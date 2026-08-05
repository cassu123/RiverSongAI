"""
tests/test_auth_2fa.py

Step 2 of the 2FA login (`POST /api/auth/login/totp`) and the session cookie
that login issues.

These exist because that endpoint had no test coverage at all and was broken:
a misplaced `return` left every line of the TOTP verification unreachable, and
the handler referenced a `response` object its signature never declared. The
negative cases below are the ones that matter — a wrong code and a stale
challenge must not produce a token.
"""

import asyncio

import bcrypt
import pytest
from fastapi.testclient import TestClient

from core.auth import create_totp_challenge_token, decode_token
from core.twofa import (
    generate_recovery_codes,
    generate_secret,
    hash_recovery_codes,
    totp_now,
)
from main import app

client = TestClient(app)

PASSWORD = "correct-horse-battery-staple"


def _sync(coro):
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """The login endpoints are rate limited per client, and every test here
    arrives from the same one. Without this the suite trips its own limiter
    and the later tests fail with 429 for reasons that have nothing to do
    with what they are asserting."""
    from core.limiter import limiter

    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture
def store(app_store):
    return app_store


@pytest.fixture
def totp_user(store):
    """A fresh approved user with 2FA enabled. Yields (user_id, secret)."""
    uid = "totp-test-user"
    email = "totp-test@example.com"

    async def _prepare():
        if not await store.get_user_by_email(email):
            await store.create_user(
                id=uid,
                email=email,
                password_hash=bcrypt.hashpw(
                    PASSWORD.encode(), bcrypt.gensalt()
                ).decode(),
                display_name="TOTP Test",
                role="user",
                is_approved=True,
            )
        secret = generate_secret()
        await store.enable_totp(uid, secret, [])
        return secret

    secret = _sync(_prepare())
    yield uid, secret
    _sync(store.disable_totp(uid))


def _post_totp(**body):
    return client.post("/api/auth/login/totp", json=body)


# =============================================================================
# The happy path — which was entirely unreachable code before this test.
# =============================================================================


