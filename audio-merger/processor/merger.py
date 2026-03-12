"""ffmpeg-based audio track concatenation and merging."""

import logging
import shutil

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


def concat_tracks(wav_paths: list[str], output_path: str) -> None:
    """Concatenate multiple WAV segments from the same participant into one file.

    Used when a participant disconnects and reconnects — each connection produces
    a separate track file. This stitches them together chronologically.
    """
    if len(wav_paths) == 1:
        shutil.copy2(wav_paths[0], output_path)
        logger.info("Single segment, copied %s → %s", wav_paths[0], output_path)
        return

    # Build ffmpeg concat filter: input all files, concatenate audio streams
    inputs: list[str] = []
    for path in wav_paths:
        inputs.extend(["-i", path])

    filter_expr = (
        f"concat=n={len(wav_paths)}:v=0:a=1,"
        f"aformat=sample_fmts=s16"
        f":sample_rates={SAMPLE_RATE}"
        f":channel_layouts=mono"
    )

    cmd: list[str] = [
        FFMPEG_PATH, "-y",
        *inputs,
        "-filter_complex", filter_expr,
        "-acodec", CODEC,
        "-ar", str(SAMPLE_RATE),
        "-ac", str(CHANNELS),
        output_path,
    ]

    run_ffmpeg(cmd, "ffmpeg concat")
    logger.info("Concatenated %d segments → %s", len(wav_paths), output_path)


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
