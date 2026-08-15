"""
tests/test_csrf.py

The double-submit CSRF layer that guards the cookie session.

The load-bearing assertions are the two that define the shape of the thing:
a cookie-authenticated write without the header must be refused, and a
Bearer-authenticated write must sail through untouched. The second is what
makes it safe to switch this on while the frontend still uses headers.
"""

import pytest
from fastapi.testclient import TestClient

from core.auth import create_access_token
from core.csrf import (
    CSRF_COOKIE_NAME,
    SESSION_COOKIE_NAME,
    csrf_required,
    new_csrf_token,
    tokens_match,
)
from main import app

client = TestClient(app)

# Any authenticated state-changing route will do. This one only needs to get
# far enough to prove the request was not stopped by the CSRF layer.
WRITE_PATH = "/api/proactive/prefs"


@pytest.fixture(autouse=True)
def _app_state(app_store):
    """The routes exercised here read app.state.memory_manager. See the
    `app_store` fixture in conftest for why this is not a TestClient
    context manager."""


@pytest.fixture
def token():
    return create_access_token("csrf-test-user", "csrf@example.com", "admin")


# =============================================================================
# The policy, tested without a transport under it.
# =============================================================================


def test_safe_methods_are_never_checked():
    for method in ("GET", "HEAD", "OPTIONS", "TRACE"):
        assert not csrf_required(
            method, "/api/anything", {SESSION_COOKIE_NAME: "t"}, {}
        )


def test_cookie_authenticated_write_is_checked():
    assert csrf_required("POST", "/api/anything", {SESSION_COOKIE_NAME: "t"}, {})


def test_bearer_header_is_exempt():
    """Cross-origin script cannot set this header, so there is no CSRF to
    protect against. This is what keeps the header-authenticated frontend
    working while the layer is switched on."""
    assert not csrf_required(
        "POST",
        "/api/anything",
        {SESSION_COOKIE_NAME: "t"},
        {"authorization": "Bearer abc"},
    )


def test_bearer_detection_is_case_insensitive():
    assert not csrf_required(
        "POST",
        "/api/anything",
        {SESSION_COOKIE_NAME: "t"},
        {"authorization": "bearer abc"},
    )


def test_no_session_cookie_means_nothing_to_ride_on():
    assert not csrf_required("POST", "/api/anything", {}, {})


def test_login_routes_are_exempt():
    for path in ("/api/auth/login", "/api/auth/login/totp", "/api/auth/setup"):
        assert not csrf_required("POST", path, {SESSION_COOKIE_NAME: "t"}, {})


def test_a_non_exempt_auth_route_is_still_checked():
    """The exemption is a fixed list, not a prefix match on /api/auth."""
    assert csrf_required(
        "PATCH", "/api/auth/password", {SESSION_COOKIE_NAME: "t"}, {}
    )


def test_tokens_match_rejects_missing_sides():
    value = new_csrf_token()
    assert tokens_match(value, value)
    assert not tokens_match(value, None)
    assert not tokens_match(None, value)
    assert not tokens_match(None, None)
    assert not tokens_match("", "")
    assert not tokens_match(value, value + "x")


# =============================================================================
# End to end, through the middleware.
# =============================================================================


def test_cookie_write_without_the_header_is_refused(token):
    r = client.patch(
        WRITE_PATH,
        json={"min_push_severity": "warning"},
        headers={"Cookie": f"{SESSION_COOKIE_NAME}={token}"},
    )
    assert r.status_code == 403
    assert "CSRF" in r.json()["detail"]


def test_cookie_write_with_a_mismatched_header_is_refused(token):
    r = client.patch(
        WRITE_PATH,
        json={"min_push_severity": "warning"},
        headers={
            "Cookie": f"{SESSION_COOKIE_NAME}={token}; {CSRF_COOKIE_NAME}={new_csrf_token()}",
            "X-CSRF-Token": new_csrf_token(),
        },
    )
    assert r.status_code == 403


def test_cookie_write_with_a_matching_header_is_allowed(token):
    csrf = new_csrf_token()
    r = client.patch(
        WRITE_PATH,
        json={"min_push_severity": "warning"},
        headers={
            "Cookie": f"{SESSION_COOKIE_NAME}={token}; {CSRF_COOKIE_NAME}={csrf}",
            "X-CSRF-Token": csrf,
        },
    )
    assert r.status_code == 200, r.text


def test_bearer_write_needs_no_csrf_token(token):
    """The existing frontend, unchanged."""
    r = client.patch(
        WRITE_PATH,
        json={"min_push_severity": "warning"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text


def test_cookie_read_needs_no_csrf_token(token):
    r = client.get(
        WRITE_PATH,
        headers={"Cookie": f"{SESSION_COOKIE_NAME}={token}"},
    )
    assert r.status_code == 200, r.text


def test_refused_request_never_reaches_the_route(token):
    """A 403 from the middleware must not have applied the write. Set a value
    with a legitimate request, then try to change it with a forged one."""
    csrf = new_csrf_token()
    good = client.patch(
        WRITE_PATH,
        json={"min_push_severity": "critical"},
        headers={
            "Cookie": f"{SESSION_COOKIE_NAME}={token}; {CSRF_COOKIE_NAME}={csrf}",
            "X-CSRF-Token": csrf,
        },
    )
    assert good.status_code == 200, good.text

    forged = client.patch(
        WRITE_PATH,
        json={"min_push_severity": "info"},
        headers={"Cookie": f"{SESSION_COOKIE_NAME}={token}"},
    )
    assert forged.status_code == 403

    after = client.get(WRITE_PATH, headers={"Authorization": f"Bearer {token}"})
    assert after.json()["prefs"]["min_push_severity"] == "critical"


# =============================================================================
# The cookies login hands out.
# =============================================================================


def test_login_issues_both_cookies():
    import asyncio

    import bcrypt

    email = "csrf-login@example.com"
    password = "correct-horse-battery-staple"

    store = app.state.memory_manager._store

    async def _prepare():
        if not await store.get_user_by_email(email):
            await store.create_user(
                id="csrf-login-user",
                email=email,
                password_hash=bcrypt.hashpw(
                    password.encode(), bcrypt.gensalt()
                ).decode(),
                display_name="CSRF Login",
                role="user",
                is_approved=True,
            )

    asyncio.run(_prepare())

    from core.limiter import limiter

    limiter.reset()
    r = client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    assert r.cookies.get(SESSION_COOKIE_NAME)
    assert r.cookies.get(CSRF_COOKIE_NAME)


def test_csrf_cookie_is_readable_by_script_and_session_cookie_is_not():
    """The whole mechanism depends on exactly one of these being httpOnly."""
    from starlette.responses import JSONResponse

    from api.routes.auth import _issue_session

    response = JSONResponse(content={})
    _issue_session(response, "a-token")

    headers = [
        value
        for key, value in response.raw_headers
        if key.lower() == b"set-cookie"
    ]
    session = next(h.decode() for h in headers if h.startswith(b"access_token="))
    csrf = next(h.decode() for h in headers if h.startswith(b"csrf_token="))

    assert "httponly" in session.lower()
    assert "httponly" not in csrf.lower()
    assert "samesite=lax" in session.lower()
    assert "samesite=lax" in csrf.lower()
