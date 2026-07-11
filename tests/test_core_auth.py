"""
tests/test_core_auth.py

Security-critical behaviour in core/auth.py that previously had no tests
(audit L-2). Covers:
  - challenge tokens can't be used as access tokens (purpose guard),
  - decode_token honours revocation / suspension / tokens_valid_after,
  - require_role accepts the token from BOTH the Authorization header and the
    access_token cookie, and enforces roles.

The cookie path is pinned here because the planned H-1 migration (cookie-only
auth) depends on it staying correct.
"""

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import main
from core.auth import (
    create_access_token,
    create_totp_challenge_token,
    decode_challenge_token,
    decode_token,
)
from main import app

client = TestClient(app)


def _run(coro):
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# Challenge vs access token separation
# ---------------------------------------------------------------------------

def test_challenge_token_roundtrip():
    tok = create_totp_challenge_token("user-1")
    payload = decode_challenge_token(tok)
    assert payload is not None
    assert payload["sub"] == "user-1"
    assert payload["purpose"] == "totp_challenge"


def test_access_token_is_not_a_valid_challenge_token():
    access = create_access_token("user-1", "u@test.local", "user")
    assert decode_challenge_token(access) is None


def test_challenge_token_rejected_by_decode_token():
    # A leaked TOTP challenge token must never authenticate as an access token.
    challenge = create_totp_challenge_token("user-1")
    assert _run(decode_token(challenge)) is None


def test_valid_access_token_decodes():
    access = create_access_token("user-1", "u@test.local", "admin")
    payload = _run(decode_token(access))
    assert payload is not None
    assert payload["sub"] == "user-1"
    assert payload["role"] == "admin"


def test_garbage_token_rejected():
    assert _run(decode_token("not-a-jwt")) is None


# ---------------------------------------------------------------------------
# decode_token store-backed checks: revocation / suspension / forced logout
# ---------------------------------------------------------------------------

class _FakeStore:
    def __init__(self, revoked=False, user=None):
        self._revoked = revoked
        self._user = user

    async def is_token_revoked(self, jti):
        return self._revoked

    async def get_user_by_id(self, user_id):
        return self._user


@pytest.fixture
def fake_store(monkeypatch):
    """Point get_app().state.memory_manager._store at a configurable fake so
    decode_token exercises its revocation/suspension/cutoff branches."""
    holder = {"store": _FakeStore()}
    mm = SimpleNamespace(_store=None)

    class _Proxy:
        @property
        def _store(self):
            return holder["store"]

    monkeypatch.setattr(app.state, "memory_manager", _Proxy(), raising=False)
    monkeypatch.setattr(main, "_app_instance", app, raising=False)
    return holder


def test_revoked_token_rejected(fake_store):
    fake_store["store"] = _FakeStore(revoked=True, user=None)
    access = create_access_token("user-1", "u@test.local", "user")
    assert _run(decode_token(access)) is None


def test_suspended_user_rejected(fake_store):
    fake_store["store"] = _FakeStore(revoked=False, user={"is_suspended": True})
    access = create_access_token("user-1", "u@test.local", "user")
    assert _run(decode_token(access)) is None


def test_token_before_valid_after_cutoff_rejected(fake_store):
    # tokens_valid_after in the future → every already-issued token is invalid.
    future = (datetime.now(tz=timezone.utc) + timedelta(days=1)).isoformat()
    fake_store["store"] = _FakeStore(
        revoked=False, user={"is_suspended": False, "tokens_valid_after": future})
    access = create_access_token("user-1", "u@test.local", "user")
    assert _run(decode_token(access)) is None


def test_token_after_valid_after_cutoff_accepted(fake_store):
    # tokens_valid_after in the past → a freshly-issued token still authenticates.
    past = (datetime.now(tz=timezone.utc) - timedelta(days=1)).isoformat()
    fake_store["store"] = _FakeStore(
        revoked=False, user={"is_suspended": False, "tokens_valid_after": past})
    access = create_access_token("user-1", "u@test.local", "user")
    payload = _run(decode_token(access))
    assert payload is not None and payload["sub"] == "user-1"


# ---------------------------------------------------------------------------
# require_role: header AND cookie extraction + role enforcement
# (driven through a real admin-only endpoint, /api/horizon/units)
# ---------------------------------------------------------------------------

ADMIN_URL = "/api/horizon/units"


def test_require_role_accepts_bearer_header():
    tok = create_access_token("admin-1", "a@test.local", "admin")
    r = client.get(ADMIN_URL, headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200


def test_require_role_accepts_cookie():
    # The H-1-relevant path: no Authorization header, token only in the cookie.
    tok = create_access_token("admin-1", "a@test.local", "admin")
    cookie_client = TestClient(app)
    cookie_client.cookies.set("access_token", tok)
    r = cookie_client.get(ADMIN_URL)
    assert r.status_code == 200


def test_require_role_rejects_non_admin():
    tok = create_access_token("user-1", "u@test.local", "user")
    r = client.get(ADMIN_URL, headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 403


def test_require_role_rejects_missing_token():
    r = client.get(ADMIN_URL)
    assert r.status_code == 401
