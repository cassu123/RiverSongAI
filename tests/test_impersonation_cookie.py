"""
tests/test_impersonation_cookie.py

Cookie-based admin impersonation (audit H-1, Stage 2): impersonate and revert
must swap the HttpOnly access_token cookie, since the frontend no longer holds
a token in JS. Uses a fake store so no DB is required.
"""

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import main
from core.auth import create_access_token
from main import app


class _FakeStore:
    def __init__(self, users):
        self.users = users

    async def is_token_revoked(self, jti):
        return False

    async def get_user_by_id(self, uid):
        return self.users.get(uid)


@pytest.fixture
def store(monkeypatch):
    users = {
        "admin-1": {"id": "admin-1", "email": "a@test.local",
                    "role": "admin", "is_suspended": False},
        "user-2": {"id": "user-2", "email": "u@test.local",
                   "role": "user", "is_suspended": False},
    }
    proxy = SimpleNamespace(_store=_FakeStore(users))
    monkeypatch.setattr(app.state, "memory_manager", proxy, raising=False)
    monkeypatch.setattr(main, "_app_instance", app, raising=False)
    return proxy


def test_impersonate_swaps_the_cookie(store):
    admin = create_access_token("admin-1", "a@test.local", "admin")
    r = TestClient(app).post(
        "/api/admin/users/user-2/impersonate",
        headers={"Authorization": f"Bearer {admin}"})
    assert r.status_code == 200
    assert r.json()["impersonated_user"]["id"] == "user-2"
    assert "access_token=" in r.headers.get("set-cookie", "")


def test_revert_restores_admin_cookie(store):
    imp = create_access_token("user-2", "u@test.local", "user",
                              impersonator_id="admin-1")
    r = TestClient(app).post(
        "/api/admin/revert-impersonation",
        headers={"Authorization": f"Bearer {imp}"})
    assert r.status_code == 200
    assert r.json()["user"]["id"] == "admin-1"
    assert "access_token=" in r.headers.get("set-cookie", "")


def test_revert_rejects_non_impersonation_token(store):
    plain = create_access_token("admin-1", "a@test.local", "admin")
    r = TestClient(app).post(
        "/api/admin/revert-impersonation",
        headers={"Authorization": f"Bearer {plain}"})
    assert r.status_code == 400
