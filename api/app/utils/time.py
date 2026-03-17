"""Pure time utility functions — no business logic, no DB access."""

from datetime import datetime, timezone


def now_iso() -> str:
    """Return current UTC time as ISO 8601 string."""
    return datetime.now(timezone.utc).isoformat()


def unix_to_iso(ts: int) -> str:
    """Convert a Unix epoch timestamp to ISO 8601 UTC string."""
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
