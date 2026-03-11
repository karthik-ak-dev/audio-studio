"""S3 operations for downloading raw tracks and uploading processed WAVs."""

import logging

import boto3

from processor.config import config
from processor.constants import AUDIO_TRACK_IDENTIFIER

logger: logging.Logger = logging.getLogger(__name__)
s3 = boto3.client("s3")


def list_audio_tracks(room_prefix: str) -> list[str]:
    """List all audio track files for a recording session."""
    response = s3.list_objects_v2(
        Bucket=config.RECORDINGS_BUCKET,
        Prefix=room_prefix,
    )
    contents = response.get("Contents", [])
    tracks = [
        obj["Key"]
        for obj in contents
        if AUDIO_TRACK_IDENTIFIER in obj["Key"]
    ]
    logger.info("Found %d audio tracks under %s", len(tracks), room_prefix)
    return sorted(tracks)


def download_track(s3_key: str, local_path: str) -> None:
    """Download a single track from S3 to local filesystem."""
    s3.download_file(config.RECORDINGS_BUCKET, s3_key, local_path)
    logger.info(
        "Downloaded s3://%s/%s → %s",
        config.RECORDINGS_BUCKET, s3_key, local_path,
    )


def upload_file(local_path: str, s3_key: str) -> None:
    """Upload a processed file to S3."""
    s3.upload_file(local_path, config.RECORDINGS_BUCKET, s3_key)
    logger.info(
        "Uploaded %s → s3://%s/%s",
        local_path, config.RECORDINGS_BUCKET, s3_key,
    )


def processed_exists(session_id: str) -> bool:
    """Check if this session has already been processed."""
    key = f"{config.PROCESSED_PREFIX}session-{session_id}/combined.wav"
    response = s3.list_objects_v2(
        Bucket=config.RECORDINGS_BUCKET,
        Prefix=key,
        MaxKeys=1,
    )
    return bool(response.get("Contents"))
