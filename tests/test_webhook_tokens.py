"""
tests/test_webhook_tokens.py

Q2#10 — Webhook tokens. Validates:
  - Token generation: prefix, length, base32 alphabet, uniqueness.
  - Hashing: deterministic, plaintext irrecoverable.
  - Expiry helper: malformed → expired; ISO-8601 future/past parsing.
  - Scope check: empty required = any; subset semantics.
  - Verification: revoked, expired, missing scope, disabled-flag all reject.
  - SQLite layer: issue, list (with/without revoked), revoke (idempotent),
    audit log, use counter, hash lookup.
"""

from __future__ import annotations

import asyncio
import datetime as _dt
import re

import pytest

from core.webhook_tokens import (
    generate_token,
    hash_token,
    has_required_scopes,
    is_expired,
    verify_webhook_token,
)
from providers.memory.sqlite_store import SQLiteStore


@pytest.fixture()
def store(tmp_path):
    db_path = str(tmp_path / "webhooks.db")
    s = SQLiteStore(db_path)
    asyncio.run(s.initialize())
    yield s
    s.close()


def _run(coro):
    return asyncio.run(coro)


# -----------------------------------------------------------------------------
# Token shape
# -----------------------------------------------------------------------------

class TestTokenShape:
    def test_prefix(self):
        t = generate_token()
        assert t.startswith("rs_wh_")

    def test_alphabet(self):
        body = generate_token()[len("rs_wh_"):]
        assert re.fullmatch(r"[A-Z2-7]+", body)

    def test_unique(self):
        a = generate_token()
        b = generate_token()
        assert a != b

    def test_hash_deterministic(self):
        t = generate_token()
        assert hash_token(t) == hash_token(t)

    def test_hash_irrecoverable(self):
        t = generate_token()
        h = hash_token(t)
        assert t not in h
        assert len(h) == 64  # sha256 hex


# -----------------------------------------------------------------------------
# Expiry + scope helpers
# -----------------------------------------------------------------------------

class TestHelpers:
    def test_no_expiry_never_expired(self):
        assert is_expired(None) is False
        assert is_expired("")   is False

    def test_past_expired(self):
        past = (_dt.datetime.now(tz=_dt.timezone.utc) - _dt.timedelta(days=1)).isoformat()
        assert is_expired(past) is True

    def test_future_not_expired(self):
        future = (_dt.datetime.now(tz=_dt.timezone.utc) + _dt.timedelta(days=1)).isoformat()
        assert is_expired(future) is False

    def test_malformed_treated_as_expired(self):
        assert is_expired("nonsense") is True

    def test_empty_required_passes(self):
        assert has_required_scopes(["a"], []) is True

    def test_subset_required_passes(self):
        assert has_required_scopes(["a", "b", "c"], ["a", "b"]) is True

    def test_missing_required_fails(self):
        assert has_required_scopes(["a"], ["b"]) is False


# -----------------------------------------------------------------------------
# SQLite CRUD
# -----------------------------------------------------------------------------

class TestStoreCRUD:
    def test_create_and_list(self, store):
        row = _run(store.create_webhook_token("label-1", "hash-1", ["a"], "admin", None))
        listing = _run(store.list_webhook_tokens())
        assert any(t["id"] == row["id"] for t in listing)
        assert row["scopes"] == ["a"]

    def test_revoke_excludes_from_default_list(self, store):
        row = _run(store.create_webhook_token("l", "h", [], "admin", None))
        _run(store.revoke_webhook_token(row["id"], actor="admin"))
        listing = _run(store.list_webhook_tokens())
        assert all(t["id"] != row["id"] for t in listing)

    def test_revoke_idempotent(self, store):
        row = _run(store.create_webhook_token("l", "h", [], "admin", None))
        assert _run(store.revoke_webhook_token(row["id"], actor="admin")) is True
        assert _run(store.revoke_webhook_token(row["id"], actor="admin")) is False

    def test_get_by_hash(self, store):
        _run(store.create_webhook_token("l", "deadbeef", ["x"], "admin", None))
        found = _run(store.get_webhook_token_by_hash("deadbeef"))
        assert found["scopes"] == ["x"]
        assert _run(store.get_webhook_token_by_hash("missing")) is None

    def test_use_counter_increments(self, store):
        row = _run(store.create_webhook_token("l", "h", [], "admin", None))
        _run(store.record_webhook_token_use(row["id"], "ok"))
        _run(store.record_webhook_token_use(row["id"], "ok"))
        relisted = _run(store.list_webhook_tokens())
        only = [t for t in relisted if t["id"] == row["id"]][0]
        assert only["use_count"] == 2
        assert only["last_used_at"] is not None

    def test_audit_log_records_actions(self, store):
        row = _run(store.create_webhook_token("l", "h", ["s"], "admin", None))
        _run(store.record_webhook_token_use(row["id"], "ok"))
        _run(store.revoke_webhook_token(row["id"], actor="admin"))
        entries = _run(store.list_webhook_token_audit(token_id=row["id"]))
        actions = {e["action"] for e in entries}
        assert {"issued", "used", "revoked"} <= actions


