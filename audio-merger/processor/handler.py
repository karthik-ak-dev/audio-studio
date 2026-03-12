"""Lambda entry point — invoked by API webhook handler after recording.ready-to-download.

Trigger: Direct Lambda invocation from the API's on_recording_ready_to_download handler.
Payload: {"session_id": "abc123", "domain": "ak-kgen"}

NOT triggered by S3 events — see ARCHITECTURE.md Flow 17 for why S3 events
cause a race condition when participants disconnect mid-recording.
"""

import os
import re
import logging
from typing import Optional
from collections import defaultdict

from processor.config import config
from processor.s3_client import (
    list_audio_tracks,
    download_track,
    upload_file,
    processed_exists,
)
from processor.merger import merge_tracks, concat_and_convert
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
    """
    names: dict = session.get("participants", {})
    history: dict = session.get("connection_history", {})
    result: dict[str, dict[str, str]] = {}

    for conn_id, user_id in history.items():
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


def _process_session(
    session_id: str,
    track_keys: list[str],
    participant_map: dict[str, dict[str, str]],
) -> None:
    """Download all tracks, group by participant, concat+convert, merge, upload.

    Pipeline per participant (single ffmpeg pass):
      WebM segments → [decode + concat + convert] → one WAV per participant

    Then merge participant WAVs into combined.wav.
    """
    temp_files: list[str] = []

    try:
        # Group tracks by participant
        groups = _group_tracks_by_participant(track_keys, participant_map)
        logger.info(
            "Session %s: track groups — %s",
            session_id,
            {k: len(v) for k, v in groups.items()},
        )

        participant_wavs: list[str] = []

        for group_name, group_keys in sorted(groups.items()):
            # Download all raw segments for this participant
            local_segments: list[str] = []
            for i, s3_key in enumerate(group_keys):
                local_path = f"/tmp/{group_name}_seg{i}.webm"
                download_track(s3_key, local_path)
                local_segments.append(local_path)
                temp_files.append(local_path)

            # Single ffmpeg pass: decode + concat + convert → one WAV
            output_wav = f"/tmp/{group_name}.wav"
            concat_and_convert(local_segments, output_wav)
            participant_wavs.append(output_wav)
            temp_files.append(output_wav)

        # Merge all participants into combined
        combined_path = "/tmp/combined.wav"
        merge_tracks(participant_wavs, combined_path)
        temp_files.append(combined_path)

        # Upload: individual participant files + combined
        output_prefix = f"{config.processed_prefix}session-{session_id}"
        for wav_path in [*participant_wavs, combined_path]:
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

def handler(event: dict, _context: object) -> dict:
    """Direct invocation handler — called by API after recording.ready-to-download.

    Expected payload: {"session_id": "abc123", "domain": "ak-kgen"}
    """
    session_id: str = event["session_id"]
    domain: str = event["domain"]

    logger.info("Invoked for session=%s domain=%s", session_id, domain)

    # Idempotency guard — skip if already processed
    if processed_exists(session_id):
        logger.info("Session %s already processed, skipping", session_id)
        return {"status": "already_processed"}

    # Load session for participant mapping
    session = get_session(session_id)
    if not session:
        logger.error("Session %s not found in DynamoDB", session_id)
        return {"status": "session_not_found"}

    participant_map = _build_participant_map(session)

    # List all audio tracks for this session
    room_prefix = f"{domain}/session-{session_id}/"
    tracks = list_audio_tracks(room_prefix)

    if not tracks:
        logger.error("Session %s: no audio tracks found at %s", session_id, room_prefix)
        update_status(session_id, "error", error_message="No audio tracks found in S3")
        return {"status": "no_tracks"}

    logger.info("Session %s: %d tracks — processing", session_id, len(tracks))
    _process_session(session_id, tracks, participant_map)

    return {"status": "ok"}
