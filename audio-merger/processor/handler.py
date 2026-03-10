"""Lambda entry point — triggered by S3 events when Daily uploads audio tracks."""

import os
import logging

from processor.config import config
from processor.constants import AUDIO_TRACK_IDENTIFIER, EXPECTED_TRACKS_PER_SESSION
from processor.s3_client import list_audio_tracks, download_track, upload_file, processed_exists
from processor.converter import webm_to_wav
from processor.merger import merge_tracks
from processor.session_store import update_status

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def handler(event: dict, context: object) -> dict:
    """
    S3 event handler. Triggered when Daily uploads an audio track.
    Waits for both tracks, then converts and merges.
    """
    for record in event.get("Records", []):
        s3_key: str = record["s3"]["object"]["key"]
        logger.info(f"S3 event: {s3_key}")

        # Parse the S3 key: {domain}/{room_name}/{timestamp}-{pid}-cam-audio-{ts}
        parts = s3_key.split("/")
        if len(parts) < 3 or AUDIO_TRACK_IDENTIFIER not in s3_key:
            logger.warning(f"Skipping non-audio key: {s3_key}")
            continue

        domain = parts[0]
        room_name = parts[1]

        # Extract session_id from room_name (format: session-{session_id})
        session_id = room_name.replace("session-", "") if room_name.startswith("session-") else room_name

        # Check if already processed
        if processed_exists(session_id):
            logger.info(f"Session {session_id} already processed, skipping")
            continue

        # List all audio tracks for this room
        room_prefix = f"{domain}/{room_name}/"
        tracks = list_audio_tracks(room_prefix)

        if len(tracks) < EXPECTED_TRACKS_PER_SESSION:
            logger.info(
                f"Session {session_id}: {len(tracks)}/{EXPECTED_TRACKS_PER_SESSION} tracks — waiting"
            )
            continue

        # Process the session
        logger.info(f"Session {session_id}: all tracks present — processing")
        _process_session(session_id, tracks[:EXPECTED_TRACKS_PER_SESSION])

    return {"status": "ok"}


def _process_session(session_id: str, track_keys: list[str]) -> None:
    """Download tracks, convert to WAV, merge, upload results."""
    local_tracks: list[str] = []
    wav_files: list[str] = []

    try:
        # Download raw tracks
        for i, s3_key in enumerate(track_keys):
            local_path = f"/tmp/track_{i}.webm"
            download_track(s3_key, local_path)
            local_tracks.append(local_path)

        # Convert each to mono WAV
        for i, track_path in enumerate(local_tracks):
            wav_path = f"/tmp/speaker_{i + 1}.wav"
            webm_to_wav(track_path, wav_path)
            wav_files.append(wav_path)

        # Merge into combined
        combined_path = "/tmp/combined.wav"
        merge_tracks(wav_files, combined_path)

        # Upload results
        output_prefix = f"{config.PROCESSED_PREFIX}{session_id}"
        for wav_path in wav_files:
            filename = os.path.basename(wav_path)
            upload_file(wav_path, f"{output_prefix}/{filename}")
        upload_file(combined_path, f"{output_prefix}/combined.wav")

        # Update session status
        update_status(
            session_id,
            "completed",
            s3_processed_prefix=f"s3://{config.RECORDINGS_BUCKET}/{output_prefix}/",
        )

        logger.info(f"Session {session_id}: processing complete")

    except Exception as e:
        logger.error(f"Session {session_id}: processing failed — {e}")
        update_status(session_id, "error", error_message=str(e)[:500])
        raise

    finally:
        # Cleanup /tmp
        for path in [*local_tracks, *wav_files, "/tmp/combined.wav"]:
            try:
                os.remove(path)
            except OSError:
                pass
