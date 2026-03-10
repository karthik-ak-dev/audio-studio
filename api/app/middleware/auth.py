"""API authentication middleware."""

from fastapi import Header, HTTPException

from app.config import settings


async def verify_api_key(x_api_key: str = Header(alias="X-Api-Key")) -> str:
    """Verify API key from request header. Use as a FastAPI dependency."""
    if not settings.daily_api_key:
        return "dev"
    if x_api_key != settings.daily_api_key:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return x_api_key
