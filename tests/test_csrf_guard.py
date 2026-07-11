"""
tests/test_csrf_guard.py

CSRF origin-check for cookie-authenticated mutations (audit H-1, Stage 2).
Only requests carrying the access_token cookie are checked; a foreign Origin
on a mutating method is rejected, same-origin / allow-listed origins pass, and
token/device clients (no cookie) are never blocked.
"""

from fastapi.testclient import TestClient

from core.auth import create_access_token
from main import app

# A cookie-authed admin so the request reaches (and passes) auth; the CSRF
# guard runs before the handler regardless.
_TOK = create_access_token("csrf-admin", "csrf@test.local", "admin")
MUTATING_URL = "/api/horizon/units/claim"  # POST, admin-only


def _client_with_cookie():
    c = TestClient(app)
    c.cookies.set("access_token", _TOK)
    return c


def test_foreign_origin_blocked_on_cookie_mutation():
    c = _client_with_cookie()
    r = c.post(MUTATING_URL, json={"name": "x"},
               headers={"Origin": "https://evil.example"})
    assert r.status_code == 403
    assert "CSRF" in r.json()["detail"]


def test_same_origin_allowed():
    c = _client_with_cookie()
    # Origin host matches the TestClient Host (testserver) → same-origin.
    r = c.post(MUTATING_URL, json={"name": "csrf-ok"},
               headers={"Origin": "http://testserver"})
    assert r.status_code == 200
    c.delete(f"/api/horizon/units/{r.json()['unit_id']}",
             headers={"Origin": "http://testserver"})


def test_no_origin_header_allowed():
    # Fail-open: no Origin → rely on SameSite=Lax, don't hard-block.
    c = _client_with_cookie()
    r = c.post(MUTATING_URL, json={"name": "csrf-noorigin"})
    assert r.status_code == 200
    c.delete(f"/api/horizon/units/{r.json()['unit_id']}")


def test_token_client_without_cookie_not_checked():
    # Bearer/device clients carry no access_token cookie → CSRF guard is inert
    # even from a foreign Origin (they aren't CSRF-able).
    r = TestClient(app).post(
        MUTATING_URL, json={"name": "csrf-bearer"},
        headers={"Authorization": f"Bearer {_TOK}",
                 "Origin": "https://evil.example"})
    assert r.status_code == 200
    TestClient(app).delete(f"/api/horizon/units/{r.json()['unit_id']}",
                           headers={"Authorization": f"Bearer {_TOK}"})


def test_get_not_checked():
    c = _client_with_cookie()
    r = c.get("/api/horizon/units", headers={"Origin": "https://evil.example"})
    assert r.status_code == 200  # reads are not CSRF-relevant
