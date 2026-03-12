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
from processor.ffmpeg import run_ffmpeg

logger: logging.Logger = logging.getLogger(__name__)


def concat_and_convert(
    session_id: str, input_paths: list[str], output_path: str,
) -> None:
    """Decode, concatenate, and convert multiple audio segments into one WAV.

    Accepts any ffmpeg-supported input format (WebM/Opus, WAV, etc.).
    Single ffmpeg pass — no intermediate files needed.

    Used when a participant disconnects and reconnects — each connection produces
    a separate track file. This decodes and stitches them together chronologically.
    """
    logger.info(
        "session=%s ffmpeg: concat+convert %d segment(s) → %s",
        session_id, len(input_paths), output_path,
    )

    inputs: list[str] = []
    for path in input_paths:
        inputs.extend(["-i", path])

    if len(input_paths) == 1:
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
            f"concat=n={len(input_paths)}:v=0:a=1,"
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


def merge_tracks(
    session_id: str, wav_paths: list[str], output_path: str,
) -> None:
    """Merge multiple mono WAV files into a single mono mix."""
    duration: str = config.MERGE_DURATION
    if duration not in VALID_MERGE_DURATIONS:
        logger.warning(
            "session=%s ffmpeg: invalid MERGE_DURATION '%s', falling back to '%s'",
            session_id, duration, DEFAULT_MERGE_DURATION,
        )
        duration = DEFAULT_MERGE_DURATION

    logger.info(
        "session=%s ffmpeg: merging %d tracks → %s (duration=%s)",
        session_id, len(wav_paths), output_path, duration,
    )

    if len(wav_paths) < 2:
        cmd: list[str] = [
            FFMPEG_PATH, "-y",
            "-i", wav_paths[0],
            "-c", "copy",
            output_path,
        ]
    else:
        filter_expr = (
            f"amix=inputs=2:duration={duration}:normalize=0,"
            f"aformat=sample_fmts=s16"
            f":sample_rates={SAMPLE_RATE}"
            f":channel_layouts=mono"
        )
        cmd = [
            FFMPEG_PATH, "-y",
            "-i", wav_paths[0],
            "-i", wav_paths[1],
            "-filter_complex", filter_expr,
            output_path,
        ]

    run_ffmpeg(cmd, f"session={session_id} ffmpeg merge")
    logger.info("session=%s ffmpeg: merge done → %s", session_id, output_path)
