"""S3 operations for downloading raw tracks and uploading processed WAVs."""

import re
import logging

import boto3

from processor.config import config
from processor.constants import AUDIO_TRACK_IDENTIFIER

logger: logging.Logger = logging.getLogger(__name__)
s3 = boto3.client("s3")

# S3 key format from Daily.co raw-tracks:
#   {domain}/session-{id}/{recordingTs}-{connId}-cam-audio-{trackTs}
# Both timestamps are Unix epoch in milliseconds.
_TRACK_TS_RE: re.Pattern[str] = re.compile(r"cam-audio-(\d+)$")
_RECORDING_TS_RE: re.Pattern[str] = re.compile(r"/(\d+)-[0-9a-f]{8}-")


def track_timestamp(s3_key: str) -> int:
    """Extract trackTimestamp (ms since epoch) from S3 key for sorting."""
    match = _TRACK_TS_RE.search(s3_key)
    return int(match.group(1)) if match else 0


def recording_timestamp(s3_key: str) -> int:
    """Extract recordingTimestamp (ms since epoch) from S3 key.

    This is the same across all tracks in one recording session.
    Used with track_timestamp to calculate absolute offset:
        offset_ms = track_timestamp(key) - recording_timestamp(key)
    """
    match = _RECORDING_TS_RE.search(s3_key)
    return int(match.group(1)) if match else 0


def list_audio_tracks(session_id: str, room_prefix: str) -> list[str]:
    """List all audio track files for a recording session.

    Returns keys sorted by trackTimestamp (the actual audio start time),
    NOT by the full key string which would sort by recordingTimestamp.
    """
    logger.info(
        "session=%s S3: listing tracks bucket=%s prefix=%s",
        session_id, config.RECORDINGS_BUCKET, room_prefix,
    )
    response = s3.list_objects_v2(
        Bucket=config.RECORDINGS_BUCKET,
        Prefix=room_prefix,
    )
    contents = response.get("Contents", [])
    all_keys = [obj["Key"] for obj in contents]
    tracks = [key for key in all_keys if AUDIO_TRACK_IDENTIFIER in key]
    tracks.sort(key=track_timestamp)
    logger.info(
        "session=%s S3: found %d objects, %d audio tracks under %s",
        session_id, len(all_keys), len(tracks), room_prefix,
    )
    return tracks


def download_track(session_id: str, s3_key: str, local_path: str) -> None:
    """Download a single track from S3 to local filesystem."""
    s3.download_file(config.RECORDINGS_BUCKET, s3_key, local_path)
    logger.info("session=%s S3: downloaded %s", session_id, s3_key)


def upload_file(session_id: str, local_path: str, s3_key: str) -> None:
    """Upload a processed file to S3."""
    s3.upload_file(local_path, config.RECORDINGS_BUCKET, s3_key)
    logger.info("session=%s S3: uploaded → %s", session_id, s3_key)


def processed_exists(session_id: str) -> bool:
    """Check if this session has already been processed."""
    key = f"{config.processed_prefix}session-{session_id}/combined.wav"
    response = s3.list_objects_v2(
        Bucket=config.RECORDINGS_BUCKET,
        Prefix=key,
        MaxKeys=1,
    )
    exists = bool(response.get("Contents"))
    logger.info(
        "session=%s S3: idempotency check key=%s exists=%s",
        session_id, key, exists,
    )
    return exists
