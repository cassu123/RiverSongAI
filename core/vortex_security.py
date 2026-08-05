"""
core/vortex_security.py

Security primitives shared by every River Vortex code path.

Three concerns live here, all of them foundational to the device contract
described in the River Vortex brief:

1. **Unit tokens.** Tokens are stored hashed and compared in constant time.
   A Vortex unit is a Raspberry Pi on a kitchen counter — it is the most
   stealable thing in the house — so a database leak must not yield a working
   credential, and a token check must not leak its own prefix through timing.

2. **Brute-force lockout.** Pairing codes are 8 digits (10^8). That is only
   safe behind a limiter, so pair/status and pair/approve share one here.

3. **Pending confirmations.** Medium-risk actions do not execute; they mint a
   challenge id and wait for a second factor that was typed on the unit's
   touchscreen. A spoken PIN travels the same channel as the voice that
   triggered it and is audible to the whole room, so it is never accepted.

Nothing in this module talks to the network or trusts anything a unit says
about itself.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import secrets
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Concurrency
# ---------------------------------------------------------------------------

class LoopLock:
    """
    An asyncio lock that rebinds itself when the running event loop changes.

    Module-level singletons outlive any one event loop: a plain
    `asyncio.Lock()` created at import binds to whichever loop first awaits it
    and then raises on every other one. Uvicorn only ever has one loop, but
    test clients and one-off `asyncio.run` calls do not, and a lock that only
    works in production is a lock nobody can test around.
    """

    __slots__ = ("_lock", "_loop")

    def __init__(self) -> None:
        self._lock: Optional[asyncio.Lock] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def _current(self) -> asyncio.Lock:
        loop = asyncio.get_running_loop()
        if self._lock is None or self._loop is not loop:
            self._lock = asyncio.Lock()
            self._loop = loop
        return self._lock

    async def __aenter__(self) -> "LoopLock":
        await self._current().acquire()
        return self

    async def __aexit__(self, *_exc: Any) -> None:
        # The loop cannot change inside an awaited block, so this is the same
        # lock object that was acquired.
        self._current().release()


# ---------------------------------------------------------------------------
# Unit tokens
# ---------------------------------------------------------------------------

_HASH_PREFIX = "sha256:"

# Unit tokens are 256 bits of CSPRNG output (two uuid4 hex strings, or
# token_hex(32) for tokens minted here). At that entropy a plain SHA-256 is
# the right primitive: there is no dictionary to protect against, and a slow
# KDF would put a deliberate delay on every device heartbeat in the house.
_TOKEN_BYTES = 32


def mint_unit_token() -> str:
    """Return a fresh 256-bit unit token as a hex string."""
    return secrets.token_hex(_TOKEN_BYTES)


def hash_unit_token(token: str) -> str:
    """Return the at-rest representation of a unit token."""
    digest = hashlib.sha256((token or "").encode("utf-8")).hexdigest()
    return f"{_HASH_PREFIX}{digest}"


def is_hashed(stored: str) -> bool:
    """True when a stored value is already in hashed form."""
    return bool(stored) and stored.startswith(_HASH_PREFIX)


# Compared against when there is nothing real to compare against, so that an
# unknown unit id and a wrong token take the same path through this function.
_DUMMY_HASH = hash_unit_token(secrets.token_hex(_TOKEN_BYTES))


def verify_unit_token(presented: Optional[str], stored: Optional[str]) -> bool:
    """
    Constant-time comparison of a presented token against its stored form.

    Accepts a legacy plaintext `stored` value so a database that has not yet
    run the hashing migration keeps working for the length of one restart;
    both sides are hashed before comparison either way, so the comparison is
    always constant-time and always over equal-length strings.
    """
    if not stored:
        expected = _DUMMY_HASH
    elif is_hashed(stored):
        expected = stored
    else:
        expected = hash_unit_token(stored)
    return hmac.compare_digest(hash_unit_token(presented or ""), expected)


# ---------------------------------------------------------------------------
# Brute-force lockout
# ---------------------------------------------------------------------------

@dataclass
class _Attempts:
    count: int = 0
    first_at: float = 0.0
    locked_until: float = 0.0


class AttemptLimiter:
    """
    Fixed-window failure counter with a lockout, keyed by an arbitrary string.

    Used for pairing (keyed by client IP) where the secret is short enough to
    enumerate. Successful attempts clear the counter; the window resets once
    it expires so a device that fails once an hour is never locked out.
    """

    def __init__(self, *, max_failures: int = 10,
                 window_seconds: float = 300.0,
                 lockout_seconds: float = 900.0) -> None:
        self._max = max_failures
        self._window = window_seconds
        self._lockout = lockout_seconds
        self._state: Dict[str, _Attempts] = {}
        self._lock = LoopLock()

    async def check(self, key: str) -> Optional[float]:
        """Return remaining lockout seconds, or None when the key may proceed."""
        now = time.monotonic()
        async with self._lock:
            entry = self._state.get(key)
            if entry and entry.locked_until > now:
                return entry.locked_until - now
        return None

    async def record_failure(self, key: str) -> Optional[float]:
        """Count a failure. Returns remaining lockout seconds once locked."""
        now = time.monotonic()
        async with self._lock:
            entry = self._state.get(key)
            if entry is None or (now - entry.first_at) > self._window:
                entry = _Attempts(count=0, first_at=now)
                self._state[key] = entry
            entry.count += 1
            if entry.count >= self._max:
                entry.locked_until = now + self._lockout
                logger.warning(
                    "Vortex pairing lockout for %s after %d failures.",
                    key, entry.count,
                )
                return self._lockout
        return None

    async def record_success(self, key: str) -> None:
        async with self._lock:
            self._state.pop(key, None)

    async def reset(self) -> None:
        async with self._lock:
            self._state.clear()


# One limiter shared by pair/status and pair/approve: an attacker who can
# hammer either surface is enumerating the same 8-digit space.
pairing_limiter = AttemptLimiter(max_failures=10, window_seconds=300.0,
                                 lockout_seconds=900.0)

# Second-factor attempts are limited per challenge, not per IP — a challenge
# is single-use and short-lived, so a handful of typos is the whole budget.
_MAX_CHALLENGE_ATTEMPTS = 5


# ---------------------------------------------------------------------------
# Pending confirmations (second factor)
# ---------------------------------------------------------------------------

@dataclass
class PendingConfirmation:
    """
    A medium-risk action that has been parsed and authorised in principle but
    deliberately not executed.

    `payload` carries everything needed to perform the action once the second
    factor lands, so nothing has to be re-parsed from a transcript that the
    user is no longer saying.
    """
    challenge_id: str
    user_id: str
    unit_id: Optional[str]
    action: str
    description: str
    payload: Dict[str, Any] = field(default_factory=dict)
    expires_at: float = 0.0
    attempts: int = 0


class ConfirmationStore:
    """
    In-memory store of pending confirmations with a short TTL.

    Deliberately not persisted: a pending confirmation is a live prompt in
    front of a person. If this server restarts mid-prompt, the right outcome
    is that the action is forgotten and the user asks again — not that a
    challenge minted before a crash is still redeemable afterwards.
    """

    def __init__(self, ttl_seconds: float = 120.0) -> None:
        self._ttl = ttl_seconds
        self._items: Dict[str, PendingConfirmation] = {}
        self._lock = LoopLock()

    def _purge(self) -> None:
        now = time.monotonic()
        for cid in [k for k, v in self._items.items() if v.expires_at <= now]:
            self._items.pop(cid, None)

    async def create(self, *, user_id: str, unit_id: Optional[str],
                     action: str, description: str,
                     payload: Optional[Dict[str, Any]] = None,
                     ttl_seconds: Optional[float] = None) -> PendingConfirmation:
        ttl = ttl_seconds if ttl_seconds is not None else self._ttl
        pending = PendingConfirmation(
            challenge_id=uuid.uuid4().hex,
            user_id=user_id,
            unit_id=unit_id,
            action=action,
            description=description,
            payload=dict(payload or {}),
            expires_at=time.monotonic() + ttl,
        )
        async with self._lock:
            self._purge()
            self._items[pending.challenge_id] = pending
        logger.info(
            "Vortex confirmation %s minted for action '%s' (unit=%s, ttl=%.0fs).",
            pending.challenge_id, action, unit_id, ttl,
        )
        return pending

    async def peek(self, challenge_id: str) -> Optional[PendingConfirmation]:
        async with self._lock:
            self._purge()
            return self._items.get(challenge_id)

    async def record_attempt(self, challenge_id: str) -> bool:
        """
        Count a failed second-factor attempt.

        Returns True while the challenge is still redeemable, False once it
        has been burned through and dropped.
        """
        async with self._lock:
            self._purge()
            pending = self._items.get(challenge_id)
            if pending is None:
                return False
            pending.attempts += 1
            if pending.attempts >= _MAX_CHALLENGE_ATTEMPTS:
                self._items.pop(challenge_id, None)
                logger.warning(
                    "Vortex confirmation %s discarded after %d failed attempts.",
                    challenge_id, pending.attempts,
                )
                return False
        return True

    async def consume(self, challenge_id: str) -> Optional[PendingConfirmation]:
        """Take a pending confirmation, removing it. Single use by construction."""
        async with self._lock:
            self._purge()
            return self._items.pop(challenge_id, None)

    async def clear(self) -> None:
        async with self._lock:
            self._items.clear()


confirmations = ConfirmationStore()


# ---------------------------------------------------------------------------
# Second-factor verification
# ---------------------------------------------------------------------------

async def verify_second_factor(user_id: str, code: str) -> bool:
    """
    Verify a second factor typed on a unit's touchscreen.

    Order of preference:
      1. The owner's enrolled TOTP secret — a real second factor, already
         supported by /api/auth/2fa.
      2. `settings.vortex_confirm_pin`, for households that have not enrolled
         TOTP. Weaker, but still a factor the microphone never hears.

    With neither configured the answer is False and the action does not
    happen. That is the intended failure direction: an unconfirmable
    medium-risk action is a denied one.
    """
    code = (code or "").strip().replace(" ", "")
    if not code:
        return False

    try:
        from providers.memory.sqlite_store import SQLiteStore
        from core.twofa import verify_totp

        store = SQLiteStore()
        row = await store.execute_read_one_async(
            "SELECT totp_secret FROM users WHERE id=?", (user_id,)
        )
        secret = (row or {}).get("totp_secret") or ""
        if secret:
            return bool(verify_totp(secret, code))
    except Exception as exc:  # pragma: no cover - defensive
        logger.error("Vortex second-factor TOTP check failed: %s", exc)

    from config.settings import get_settings
    pin = (getattr(get_settings(), "vortex_confirm_pin", "") or "").strip()
    if pin:
        return hmac.compare_digest(code, pin)

    logger.warning(
        "Vortex second factor requested for user %s but no TOTP secret and no "
        "VORTEX_CONFIRM_PIN are configured — denying.", user_id,
    )
    return False
