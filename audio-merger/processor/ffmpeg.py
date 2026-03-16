"""Shared ffmpeg/ffprobe subprocess helpers."""

import subprocess
import logging

from processor.constants import FFMPEG_TIMEOUT_SEC, FFPROBE_PATH

logger: logging.Logger = logging.getLogger(__name__)


def run_ffmpeg(cmd: list[str], description: str) -> None:
    """Run an ffmpeg command and raise on failure."""
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=FFMPEG_TIMEOUT_SEC,
        check=False,
    )
    if result.returncode != 0:
        logger.error("%s failed: %s", description, result.stderr)
        raise RuntimeError(
            f"{description} failed: {result.stderr[:500]}"
        )


def probe_duration_ms(file_path: str) -> int:
    """Get audio duration in milliseconds using ffprobe.

    Returns 0 if duration cannot be determined.
    """
    cmd: list[str] = [
        FFPROBE_PATH,
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        file_path,
    ]
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    if result.returncode != 0:
        logger.warning("ffprobe failed for %s: %s", file_path, result.stderr)
        return 0

    try:
        return int(float(result.stdout.strip()) * 1000)
    except (ValueError, TypeError):
        logger.warning("ffprobe returned unparseable duration for %s: %s", file_path, result.stdout)
        return 0
