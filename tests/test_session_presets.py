"""
tests/test_session_presets.py

Q2#9 — Session presets. Exercises the SQLite layer (CRUD, default flag,
ownership isolation) plus the route surface (flag default off).
"""

from __future__ import annotations

import asyncio

import pytest

from providers.memory.sqlite_store import SQLiteStore


@pytest.fixture()
def store(tmp_path):
    db_path = str(tmp_path / "presets.db")
    s = SQLiteStore(db_path)
    asyncio.run(s.initialize())
    yield s
    s.close()


def _run(coro):
    return asyncio.run(coro)


# -----------------------------------------------------------------------------
# CRUD
# -----------------------------------------------------------------------------

class TestPresetCRUD:
    def test_create_persists_config(self, store):
        p = _run(store.create_preset(
            "u", "Quick draft",
            {"provider": "ollama", "model": "llama3.2:3b", "thinking_mode": "off"},
        ))
        assert p["name"] == "Quick draft"
        assert p["config"]["provider"] == "ollama"
        assert p["config"]["thinking_mode"] == "off"
        assert p["is_default"] is False

    def test_list_only_owner(self, store):
        _run(store.create_preset("a", "A", {"voice_id": "river"}))
        _run(store.create_preset("b", "B", {"voice_id": "river"}))
        mine = _run(store.list_presets("a"))
        assert len(mine) == 1
        assert mine[0]["name"] == "A"

    def test_update_partial(self, store):
        p = _run(store.create_preset("u", "T", {"model": "llama3.2:3b"}))
        upd = _run(store.update_preset("u", p["id"], name="T2"))
        assert upd["name"] == "T2"
        assert upd["config"]["model"] == "llama3.2:3b"  # untouched

    def test_default_is_exclusive(self, store):
        a = _run(store.create_preset("u", "A", {}))
        b = _run(store.create_preset("u", "B", {}))
        _run(store.update_preset("u", a["id"], is_default=True))
        _run(store.update_preset("u", b["id"], is_default=True))
        listing = _run(store.list_presets("u"))
        defaults = [p for p in listing if p["is_default"]]
        assert len(defaults) == 1
        assert defaults[0]["id"] == b["id"]

    def test_delete_owner_only(self, store):
        p = _run(store.create_preset("u", "T", {}))
        assert _run(store.delete_preset("other", p["id"])) is False
        assert _run(store.delete_preset("u",     p["id"])) is True

    def test_get_other_user_returns_none(self, store):
        p = _run(store.create_preset("u", "T", {}))
        assert _run(store.get_preset("other", p["id"])) is None


# -----------------------------------------------------------------------------
# Route surface — flag-gated
# -----------------------------------------------------------------------------

class TestRouteSurface:
    def test_flag_default_on(self):
        from config.settings import get_settings
        # Enabled by default — per-user settings snapshots in the chat selector.
        assert getattr(get_settings(), "session_presets_enabled", False) is True

    def test_router_importable(self):
        from api.routes import session_presets as p
        assert p.router.prefix == "/api/presets"
        paths = {r.path for r in p.router.routes}
        assert "/api/presets"                  in paths
        assert "/api/presets/{preset_id}"      in paths
        assert "/api/presets/{preset_id}/apply" in paths
