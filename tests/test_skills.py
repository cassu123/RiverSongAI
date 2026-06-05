"""
tests/test_skills.py

Q2#7 — Skills system. Exercises the SQLite layer (CRUD shape, ownership
isolation, active toggle) plus the pure helpers in core/skills.py
(rendering, soft no-op when disabled). The vector layer is stubbed by
default since ChromaDB initialization is environment-dependent.
"""

from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest

from providers.memory.sqlite_store import SQLiteStore


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

@pytest.fixture()
def store(tmp_path):
    db_path = str(tmp_path / "skills.db")
    s = SQLiteStore(db_path)
    asyncio.run(s.initialize())
    yield s
    s.close()


def _run(coro):
    return asyncio.run(coro)


# -----------------------------------------------------------------------------
# CRUD
# -----------------------------------------------------------------------------

class TestSkillCRUD:
    def test_create_defaults_active(self, store):
        s = _run(store.create_skill("u", "Summarize", "When asked to summarize, …"))
        assert s["is_active"] is True
        assert s["name"]   == "Summarize"
        assert s["prompt"] == "When asked to summarize, …"

    def test_list_returns_only_owner(self, store):
        _run(store.create_skill("a", "A-skill", "prompt-a"))
        _run(store.create_skill("b", "B-skill", "prompt-b"))
        mine = _run(store.list_skills("a"))
        assert len(mine) == 1
        assert mine[0]["name"] == "A-skill"

    def test_get_other_user_returns_none(self, store):
        s = _run(store.create_skill("u", "T", "p"))
        assert _run(store.get_skill("other", s["id"])) is None

    def test_update_changes_fields(self, store):
        s = _run(store.create_skill("u", "T", "p"))
        upd = _run(store.update_skill("u", s["id"], name="T2", is_active=False))
        assert upd["name"]      == "T2"
        assert upd["is_active"] is False
        assert upd["prompt"]    == "p"  # unchanged

    def test_active_only_filter(self, store):
        a = _run(store.create_skill("u", "A", "p1"))
        b = _run(store.create_skill("u", "B", "p2"))
        _run(store.update_skill("u", b["id"], is_active=False))
        all_skills    = _run(store.list_skills("u"))
        active_skills = _run(store.list_skills("u", active_only=True))
        assert len(all_skills)    == 2
        assert len(active_skills) == 1
        assert active_skills[0]["id"] == a["id"]

    def test_delete_owner_only(self, store):
        s = _run(store.create_skill("u", "T", "p"))
        assert _run(store.delete_skill("other", s["id"])) is False
        assert _run(store.delete_skill("u",     s["id"])) is True

    def test_count(self, store):
        for i in range(4):
            _run(store.create_skill("u", f"S{i}", "p"))
        assert _run(store.count_skills("u")) == 4


# -----------------------------------------------------------------------------
# core/skills pure helpers
# -----------------------------------------------------------------------------

class TestSkillsHelpers:
    def test_render_block_with_hits(self):
        from core.skills import render_skills_block
        out = render_skills_block([
            {"name": "Summarize", "text": "Summarize → TL;DR + 3 takeaways"},
            {"name": "Explain",   "text": "Explain like I'm 12"},
        ])
        assert "User skills" in out
        assert "Summarize"   in out
        assert "TL;DR"       in out
        assert "Explain"     in out

    def test_render_block_empty_returns_empty(self):
        from core.skills import render_skills_block
        assert render_skills_block([]) == ""

    def test_skill_text_combines_fields(self):
        from core.skills import _skill_text
        out = _skill_text({
            "name": "Greet",
            "trigger_phrases": "say hi, hello",
            "prompt": "Respond with a warm greeting.",
        })
        assert "Greet" in out
        assert "hello" in out
        assert "Respond" in out

    def test_relevant_skills_no_op_when_disabled(self):
        # With the flag off, the retrieval helper must short-circuit to []
        # without touching the vector store.
        from core.skills import get_relevant_skills
        with patch("core.skills._is_enabled", return_value=False):
            hits = asyncio.run(get_relevant_skills("anything", owner_id="u"))
        assert hits == []

    def test_relevant_skills_empty_query_returns_empty(self):
        from core.skills import get_relevant_skills
        with patch("core.skills._is_enabled", return_value=True):
            hits = asyncio.run(get_relevant_skills("", owner_id="u"))
        assert hits == []


# -----------------------------------------------------------------------------
# Route surface — flag-gated
# -----------------------------------------------------------------------------

class TestRouteSurface:
    def test_flag_default_off(self):
        from config.settings import get_settings
        assert getattr(get_settings(), "skills_enabled", True) is False

    def test_router_importable(self):
        from api.routes import skills as skills_route
        assert skills_route.router.prefix == "/api/skills"
        paths = {r.path for r in skills_route.router.routes}
        assert "/api/skills"              in paths
        assert "/api/skills/{skill_id}"   in paths
        assert "/api/skills/relevant"     in paths
