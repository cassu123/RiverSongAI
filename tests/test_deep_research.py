"""
tests/test_deep_research.py

Q3#11 — Deep Research orchestrator. Validates:
  - Heuristic decompose: degrades gracefully when no LLM is available.
  - LLM decompose: parses JSON output, strips code fences, pads on
    under-delivery, falls back on malformed output.
  - gather_sources: parses the formatted search-provider output, dedupes
    URLs, respects the per-run cap.
  - fetch_and_extract: handles fetcher returning None, applies max-char
    truncation, uses injected extractor.
  - Synthesis: heuristic fallback produces a usable Markdown structure;
    LLM-mocked path returns the model's content verbatim.
  - run_deep_research end-to-end: writes a research document via store.
  - Route surface: flag default OFF.
"""

from __future__ import annotations

import asyncio
import json
from unittest.mock import patch

import pytest

from core.deep_research import (
    _heuristic_decompose,
    _heuristic_synth,
    _parse_urls_from_block,
    decompose_query,
    fetch_and_extract,
    gather_sources,
    run_deep_research,
    synthesize,
)
from providers.memory.sqlite_store import SQLiteStore


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture()
def store(tmp_path):
    s = SQLiteStore(str(tmp_path / "research.db"))
    asyncio.run(s.initialize())
    yield s
    s.close()


# -----------------------------------------------------------------------------
# Decompose
# -----------------------------------------------------------------------------

class TestDecompose:
    def test_heuristic_returns_count(self):
        out = _heuristic_decompose("how does X compare to Y?", 4)
        assert len(out) == 4

    def test_heuristic_handles_empty(self):
        assert _heuristic_decompose("", 3) == []

    def test_llm_path_parses_json_array(self):
        class FakeLLM:
            async def chat(self, messages):
                return {"content": json.dumps(["sub a", "sub b", "sub c", "sub d"])}
        out = _run(decompose_query("topic", count=4, llm=FakeLLM()))
        assert out == ["sub a", "sub b", "sub c", "sub d"]

    def test_llm_strips_code_fence(self):
        class FakeLLM:
            async def chat(self, messages):
                return {"content": '```json\n["one","two"]\n```'}
        out = _run(decompose_query("topic", count=2, llm=FakeLLM()))
        assert out == ["one", "two"]

    def test_llm_pads_under_delivery(self):
        class FakeLLM:
            async def chat(self, messages):
                return {"content": json.dumps(["only one"])}
        out = _run(decompose_query("topic", count=3, llm=FakeLLM()))
        assert len(out) == 3
        assert out[0] == "only one"

    def test_llm_malformed_falls_back(self):
        class JunkLLM:
            async def chat(self, messages):
                return {"content": "not json"}
        out = _run(decompose_query("topic", count=2, llm=JunkLLM()))
        assert len(out) == 2  # heuristic still delivers


# -----------------------------------------------------------------------------
# gather_sources + URL parsing
# -----------------------------------------------------------------------------

_FORMATTED = """Search results for 'how do tides work':

1. Tide Basics
   Tides are caused by the gravitational pull of the moon.
   Source: https://ocean.example/tides

2. Lunar Pull Explained
   Detailed physics walkthrough.
   Source: https://physics.example/lunar
"""


class TestGather:
    def test_parse_extracts_structured_records(self):
        recs = _parse_urls_from_block(_FORMATTED)
        urls = [r["url"] for r in recs]
        assert "https://ocean.example/tides" in urls
        assert "https://physics.example/lunar" in urls

    def test_dedupe_across_queries(self):
        class FakeSearch:
            async def search(self, q, n):
                return _FORMATTED
        recs = _run(gather_sources(["q1", "q2"], search_provider=FakeSearch()))
        urls = [r["url"] for r in recs]
        assert len(urls) == len(set(urls))

    def test_overall_cap(self):
        class FakeSearch:
            async def search(self, q, n):
                # Each query returns 2 unique URLs based on the q string.
                return f"""1. Hit
   Stuff.
   Source: https://example.com/{q}/a

2. Hit
   Stuff.
   Source: https://example.com/{q}/b
"""
        recs = _run(gather_sources(["a", "b", "c"], overall_cap=3, search_provider=FakeSearch()))
        assert len(recs) == 3

    def test_search_failure_returns_empty(self):
        class BrokenSearch:
            async def search(self, q, n):
                raise RuntimeError("down")
        recs = _run(gather_sources(["q"], search_provider=BrokenSearch()))
        assert recs == []


