"""
tests/test_embedding_and_markitdown.py

Q1#2 (fastembed) + Q1#3 (MarkItDown) — anti-regression coverage.

These tests verify the *contract* without requiring the optional packages
(fastembed, markitdown) to be installed:

  * Settings flags default to the pre-existing behaviour.
  * EmbeddingProvider falls back to Ollama by default.
  * EmbeddingProvider with backend='fastembed' returns None gracefully
    when fastembed isn't installed — never raises.
  * markitdown_extract returns [] gracefully when MarkItDown isn't installed.
  * RAGProvider's extractor dispatch respects rag_extractor flag and
    falls back to unstructured if markitdown yields nothing.
"""

from __future__ import annotations

import asyncio

import pytest

from config.settings import get_settings


# =============================================================================
# Settings defaults — anti-regression guardrail #1
# =============================================================================

class TestFlagDefaults:
    def test_embedding_backend_defaults_to_ollama(self):
        assert get_settings().embedding_backend == "ollama"

    def test_rag_extractor_defaults_to_unstructured(self):
        assert get_settings().rag_extractor == "unstructured"

    def test_fastembed_model_has_sane_default(self):
        # Default should reference a real, small public model.
        s = get_settings()
        assert isinstance(s.fastembed_model, str) and len(s.fastembed_model) > 0
        assert "/" in s.fastembed_model  # HF-style identifier


# =============================================================================
# EmbeddingProvider
# =============================================================================

class TestEmbeddingProvider:
    def test_constructor_uses_default_backend(self):
        from providers.memory.embedding_provider import EmbeddingProvider
        p = EmbeddingProvider()
        assert p._backend == "ollama"

    def test_fastembed_path_is_safe_when_package_missing(self, monkeypatch):
        """
        If admin flips embedding_backend='fastembed' but hasn't installed
        the package, embed() must return None — never raise.
        """
        from providers.memory.embedding_provider import EmbeddingProvider
        import providers.memory.embedding_provider as ep

        # Force the backend on a fresh instance, and reset the module-level cache.
        monkeypatch.setattr(ep, "_fastembed_model", None)
        monkeypatch.setattr(ep, "_fastembed_model_id", None)
        provider = EmbeddingProvider()
        provider._backend = "fastembed"

        result = asyncio.run(provider.embed("hello world"))
        # When fastembed isn't installed (current test env), expect None.
        # When it IS installed, expect a list of floats (still not a crash).
        assert result is None or (isinstance(result, list) and all(isinstance(x, float) for x in result))

    def test_empty_text_returns_none_regardless_of_backend(self):
        from providers.memory.embedding_provider import EmbeddingProvider
        provider = EmbeddingProvider()
        assert asyncio.run(provider.embed("")) is None
        assert asyncio.run(provider.embed("   ")) is None


# =============================================================================
# markitdown_extract
# =============================================================================

class TestMarkitdownLoader:
    def test_returns_empty_list_when_package_missing(self):
        """
        Soft-import contract: never raise, just log and return []. Matches
        the legacy unstructured_extract behaviour for absent deps.
        """
        from providers.rag.markitdown_loader import markitdown_extract
        result = markitdown_extract(file_bytes=b"%PDF-1.4\nfake content", filename="x.pdf")
        assert isinstance(result, list)
        # When markitdown isn't installed: empty. When installed: at least one element.
        if result:
            assert "text" in result[0] and "metadata" in result[0]

    def test_returns_empty_list_with_no_input(self):
        from providers.rag.markitdown_loader import markitdown_extract
        assert markitdown_extract() == []

    def test_alias_extract_matches_markitdown_extract(self):
        from providers.rag.markitdown_loader import extract, markitdown_extract
        # Same callable signature, same return shape.
        assert extract(file_bytes=b"hi", filename="t.txt") == markitdown_extract(file_bytes=b"hi", filename="t.txt")


# =============================================================================
# RAGProvider dispatch
# =============================================================================

class TestRAGExtractorDispatch:
    def test_default_dispatch_calls_unstructured(self, monkeypatch):
        """
        With rag_extractor='unstructured' (default), markitdown must NOT
        be called. Verifies we haven't accidentally switched the default.
        """
        called: dict = {"unstructured": 0, "markitdown": 0}

        def fake_unstructured(file_bytes=None, filename=None, **kw):
            called["unstructured"] += 1
            return [{"text": "ok", "metadata": {"filename": filename}}]

        def fake_markitdown(file_bytes=None, filename=None, **kw):
            called["markitdown"] += 1
            return [{"text": "md", "metadata": {"filename": filename}}]

        import providers.rag.rag_provider as rp
        monkeypatch.setattr(rp, "unstructured_extract", fake_unstructured)
        monkeypatch.setattr(rp, "markitdown_extract", fake_markitdown)

        # Stub VectorStore so we don't touch ChromaDB.
        class _StubVS:
            async def upsert(self, **kw): pass
        provider = rp.RAGProvider()
        provider._vector_store = _StubVS()

        asyncio.run(provider.ingest_document(b"data", {"filename": "x.txt"}))
        assert called["unstructured"] == 1
        assert called["markitdown"] == 0

    def test_markitdown_dispatch_when_flag_set(self, monkeypatch):
        called: dict = {"unstructured": 0, "markitdown": 0}

        def fake_unstructured(file_bytes=None, filename=None, **kw):
            called["unstructured"] += 1
            return [{"text": "u", "metadata": {"filename": filename}}]

        def fake_markitdown(file_bytes=None, filename=None, **kw):
            called["markitdown"] += 1
            return [{"text": "m", "metadata": {"filename": filename}}]

        import providers.rag.rag_provider as rp
        monkeypatch.setattr(rp, "unstructured_extract", fake_unstructured)
        monkeypatch.setattr(rp, "markitdown_extract", fake_markitdown)

        class _StubVS:
            async def upsert(self, **kw): pass
        provider = rp.RAGProvider()
        provider._vector_store = _StubVS()
        provider._settings.rag_extractor = "markitdown"

        asyncio.run(provider.ingest_document(b"data", {"filename": "x.pdf"}))
        assert called["markitdown"] == 1
        assert called["unstructured"] == 0

    def test_markitdown_falls_back_to_unstructured_on_empty(self, monkeypatch):
        """
        If admin sets rag_extractor='markitdown' but the package isn't
        installed (returns []), the dispatch should fall through to
        unstructured rather than silently losing the document.
        """
        called: dict = {"unstructured": 0, "markitdown": 0}

        def fake_unstructured(file_bytes=None, filename=None, **kw):
            called["unstructured"] += 1
            return [{"text": "u", "metadata": {"filename": filename}}]

        def fake_markitdown(file_bytes=None, filename=None, **kw):
            called["markitdown"] += 1
            return []  # simulate "package missing" / extraction failure

        import providers.rag.rag_provider as rp
        monkeypatch.setattr(rp, "unstructured_extract", fake_unstructured)
        monkeypatch.setattr(rp, "markitdown_extract", fake_markitdown)

        class _StubVS:
            async def upsert(self, **kw): pass
        provider = rp.RAGProvider()
        provider._vector_store = _StubVS()
        provider._settings.rag_extractor = "markitdown"

        chunks = asyncio.run(provider.ingest_document(b"data", {"filename": "x.pdf"}))
        assert called["markitdown"] == 1
        assert called["unstructured"] == 1, "expected fallback to unstructured when markitdown returns []"
        assert chunks >= 1
