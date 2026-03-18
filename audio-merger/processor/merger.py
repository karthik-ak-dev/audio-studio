"""ffmpeg-based audio track concatenation and merging.

Time alignment approach (from Daily.co's raw-tracks-tools):
  S3 key format: {domain}/session-{id}/{recordingTs}-{connId}-cam-audio-{trackTs}
  Both timestamps are Unix epoch milliseconds.
  Offset of any track from recording start = trackTs - recordingTs.

  Each segment is placed at its absolute offset using ffmpeg's adelay filter.
  Gaps (from disconnect/reconnect) become silence naturally — no duration
  probing needed, avoiding the known issue where WebM/Opus files lack
  duration metadata in the container header.

  IMPORTANT: -itsoffset does NOT work with filter graphs (amix, adelay, etc).
  It only affects muxer-level timing. Use adelay inside the filter graph instead.
"""

import logging

from processor.config import config
from processor.constants import (
    FFMPEG_PATH,
    SAMPLE_RATE,
    CHANNELS,
    CODEC,
    VALID_MERGE_DURATIONS,
    DEFAULT_MERGE_DURATION,
)
from processor.ffmpeg import run_ffmpeg

logger: logging.Logger = logging.getLogger(__name__)


def concat_and_convert(
    session_id: str,
    input_paths: list[str],
    output_path: str,
    offset_ms: list[int] | None = None,
) -> list[str]:
    """Decode and merge multiple audio segments into one WAV using absolute offsets.

    Each segment is placed at its absolute time position using ffmpeg's adelay
    filter (NOT -itsoffset, which doesn't work with filter graphs).
    Gaps between segments (e.g. participant disconnected and reconnected) become
    silence naturally. This avoids needing ffprobe duration (unreliable on raw WebM).

    Args:
        session_id: For logging.
        input_paths: Raw audio files (WebM/Opus) to merge.
        output_path: Output WAV path.
        offset_ms: Absolute offset in ms from recording start for each segment.
                   Must be same length as input_paths. If None, segments are
                   concatenated sequentially (no time alignment).

    Returns empty list (no temp files created — kept for API compatibility).
    """
    n = len(input_paths)

    if n == 1:
        # Single segment — just convert, apply offset via adelay if needed
        ofs = offset_ms[0] if offset_ms else 0
        logger.info(
            "session=%s ffmpeg: convert single segment → %s (offset=%dms)",
            session_id, output_path, ofs,
        )

        if offset_ms and offset_ms[0] > 100:
            # Pad start with silence using adelay filter
            cmd: list[str] = [
                FFMPEG_PATH, "-y",
                "-i", input_paths[0],
                "-vn",
                "-filter_complex",
                f"[0]adelay={offset_ms[0]}|{offset_ms[0]}[a];"
                f"[a]aformat=sample_fmts=s16"
                f":sample_rates={SAMPLE_RATE}"
                f":channel_layouts=mono",
                "-acodec", CODEC,
                output_path,
            ]
        else:
            cmd = [
                FFMPEG_PATH, "-y",
                "-i", input_paths[0],
                "-vn",
                "-acodec", CODEC,
                "-ar", str(SAMPLE_RATE),
                "-ac", str(CHANNELS),
                output_path,
            ]
    else:
        # Multiple segments — use adelay to place each at its absolute position,
        # then amix to merge them into one timeline.
        logger.info(
            "session=%s ffmpeg: mixing %d segments with adelay offsets → %s",
            session_id, n, output_path,
        )
        for i, path in enumerate(input_paths):
            ofs = offset_ms[i] if offset_ms else 0
            logger.info(
                "session=%s   segment %d: offset=%dms (%.1fs) path=%s",
                session_id, i, ofs, ofs / 1000.0, path,
            )

        # Build inputs (plain, no -itsoffset)
        inputs: list[str] = []
        for path in input_paths:
            inputs.extend(["-i", path])

        # Build filter graph: adelay each input, then amix all together
        # adelay=<ms>|<ms> delays both left and right channels (mono uses both)
        delay_parts: list[str] = []
        amix_inputs: list[str] = []
        for i in range(n):
            ofs = offset_ms[i] if offset_ms else 0
            if ofs > 0:
                delay_parts.append(f"[{i}]adelay={ofs}|{ofs}[d{i}]")
                amix_inputs.append(f"[d{i}]")
            else:
                amix_inputs.append(f"[{i}]")

        filter_expr = ";".join(delay_parts) + ";" if delay_parts else ""
        filter_expr += (
            "".join(amix_inputs)
            + f"amix=inputs={n}:duration=longest:normalize=0,"
            f"aformat=sample_fmts=s16"
            f":sample_rates={SAMPLE_RATE}"
            f":channel_layouts=mono"
        )

        cmd = [
            FFMPEG_PATH, "-y",
            *inputs,
            "-filter_complex", filter_expr,
            "-acodec", CODEC,
            output_path,
        ]

    run_ffmpeg(cmd, f"session={session_id} ffmpeg concat+convert")
    logger.info("session=%s ffmpeg: concat+convert done → %s", session_id, output_path)
    return []  # No temp files created


