"""Application configuration from environment variables."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Environment-based application settings."""
    environment: str = "dev"
    sessions_table: str = "dev-recstudio-sessions"
    topics_table: str = "dev-recstudio-topics"
    recordings_bucket: str = ""
    daily_api_key: str = ""
    daily_webhook_secret: str = ""
    daily_domain: str = ""
    daily_api_base: str = "https://api.daily.co/v1"
    frontend_origin: str = "http://localhost:5173"
    dynamodb_endpoint: str = ""  # Set to "http://host.docker.internal:8000" for SAM local
    audio_merger_function_name: str = ""  # Lambda function name for audio merger
    audio_merger_endpoint: str = ""  # Local HTTP endpoint (e.g. http://audio-merger:3002/process)

    model_config = {"env_file": ".env", "extra": "ignore"}


settings: Settings = Settings()