def test_correct_code_issues_a_token(totp_user):
    uid, secret = totp_user
    r = _post_totp(
        challenge_token=create_totp_challenge_token(user_id=uid),
        code=totp_now(secret),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["token"]
    assert body["used_recovery_code"] is False
    assert body["user"]["id"] == uid


def test_correct_code_sets_the_session_cookie(totp_user):
    uid, secret = totp_user
    r = _post_totp(
        challenge_token=create_totp_challenge_token(user_id=uid),
        code=totp_now(secret),
    )
    assert r.status_code == 200, r.text
    assert r.cookies.get("access_token")


def test_recovery_code_works_and_is_consumed(store):
    uid = "totp-recovery-user"
    email = "totp-recovery@example.com"
    plaintext = generate_recovery_codes(count=2)

    async def _prepare():
        if not await store.get_user_by_email(email):
            await store.create_user(
                id=uid,
                email=email,
                password_hash=bcrypt.hashpw(
                    PASSWORD.encode(), bcrypt.gensalt()
                ).decode(),
                display_name="Recovery Test",
                role="user",
                is_approved=True,
            )
        await store.enable_totp(uid, generate_secret(), hash_recovery_codes(plaintext))

    _sync(_prepare())

    r = _post_totp(
        challenge_token=create_totp_challenge_token(user_id=uid),
        recovery_code=plaintext[0],
    )
    assert r.status_code == 200, r.text
    assert r.json()["used_recovery_code"] is True

    # Burned: the same code must not work twice.
    again = _post_totp(
        challenge_token=create_totp_challenge_token(user_id=uid),
        recovery_code=plaintext[0],
    )
    assert again.status_code == 401

    # The other one still works.
    other = _post_totp(
        challenge_token=create_totp_challenge_token(user_id=uid),
        recovery_code=plaintext[1],
    )
    assert other.status_code == 200, other.text

    _sync(store.disable_totp(uid))


# =============================================================================
# The negative cases. These are the point of the endpoint.
# =============================================================================


def test_wrong_code_is_rejected(totp_user):
    uid, secret = totp_user
    wrong = "000000" if totp_now(secret) != "000000" else "111111"
    r = _post_totp(
        challenge_token=create_totp_challenge_token(user_id=uid), code=wrong
    )
    assert r.status_code == 401
    assert "token" not in r.json()


def test_wrong_code_issues_no_cookie(totp_user):
    uid, secret = totp_user
    wrong = "000000" if totp_now(secret) != "000000" else "111111"
    r = _post_totp(
        challenge_token=create_totp_challenge_token(user_id=uid), code=wrong
    )
    assert r.status_code == 401
    assert not r.cookies.get("access_token")


def test_unknown_recovery_code_is_rejected(totp_user):
    uid, _secret = totp_user
    r = _post_totp(
        challenge_token=create_totp_challenge_token(user_id=uid),
        recovery_code="not-a-real-recovery-code",
    )
    assert r.status_code == 401


def test_garbage_challenge_token_is_rejected(totp_user):
    _uid, secret = totp_user
    r = _post_totp(challenge_token="not.a.jwt", code=totp_now(secret))
    assert r.status_code == 401


def test_access_token_is_not_accepted_as_a_challenge(totp_user):
    """A challenge token is a distinct audience. A full access token must not
    stand in for one, or step 1 could be skipped entirely."""
    from core.auth import create_access_token

    uid, secret = totp_user
    access = create_access_token(uid, "totp-test@example.com", "user")
    r = _post_totp(challenge_token=access, code=totp_now(secret))
    assert r.status_code == 401


def test_missing_both_code_and_recovery_is_a_400(totp_user):
    uid, _secret = totp_user
    r = _post_totp(challenge_token=create_totp_challenge_token(user_id=uid))
    assert r.status_code == 400


def test_disabled_midflight_falls_back_to_plain_login(store, totp_user):
    """The documented race: the user turns 2FA off between step 1 and step 2.
    The challenge was issued against a verified password, so it stands."""
    uid, _secret = totp_user
    challenge = create_totp_challenge_token(user_id=uid)
    _sync(store.disable_totp(uid))

    r = _post_totp(challenge_token=challenge, code="000000")
    assert r.status_code == 200, r.text
    assert r.json()["token"]


def test_issued_token_actually_authenticates(totp_user):
    uid, secret = totp_user
    r = _post_totp(
        challenge_token=create_totp_challenge_token(user_id=uid),
        code=totp_now(secret),
    )
    assert r.status_code == 200, r.text
    payload = _sync(decode_token(r.json()["token"]))
    assert payload is not None
    assert payload["sub"] == uid

    me = client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {r.json()['token']}"}
    )
    assert me.status_code == 200
    assert me.json()["id"] == uid


# =============================================================================
# Step 1 issues the same cookie step 2 does.
# =============================================================================


def test_password_login_sets_the_session_cookie(store):
    uid = "cookie-login-user"
    email = "cookie-login@example.com"

    async def _prepare():
        if not await store.get_user_by_email(email):
            await store.create_user(
                id=uid,
                email=email,
                password_hash=bcrypt.hashpw(
                    PASSWORD.encode(), bcrypt.gensalt()
                ).decode(),
                display_name="Cookie Login",
                role="user",
                is_approved=True,
            )

    _sync(_prepare())

    r = client.post(
        "/api/auth/login", json={"email": email, "password": PASSWORD}
    )
    assert r.status_code == 200, r.text
    assert r.cookies.get("access_token") == r.json()["token"]


def test_failed_password_login_sets_no_cookie(store):
    r = client.post(
        "/api/auth/login",
        json={"email": "cookie-login@example.com", "password": "wrong-password"},
    )
    assert r.status_code == 401
    assert not r.cookies.get("access_token")


def test_2fa_challenge_response_sets_no_cookie(store, totp_user):
    """Step 1 for a 2FA user must hand back a challenge, never a session."""
    r = client.post(
        "/api/auth/login",
        json={"email": "totp-test@example.com", "password": PASSWORD},
    )
    assert r.status_code == 200, r.text
    assert r.json()["require_totp"] is True
    assert not r.cookies.get("access_token")
