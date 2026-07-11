"""
tests/test_cookie_auth_bridge.py

Backend Stage 1 of the cookie-only auth migration (audit H-1): the
_CookieAuthBridgeMiddleware injects `Authorization: Bearer <cookie>` when a
request carries the access_token cookie but no Authorization header, so the
many handlers that read the header directly (and never checked the cookie)
also accept cookie auth.

/api/commerce/workspaces is a good probe: its get_current_biz_user reads the
Authorization header only, with no cookie fallback of its own.
"""

from fastapi.testclient import TestClient

from core.auth import create_access_token
from main import app

URL = "/api/commerce/workspaces"


def test_header_only_endpoint_accepts_cookie_via_bridge():
    tok = create_access_token("bridge-user", "bridge@test.local", "user")
    c = TestClient(app)
    c.cookies.set("access_token", tok)
    r = c.get(URL)  # cookie only, no Authorization header
    assert r.status_code == 200


def test_header_still_works():
    tok = create_access_token("bridge-user", "bridge@test.local", "user")
    r = TestClient(app).get(URL, headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200


def test_no_auth_still_rejected():
    r = TestClient(app).get(URL)
    assert r.status_code == 401


def test_explicit_header_wins_over_cookie():
    # A valid header must take precedence; a garbage cookie alongside it must
    # not override the real credential.
    good = create_access_token("bridge-user", "bridge@test.local", "user")
    c = TestClient(app)
    c.cookies.set("access_token", "garbage-token")
    r = c.get(URL, headers={"Authorization": f"Bearer {good}"})
    assert r.status_code == 200


def test_cookie_auth_sentinel_resolves_to_cookie():
    # The cookie-only frontend sends the public sentinel as its bearer; with a
    # valid cookie present it must authenticate from the cookie.
    tok = create_access_token("bridge-user", "bridge@test.local", "user")
    c = TestClient(app)
    c.cookies.set("access_token", tok)
    r = c.get(URL, headers={"Authorization": "Bearer __rs_cookie__"})
    assert r.status_code == 200


def test_placeholder_bearer_null_resolves_to_cookie():
    tok = create_access_token("bridge-user", "bridge@test.local", "user")
    c = TestClient(app)
    c.cookies.set("access_token", tok)
    r = c.get(URL, headers={"Authorization": "Bearer null"})
    assert r.status_code == 200


def test_sentinel_without_cookie_is_unauthorized():
    # The sentinel is not itself a credential — no cookie means no auth.
    r = TestClient(app).get(URL, headers={"Authorization": "Bearer __rs_cookie__"})
    assert r.status_code == 401
