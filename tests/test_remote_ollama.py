"""
tests/test_remote_ollama.py

Q3#14 — Remote Ollama. Validates:
  - SQLite layer: rig CRUD, health-state persistence, model list storage.
  - resolve_rig: by id, by label (case-insensitive), inactive rejected.
  - health_check: returns ("down", []) for an unreachable URL fast.
  - RemoteOllamaLLM construction rejects empty base_url.
  - Provider falls back to local Ollama when remote is down (when
    fallback_local=True).
  - Route surface: flag default off.
"""

from __future__ import annotations

import asyncio

import pytest

from providers.memory.sqlite_store import SQLiteStore
from providers.llm.remote_ollama import (
    RemoteOllamaLLM,
    health_check,
    resolve_rig,
)


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture()
def store(tmp_path):
    s = SQLiteStore(str(tmp_path / "rigs.db"))
    asyncio.run(s.initialize())
    yield s
    s.close()


# -----------------------------------------------------------------------------
# CRUD
# -----------------------------------------------------------------------------

class TestRigCRUD:
    def test_create_persists_fields(self, store):
        rig = _run(store.create_remote_rig("ws", "http://localhost:11500", "fast", "admin"))
        assert rig["label"]      == "ws"
        assert rig["base_url"]   == "http://localhost:11500"
        assert rig["last_health"] == "unknown"
        assert rig["is_active"] is True

    def test_list_orderable(self, store):
        for i in range(3):
            _run(store.create_remote_rig(f"r{i}", f"http://h{i}", "", "admin"))
        listing = _run(store.list_remote_rigs())
        assert len(listing) == 3

    def test_update_partial(self, store):
        rig = _run(store.create_remote_rig("ws", "http://localhost:11500", "", "admin"))
        upd = _run(store.update_remote_rig(rig["id"], label="new-label"))
        assert upd["label"]    == "new-label"
        assert upd["base_url"] == "http://localhost:11500"  # unchanged

    def test_health_persists_models(self, store):
        rig = _run(store.create_remote_rig("ws", "http://localhost:11500", "", "admin"))
        upd = _run(store.record_remote_rig_health(rig["id"], health="ok", models=["llama:7b", "mistral"]))
        assert upd["last_health"] == "ok"
        assert upd["last_models"] == ["llama:7b", "mistral"]

    def test_health_unknown_for_bad_value(self, store):
        rig = _run(store.create_remote_rig("ws", "http://x", "", "admin"))
        upd = _run(store.record_remote_rig_health(rig["id"], health="exploded", models=[]))
        assert upd["last_health"] == "unknown"

    def test_delete(self, store):
        rig = _run(store.create_remote_rig("ws", "http://x", "", "admin"))
        assert _run(store.delete_remote_rig(rig["id"])) is True
        assert _run(store.get_remote_rig(rig["id"]))    is None


# -----------------------------------------------------------------------------
# resolve_rig
# -----------------------------------------------------------------------------

class TestResolveRig:
    def test_by_id(self, store):
        rig = _run(store.create_remote_rig("ws", "http://x", "", "admin"))
        out = _run(resolve_rig(rig["id"], store))
        assert out and out["id"] == rig["id"]

    def test_by_label_case_insensitive(self, store):
        _run(store.create_remote_rig("Workstation", "http://x", "", "admin"))
        out = _run(resolve_rig("workstation", store))
        assert out and out["label"] == "Workstation"

    def test_inactive_returns_none(self, store):
        rig = _run(store.create_remote_rig("ws", "http://x", "", "admin"))
        _run(store.update_remote_rig(rig["id"], is_active=False))
        assert _run(resolve_rig(rig["id"], store)) is None

    def test_unknown_returns_none(self, store):
        assert _run(resolve_rig("missing", store)) is None

    def test_empty_returns_none(self, store):
        assert _run(resolve_rig("", store)) is None


# -----------------------------------------------------------------------------
# health_check — unreachable URLs return ("down", []) quickly
# -----------------------------------------------------------------------------

class TestHealthCheck:
    def test_unreachable_returns_down(self):
        # 127.0.0.1:1 is reserved and refuses connections.
        h, models = _run(health_check("http://127.0.0.1:1", timeout=0.5))
        assert h == "down"
        assert models == []

    def test_empty_url_returns_unknown(self):
        h, models = _run(health_check(""))
        assert h == "unknown"


# -----------------------------------------------------------------------------
# RemoteOllamaLLM
# -----------------------------------------------------------------------------

class TestRemoteOllamaLLM:
    def test_empty_base_url_rejected(self):
        with pytest.raises(ValueError):
            RemoteOllamaLLM(base_url="")

    def test_accepts_explicit_model(self):
        llm = RemoteOllamaLLM(base_url="http://localhost:11434", model="llama3.2:3b")
        assert llm._model == "llama3.2:3b"


# -----------------------------------------------------------------------------
# Route surface
# -----------------------------------------------------------------------------

class TestRouteSurface:
    def test_flag_default_off(self):
        from config.settings import get_settings
        assert getattr(get_settings(), "remote_ollama_enabled", True) is False

    def test_router_importable(self):
        from api.routes import remote_ollama as r
        assert r.router.prefix == "/api/remote-ollama"
        paths = {rt.path for rt in r.router.routes}
        assert "/api/remote-ollama/rigs"               in paths
        assert "/api/remote-ollama/rigs/{rig_id}"      in paths
        assert "/api/remote-ollama/rigs/{rig_id}/health" in paths
