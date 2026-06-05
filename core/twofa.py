# =============================================================================
# core/twofa.py
#
# File Purpose:
#   TOTP (RFC 6238) + recovery-code logic for per-user two-factor auth.
#   Pure stdlib — no new dependencies. Verified against the RFC 6238
#   Appendix B reference vectors (see tests/test_twofa.py).
#
# Threat model and choices:
#   * Algorithm:  HMAC-SHA1 (the de-facto standard, what every authenticator
#                 app supports without extra setup).
#   * Period:     30 seconds.
#   * Digits:     6.
#   * Drift:      ±1 step accepted (90s effective window) — covers most clock
#                 skew without weakening the design materially.
#   * Recovery:   8 codes per user, 10 hex chars each, stored bcrypt-hashed.
#
# Why not pyotp:
#   TOTP is short enough to implement correctly from RFC, and avoiding the
#   dependency keeps the install footprint identical. The reference-vector
#   tests catch any algorithmic mistake.
# =============================================================================

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time
import urllib.parse
from typing import Optional


# =============================================================================
# Constants
# =============================================================================

TOTP_PERIOD_SECONDS = 30
TOTP_DIGITS         = 6
TOTP_DRIFT_STEPS    = 1     # accept current step ±1 (so ±30s)

RECOVERY_CODE_COUNT  = 8
RECOVERY_CODE_NIBBLES = 10  # hex chars per code; 10 → 40 bits entropy each


# =============================================================================
# TOTP — RFC 6238
# =============================================================================

def generate_secret(bytes_len: int = 20) -> str:
    """
    Return a base32-encoded secret suitable for authenticator apps.
    20 bytes (160 bits) matches the RFC 6238 / RFC 4226 reference.
    Padding stripped so the string copies cleanly into manual-entry fields.
    """
    raw = secrets.token_bytes(bytes_len)
    return base64.b32encode(raw).decode("ascii").rstrip("=")


def _hotp(secret_b32: str, counter: int, digits: int = TOTP_DIGITS) -> str:
    """RFC 4226 HOTP. Counter is big-endian 8-byte int."""
    # Re-pad base32 if the caller stripped it.
    pad = "=" * ((8 - len(secret_b32) % 8) % 8)
    key = base64.b32decode(secret_b32.upper() + pad)
    msg = struct.pack(">Q", counter)
    mac = hmac.new(key, msg, hashlib.sha1).digest()
    offset = mac[-1] & 0x0F
    code_int = (
        ((mac[offset]     & 0x7F) << 24)
        | ((mac[offset + 1] & 0xFF) << 16)
        | ((mac[offset + 2] & 0xFF) <<  8)
        |  (mac[offset + 3] & 0xFF)
    )
    return str(code_int % (10 ** digits)).zfill(digits)


def totp_at(secret_b32: str, when: float, period: int = TOTP_PERIOD_SECONDS, digits: int = TOTP_DIGITS) -> str:
    """Compute the TOTP code at a specific unix time."""
    counter = int(when // period)
    return _hotp(secret_b32, counter, digits)


def totp_now(secret_b32: str) -> str:
    """Current TOTP code. Useful for diagnostics; auth uses verify_totp."""
    return totp_at(secret_b32, time.time())


def verify_totp(secret_b32: str, code: str, when: Optional[float] = None, drift_steps: int = TOTP_DRIFT_STEPS) -> bool:
    """
    Constant-time check that `code` matches the TOTP for `secret_b32` within
    ±drift_steps of the current period.

    Returns False on any malformed input — never raises.
    """
    if not secret_b32 or not code:
        return False
    code = code.strip().replace(" ", "")
    if not code.isdigit() or len(code) != TOTP_DIGITS:
        return False

    now    = when if when is not None else time.time()
    centre = int(now // TOTP_PERIOD_SECONDS)
    for offset in range(-drift_steps, drift_steps + 1):
        try:
            candidate = _hotp(secret_b32, centre + offset)
        except (ValueError, TypeError):
            return False
        if hmac.compare_digest(candidate, code):
            return True
    return False


def provisioning_uri(secret_b32: str, account_name: str, issuer: str = "River Song") -> str:
    """
    Build the otpauth:// URI for QR-code provisioning. Compatible with
    Google Authenticator, Authy, 1Password, Aegis, etc.
    """
    label = f"{issuer}:{account_name}"
    params = {
        "secret":    secret_b32,
        "issuer":    issuer,
        "algorithm": "SHA1",
        "digits":    str(TOTP_DIGITS),
        "period":    str(TOTP_PERIOD_SECONDS),
    }
    query = urllib.parse.urlencode(params)
    return f"otpauth://totp/{urllib.parse.quote(label)}?{query}"


# =============================================================================
# QR rendering — uses the existing qrcode dep (already in requirements.txt)
# =============================================================================

def make_qr_png_base64(otpauth_uri: str) -> Optional[str]:
    """
    Render the provisioning URI as a PNG and return it base64-encoded.
    Returns None if the qrcode library is somehow unavailable — the
    plaintext otpauth_uri remains usable as a manual-entry fallback.
    """
    try:
        import io
        import qrcode
    except ImportError:
        return None

    try:
        img = qrcode.make(otpauth_uri)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception:
        return None


# =============================================================================
# Recovery codes
# =============================================================================

def generate_recovery_codes(count: int = RECOVERY_CODE_COUNT, nibbles: int = RECOVERY_CODE_NIBBLES) -> list[str]:
    """
    Plaintext recovery codes — shown to the user once, never stored.
    Format: `XXXXX-XXXXX` (hex, easy to write down).
    """
    codes: list[str] = []
    for _ in range(count):
        raw = secrets.token_hex(nibbles // 2)
        mid = nibbles // 2
        codes.append(f"{raw[:mid]}-{raw[mid:]}".lower())
    return codes


def hash_recovery_codes(plaintext_codes: list[str]) -> list[str]:
    """bcrypt-hash each recovery code for storage."""
    import bcrypt
    return [
        bcrypt.hashpw(_normalise_recovery_code(c).encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        for c in plaintext_codes
    ]


def _normalise_recovery_code(code: str) -> str:
    """Lower-case, strip whitespace + dashes — users may type with/without dashes."""
    return code.strip().lower().replace("-", "").replace(" ", "")


def verify_recovery_code(input_code: str, hashed_codes: list[str]) -> Optional[int]:
    """
    Return the index of the matching hashed code, or None if no match.
    Caller is responsible for removing that index from the user's record
    so each code is single-use.
    """
    if not input_code or not hashed_codes:
        return None

    import bcrypt
    normalised = _normalise_recovery_code(input_code)
    if not normalised:
        return None

    candidate = normalised.encode("utf-8")
    # Also try the canonical dashed form, since bcrypt hashes the exact input.
    # We hash with normalised form, so only the normalised candidate should match.
    for idx, hashed in enumerate(hashed_codes):
        try:
            if bcrypt.checkpw(candidate, hashed.encode("utf-8")):
                return idx
        except (ValueError, TypeError):
            continue
    return None
