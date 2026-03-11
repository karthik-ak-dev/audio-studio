"""ffmpeg-based audio track merging."""

import logging

from processor.config import config
from processor.constants import (
    FFMPEG_PATH,
    SAMPLE_RATE,
    VALID_MERGE_DURATIONS,
    DEFAULT_MERGE_DURATION,
)
from processor.ffmpeg import run_ffmpeg

logger: logging.Logger = logging.getLogger(__name__)


def merge_tracks(wav_paths: list[str], output_path: str) -> None:
    """Merge multiple mono WAV files into a single mono mix."""
    duration: str = config.MERGE_DURATION
    if duration not in VALID_MERGE_DURATIONS:
        logger.warning(
            "Invalid MERGE_DURATION '%s', falling back to '%s'",
            duration, DEFAULT_MERGE_DURATION,
        )
        duration = DEFAULT_MERGE_DURATION

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

    run_ffmpeg(cmd, "ffmpeg merge")
    logger.info("Merged %d tracks → %s", len(wav_paths), output_path)
