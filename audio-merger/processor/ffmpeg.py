"""Shared ffmpeg subprocess runner."""

import subprocess
import logging

from processor.constants import FFMPEG_TIMEOUT_SEC

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