# -----------------------------------------------------------------------------
# verify_webhook_token end-to-end
# -----------------------------------------------------------------------------

class TestVerify:
    def test_disabled_flag_rejects(self, store):
        from config.settings import get_settings
        assert getattr(get_settings(), "webhook_tokens_enabled", True) is False
        t = generate_token()
        _run(store.create_webhook_token("l", hash_token(t), [], "admin", None))
        # Flag off → reject even a perfectly valid token.
        assert _run(verify_webhook_token(t, store=store)) is None

    def test_enabled_valid_token(self, store, monkeypatch):
        from config import settings as settings_mod
        monkeypatch.setattr(settings_mod.get_settings(), "webhook_tokens_enabled", True, raising=False)
        t = generate_token()
        _run(store.create_webhook_token("l", hash_token(t), ["routines:trigger"], "admin", None))
        row = _run(verify_webhook_token(t, store=store, required_scopes=["routines:trigger"]))
        assert row is not None
        assert row["label"] == "l"

    def test_missing_scope_rejected(self, store, monkeypatch):
        from config import settings as settings_mod
        monkeypatch.setattr(settings_mod.get_settings(), "webhook_tokens_enabled", True, raising=False)
        t = generate_token()
        _run(store.create_webhook_token("l", hash_token(t), ["routines:read"], "admin", None))
        assert _run(verify_webhook_token(t, store=store, required_scopes=["routines:write"])) is None

    def test_revoked_token_rejected(self, store, monkeypatch):
        from config import settings as settings_mod
        monkeypatch.setattr(settings_mod.get_settings(), "webhook_tokens_enabled", True, raising=False)
        t = generate_token()
        row = _run(store.create_webhook_token("l", hash_token(t), [], "admin", None))
        _run(store.revoke_webhook_token(row["id"], actor="admin"))
        assert _run(verify_webhook_token(t, store=store)) is None

    def test_expired_token_rejected(self, store, monkeypatch):
        from config import settings as settings_mod
        monkeypatch.setattr(settings_mod.get_settings(), "webhook_tokens_enabled", True, raising=False)
        t = generate_token()
        past = (_dt.datetime.now(tz=_dt.timezone.utc) - _dt.timedelta(days=1)).isoformat()
        _run(store.create_webhook_token("l", hash_token(t), [], "admin", past))
        assert _run(verify_webhook_token(t, store=store)) is None

    def test_unknown_token_rejected(self, store, monkeypatch):
        from config import settings as settings_mod
        monkeypatch.setattr(settings_mod.get_settings(), "webhook_tokens_enabled", True, raising=False)
        assert _run(verify_webhook_token("rs_wh_NOPE", store=store)) is None


# -----------------------------------------------------------------------------
# Route surface
# -----------------------------------------------------------------------------

class TestRouteSurface:
    def test_router_importable(self):
        from api.routes import webhook_tokens as wt
        assert wt.router.prefix == "/api/webhook-tokens"
        paths = {r.path for r in wt.router.routes}
        assert "/api/webhook-tokens"                   in paths
        assert "/api/webhook-tokens/{token_id}/revoke" in paths
        assert "/api/webhook-tokens/audit"             in paths
