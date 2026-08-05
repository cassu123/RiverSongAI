# =============================================================================
# providers/memory/ttl_engine.py
#
# File Purpose:
#   TTL (Time-To-Live) engine for conversation summary retention.
#   Calculates expiry dates, checks expiration, and handles auto-extension
#   when a summary is pulled into conversation context.
#
# Key Functions:
#   calculate_expires_at(ttl_setting)  -- compute expiry datetime from TTL tier
#   is_expired(summary)                -- True if summary has passed its expiry
#   extend_ttl(summary, ttl_setting)   -- reset expiry from today on reference
#   get_cleanup_cutoff()               -- datetime before which all expired rows can be deleted
#
# Dependencies:
#   datetime (stdlib)
#   providers.memory.models (TTLOption, ConversationSummary)
#
# Usage Example:
#   expires = calculate_expires_at(TTLOption.STANDARD)  # now + 30 days
#   if is_expired(summary):
#       db.delete_summary(summary.id)
#   new_expiry = extend_ttl(summary, TTLOption.STANDARD)
# =============================================================================

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from providers.memory.models import ConversationSummary, TTLOption


# =============================================================================
# Expiry calculation
# =============================================================================
#
# Purpose:
#   Convert a TTL option string into an absolute expiry datetime (UTC).
#   Returns None for "forever" summaries -- these are never auto-deleted.
#
# Inputs:  ttl_setting -- one of TTLOption.ALL
# Outputs: datetime (UTC) or None
# Assumptions: All datetimes stored and compared in UTC.
# =============================================================================

def calculate_expires_at(ttl_setting: str) -> Optional[datetime]:
    """
    Return the UTC datetime when a summary with this TTL setting should expire.

    Args:
        ttl_setting: A TTLOption constant (e.g., TTLOption.STANDARD).

    Returns:
        UTC datetime of expiry, or None if ttl_setting is TTLOption.FOREVER.

    Raises:
        ValueError: If ttl_setting is not a recognised TTLOption value.
    """
    if not TTLOption.is_valid(ttl_setting):
        raise ValueError(
            f"Unknown TTL setting '{ttl_setting}'. "
            f"Valid options: {TTLOption.ALL}"
        )

    days = TTLOption.DAYS[ttl_setting]
    if days is None:
        return None  # forever -- no expiry

    return datetime.now(tz=timezone.utc) + timedelta(days=days)


# =============================================================================
# Expiry check
# =============================================================================
#
# Purpose:
#   Determine whether a summary has passed its expiry time.
#   Summaries with no expiry (TTLOption.FOREVER) are never expired.
#
# Inputs:  summary -- ConversationSummary instance
# Outputs: bool
# =============================================================================

def is_expired(summary: ConversationSummary) -> bool:
    """
    Return True if this summary has passed its expires_at timestamp.

    Summaries with expires_at == None (forever) always return False.

    Args:
        summary: The summary to check.

    Returns:
        True if expired and eligible for deletion, False otherwise.
    """
    if summary.expires_at is None:
        return False

    # Normalise to UTC-aware comparison
    expiry = summary.expires_at
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)

    return datetime.now(tz=timezone.utc) > expiry


# =============================================================================
# Auto-extend
# =============================================================================
#
# Purpose:
#   When a summary is pulled into conversation context it proved useful.
#   If auto_extend is enabled for the user, reset its expiry from today
#   so frequently-referenced summaries survive longer naturally.
#
# Inputs:
#   summary     -- ConversationSummary to extend
#   ttl_setting -- the user's default TTL (from MemorySettings.default_ttl)
#
# Outputs: new expires_at datetime (or None for forever) -- caller must persist
# Assumptions: Only called when auto_extend == True in MemorySettings.
# =============================================================================

def extend_ttl(
    summary: ConversationSummary,
    ttl_setting: str,
) -> Optional[datetime]:
    """
    Calculate a new expiry date from today for a summary that was just referenced.

    Does not modify the summary object -- returns the new expiry for the caller
    to persist via SQLiteStore.

    Args:
        summary:     The summary that was just pulled into context.
        ttl_setting: The user's default TTL setting (resets from today).

    Returns:
        New UTC expiry datetime, or None if ttl_setting is FOREVER.
    """
    if summary.ttl_setting == TTLOption.FOREVER:
        return None  # forever summaries don't need extension

    # Extend using the user's current default TTL, not the summary's original TTL.
    # If the user has upgraded their default TTL since the summary was created,
    # the extension benefits from the new setting.
    return calculate_expires_at(ttl_setting)


# =============================================================================
# Bulk cleanup cutoff
# =============================================================================
#
# Purpose:
#   Return the current UTC time for use in a WHERE clause that bulk-deletes
#   all summaries whose expires_at is in the past.
#   "WHERE expires_at IS NOT NULL AND expires_at < :cutoff"
#
# Outputs: datetime (UTC)
# =============================================================================

def get_cleanup_cutoff() -> datetime:
    """
    Return the current UTC datetime for use as a bulk-delete cutoff.

    Usage:
        cutoff = get_cleanup_cutoff()
        db.delete_expired_summaries(user_id, before=cutoff)
    """
    return datetime.now(tz=timezone.utc)
