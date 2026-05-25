# providers/rag/extractors.py
import io
import logging
from typing import List, Dict, Any

logger = logging.getLogger(__name__)


def unstructured_extract(file_path: str = None, file_bytes: bytes = None, filename: str = None) -> List[Dict[str, Any]]:
    """
    Extract text and metadata from various file types using Unstructured.
    Supports PDF, HTML, DOCX, images (with OCR), etc.

    Unstructured is a heavy optional dependency (~hundreds of MB with OCR
    extras), so it is imported lazily — RAG keeps working with the legacy
    extractor when the package is not installed.
    """
    try:
        from unstructured.partition.auto import partition
    except ImportError:
        logger.warning("unstructured not installed; skipping advanced extraction.")
        return []

    try:
        if file_bytes:
            elements = partition(file=io.BytesIO(file_bytes), metadata_filename=filename)
        else:
            elements = partition(filename=file_path)
        return [{"text": str(el), "metadata": el.metadata.to_dict()} for el in elements]
    except Exception as exc:
        logger.error("Unstructured extraction failed for %s: %s", filename or file_path, exc)
        return []
