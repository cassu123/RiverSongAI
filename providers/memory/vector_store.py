"""
providers/memory/vector_store.py

Vector storage using ChromaDB for semantic memory retrieval.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Dict, List, Optional

from config.settings import get_settings
from providers.memory.embedding_provider import EmbeddingProvider

logger = logging.getLogger(__name__)

# Lazy import chromadb to prevent startup failure if it's not installed
try:
    import chromadb
    from chromadb.api.types import Where
except ImportError:
    chromadb = None
    Where = Any


class VectorStore:
    """
    Manages semantic memory using ChromaDB.
    """

    def __init__(self) -> None:
        self._settings = get_settings()
        self._enabled = self._settings.semantic_memory_enabled
        self._collection = None
        self._embedding_provider = EmbeddingProvider()

        if self._enabled:
            self._initialize_chroma()

    def _initialize_chroma(self) -> None:
        """Create Chroma client and get/create collection.

        SECURITY: This MUST stay on PersistentClient (embedded, on-disk).
        chromadb HttpClient + the `chroma run` server are affected by
        GHSA-f4j7-r4q5-qw2c (pre-auth RCE via trust_remote_code on
        /api/v2/.../collections). The embedded path does not expose that
        endpoint, so the CVE does not apply to us. Do not switch to
        HttpClient without first confirming a patched ChromaDB release.
        """
        if chromadb is None:
            logger.warning("chromadb package not found. Semantic memory will be disabled.")
            self._enabled = False
            return

        try:
            self._client = chromadb.PersistentClient(path=self._settings.chroma_path)
            self._collection = self._client.get_or_create_collection("river_song_memory")
            logger.info("ChromaDB initialized at %s", self._settings.chroma_path)
        except Exception as exc:
            logger.warning("Failed to initialize ChromaDB: %s. Semantic memory will be disabled.", exc)
            self._enabled = False

    async def upsert(self, id: str, text: str, metadata: Dict[str, Any]) -> None:
        """
        Embed text and upsert into the vector store.
        """
        if not self._enabled or self._collection is None:
            return

        embedding = await self._embedding_provider.embed(text)
        if embedding is None:
            logger.warning("Skipping upsert for id %s: embedding failed.", id)
            return

        try:
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, lambda: self._collection.upsert(
                ids=[id],
                embeddings=[embedding],
                metadatas=[metadata],
                documents=[text]
            ))
        except Exception as exc:
            logger.warning("ChromaDB upsert failed for id %s: %s", id, exc)

    async def search(
        self,
        query_text: str,
        n_results: int = 5,
        where: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """
        Search for semantically similar memories.

        Returns:
            List of {id, text, metadata, distance} sorted by relevance.
        """
        if not self._enabled or self._collection is None:
            return []

        embedding = await self._embedding_provider.embed(query_text)
        if embedding is None:
            return []

        try:
            loop = asyncio.get_running_loop()
            results = await loop.run_in_executor(None, lambda: self._collection.query(
                query_embeddings=[embedding],
                n_results=n_results,
                where=where
            ))

            # Flatten results
            output = []
            if results["ids"]:
                for i in range(len(results["ids"][0])):
                    output.append({
                        "id": results["ids"][0][i],
                        "text": results["documents"][0][i],
                        "metadata": results["metadatas"][0][i],
                        "distance": results["distances"][0][i]
                    })
            return output
        except Exception as exc:
            logger.warning("ChromaDB search failed: %s", exc)
            return []
