"""
providers/rag/rag_provider.py

Retrieval-Augmented Generation provider for local documents.
Uses ChromaDB for storage and Ollama for embeddings.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any, Dict, List, Optional

from config.settings import get_settings
from providers.memory.vector_store import VectorStore
from providers.rag.chunker import chunk_text
from providers.rag.extractors import unstructured_extract
from providers.rag.markitdown_loader import markitdown_extract

logger = logging.getLogger(__name__)


class RAGProvider:
    """
    Handles ingestion and retrieval of local documents (PDFs, manuals, images).
    """

    def __init__(self):
        self._settings = get_settings()
        self._vector_store = VectorStore()  # ChromaDB instance from Phase 1

    async def ingest_document(self, file_bytes: bytes,
                              metadata: Dict[str, Any]) -> int:
        """
        Extracts text from a document using Unstructured, chunks it, and stores in the vector database.
        Returns the number of chunks ingested.
        """
        filename = metadata.get('filename', 'unknown')
        backend = (
            getattr(
                self._settings,
                "rag_extractor",
                "unstructured") or "unstructured").lower()
        if backend == "markitdown":
            elements = markitdown_extract(
                file_bytes=file_bytes, filename=filename)
            if not elements:
                logger.info(
                    "MarkItDown returned nothing for %s; trying unstructured.",
                    filename)
                elements = unstructured_extract(
                    file_bytes=file_bytes, filename=filename)
        else:
            elements = unstructured_extract(
                file_bytes=file_bytes, filename=filename)

        if not elements:
            logger.warning(
                "No elements extracted from document %s for ingestion.",
                filename)
            return 0

        # Combine elements into a single text for chunking,
        # or we could chunk per element if they are large.
        # For now, let's keep it simple and combine.
        full_text = "\n\n".join([el['text'] for el in elements])

        if not full_text.strip():
            logger.warning(
                "No text extracted from document %s for ingestion.",
                filename)
            return 0

        chunks = chunk_text(full_text)
        for i, chunk in enumerate(chunks):
            chunk_id = f"doc_{metadata.get('document_id', uuid.uuid4())}_{i}"
            chunk_metadata = {
                **metadata,
                "chunk_index": i,
                "source_type": "document"
            }
            await self._vector_store.upsert(
                id=chunk_id,
                text=chunk,
                metadata=chunk_metadata
            )

        logger.info(
            "Ingested %d chunks from document: %s",
            len(chunks),
            filename)
        return len(chunks)

    async def ingest_pdf(self, file_bytes: bytes,
                         metadata: Dict[str, Any]) -> int:
        """Alias for backward compatibility."""
        return await self.ingest_document(file_bytes, metadata)

    async def query_documents(self, query_text: str, n_results: int = 5,
                              where: Optional[dict] = None) -> List[Dict[str, Any]]:
        """
        Retrieves relevant document chunks for a given query.
        """
        # Ensure we only query document sources if not specified otherwise
        if where is None:
            where = {"source_type": "document"}
        elif "source_type" not in where:
            where["source_type"] = "document"

        return await self._vector_store.search(
            query_text=query_text,
            n_results=n_results,
            where=where
        )

    def format_context(self, search_results: List[Dict[str, Any]]) -> str:
        """
        Formats retrieved chunks into a context block for the LLM.
        """
        if not search_results:
            return ""

        context_parts = []
        for res in search_results:
            source = res['metadata'].get('filename', 'Local Document')
            context_parts.append(
                f"--- Excerpt from {source} ---\n{res['text']}")

        return "\n\n".join(context_parts)
