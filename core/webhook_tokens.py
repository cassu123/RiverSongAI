"""
core/webhook_tokens.py

Q2#10 — Webhook tokens. Pure-stdlib helpers for generating, hashing,
and verifying admin-issuable scoped webhook tokens.

Design:
- Token wire format:  rs_wh_<32-char-base32>      (the plaintext)
- Storage format:     sha256 hex digest           (the persisted hash)

Comparing only the hash means a database leak does not yield usable
tokens. The plaintext is shown to the admin **once** at creation time
and never again.

Scopes are an opaque list of strings the issuing admin assigns; a
caller verifying a token specifies the set of scopes the endpoint
requires, and `verify_webhook_token` returns the token record only
when **every** required scope is present (an empty required set is
treated as "any valid token").
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import hmac
import secrets
from typing import Iterable, Optional

_TOKEN_PREFIX = "rs_wh_"
_TOKEN_RAW_BYTES = 20  # → 32 base32 chars (no padding)


def generate_token() -> str:
    """Mint a new opaque token string. Show once, never persist plaintext."""
    import base64
    raw = secrets.token_bytes(_TOKEN_RAW_BYTES)
    body = base64.b32encode(raw).decode("ascii").rstrip("=")
    return f"{_TOKEN_PREFIX}{body}"


def hash_token(token: str) -> str:
    """Stable, fast sha256 hex digest used for both storage and lookup."""
    if not isinstance(token, str):
        return ""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def constant_time_match(a: str, b: str) -> bool:
    """Constant-time string compare; safe on empty or differing-length input."""
    if not isinstance(a, str) or not isinstance(b, str):
        return False
    return hmac.compare_digest(a, b)


def _now() -> _dt.datetime:
    return _dt.datetime.now(tz=_dt.timezone.utc)


def is_expired(expires_at: Optional[str]) -> bool:
    if not expires_at:
        return False
    try:
        dt = _dt.datetime.fromisoformat(expires_at)
    except ValueError:
        return True  # malformed → safer to treat as expired
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_dt.timezone.utc)
    return dt <= _now()


def has_required_scopes(token_scopes: Iterable[str], required: Iterable[str]) -> bool:
    """
    Return True iff every scope in `required` is present in `token_scopes`.
    Empty required means "any valid token is enough".
    """
    if not required:
        return True
    have = set(token_scopes or [])
    return set(required).issubset(have)


async def verify_webhook_token(
    raw_token: str,
    *,
    store,
    required_scopes: Optional[Iterable[str]] = None,
) -> Optional[dict]:
    """
    Look up `raw_token` in the store, ensuring it is not revoked, not
    expired, and carries every required scope. Records the use (audit +
    counters) on success.

    Returns the token row dict on success; None on any failure.
    """
    from config.settings import get_settings
    if not getattr(get_settings(), "webhook_tokens_enabled", False):
        return None
    if not raw_token or not isinstance(raw_token, str):
        return None

    digest = hash_token(raw_token)
    row = await store.get_webhook_token_by_hash(digest)
    if not row:
        return None

    if row.get("revoked_at"):
        return None
    if is_expired(row.get("expires_at")):
        return None
    if not has_required_scopes(row.get("scopes") or [], required_scopes or []):
        return None

    try:
        await store.record_webhook_token_use(row["id"], detail="verified")
    except Exception:
        # Audit failure must not block a valid call.
        pass
    return row
