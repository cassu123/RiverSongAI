"""Unit tests for providers.rag.reranker."""

from __future__ import annotations

import pytest

from providers.rag import reranker


@pytest.fixture(autouse=True)
def _clear_model_cache():
    """Keep the module-level singleton from leaking between tests."""
    reranker._model = None
    reranker._model_key = None
    yield
    reranker._model = None
    reranker._model_key = None


@pytest.fixture
def rag_settings(monkeypatch):
    """Drive the module through settings, the way production does."""
    class _S:
        rag_rerank_enabled = False
        rag_rerank_model = "BAAI/bge-reranker-base"
        rag_rerank_device = "cpu"
        rag_fetch_k = 25
        rag_top_k = 5

    s = _S()
    monkeypatch.setattr(reranker, "get_settings", lambda: s)
    return s


def _hits(n: int):
    return [{"id": f"c{i}", "text": f"chunk {i}", "metadata": {}} for i in range(n)]


# ---------------------------------------------------------------------------
# Disabled path — must be indistinguishable from plain vector search
# ---------------------------------------------------------------------------

def test_disabled_by_default(rag_settings):
    assert reranker.is_enabled() is False


def test_fetch_k_is_a_noop_when_disabled(rag_settings):
    assert reranker.fetch_k(5) == 5


@pytest.mark.asyncio
async def test_rerank_preserves_order_when_disabled(rag_settings):
    hits = _hits(10)
    out = await reranker.rerank("q", hits, top_k=3)
    assert [r["id"] for r in out] == ["c0", "c1", "c2"]
    assert "rerank_score" not in out[0]


# ---------------------------------------------------------------------------
# Shortlist sizing
# ---------------------------------------------------------------------------

def test_fetch_k_widens_the_shortlist_when_enabled(rag_settings):
    rag_settings.rag_rerank_enabled = True
    assert reranker.fetch_k(5) == 25


def test_fetch_k_never_returns_less_than_top_k(rag_settings):
    """A shortlist smaller than the result count would make reranking pointless."""
    rag_settings.rag_rerank_enabled = True
    rag_settings.rag_fetch_k = 3
    assert reranker.fetch_k(10) == 10


# ---------------------------------------------------------------------------
# Enabled path
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_rerank_reorders_by_score(rag_settings, monkeypatch):
    rag_settings.rag_rerank_enabled = True

    class _FakeModel:
        def predict(self, pairs):
            # Reverse the incoming order: last chunk scores highest.
            return list(range(len(pairs)))

    monkeypatch.setattr(reranker, "_get_model", lambda *a: _FakeModel())

    out = await reranker.rerank("q", _hits(5), top_k=3)
    assert [r["id"] for r in out] == ["c4", "c3", "c2"]
    assert out[0]["rerank_score"] == 4.0


@pytest.mark.asyncio
async def test_rerank_keeps_original_fields(rag_settings, monkeypatch):
    rag_settings.rag_rerank_enabled = True
    monkeypatch.setattr(
        reranker, "_get_model",
        lambda *a: type("M", (), {"predict": lambda self, p: [1.0] * len(p)})(),
    )
    out = await reranker.rerank("q", _hits(3), top_k=2)
    assert all("text" in r and "metadata" in r for r in out)


# ---------------------------------------------------------------------------
# Degradation — a broken reranker must never break retrieval
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_missing_model_falls_back_to_vector_order(rag_settings, monkeypatch):
    rag_settings.rag_rerank_enabled = True
    monkeypatch.setattr(reranker, "_get_model", lambda *a: None)

    out = await reranker.rerank("q", _hits(6), top_k=3)
    assert [r["id"] for r in out] == ["c0", "c1", "c2"]


@pytest.mark.asyncio
async def test_scoring_error_falls_back_to_vector_order(rag_settings, monkeypatch):
    rag_settings.rag_rerank_enabled = True

    class _Exploding:
        def predict(self, pairs):
            raise RuntimeError("CUDA out of memory")

    monkeypatch.setattr(reranker, "_get_model", lambda *a: _Exploding())

    out = await reranker.rerank("q", _hits(6), top_k=3)
    assert [r["id"] for r in out] == ["c0", "c1", "c2"]


@pytest.mark.asyncio
async def test_empty_results_short_circuit(rag_settings):
    assert await reranker.rerank("q", [], top_k=5) == []


def test_missing_dependency_returns_none(rag_settings, monkeypatch):
    """sentence-transformers absent must not raise."""
    import builtins
    real_import = builtins.__import__

    def _no_sentence_transformers(name, *args, **kwargs):
        if name == "sentence_transformers":
            raise ImportError("not installed")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", _no_sentence_transformers)
    reranker._warned_missing_dep = False
    assert reranker._get_model("any/model", "cpu") is None


# ---------------------------------------------------------------------------
# Device resolution
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "configured,expected",
    [
        ("auto", None),
        ("AUTO", None),
        ("cpu", "cpu"),
        ("cuda", "cuda"),
        ("cuda:1", "cuda:1"),
        ("", None),
        (None, None),
    ],
)
def test_device_resolution(configured, expected):
    assert reranker._resolve_device(configured) == expected
