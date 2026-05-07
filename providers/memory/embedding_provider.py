"""
providers/memory/embedding_provider.py

Ollama-based embedding provider for River Song AI.
"""

from __future__ import annotations

import logging
from typing import List, Optional

import ollama
from config.settings import get_settings

logger = logging.getLogger(__name__)

class EmbeddingProvider:
    """
    Handles text embedding generation via local Ollama instance.
    """

    def __init__(self):
        self._settings = get_settings()
        self._client = ollama.AsyncClient(host=self._settings.ollama_base_url)

    async def embed(self, text: str) -> Optional[List[float]]:
        """
        Generates an embedding vector for the provided text.

        Returns:
            List of floats if successful, None if Ollama is unreachable or error occurs.
        """
        if not text.strip():
            return None

        try:
            response = await self._client.embeddings(
                model=self._settings.embedding_model,
                prompt=text
            )
            return response.get("embedding")
        except Exception as exc:
            logger.warning("Ollama embedding failed for model %s: %s", self._settings.embedding_model, exc)
            return None
