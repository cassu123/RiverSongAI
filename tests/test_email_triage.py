"""
tests/test_email_triage.py

Q2#8 — Gmail triage. Validates the classifier contract (heuristic + LLM
parsing), the safety fallback when the LLM is unreachable, and the
inbox orchestrator with a mocked Gmail provider.
"""

from __future__ import annotations

import asyncio
import json
from unittest.mock import patch, AsyncMock

import pytest

from core.email_triage import (
    _coerce_classification,
    _heuristic_classify,
    _strip_code_fence,
    classify_message,
    triage_inbox,
)


def _run(coro):
    return asyncio.run(coro)


# -----------------------------------------------------------------------------
# Heuristic classifier
# -----------------------------------------------------------------------------

class TestHeuristic:
    def test_high_urgency_keyword(self):
        out = _heuristic_classify("URGENT: deadline tomorrow", "boss@x", "please respond")
        assert out["urgency"] == "high"

    def test_low_urgency_newsletter(self):
        out = _heuristic_classify("Weekly newsletter", "news@x", "to unsubscribe click here")
        assert out["urgency"] == "low"

    def test_medium_default(self):
        out = _heuristic_classify("hi there", "friend@x", "checking in")
        assert out["urgency"] == "medium"

    def test_tags_extracted(self):
        out = _heuristic_classify(
            "Your invoice is ready",
            "billing@stripe.com",
            "Your payment receipt is attached.",
        )
        assert "billing" in out["tags"]

    def test_heuristic_never_drafts(self):
        out = _heuristic_classify("URGENT", "x@y", "respond please")
        assert out["draft_reply"] == ""
        assert out["classifier"]  == "heuristic"


# -----------------------------------------------------------------------------
# Code fence + coercion
# -----------------------------------------------------------------------------

class TestParsing:
    def test_strip_json_fence(self):
        assert _strip_code_fence('```json\n{"a":1}\n```') == '{"a":1}'

    def test_strip_generic_fence(self):
        assert _strip_code_fence("```\n{}\n```") == "{}"

    def test_no_fence_passthrough(self):
        assert _strip_code_fence('{"a":1}') == '{"a":1}'

    def test_coerce_valid(self):
        fallback = _heuristic_classify("s", "f", "b")
        result = _coerce_classification(
            {"urgency": "high", "tags": ["work"], "summary": "Quick", "draft_reply": "Got it."},
            fallback,
        )
        assert result["urgency"]     == "high"
        assert result["tags"]        == ["work"]
        assert result["draft_reply"] == "Got it."
        assert result["classifier"]  == "llm"

    def test_coerce_invalid_urgency_falls_back(self):
        fallback = _heuristic_classify("s", "f", "b")
        result = _coerce_classification({"urgency": "screaming"}, fallback)
        assert result["urgency"] == fallback["urgency"]

    def test_coerce_strips_draft_when_not_high(self):
        fallback = _heuristic_classify("s", "f", "b")
        result = _coerce_classification(
            {"urgency": "low", "draft_reply": "this should be cleared"},
            fallback,
        )
        assert result["draft_reply"] == ""

    def test_coerce_non_dict_falls_back(self):
        fallback = _heuristic_classify("s", "f", "b")
        result = _coerce_classification("not a dict", fallback)
        assert result == fallback

    def test_coerce_dedups_and_caps_tags(self):
        fallback = _heuristic_classify("s", "f", "b")
        many = ["a", "a", "B", "c", "d", "e", "f", "g", "h"]
        result = _coerce_classification({"urgency": "medium", "tags": many}, fallback)
        # Caps at 6 unique, all lowercase
        assert len(result["tags"]) == 6
        assert all(t == t.lower() for t in result["tags"])


# -----------------------------------------------------------------------------
# classify_message — full path with mocked LLM
# -----------------------------------------------------------------------------

class TestClassifyMessage:
    def test_disabled_uses_heuristic(self):
        # Flag default OFF — short-circuit to heuristic.
        out = _run(classify_message("urgent: pay now", "billing@x", "respond please"))
        assert out["classifier"] == "heuristic"
        assert out["urgency"]    == "high"

    def test_llm_path_parses_json(self):
        class FakeLLM:
            async def chat(self, messages):
                return {"content": json.dumps({
                    "urgency": "high",
                    "tags": ["work"],
                    "summary": "Boss needs reply.",
                    "draft_reply": "Will do, thanks.",
                })}

        with patch("core.email_triage._enabled", return_value=True):
            out = _run(classify_message("Need eyes on this", "boss@x", "?", llm=FakeLLM()))
        assert out["classifier"]  == "llm"
        assert out["urgency"]     == "high"
        assert out["draft_reply"] == "Will do, thanks."

    def test_llm_malformed_falls_back(self):
        class JunkLLM:
            async def chat(self, messages):
                return {"content": "I don't know how to JSON"}

        with patch("core.email_triage._enabled", return_value=True):
            out = _run(classify_message("hi", "x@y", "z", llm=JunkLLM()))
        assert out["classifier"] == "heuristic"

    def test_llm_exception_falls_back(self):
        class ExplodingLLM:
            async def chat(self, messages):
                raise RuntimeError("Ollama down")

        with patch("core.email_triage._enabled", return_value=True):
            out = _run(classify_message("hi", "x@y", "z", llm=ExplodingLLM()))
        assert out["classifier"] == "heuristic"


# -----------------------------------------------------------------------------
# triage_inbox — with mocked GmailProvider
# -----------------------------------------------------------------------------

class TestTriageInbox:
    def test_disabled_returns_empty(self):
        out = _run(triage_inbox("u"))
        assert out == []

    def test_enabled_enriches_each_message(self):
        class FakeGmail:
            async def get_unread_messages(self, max_results=10):
                return [
                    {"id": "1", "from": "boss@x", "subject": "URGENT: review",     "snippet": "asap please"},
                    {"id": "2", "from": "news@x", "subject": "Weekly newsletter",  "snippet": "unsubscribe"},
                ]
            async def get_message_body(self, mid):
                return {"1": "Please respond by EOD.", "2": "Click here to unsubscribe."}[mid]

        with patch("core.email_triage._enabled", return_value=True):
            out = _run(triage_inbox("u", gmail_provider=FakeGmail()))

        assert len(out) == 2
        assert out[0]["triage"]["urgency"] == "high"
        assert out[1]["triage"]["urgency"] == "low"
        # Original metadata preserved
        assert out[0]["subject"] == "URGENT: review"

    def test_gmail_failure_returns_empty(self):
        class BrokenGmail:
            async def get_unread_messages(self, max_results=10):
                raise RuntimeError("API down")

        with patch("core.email_triage._enabled", return_value=True):
            out = _run(triage_inbox("u", gmail_provider=BrokenGmail()))
        assert out == []


# -----------------------------------------------------------------------------
# Flag default + route surface
# -----------------------------------------------------------------------------

class TestRouteSurface:
    def test_flag_default_off(self):
        from config.settings import get_settings
        assert getattr(get_settings(), "gmail_triage_enabled", True) is False

    def test_triage_route_registered(self):
        from api.routes import google as g
        paths = {r.path for r in g.router.routes}
        assert "/api/google/gmail/triage" in paths
