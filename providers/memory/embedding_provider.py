"""
providers/memory/embedding_provider.py

Embedding provider for River Song AI.

Two backends, selected by `settings.embedding_backend`:
  * "ollama"     — default; calls a local Ollama instance with `embedding_model`
  * "fastembed"  — ONNX CPU embeddings via the optional `fastembed` package
                   (no Ollama dependency, faster for small batches)

The fastembed path is gated behind a soft import: if the package is missing
when the backend is requested, we log a clear warning and return None rather
than crashing. The Ollama path stays the default for compatibility with any
existing populated ChromaDB collection.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, List, Optional

from config.settings import get_settings


logger = logging.getLogger(__name__)

# Module-level singleton for the fastembed model: it caches the ONNX session
# on first call (a few hundred ms), and we want that amortised across requests.
_fastembed_model = None
_fastembed_model_id: Optional[str] = None


class EmbeddingProvider:
    """
    Generate embedding vectors for text. Backend chosen by settings.

    Both backends are async — the Ollama path is natively async, the
    fastembed path runs sync inference inside `asyncio.to_thread` so it
    does not block the event loop.

    The Ollama client and the `ollama` package are both lazy-loaded on
    first use of the Ollama backend so that fastembed-only deployments
    (which may not have `ollama` installed) don't pay an unconditional
    import cost.
    """

    def __init__(self) -> None:
        self._settings = get_settings()
        self._backend  = (getattr(self._settings, "embedding_backend", "ollama") or "ollama").lower()
        self._ollama_client: Optional[Any] = None

    def _get_ollama_client(self) -> Optional[Any]:
        if self._ollama_client is not None:
            return self._ollama_client
        try:
            import ollama  # lazy import — keeps fastembed-only installs slim
        except ImportError:
            logger.warning(
                "Ollama package missing; install 'ollama' to use the ollama embedding backend."
            )
            return None
        self._ollama_client = ollama.AsyncClient(host=self._settings.ollama_base_url)
        return self._ollama_client

    async def embed(self, text: str) -> Optional[List[float]]:
        """
        Return an embedding vector for `text`, or None on any failure.

        The contract matches the legacy single-backend implementation so
        callers (VectorStore.upsert/search) do not need to change.
        """
        if not text or not text.strip():
            return None

        if self._backend == "fastembed":
            return await self._embed_fastembed(text)
        return await self._embed_ollama(text)

    # -------------------------------------------------------------------------
    # Backends
    # -------------------------------------------------------------------------

    async def _embed_ollama(self, text: str) -> Optional[List[float]]:
        client = self._get_ollama_client()
        if client is None:
            return None
        try:
            response = await client.embeddings(
                model=self._settings.embedding_model,
                prompt=text,
            )
            return response.get("embedding")
        except Exception as exc:
            logger.warning(
                "Ollama embedding failed for model %s: %s",
                self._settings.embedding_model,
                exc,
            )
            return None

    async def _embed_fastembed(self, text: str) -> Optional[List[float]]:
        model = _get_fastembed_model(self._settings.fastembed_model)
        if model is None:
            return None
        try:
            # fastembed returns a generator of numpy arrays; one input → one output.
            vectors = await asyncio.to_thread(lambda: list(model.embed([text])))
            if not vectors:
                return None
            return [float(x) for x in vectors[0].tolist()]
        except Exception as exc:
            logger.warning(
                "fastembed embedding failed for model %s: %s",
                self._settings.fastembed_model,
                exc,
            )
            return None


def _get_fastembed_model(model_id: str):
    """
    Lazy-load and cache the fastembed TextEmbedding model.

    Returns None if the package isn't installed, after logging a clear
    one-time install hint. Re-instantiates when `model_id` changes so
    admins can hot-swap via settings without restarting.
    """
    global _fastembed_model, _fastembed_model_id

    if _fastembed_model is not None and _fastembed_model_id == model_id:
        return _fastembed_model

    try:
        from fastembed import TextEmbedding
    except ImportError:
        logger.warning(
            "embedding_backend='fastembed' requested but fastembed is not installed. "
            "Run: pip install fastembed  — falling back to no-embedding (None)."
        )
        return None

    try:
        _fastembed_model    = TextEmbedding(model_name=model_id)
        _fastembed_model_id = model_id
        logger.info("fastembed model loaded: %s", model_id)
        return _fastembed_model
    except Exception as exc:
        logger.warning("Could not initialise fastembed model %s: %s", model_id, exc)
        _fastembed_model    = None
        _fastembed_model_id = None
        return None
