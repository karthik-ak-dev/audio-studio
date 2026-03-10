"""Processor configuration from environment variables."""

import os


class ProcessorConfig:
    RECORDINGS_BUCKET: str = os.environ.get("RECORDINGS_BUCKET", "")
    SESSIONS_TABLE: str = os.environ.get("SESSIONS_TABLE", "")
    DAILY_DOMAIN: str = os.environ.get("DAILY_DOMAIN", "")
    PROCESSED_PREFIX: str = os.environ.get("PROCESSED_PREFIX", "processed/")
    ENVIRONMENT: str = os.environ.get("ENVIRONMENT", "dev")


config = ProcessorConfig()
