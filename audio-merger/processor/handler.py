"""Lambda entry point — triggered by S3 events when Daily uploads audio tracks."""

import os
import re
import logging
from typing import Optional

from processor.config import config
from processor.constants import (
    AUDIO_TRACK_IDENTIFIER,
    EXPECTED_TRACKS_PER_SESSION,
)
from processor.s3_client import (
    list_audio_tracks,
    download_track,
    upload_file,
    processed_exists,
)
from processor.converter import webm_to_wav
from processor.merger import merge_tracks
from processor.session_store import get_session, update_status

logger: logging.Logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Regex to extract connectionId from Daily.co S3 key:
#   {domain}/session-{id}/{ts}-{connectionId}-cam-audio-{trackTs}
# connectionId is a UUID (8-4-4-4-12 hex).
CONNECTION_ID_RE: re.Pattern[str] = re.compile(
    r"\d+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-"
    r"[0-9a-f]{4}-[0-9a-f]{12})-cam-audio-"
)


def _extract_connection_id(s3_key: str) -> Optional[str]:
    """Extract the Daily connectionId (UUID) from an S3 key."""
    match = CONNECTION_ID_RE.search(s3_key)
    return match.group(1) if match else None


def _build_participant_map(
    session: dict,
) -> dict[str, dict[str, str]]:
    """Build a connectionId → {role, name} map from session data.

    DynamoDB session contains:
      participant_connections: {userId: connectionId}
      participants:            {userId: displayName}
    """
    connections: dict = session.get("participant_connections", {})
    names: dict = session.get("participants", {})
    result: dict[str, dict[str, str]] = {}

    for user_id, conn_id in connections.items():
        role = "host" if user_id.startswith("host-") else "guest"
        name = names.get(user_id, role.capitalize())
        result[conn_id] = {"role": role, "name": name}

    return result


def _sanitize_filename(name: str) -> str:
    """Sanitize a name for use in a filename."""
    sanitized = re.sub(r"[^\w\s-]", "", name).strip().lower()
    sanitized = re.sub(r"[\s]+", "-", sanitized)
    return sanitized or "unknown"


def _resolve_track_name(
    s3_key: str,
    index: int,
    participant_map: dict[str, dict[str, str]],
) -> str:
    """Resolve a human-readable upload name for a track."""
    conn_id = _extract_connection_id(s3_key)
    if conn_id and conn_id in participant_map:
        info = participant_map[conn_id]
        safe_name = _sanitize_filename(info["name"])
        return f"{info['role']}-{safe_name}"

    fallback = "host" if index == 0 else "guest"
    logger.warning(
        "Track %d: connectionId %s not in map, using %s",
        index, conn_id, fallback,
    )
    return f"{fallback}-speaker-{index + 1}"


def handler(event: dict, _context: object) -> dict:
    """S3 event handler — waits for both tracks, then converts and merges."""
    for record in event.get("Records", []):
        s3_key: str = record["s3"]["object"]["key"]
        logger.info("S3 event: %s", s3_key)

        parts = s3_key.split("/")
        if len(parts) < 3 or AUDIO_TRACK_IDENTIFIER not in s3_key:
            logger.warning("Skipping non-audio key: %s", s3_key)
            continue

        domain = parts[0]
        room_name = parts[1]
        session_id = (
            room_name.removeprefix("session-")
            if room_name.startswith("session-")
            else room_name
        )

        if processed_exists(session_id):
            logger.info(
                "Session %s already processed, skipping", session_id,
            )
            continue

        room_prefix = f"{domain}/{room_name}/"
        tracks = list_audio_tracks(room_prefix)

        if len(tracks) < EXPECTED_TRACKS_PER_SESSION:
            logger.info(
                "Session %s: %d/%d tracks — waiting",
                session_id, len(tracks), EXPECTED_TRACKS_PER_SESSION,
            )
            continue

        logger.info(
            "Session %s: all tracks present — processing", session_id,
        )
        _process_session(
            session_id, tracks[:EXPECTED_TRACKS_PER_SESSION],
        )

    return {"status": "ok"}


def _download_and_resolve(
    track_keys: list[str],
    session_id: str,
) -> tuple[list[str], list[str]]:
    """Download tracks from S3 and resolve participant-based file names."""
    session = get_session(session_id)
    participant_map = _build_participant_map(session) if session else {}
    if participant_map:
        logger.info(
            "Session %s: participant map — %s",
            session_id, participant_map,
        )
    else:
        logger.warning(
            "Session %s: no participant map, using fallback names",
            session_id,
        )

    local_paths: list[str] = []
    names: list[str] = []
    for i, s3_key in enumerate(track_keys):
        local_path = f"/tmp/track_{i}.webm"
        download_track(s3_key, local_path)
        local_paths.append(local_path)
        names.append(_resolve_track_name(s3_key, i, participant_map))

    return local_paths, names


def _process_session(session_id: str, track_keys: list[str]) -> None:
    """Download tracks, convert to WAV, merge, upload with proper names."""
    local_tracks: list[str] = []
    wav_files: list[str] = []

    try:
        local_tracks, upload_names = _download_and_resolve(
            track_keys, session_id,
        )

        # Convert each to mono WAV
        for i, track_path in enumerate(local_tracks):
            wav_path = f"/tmp/{upload_names[i]}.wav"
            webm_to_wav(track_path, wav_path)
            wav_files.append(wav_path)

        # Merge into combined
        combined_path = "/tmp/combined.wav"
        merge_tracks(wav_files, combined_path)
        wav_files.append(combined_path)

        # Upload into processed/session-{sessionId}/
        output_prefix = f"{config.PROCESSED_PREFIX}session-{session_id}"
        for wav_path in wav_files:
            filename = os.path.basename(wav_path)
            upload_file(wav_path, f"{output_prefix}/{filename}")

        # Update session status
        update_status(
            session_id,
            "completed",
            s3_processed_prefix=(
                f"s3://{config.RECORDINGS_BUCKET}/{output_prefix}/"
            ),
        )
        logger.info("Session %s: processing complete", session_id)

    except Exception as exc:
        logger.error("Session %s: processing failed — %s", session_id, exc)
        update_status(session_id, "error", error_message=str(exc)[:500])
        raise

    finally:
        for path in [*local_tracks, *wav_files]:
            try:
                os.remove(path)
            except OSError:
                pass
