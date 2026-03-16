"""ffmpeg-based audio track concatenation and merging."""

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
from processor.ffmpeg import run_ffmpeg, probe_duration_ms

logger: logging.Logger = logging.getLogger(__name__)


def _generate_silence(output_path: str, duration_ms: int, session_id: str) -> None:
    """Generate a silent WAV file of the given duration."""
    duration_sec = duration_ms / 1000.0
    cmd: list[str] = [
        FFMPEG_PATH, "-y",
        "-f", "lavfi",
        "-i", f"anullsrc=r={SAMPLE_RATE}:cl=mono",
        "-t", f"{duration_sec:.3f}",
        "-acodec", CODEC,
        "-ar", str(SAMPLE_RATE),
        "-ac", str(CHANNELS),
        output_path,
    ]
    run_ffmpeg(cmd, f"session={session_id} ffmpeg generate-silence ({duration_ms}ms)")
    logger.info(
        "session=%s Generated %dms silence → %s",
        session_id, duration_ms, output_path,
    )


def concat_and_convert(
    session_id: str,
    input_paths: list[str],
    output_path: str,
    track_timestamps_ms: list[int] | None = None,
) -> list[str]:
    """Decode, concatenate, and convert multiple audio segments into one WAV.

    Accepts any ffmpeg-supported input format (WebM/Opus, WAV, etc.).

    When track_timestamps_ms is provided (one per input_path), gaps between
    consecutive segments are detected using ffprobe durations and filled with
    silence so that the final WAV preserves real-time alignment.

    Returns a list of any temporary silence files created (caller must clean up).
    """
    silence_temps: list[str] = []

    # ── Build the effective input list, inserting silence for gaps ──
    effective_inputs: list[str] = list(input_paths)

    if track_timestamps_ms and len(input_paths) > 1:
        effective_inputs = []
        for i, path in enumerate(input_paths):
            if i > 0:
                prev_start = track_timestamps_ms[i - 1]
                prev_duration = probe_duration_ms(input_paths[i - 1])
                curr_start = track_timestamps_ms[i]

                if prev_duration > 0:
                    gap_ms = curr_start - (prev_start + prev_duration)
                else:
                    # Cannot determine gap without duration — skip silence
                    gap_ms = 0

                if gap_ms > 100:  # Only insert silence for gaps > 100ms
                    silence_path = f"{output_path}.silence_{i}.wav"
                    _generate_silence(silence_path, gap_ms, session_id)
                    effective_inputs.append(silence_path)
                    silence_temps.append(silence_path)
                    logger.info(
                        "session=%s Inserting %dms silence between segment %d and %d",
                        session_id, gap_ms, i - 1, i,
                    )
                elif gap_ms < -100:
                    logger.warning(
                        "session=%s Negative gap %dms between segment %d and %d (overlap?)",
                        session_id, gap_ms, i - 1, i,
                    )

            effective_inputs.append(path)

    n_inputs = len(effective_inputs)
    logger.info(
        "session=%s ffmpeg: concat+convert %d segment(s) (%d effective inputs) → %s",
        session_id, len(input_paths), n_inputs, output_path,
    )

    inputs: list[str] = []
    for path in effective_inputs:
        inputs.extend(["-i", path])

    if n_inputs == 1:
        # Single segment — just convert (no concat filter needed)
        cmd: list[str] = [
            FFMPEG_PATH, "-y",
            *inputs,
            "-vn",
            "-acodec", CODEC,
            "-ar", str(SAMPLE_RATE),
            "-ac", str(CHANNELS),
            output_path,
        ]
    else:
        # Multiple segments — concat + convert in one pass
        filter_expr = (
            f"concat=n={n_inputs}:v=0:a=1,"
            f"aformat=sample_fmts=s16"
            f":sample_rates={SAMPLE_RATE}"
            f":channel_layouts=mono"
        )
        cmd = [
            FFMPEG_PATH, "-y",
            *inputs,
            "-filter_complex", filter_expr,
            "-acodec", CODEC,
            "-ar", str(SAMPLE_RATE),
            "-ac", str(CHANNELS),
            output_path,
        ]

    run_ffmpeg(cmd, f"session={session_id} ffmpeg concat+convert")
    logger.info(
        "session=%s ffmpeg: concat+convert done → %s",
        session_id, output_path,
    )
    return silence_temps


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
