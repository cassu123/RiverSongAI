"""
tests/test_documents.py

Q2#6 — Documents workspace. Exercises the SQLite layer directly (CRUD shape,
ownership isolation, pin behavior, ordering) without needing the FastAPI app
under test — same approach used for Q1 features so the suite stays portable
across degraded test environments.
"""

from __future__ import annotations

import asyncio
import os
import tempfile

import pytest

from providers.memory.sqlite_store import SQLiteStore


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

@pytest.fixture()
def store(tmp_path):
    db_path = str(tmp_path / "docs.db")
    s = SQLiteStore(db_path)
    asyncio.run(s.initialize())
    yield s
    s.close()


def _run(coro):
    return asyncio.run(coro)


# -----------------------------------------------------------------------------
# CRUD
# -----------------------------------------------------------------------------

class TestDocumentCRUD:
    def test_create_returns_full_doc(self, store):
        doc = _run(store.create_document("u1", "Notes", "markdown", "# hello"))
        assert doc["id"]
        assert doc["title"] == "Notes"
        assert doc["kind"]  == "markdown"
        assert doc["body"]  == "# hello"
        assert doc["pinned"] is False
        assert doc["created_at"] == doc["updated_at"]

    def test_list_returns_only_owner(self, store):
        _run(store.create_document("a", "Mine",   "text", "a"))
        _run(store.create_document("b", "Theirs", "text", "b"))
        mine = _run(store.list_documents("a"))
        assert len(mine) == 1
        assert mine[0]["title"] == "Mine"

    def test_get_returns_body(self, store):
        d = _run(store.create_document("u", "T", "text", "body here"))
        got = _run(store.get_document("u", d["id"]))
        assert got["body"] == "body here"

    def test_get_other_user_returns_none(self, store):
        d = _run(store.create_document("u", "T", "text", "x"))
        assert _run(store.get_document("other", d["id"])) is None

    def test_update_changes_fields(self, store):
        d = _run(store.create_document("u", "T", "markdown", "v1"))
        upd = _run(store.update_document("u", d["id"], title="T2", body="v2"))
        assert upd["title"] == "T2"
        assert upd["body"]  == "v2"
        assert upd["kind"]  == "markdown"  # unchanged

    def test_update_other_user_returns_none(self, store):
        d = _run(store.create_document("u", "T", "text", "x"))
        assert _run(store.update_document("other", d["id"], body="hack")) is None

    def test_delete_owner_only(self, store):
        d = _run(store.create_document("u", "T", "text", "x"))
        assert _run(store.delete_document("other", d["id"])) is False
        assert _run(store.delete_document("u",     d["id"])) is True
        assert _run(store.get_document("u",        d["id"])) is None

    def test_count(self, store):
        for i in range(3):
            _run(store.create_document("u", f"T{i}", "text", str(i)))
        assert _run(store.count_documents("u"))     == 3
        assert _run(store.count_documents("other")) == 0


# -----------------------------------------------------------------------------
# Pinning + ordering
# -----------------------------------------------------------------------------

class TestPinningOrdering:
    def test_pinned_floats_to_top(self, store):
        first  = _run(store.create_document("u", "First",  "text", "1"))
        second = _run(store.create_document("u", "Second", "text", "2"))
        _run(store.update_document("u", first["id"], pinned=True))
        order = [d["title"] for d in _run(store.list_documents("u"))]
        assert order[0] == "First"

    def test_unpin_works(self, store):
        d = _run(store.create_document("u", "T", "text", "x"))
        _run(store.update_document("u", d["id"], pinned=True))
        _run(store.update_document("u", d["id"], pinned=False))
        listing = _run(store.list_documents("u"))
        assert listing[0]["pinned"] is False


# -----------------------------------------------------------------------------
# Route surface — soft-gated on flag
# -----------------------------------------------------------------------------

class TestRouteSurface:
    def test_flag_default_on(self):
        from config.settings import get_settings
        # Enabled by default — backs the Docs tab and Deep Research storage.
        assert getattr(get_settings(), "documents_enabled", False) is True

    def test_router_importable(self):
        # Routes file must import cleanly even when the flag is off — it should
        # only consult the flag inside per-request handlers.
        from api.routes import documents as docs_route
        assert docs_route.router.prefix == "/api/documents"
        # CRUD endpoints all registered
        paths = {r.path for r in docs_route.router.routes}
        assert "/api/documents"          in paths
        assert "/api/documents/{doc_id}" in paths