def merge_tracks(
    session_id: str,
    wav_paths: list[str],
    output_path: str,
    delay_ms: list[int] | None = None,
) -> None:
    """Merge multiple mono WAV files into a single mono mix.

    Supports N participants (not just 2). When delay_ms is provided, each
    participant's audio is delayed by the corresponding number of milliseconds
    to maintain correct time alignment (e.g., a guest who joined 500ms after
    the host gets 500ms of silence prepended).
    """
    duration: str = config.MERGE_DURATION
    if duration not in VALID_MERGE_DURATIONS:
        logger.warning(
            "session=%s ffmpeg: invalid MERGE_DURATION '%s', falling back to '%s'",
            session_id, duration, DEFAULT_MERGE_DURATION,
        )
        duration = DEFAULT_MERGE_DURATION

    n = len(wav_paths)
    logger.info(
        "session=%s ffmpeg: merging %d tracks → %s (duration=%s, delays=%s)",
        session_id, n, output_path, duration, delay_ms,
    )

    if n < 2:
        cmd: list[str] = [
            FFMPEG_PATH, "-y",
            "-i", wav_paths[0],
            "-c", "copy",
            output_path,
        ]
    else:
        # Build input args for all participants
        inputs: list[str] = []
        for path in wav_paths:
            inputs.extend(["-i", path])

        # Build filter: optionally delay each input, then amix all
        if delay_ms and any(d > 0 for d in delay_ms):
            # Apply adelay to each input that has a non-zero offset
            delay_parts: list[str] = []
            amix_inputs: list[str] = []
            for i, d in enumerate(delay_ms):
                if d > 0:
                    delay_parts.append(f"[{i}]adelay={d}|{d}[d{i}]")
                    amix_inputs.append(f"[d{i}]")
                else:
                    amix_inputs.append(f"[{i}]")
            filter_expr = ";".join(delay_parts) + ";" if delay_parts else ""
            filter_expr += (
                "".join(amix_inputs)
                + f"amix=inputs={n}:duration={duration}:normalize=0,"
                f"aformat=sample_fmts=s16"
                f":sample_rates={SAMPLE_RATE}"
                f":channel_layouts=mono"
            )
        else:
            # No alignment needed — straightforward amix
            filter_expr = (
                f"amix=inputs={n}:duration={duration}:normalize=0,"
                f"aformat=sample_fmts=s16"
                f":sample_rates={SAMPLE_RATE}"
                f":channel_layouts=mono"
            )

        cmd = [
            FFMPEG_PATH, "-y",
            *inputs,
            "-filter_complex", filter_expr,
            output_path,
        ]

    run_ffmpeg(cmd, f"session={session_id} ffmpeg merge")
    logger.info("session=%s ffmpeg: merge done → %s", session_id, output_path)
