"""FastAPI application setup."""

import logging
import time
import re

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routes import sessions, recordings, webhooks

# ── Logging setup ─────────────────────────────────
# Format: [LEVEL] [timestamp] [module] message
# All API logs include session=<id> in message — searchable in CloudWatch.
logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s %(asctime)s [%(name)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    force=True,
)
# Suppress noisy libraries
logging.getLogger("boto3").setLevel(logging.WARNING)
logging.getLogger("botocore").setLevel(logging.WARNING)
logging.getLogger("urllib3").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

logger: logging.Logger = logging.getLogger("api")

app: FastAPI = FastAPI(
    title="Audio Recording Platform API",
    version="2.0.0",
    docs_url="/docs" if settings.environment != "prod" else None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Regex to extract session_id from URL paths like /sessions/{session_id}/...
_SESSION_ID_RE = re.compile(r"/sessions/([a-f0-9]+)")


@app.middleware("http")
async def log_requests(request: Request, call_next) -> Response:
    """Log every request with session_id context and duration."""
    start = time.monotonic()
    path = request.url.path

    # Skip noisy health checks
    if path == "/health":
        return await call_next(request)

    # Extract session_id from path if present
    match = _SESSION_ID_RE.search(path)
    session_tag = f"session={match.group(1)}" if match else "session=-"

    response: Response = await call_next(request)
    duration_ms = (time.monotonic() - start) * 1000

    logger.info(
        "%s %s %s → %d (%.0fms)",
        request.method, path, session_tag, response.status_code, duration_ms,
    )
    return response


app.include_router(sessions.router, prefix="/sessions", tags=["sessions"])
app.include_router(recordings.router, prefix="/recordings", tags=["recordings"])
app.include_router(webhooks.router, prefix="/webhooks", tags=["webhooks"])


@app.get("/health")
async def health() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "ok", "version": "2.0.0"}
