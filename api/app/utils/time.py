"""Pure time utility functions — no business logic, no DB access."""

import time
from datetime import datetime, timezone

from app.constants import SESSION_TTL_DAYS


def now_iso() -> str:
    """Return current UTC time as ISO 8601 string."""
    return datetime.now(timezone.utc).isoformat()


def compute_ttl(ttl_days: int = SESSION_TTL_DAYS) -> int:
    """Return a Unix epoch timestamp N days from now for DynamoDB TTL."""
    return int(time.time()) + (86400 * ttl_days)
