"""
providers/rag/chunker.py

Logic for splitting text into overlapping chunks and extracting text from PDFs.
"""

from __future__ import annotations

import io
import logging
from typing import List

logger = logging.getLogger(__name__)


def chunk_text(text: str, chunk_size: int | None = None,
               overlap: int | None = None) -> List[str]:
    """
    Splits text into overlapping chunks by word count.

    Defaults come from the RAG_CHUNK_SIZE / RAG_CHUNK_OVERLAP settings;
    explicit arguments override them.
    """
    if chunk_size is None or overlap is None:
        from config.settings import get_settings
        settings = get_settings()
        if chunk_size is None:
            chunk_size = settings.rag_chunk_size
        if overlap is None:
            overlap = settings.rag_chunk_overlap
    if overlap >= chunk_size:
        overlap = max(chunk_size // 8, 0)
    words = text.split()
    chunks = []

    if not words:
        return []

    for i in range(0, len(words), chunk_size - overlap):
        chunk_words = words[i: i + chunk_size]
        chunks.append(" ".join(chunk_words))
        if i + chunk_size >= len(words):
            break

    return chunks


def extract_text_from_pdf(file_bytes: bytes) -> str:
    """
    Extracts all text from PDF bytes using pypdf, falling back to pymupdf.
    """
    text = ""

    # Try pypdf
    try:
        import pypdf
        reader = pypdf.PdfReader(io.BytesIO(file_bytes))
        pages = []
        for page in reader.pages:
            p_text = page.extract_text()
            if p_text:
                pages.append(p_text)
        text = "\n\n".join(pages)
    except Exception as exc:
        logger.warning("pypdf extraction failed: %s", exc)

    # Fallback to pymupdf (fitz) if pypdf returned empty or failed
    if not text.strip():
        try:
            import fitz  # PyMuPDF
            doc = fitz.open(stream=file_bytes, filetype="pdf")
            pages = []
            for page in doc:
                pages.append(page.get_text())
            text = "\n\n".join(pages)
        except Exception as exc:
            logger.warning("pymupdf extraction fallback failed: %s", exc)

    return text
