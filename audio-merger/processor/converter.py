"""ffmpeg-based audio conversion: WebM/Opus → WAV."""

import subprocess
import logging

from processor.constants import (
    FFMPEG_PATH,
    SAMPLE_RATE,
    CHANNELS,
    CODEC,
    FFMPEG_TIMEOUT_SEC,
)

logger = logging.getLogger(__name__)


def webm_to_wav(input_path: str, output_path: str) -> None:
    """Convert a WebM/Opus file to mono WAV (48kHz, 16-bit PCM)."""
    cmd = [
        FFMPEG_PATH,
        "-y",
        "-i", input_path,
        "-vn",
        "-acodec", CODEC,
        "-ar", str(SAMPLE_RATE),
        "-ac", str(CHANNELS),
        output_path,
    ]
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=FFMPEG_TIMEOUT_SEC,
    )
    if result.returncode != 0:
        logger.error(f"ffmpeg conversion failed: {result.stderr}")
        raise RuntimeError(f"ffmpeg conversion failed: {result.stderr[:500]}")
    logger.info(f"Converted {input_path} → {output_path}")
