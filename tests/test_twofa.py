"""
tests/test_twofa.py

Q1#5 — TOTP 2FA. Validates the pure-stdlib TOTP/recovery-code
implementation against the RFC 6238 Appendix B reference vectors
and exercises drift, recovery flow, and challenge-token round-trip.
"""

from __future__ import annotations

import base64
import time

import pytest

from core.twofa import (
    _hotp,
    generate_recovery_codes,
    generate_secret,
    hash_recovery_codes,
    make_qr_png_base64,
    provisioning_uri,
    totp_at,
    totp_now,
    verify_recovery_code,
    verify_totp,
)


# RFC 6238 Appendix B reference secret: ASCII "12345678901234567890" → base32
_RFC_SECRET_B32 = base64.b32encode(b"12345678901234567890").decode().rstrip("=")


# =============================================================================
# RFC 6238 reference vectors
# =============================================================================

class TestRFC6238Vectors:
    @pytest.mark.parametrize(
        "unix_time,expected",
        [
            (59,          "287082"),
            (1111111109,  "081804"),
            (1111111111,  "050471"),
            (1234567890,  "005924"),
            (2000000000,  "279037"),
        ],
    )
    def test_totp_matches_reference(self, unix_time, expected):
        assert totp_at(_RFC_SECRET_B32, unix_time) == expected

    def test_hotp_counter_zero(self):
        # RFC 4226 Appendix D, counter 0 → 755224
        assert _hotp(_RFC_SECRET_B32, 0) == "755224"


# =============================================================================
# verify_totp — drift, malformed input, constant-time
# =============================================================================

class TestVerifyTotp:
    def test_accepts_current_code(self):
        secret = generate_secret()
        now = time.time()
        assert verify_totp(secret, totp_at(secret, now), when=now)

    def test_accepts_one_step_drift_either_side(self):
        secret = generate_secret()
        now = time.time()
        prev = totp_at(secret, now - 30)
        nxt  = totp_at(secret, now + 30)
        assert verify_totp(secret, prev, when=now)
        assert verify_totp(secret, nxt,  when=now)

    def test_rejects_two_step_drift(self):
        secret = generate_secret()
        now = time.time()
        far = totp_at(secret, now - 90)
        assert verify_totp(secret, far, when=now) is False

    def test_rejects_wrong_code(self):
        secret = generate_secret()
        assert verify_totp(secret, "000000") is False

    def test_rejects_short_code(self):
        secret = generate_secret()
        assert verify_totp(secret, "12345") is False

    def test_rejects_non_digit_code(self):
        secret = generate_secret()
        assert verify_totp(secret, "12345a") is False

    def test_rejects_empty_inputs(self):
        assert verify_totp("", "123456") is False
        assert verify_totp("ABCD", "") is False
        assert verify_totp("", "") is False

    def test_strips_spaces(self):
        # Some authenticator apps render "123 456" with a space — accept that.
        secret = generate_secret()
        now    = time.time()
        good   = totp_at(secret, now)
        spaced = f"{good[:3]} {good[3:]}"
        assert verify_totp(secret, spaced, when=now)


# =============================================================================
# generate_secret / provisioning_uri / QR
# =============================================================================

class TestProvisioning:
    def test_generate_secret_base32_alphabet(self):
        s = generate_secret()
        # Base32 (without padding) — A-Z, 2-7
        assert all(c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567" for c in s)
        # 20 bytes → 32 chars before strip; strip removes nothing for 20 bytes.
        assert len(s) == 32

    def test_secrets_are_unique(self):
        s1 = generate_secret()
        s2 = generate_secret()
        assert s1 != s2

    def test_provisioning_uri_shape(self):
        uri = provisioning_uri("ABCDEFGHIJKLMNOP", "cheryl@example.com")
        assert uri.startswith("otpauth://totp/")
        assert "secret=ABCDEFGHIJKLMNOP" in uri
        assert "issuer=River+Song" in uri or "issuer=River%20Song" in uri
        assert "algorithm=SHA1" in uri
        assert "digits=6" in uri
        assert "period=30" in uri

    def test_qr_png_returns_base64_or_none(self):
        uri = provisioning_uri("ABCDEFGHIJKLMNOP", "x@y")
        b64 = make_qr_png_base64(uri)
        # qrcode is in requirements — should return a non-empty string here.
        assert b64 is None or (isinstance(b64, str) and len(b64) > 100)


# =============================================================================
# Recovery codes — generation, hashing, verification, single-use semantics
# =============================================================================

class TestRecoveryCodes:
    def test_generate_count_and_format(self):
        codes = generate_recovery_codes(count=8, nibbles=10)
        assert len(codes) == 8
        for c in codes:
            assert len(c) == 11  # "xxxxx-xxxxx"
            assert c[5] == "-"
            assert all(ch in "0123456789abcdef-" for ch in c)

    def test_codes_are_unique(self):
        codes = generate_recovery_codes(count=20)
        assert len(set(codes)) == 20

    def test_hash_and_verify_match(self):
        codes  = generate_recovery_codes(count=3)
        hashes = hash_recovery_codes(codes)
        assert verify_recovery_code(codes[0], hashes) == 0
        assert verify_recovery_code(codes[1], hashes) == 1
        assert verify_recovery_code(codes[2], hashes) == 2

    def test_verify_strips_dashes_and_case(self):
        codes  = generate_recovery_codes(count=1)
        hashes = hash_recovery_codes(codes)
        no_dash = codes[0].replace("-", "")
        upper   = codes[0].upper()
        assert verify_recovery_code(no_dash, hashes) == 0
        assert verify_recovery_code(upper,  hashes)  == 0

    def test_verify_rejects_wrong_code(self):
        codes  = generate_recovery_codes(count=4)
        hashes = hash_recovery_codes(codes)
        assert verify_recovery_code("00000-00000", hashes) is None

    def test_verify_safe_on_empty_input(self):
        assert verify_recovery_code("", ["$2b$12$abc"]) is None
        assert verify_recovery_code("abc", []) is None


# =============================================================================
# Challenge token (core.auth.create_totp_challenge_token)
# =============================================================================

class TestChallengeToken:
    def test_challenge_roundtrip(self):
        from core.auth import create_totp_challenge_token, decode_challenge_token
        t = create_totp_challenge_token("user-abc")
        p = decode_challenge_token(t)
        assert p is not None
        assert p["sub"] == "user-abc"
        assert p["purpose"] == "totp_challenge"

    def test_access_token_rejected_as_challenge(self):
        from core.auth import create_access_token, decode_challenge_token
        t = create_access_token("uid", "a@b.com", "user")
        # Lacks purpose='totp_challenge' → rejected
        assert decode_challenge_token(t) is None

    def test_malformed_token_returns_none(self):
        from core.auth import decode_challenge_token
        assert decode_challenge_token("not.a.token") is None
        assert decode_challenge_token("") is None

    def test_challenge_token_rejected_by_decode_token(self):
        """A TOTP challenge token must NOT authenticate as an access token.

        Regression for the 2FA-bypass risk: without the purpose check in
        decode_token, a leaked challenge token could be presented as
        Bearer auth to any access-token endpoint.
        """
        import asyncio
        from core.auth import create_totp_challenge_token, decode_token
        t = create_totp_challenge_token("user-abc")
        assert asyncio.run(decode_token(t)) is None
