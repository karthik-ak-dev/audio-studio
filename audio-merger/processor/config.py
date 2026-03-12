"""Processor configuration from environment variables."""

import os


class ProcessorConfig:  # pylint: disable=too-few-public-methods
    """Audio-merger processor configuration loaded from environment variables."""
    RECORDINGS_BUCKET: str = os.environ.get("RECORDINGS_BUCKET", "")
    SESSIONS_TABLE: str = os.environ.get("SESSIONS_TABLE", "")
    DAILY_DOMAIN: str = os.environ.get("DAILY_DOMAIN", "")
    PROCESSED_PREFIX: str = os.environ.get("PROCESSED_PREFIX", "")
    MERGE_DURATION: str = os.environ.get("MERGE_DURATION", "longest")
    ENVIRONMENT: str = os.environ.get("ENVIRONMENT", "dev")
    DYNAMODB_ENDPOINT: str = os.environ.get("DYNAMODB_ENDPOINT", "")

    @property
    def processed_prefix(self) -> str:
        """Resolved processed prefix — defaults to {DAILY_DOMAIN}-processed/.

        Priority:
          1. PROCESSED_PREFIX env var (explicit override)
          2. {DAILY_DOMAIN}-processed/ (e.g. "ak-kgen-processed/")
          3. "processed/" (fallback)
        """
        if self.PROCESSED_PREFIX:
            return self.PROCESSED_PREFIX
        if self.DAILY_DOMAIN:
            return f"{self.DAILY_DOMAIN}-processed/"
        return "processed/"


config = ProcessorConfig()
