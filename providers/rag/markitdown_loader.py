"""
providers/rag/markitdown_loader.py

MarkItDown-based document extractor for River Song RAG.

Microsoft's MarkItDown converts PDF, DOCX, PPTX, XLSX, HTML, images (via
OCR), and a few other formats into markdown — handy for the Sifter
daemon's WAPS technical-order ingestion path.

Returns the same shape as `providers.rag.extractors.unstructured_extract`:
a list of dicts with `text` and `metadata` keys. We emit a single element
holding the full markdown output, because MarkItDown is structure-aware
and the downstream chunker (`providers.rag.chunker`) already handles
section splitting on markdown headers.

MarkItDown is an optional dependency. If the package isn't installed when
this loader is invoked, we log a one-time install hint and return an
empty list — RAG keeps working via the default `unstructured_extract`.
"""

from __future__ import annotations

import io
import logging
import os
import tempfile
from typing import Any, Dict, List, Optional


logger = logging.getLogger(__name__)


def markitdown_extract(
    file_path: Optional[str] = None,
    file_bytes: Optional[bytes] = None,
    filename: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Convert a document to markdown via MarkItDown.

    Args:
        file_path:   Absolute path to the document on disk. Mutually exclusive with file_bytes.
        file_bytes:  Raw document bytes. When given, `filename` should be provided so
                     MarkItDown can infer the format from the extension.
        filename:    Original filename, used for format inference and metadata.

    Returns:
        List with a single element: {"text": "<markdown>", "metadata": {...}}.
        Empty list on any failure or when MarkItDown is not installed.
    """
    if not file_path and not file_bytes:
        logger.warning("markitdown_extract called without file_path or file_bytes.")
        return []

    try:
        from markitdown import MarkItDown
    except ImportError:
        logger.warning(
            "rag_extractor='markitdown' requested but MarkItDown is not installed. "
            "Run: pip install markitdown  — falling back to no extraction."
        )
        return []

    md = MarkItDown()
    temp_path: Optional[str] = None

    try:
        target_path = file_path
        if not target_path and file_bytes:
            # MarkItDown's convert() works on a path or stream; for bytes we
            # write to a temp file so the extension carries format hints.
            suffix = os.path.splitext(filename or "")[1] or ".bin"
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                tmp.write(file_bytes)
                temp_path = tmp.name
                target_path = temp_path

        result = md.convert(target_path)
        text   = (getattr(result, "text_content", None) or "").strip()
        if not text:
            return []

        metadata: Dict[str, Any] = {
            "filename":  filename or os.path.basename(target_path),
            "extractor": "markitdown",
        }
        title = getattr(result, "title", None)
        if title:
            metadata["title"] = title

        return [{"text": text, "metadata": metadata}]

    except Exception as exc:
        logger.error("MarkItDown extraction failed for %s: %s", filename or file_path, exc)
        return []
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
            except OSError:
                pass


def extract(
    file_path: Optional[str] = None,
    file_bytes: Optional[bytes] = None,
    filename: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Alias matching the legacy `unstructured_extract` symbol name."""
    return markitdown_extract(file_path=file_path, file_bytes=file_bytes, filename=filename)