# -----------------------------------------------------------------------------
# fetch_and_extract
# -----------------------------------------------------------------------------

class TestFetch:
    def test_fetcher_none_yields_empty_text(self):
        async def fetcher(u): return None
        out = _run(fetch_and_extract({"url": "https://ex/"}, fetcher=fetcher))
        assert out["text"] == ""

    def test_truncates_to_max_chars(self):
        async def fetcher(u): return b"<html>X</html>"
        def extractor(content, fname):
            return "x" * 50_000
        out = _run(fetch_and_extract({"url": "https://ex/"}, fetcher=fetcher,
                                     extractor=extractor, max_chars=100))
        # 100 chars of x + the truncation marker
        assert out["text"].startswith("x" * 100)
        assert out["text"].endswith("…")

    def test_uses_injected_extractor(self):
        async def fetcher(u): return b"<html><body>hi</body></html>"
        def extractor(content, fname):
            return f"extracted({fname})"
        out = _run(fetch_and_extract({"url": "https://x.com/foo.html"},
                                     fetcher=fetcher, extractor=extractor))
        assert "extracted(foo.html)" in out["text"]

    def test_missing_url_passes_through(self):
        out = _run(fetch_and_extract({"url": ""}))
        assert out["text"] == ""


# -----------------------------------------------------------------------------
# Synthesis
# -----------------------------------------------------------------------------

class TestSynthesis:
    def test_heuristic_includes_sources_section(self):
        sources = [
            {"title": "T", "url": "https://x", "snippet": "snip"},
        ]
        out = _heuristic_synth("query", sources)
        assert "## Sources" in out
        assert "[T](https://x)" in out

    def test_llm_path_returns_content(self):
        class FakeLLM:
            async def chat(self, messages):
                return {"content": "# Report\n\nSome content."}
        out = _run(synthesize("q", [{"url": "https://x", "text": "body"}], llm=FakeLLM()))
        assert out.startswith("# Report")

    def test_llm_empty_falls_back(self):
        class FakeLLM:
            async def chat(self, messages):
                return {"content": ""}
        out = _run(synthesize("q", [{"url": "https://x", "text": "body"}], llm=FakeLLM()))
        assert "Research" in out


# -----------------------------------------------------------------------------
# Orchestrator end-to-end (with mocked stages)
# -----------------------------------------------------------------------------

class TestRunDeepResearch:
    def test_writes_document(self, store):
        class FakeLLM:
            async def chat(self, messages):
                if "sub-queries" in messages[1]["content"]:
                    return {"content": json.dumps(["sub a", "sub b"])}
                return {"content": "# Final Report\n\nBody."}

        class FakeSearch:
            async def search(self, q, n):
                return _FORMATTED

        async def fetcher(url):
            return b"<html><body>fixture body</body></html>"

        progress: list = []
        async def on_progress(ev):
            progress.append(ev["stage"])

        result = _run(run_deep_research(
            "How do tides work?",
            user_id="u1",
            store=store,
            llm=FakeLLM(),
            search_provider=FakeSearch(),
            fetcher=fetcher,
            on_progress=on_progress,
        ))

        assert result["document_id"]
        assert result["report"].startswith("# Final Report")
        # Stored as a research-kind document.
        doc = _run(store.get_document("u1", result["document_id"]))
        assert doc is not None
        assert doc["kind"] == "research"
        # Progress emitted for every stage.
        for stage in ("decompose", "gather", "fetch", "synthesize", "saved"):
            assert stage in progress

    def test_empty_query_rejects(self, store):
        with pytest.raises(ValueError):
            _run(run_deep_research("   ", user_id="u", store=store))


# -----------------------------------------------------------------------------
# Route surface
# -----------------------------------------------------------------------------

class TestRouteSurface:
    def test_flag_default_on(self):
        from config.settings import get_settings
        # Enabled by default so the in-chat Research toggle works out of the box.
        assert getattr(get_settings(), "deep_research_enabled", False) is True

    def test_router_importable(self):
        from api.routes import research
        assert research.router.prefix == "/api/research"
        paths = {r.path for r in research.router.routes}
        assert "/api/research/run" in paths
