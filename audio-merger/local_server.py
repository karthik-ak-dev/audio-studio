"""Local HTTP wrapper for the audio-merger Lambda handler.

Used ONLY in docker-compose for local development.
Not part of the Lambda deployment package.
"""

import logging

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from processor.handler import handler

logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s %(asctime)s [%(name)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    force=True,
)

logger = logging.getLogger("audio-merger.local")

app = FastAPI(title="Audio Merger (local)")


class ProcessRequest(BaseModel):
    """Payload for the /process endpoint."""

    session_id: str
    domain: str


@app.post("/process")
def process(req: ProcessRequest):
    """Invoke the audio-merger handler with the given session."""
    logger.info("session=%s /process invoked domain=%s", req.session_id, req.domain)
    result = handler(req.model_dump(), None)
    logger.info("session=%s /process result=%s", req.session_id, result.get("status"))
    if result.get("status") == "session_not_found":
        raise HTTPException(status_code=404, detail="Session not found")
    return result


@app.get("/health")
def health():
    """Health check endpoint."""
    return {"status": "ok"}
