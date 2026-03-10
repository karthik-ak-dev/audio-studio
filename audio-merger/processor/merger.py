"""ffmpeg-based audio track merging."""

import subprocess
import logging

from processor.config import config
from processor.constants import (
    FFMPEG_PATH,
    SAMPLE_RATE,
    FFMPEG_TIMEOUT_SEC,
    VALID_MERGE_DURATIONS,
    DEFAULT_MERGE_DURATION,
)

logger = logging.getLogger(__name__)


def merge_tracks(wav_paths: list[str], output_path: str) -> None:
    """Merge multiple mono WAV files into a single mono mix."""
    duration = config.MERGE_DURATION
    if duration not in VALID_MERGE_DURATIONS:
        logger.warning(f"Invalid MERGE_DURATION '{duration}', falling back to '{DEFAULT_MERGE_DURATION}'")
        duration = DEFAULT_MERGE_DURATION

    if len(wav_paths) < 2:
        # Single track — just copy
        cmd = [FFMPEG_PATH, "-y", "-i", wav_paths[0], "-c", "copy", output_path]
    else:
        cmd = [
            FFMPEG_PATH,
            "-y",
            "-i", wav_paths[0],
            "-i", wav_paths[1],
            "-filter_complex",
            f"amix=inputs=2:duration={duration}:normalize=0,"
            f"aformat=sample_fmts=s16:sample_rates={SAMPLE_RATE}:channel_layouts=mono",
            output_path,
        ]

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=FFMPEG_TIMEOUT_SEC,
    )
    if result.returncode != 0:
        logger.error(f"ffmpeg merge failed: {result.stderr}")
        raise RuntimeError(f"ffmpeg merge failed: {result.stderr[:500]}")
    logger.info(f"Merged {len(wav_paths)} tracks → {output_path}")
