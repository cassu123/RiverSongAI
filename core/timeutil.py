"""
core/timeutil.py

Single source of truth for "what day is it locally".

Before this module, three subsystems each answered that question differently:
the vault rolled daily notes at **UTC** midnight, the briefing sweep keyed its
dedupe entry off **local** midnight, and the frontend derived its own date from
``toISOString()`` (UTC again). For any timezone behind UTC that meant a user at
8pm was shown a daily note dated *tomorrow*, and the briefing card silently
never matched its dedupe key.

Everything that needs a calendar day for a human should call `local_today_str`.
Only use UTC for machine timestamps (`created_at`, audit rows, etc.).
"""

from __future__ import annotations

import logging
import zoneinfo
from datetime import datetime, timezone, tzinfo
from typing import Optional

logger = logging.getLogger(__name__)

_UTC = timezone.utc


def local_tz() -> tzinfo:
    """
    Resolve the system's configured IANA timezone, falling back to UTC.

    Kept tolerant on purpose: a bad ``DEFAULT_TIMEZONE`` should degrade to UTC
    rather than take down every caller that needs to know the date.
    """
    try:
        from config.settings import get_settings
        tz_str = get_settings().default_timezone or "UTC"
    except Exception:  # settings unavailable (early boot, tests)
        return _UTC

    try:
        return zoneinfo.ZoneInfo(tz_str)
    except Exception:
        logger.warning("Unknown timezone %r; falling back to UTC.", tz_str)
        return _UTC


def local_now(tz: Optional[tzinfo] = None) -> datetime:
    """Timezone-aware 'now' in the configured local zone."""
    return datetime.now(tz or local_tz())


def local_today_str(tz: Optional[tzinfo] = None) -> str:
    """Today's calendar date, local, as ``YYYY-MM-DD``."""
    return local_now(tz).strftime("%Y-%m-%d")


def utc_now() -> datetime:
    """Timezone-aware 'now' in UTC — for machine timestamps only."""
    return datetime.now(_UTC)
