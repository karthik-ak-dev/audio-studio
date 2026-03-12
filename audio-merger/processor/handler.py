"""Lambda entry point — triggered by S3 events when Daily uploads audio tracks."""

import os
import re
import logging
from typing import Optional
from collections import defaultdict

from processor.config import config
from processor.constants import (
    AUDIO_TRACK_IDENTIFIER,
    MIN_PARTICIPANTS,
)
from processor.s3_client import (
    list_audio_tracks,
    download_track,
    upload_file,
    processed_exists,
)
from processor.converter import webm_to_wav
from processor.merger import merge_tracks, concat_tracks
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

    Uses connection_history (connectionId → userId) which is append-only
    and contains ALL connection IDs ever used, including reconnections.

    Falls back to inverting participant_connections for older sessions
    that don't have connection_history yet.
    """
    names: dict = session.get("participants", {})
    history: dict = session.get("connection_history", {})
    result: dict[str, dict[str, str]] = {}

    if history:
        # Preferred: connection_history has ALL connectionIds
        for conn_id, user_id in history.items():
            role = "host" if user_id.startswith("host-") else "guest"
            name = names.get(user_id, role.capitalize())
            result[conn_id] = {"role": role, "name": name}
    else:
        # Fallback: invert participant_connections (only has latest per user)
        connections: dict = session.get("participant_connections", {})
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


def _group_tracks_by_participant(
    track_keys: list[str],
    participant_map: dict[str, dict[str, str]],
) -> dict[str, list[str]]:
    """Group S3 track keys by participant role-name.

    Returns e.g.:
      {"host-ak": ["s3/key1"], "guest-yv": ["s3/key2", "s3/key3"]}

    Track keys within each group are already sorted chronologically
    (list_audio_tracks returns sorted keys, and the filename contains
    timestamps that sort correctly).
    """
    groups: dict[str, list[str]] = defaultdict(list)
    unmatched_index = 0

    for s3_key in track_keys:
        conn_id = _extract_connection_id(s3_key)
        if conn_id and conn_id in participant_map:
            info = participant_map[conn_id]
            safe_name = _sanitize_filename(info["name"])
            group_key = f"{info['role']}-{safe_name}"
        else:
            # Fallback for tracks we can't map
            fallback = "host" if unmatched_index == 0 else "guest"
            group_key = f"{fallback}-speaker-{unmatched_index + 1}"
            unmatched_index += 1
            logger.warning(
                "Track connectionId %s not in map, assigned to %s",
                conn_id, group_key,
            )
        groups[group_key].append(s3_key)

    return dict(groups)


def _count_distinct_participants(
    track_keys: list[str],
    participant_map: dict[str, dict[str, str]],
) -> int:
    """Count how many distinct participant roles have tracks."""
    roles: set[str] = set()
    for s3_key in track_keys:
        conn_id = _extract_connection_id(s3_key)
        if conn_id and conn_id in participant_map:
            roles.add(participant_map[conn_id]["role"])
    return len(roles)


def handler(event: dict, _context: object) -> dict:
    """S3 event handler — waits for tracks from all participants, then processes."""
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

        # Load session to get connection_history for participant mapping
        session = get_session(session_id)
        if not session:
            logger.warning("Session %s not found in DynamoDB, skipping", session_id)
            continue

        participant_map = _build_participant_map(session)

        room_prefix = f"{domain}/{room_name}/"
        tracks = list_audio_tracks(room_prefix)

        # Wait until we have tracks from at least MIN_PARTICIPANTS distinct participants
        distinct = _count_distinct_participants(tracks, participant_map)
        if distinct < MIN_PARTICIPANTS:
            logger.info(
                "Session %s: %d tracks from %d/%d participants — waiting",
                session_id, len(tracks), distinct, MIN_PARTICIPANTS,
            )
            continue

        logger.info(
            "Session %s: %d tracks from %d participants — processing",
            session_id, len(tracks), distinct,
        )
        _process_session(session_id, tracks, participant_map)

    return {"status": "ok"}


def _process_session(
    session_id: str,
    track_keys: list[str],
    participant_map: dict[str, dict[str, str]],
) -> None:
    """Download all tracks, group by participant, concat segments, merge, upload."""
    temp_files: list[str] = []

    try:
        # Group tracks by participant
        groups = _group_tracks_by_participant(track_keys, participant_map)
        logger.info(
            "Session %s: track groups — %s",
            session_id,
            {k: len(v) for k, v in groups.items()},
        )

        consolidated_wavs: list[str] = []
        consolidated_names: list[str] = []

        for group_name, group_keys in sorted(groups.items()):
            # Download all segments for this participant
            segment_wavs: list[str] = []
            for i, s3_key in enumerate(group_keys):
                local_webm = f"/tmp/{group_name}_seg{i}.webm"
                download_track(s3_key, local_webm)
                temp_files.append(local_webm)

                # Convert each segment to WAV
                local_wav = f"/tmp/{group_name}_seg{i}.wav"
                webm_to_wav(local_webm, local_wav)
                segment_wavs.append(local_wav)
                temp_files.append(local_wav)

            # Concatenate segments into one file per participant
            concat_path = f"/tmp/{group_name}.wav"
            concat_tracks(segment_wavs, concat_path)
            temp_files.append(concat_path)

            consolidated_wavs.append(concat_path)
            consolidated_names.append(group_name)

        # Merge all participants into combined
        combined_path = "/tmp/combined.wav"
        merge_tracks(consolidated_wavs, combined_path)
        temp_files.append(combined_path)

        # Upload: individual participant files + combined
        output_prefix = f"{config.PROCESSED_PREFIX}session-{session_id}"
        for wav_path in [*consolidated_wavs, combined_path]:
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
        for path in temp_files:
            try:
                os.remove(path)
            except OSError:
                pass
