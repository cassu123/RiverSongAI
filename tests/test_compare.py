"""
tests/test_compare.py

Q3#12 — Blind model comparison. Validates the SQLite layer (compare runs,
single-vote semantics, history, leaderboard aggregation) and the route
flag.
"""

from __future__ import annotations

import asyncio

import pytest

from providers.memory.sqlite_store import SQLiteStore


@pytest.fixture()
def store(tmp_path):
    s = SQLiteStore(str(tmp_path / "compare.db"))
    asyncio.run(s.initialize())
    yield s
    s.close()


def _run(coro):
    return asyncio.run(coro)


def _seed(store, owner_id, model_a, model_b, winner=""):
    row = _run(store.create_compare_run(
        owner_id=owner_id,
        prompt="q",
        prompt_hash="h",
        model_a=model_a,
        model_b=model_b,
        response_a="resp-a",
        response_b="resp-b",
    ))
    if winner:
        _run(store.record_compare_vote(row["id"], owner_id, winner))
    return row


# -----------------------------------------------------------------------------
# Create + vote
# -----------------------------------------------------------------------------

class TestCRUD:
    def test_create_run(self, store):
        row = _seed(store, "u", {"provider": "ollama", "model": "a"},
                                {"provider": "ollama", "model": "b"})
        assert row["winner"] == ""
        assert row["model_a"]["model"] == "a"

    def test_vote_records_winner(self, store):
        row = _seed(store, "u", {"provider": "x", "model": "1"},
                                {"provider": "x", "model": "2"})
        upd = _run(store.record_compare_vote(row["id"], "u", "a"))
        assert upd["winner"] == "a"

    def test_vote_invalid_winner_rejected(self, store):
        row = _seed(store, "u", {"provider": "x", "model": "1"},
                                {"provider": "x", "model": "2"})
        assert _run(store.record_compare_vote(row["id"], "u", "left")) is None

    def test_vote_once_only(self, store):
        row = _seed(store, "u", {"provider": "x", "model": "1"},
                                {"provider": "x", "model": "2"})
        _run(store.record_compare_vote(row["id"], "u", "a"))
        assert _run(store.record_compare_vote(row["id"], "u", "b")) is None

    def test_vote_other_user_rejected(self, store):
        row = _seed(store, "u", {"provider": "x", "model": "1"},
                                {"provider": "x", "model": "2"})
        assert _run(store.record_compare_vote(row["id"], "other", "a")) is None

    def test_history_ownership_scoped(self, store):
        _seed(store, "a", {"provider": "x", "model": "1"},
                          {"provider": "x", "model": "2"})
        _seed(store, "b", {"provider": "x", "model": "1"},
                          {"provider": "x", "model": "2"})
        history_a = _run(store.list_compare_history("a"))
        assert len(history_a) == 1


# -----------------------------------------------------------------------------
# Leaderboard
# -----------------------------------------------------------------------------

class TestLeaderboard:
    def test_wins_aggregate_across_sides(self, store):
        # llama wins twice — once when on side A, once when on side B.
        _seed(store, "u", {"provider": "ollama", "model": "llama"},
                          {"provider": "ollama", "model": "mistral"}, winner="a")
        _seed(store, "u", {"provider": "ollama", "model": "mistral"},
                          {"provider": "ollama", "model": "llama"},   winner="b")
        board = _run(store.compare_leaderboard("u"))
        llama = next(r for r in board if r["model"] == "llama")
        assert llama["wins"] == 2
        assert llama["win_rate"] == 1.0

    def test_unvoted_runs_ignored(self, store):
        _seed(store, "u", {"provider": "x", "model": "a"},
                          {"provider": "x", "model": "b"})  # no vote
        board = _run(store.compare_leaderboard("u"))
        # Without any voted rows the board is empty.
        assert board == []

    def test_tie_counted_separately(self, store):
        _seed(store, "u", {"provider": "x", "model": "a"},
                          {"provider": "x", "model": "b"}, winner="tie")
        board = _run(store.compare_leaderboard("u"))
        assert all(r["ties"] == 1 for r in board)
        assert all(r["wins"] == 0 for r in board)


# -----------------------------------------------------------------------------
# Route surface
# -----------------------------------------------------------------------------

class TestRouteSurface:
    def test_flag_default_off(self):
        from config.settings import get_settings
        assert getattr(get_settings(), "blind_compare_enabled", True) is False

    def test_router_importable(self):
        from api.routes import compare
        assert compare.router.prefix == "/api/compare"
        paths = {r.path for r in compare.router.routes}
        assert "/api/compare/run"           in paths
        assert "/api/compare/{run_id}/vote" in paths
        assert "/api/compare/history"       in paths
        assert "/api/compare/leaderboard"   in paths
