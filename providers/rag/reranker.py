"""
providers/rag/reranker.py

Cross-encoder reranking for RAG retrieval.

Vector search is fast but approximate: it compares a query embedding against
chunk embeddings that were computed without ever seeing the query. A cross
encoder instead reads the (query, chunk) pair together and scores how well
that specific chunk answers that specific question. It is far slower per
comparison, which is why it runs on a shortlist rather than the whole corpus.

The pipeline is therefore: retrieve `rag_fetch_k` chunks by vector search,
rerank them here, keep the best `rag_top_k`.

Everything is configurable so the same code works on very different hardware:

  rag_rerank_enabled  -- off by default; nothing changes until you turn it on
  rag_rerank_model    -- any HF cross-encoder id
  rag_rerank_device   -- "auto" | "cpu" | "cuda" (or "cuda:1", etc.)
  rag_fetch_k         -- shortlist size handed to the reranker

On a small GPU, leave the device on "cpu" so reranking never competes with
the LLM for VRAM. After a GPU upgrade, switch it to "auto" and raise
rag_fetch_k -- a longer shortlist is where most of the remaining quality
lives, and it costs nothing but reranker time.

Requires: pip install sentence-transformers
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional

from config.settings import get_settings

logger = logging.getLogger(__name__)

# Module-level singleton: loading a cross-encoder costs a model load and, on
# GPU, VRAM. Cache it and rebuild only when the model or device changes so
# settings can be hot-swapped without a restart.
_model = None
_model_key: Optional[tuple] = None

# Logged once rather than per query -- a missing optional dependency should
# not produce a line per search.
_warned_missing_dep = False


def _resolve_device(configured: str) -> Optional[str]:
    """
    Map the rag_rerank_device setting onto what sentence-transformers wants.

    "auto" returns None, which lets sentence-transformers pick (CUDA when
    available, else CPU). Anything else is passed through verbatim, so
    "cuda:1" and friends work without this function needing to know about
    them.
    """
    value = (configured or "auto").strip().lower()
    return None if value == "auto" else value


def _get_model(model_id: str, device: Optional[str]):
    """
    Lazy-load and cache the CrossEncoder.

    Returns None when sentence-transformers is missing or the model fails to
    load. Callers treat None as "skip reranking", so a broken or absent
    reranker degrades to plain vector search instead of failing the query.
    """
    global _model, _model_key, _warned_missing_dep

    key = (model_id, device)
    if _model is not None and _model_key == key:
        return _model

    try:
        from sentence_transformers import CrossEncoder
    except ImportError:
        if not _warned_missing_dep:
            logger.warning(
                "rag_rerank_enabled is on but sentence-transformers is not "
                "installed. Run: pip install sentence-transformers — "
                "retrieval will continue unranked."
            )
            _warned_missing_dep = True
        return None

    try:
        _model = CrossEncoder(model_id, device=device)
        _model_key = key
        logger.info(
            "Reranker loaded: %s (device=%s)", model_id, device or "auto")
        return _model
    except Exception as exc:
        logger.warning(
            "Failed to load reranker %s on device %s: %s — "
            "retrieval will continue unranked.",
            model_id, device or "auto", exc,
        )
        return None


def is_enabled() -> bool:
    """True when reranking is switched on in settings."""
    return bool(getattr(get_settings(), "rag_rerank_enabled", False))


def fetch_k(top_k: int) -> int:
    """
    How many chunks to pull from vector search before reranking.

    Returns `top_k` unchanged when reranking is off, so the retrieval path is
    byte-for-byte the same as before this module existed. When on, returns
    the larger of rag_fetch_k and top_k -- a shortlist smaller than the final
    result count would make reranking pointless.
    """
    if not is_enabled():
        return top_k
    configured = int(getattr(get_settings(), "rag_fetch_k", 25) or 25)
    return max(configured, top_k)


async def rerank(
    query_text: str,
    results: List[Dict[str, Any]],
    top_k: int,
) -> List[Dict[str, Any]]:
    """
    Reorder `results` by cross-encoder relevance to `query_text`.

    Args:
        query_text: The user's query, scored against each chunk.
        results: Vector-search hits, each a dict with a "text" key.
        top_k: How many to keep.

    Returns:
        The best `top_k` results, most relevant first. Each kept result gains
        a "rerank_score" key. On any failure -- reranking disabled, missing
        dependency, model load error, scoring error -- returns the first
        `top_k` of the input untouched, preserving the original vector-search
        order. Retrieval degrading to "as good as before" is always
        preferable to a search that raises.
    """
    if not results:
        return []

    if not is_enabled():
        return results[:top_k]

    settings = get_settings()
    model = _get_model(
        getattr(settings, "rag_rerank_model", "BAAI/bge-reranker-base"),
        _resolve_device(getattr(settings, "rag_rerank_device", "auto")),
    )
    if model is None:
        return results[:top_k]

    pairs = [(query_text, r.get("text", "") or "") for r in results]

    try:
        # Sync inference off the event loop -- on CPU this is the slowest step
        # in the retrieval path and would otherwise stall every other request.
        scores = await asyncio.to_thread(model.predict, pairs)
    except Exception as exc:
        logger.warning(
            "Reranking failed (%s) — falling back to vector-search order.", exc)
        return results[:top_k]

    scored = list(zip(results, scores))
    scored.sort(key=lambda pair: float(pair[1]), reverse=True)

    ranked = []
    for result, score in scored[:top_k]:
        ranked.append({**result, "rerank_score": float(score)})

    logger.debug(
        "Reranked %d chunks down to %d for query: %.60s",
        len(results), len(ranked), query_text,
    )
    return ranked
