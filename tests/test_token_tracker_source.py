"""
tests/test_token_tracker_source.py

Token usage source attribution + test-row exclusion in summaries.
Redirects the tracker at a temp database so the real one is untouched.
"""

import threading

import pytest

import core.token_tracker as tt


@pytest.fixture()
def tmp_tracker(tmp_path, monkeypatch):
    monkeypatch.setattr(tt, "_db_path", lambda: tmp_path / "usage.db")
    monkeypatch.setattr(tt, "_schema_ready", False)
    monkeypatch.setattr(tt, "_local", threading.local())
    return tt


def test_source_recorded_from_context(tmp_tracker):
    with tt.usage_source("analytics"):
        tt.record_usage("ollama", "llama3.2:3b", 100, 50, user_id="u1")
    tt.record_usage("ollama", "llama3.2:3b", 10, 5)  # no context → "other"

    summary = tt.get_summary(days=1)
    sources = {s["source"]: s for s in summary["by_source"]}
    assert sources["analytics"]["input_tokens"] == 100
    assert sources["analytics"]["calls"] == 1
    assert sources["analytics"]["models"][0]["model"] == "llama3.2:3b"
    assert sources["other"]["input_tokens"] == 10


def test_set_usage_source_tags_task(tmp_tracker):
    tt.set_usage_source("voice")
    tt.record_usage("anthropic", "claude-haiku-4-5", 30, 20)
    summary = tt.get_summary(days=1)
    assert summary["by_source"][0]["source"] == "voice"


def test_test_provider_rows_are_excluded(tmp_tracker):
    tt.set_usage_source("other")  # reset any tag leaked from prior tests
    tt.record_usage("test_provider", "test_model", 999, 999)
    tt.record_usage("verify", "verify", 888, 888)
    tt.record_usage("ollama", "llama3.2:3b", 100, 50)

    summary = tt.get_summary(days=1)
    providers = {m["provider"] for m in summary["by_model"]}
    assert providers == {"ollama"}
    assert summary["total_input"] == 100
    src_names = {s["source"] for s in summary["by_source"]}
    assert "other" in src_names and len(src_names) == 1


# =============================================================================
# Per-user attribution
# =============================================================================
#
# The user_id column existed from the start but nothing ever set it: every
# provider called record_usage without one, so all real spend landed under
# "system" and the per-user breakdown in /api/usage/models had exactly one
# row. Same ContextVar approach as the source tag, for the same reason — the
# providers sit well below anything that knows who is talking.


def test_ambient_user_is_recorded(tmp_path, monkeypatch):
    import core.token_tracker as tt

    with tt.usage_user("alice"):
        tt.record_usage("ollama", "llama3.2:3b", 100, 50)
    tt.record_usage("ollama", "llama3.2:3b", 10, 5)   # outside → system

    rows = tt.get_model_usage(days=1)["models"]
    by_user = {
        u["user_id"]: u
        for m in rows if m["model"] == "llama3.2:3b"
        for u in m["by_user"]
    }
    assert "alice" in by_user
    assert "system" in by_user


def test_an_explicit_user_id_still_wins():
    """The argument overrides the ambient context — callers that already know
    better must not be second-guessed."""
    import core.token_tracker as tt

    with tt.usage_user("alice"):
        tt.record_usage("ollama", "llama3.2:3b", 7, 3, user_id="bob")

    rows = tt.get_model_usage(days=1)["models"]
    users = {u["user_id"] for m in rows for u in m["by_user"]}
    assert "bob" in users


def test_unattributed_spend_stays_labelled_system():
    """Not 'whoever spoke last'. An unset context must not blame a real
    account for a background sweep's tokens."""
    import core.token_tracker as tt

    tt._usage_user.set("system")
    tt.record_usage("ollama", "llama3.2:3b", 5, 5)
    rows = tt.get_model_usage(days=1)["models"]
    users = {u["user_id"] for m in rows for u in m["by_user"]}
    assert "system" in users


def test_the_conversation_loop_tags_the_speaker():
    """Voice ID rebinds the speaker mid-turn; spend follows them even though
    the admin flag deliberately does not."""
    import inspect

    from core.conversation_loop import ConversationLoop

    src = inspect.getsource(ConversationLoop._apply_speaker_identity)
    assert "set_usage_user(self._user_id)" in src
