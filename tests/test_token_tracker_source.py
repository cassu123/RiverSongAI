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
