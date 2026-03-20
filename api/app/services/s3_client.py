"""S3 client — presigned URL generation and S3 operations."""

import logging
from urllib.parse import urlparse

import boto3
from botocore.exceptions import ClientError

from app.constants import PRESIGNED_URL_EXPIRY_SEC

logger: logging.Logger = logging.getLogger(__name__)

_s3_client = boto3.client("s3")


def generate_presigned_url(s3_uri: str | None) -> str | None:
    """Convert an s3://bucket/key URI to a presigned HTTPS URL.

    Returns None if the input is None/empty or if generation fails.
    """
    if not s3_uri:
        return None

    parsed = urlparse(s3_uri)
    bucket: str = parsed.netloc
    key: str = parsed.path.lstrip("/")

    if not bucket or not key:
        logger.warning("Cannot generate presigned URL — invalid S3 URI: %s", s3_uri)
        return None

    try:
        return _s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=PRESIGNED_URL_EXPIRY_SEC,
        )
    except ClientError as exc:
        logger.error("Failed to generate presigned URL for %s: %s", s3_uri, exc)
        return None
