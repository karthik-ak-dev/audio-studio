"""Application configuration from environment variables."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    environment: str = "dev"
    sessions_table: str = "audio-sessions-dev"
    recordings_bucket: str = ""
    daily_api_key: str = ""
    daily_webhook_secret: str = ""
    daily_domain: str = ""
    daily_api_base: str = "https://api.daily.co/v1"
    frontend_origin: str = "http://localhost:5173"

    model_config = {"env_file": ".env", "extra": "ignore"}


settings: Settings = Settings()
