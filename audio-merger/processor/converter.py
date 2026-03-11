"""ffmpeg-based audio conversion: WebM/Opus → WAV."""

import logging

from processor.constants import FFMPEG_PATH, SAMPLE_RATE, CHANNELS, CODEC
from processor.ffmpeg import run_ffmpeg

logger: logging.Logger = logging.getLogger(__name__)


def webm_to_wav(input_path: str, output_path: str) -> None:
    """Convert a WebM/Opus file to mono WAV (48kHz, 16-bit PCM)."""
    cmd: list[str] = [
        FFMPEG_PATH, "-y",
        "-i", input_path,
        "-vn",
        "-acodec", CODEC,
        "-ar", str(SAMPLE_RATE),
        "-ac", str(CHANNELS),
        output_path,
    ]
    run_ffmpeg(cmd, "ffmpeg conversion")
    logger.info("Converted %s → %s", input_path, output_path)
