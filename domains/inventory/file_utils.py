"""
inventory/file_utils.py

File storage helpers for the inventory system.

  save_file_for_home   -- persists an uploaded file under a structured path
  extract_data_from_receipt -- attempts OCR on a receipt image to pull price/date
  INVENTORY_FILES_BASE_DIR  -- root directory for all inventory file storage
"""

from __future__ import annotations

import logging
import os
import re
from datetime import date
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

# All inventory files live here, outside the source tree.
INVENTORY_FILES_BASE_DIR = os.environ.get(
    "INVENTORY_FILES_DIR",
    os.path.join(os.path.expanduser("~"), "inventory_files"),
)


def save_file_for_home(
    home_id: str,
    subdir: str,
    data: bytes,
    filename: str,
) -> str:
    """
    Save binary data to  <INVENTORY_FILES_BASE_DIR>/home_<home_id>/<subdir>/<filename>

    Returns the relative path (from INVENTORY_FILES_BASE_DIR) so it can be
    stored in the database without hardcoding the base directory.
    """
    safe_name = _sanitise_filename(filename)
    dest_dir  = os.path.join(INVENTORY_FILES_BASE_DIR, f"home_{home_id}", subdir)
    os.makedirs(dest_dir, exist_ok=True)

    dest_path = os.path.join(dest_dir, safe_name)

    # Avoid silent overwrites — append a counter if the name is taken.
    if os.path.exists(dest_path):
        base, ext = os.path.splitext(safe_name)
        counter   = 1
        while os.path.exists(dest_path):
            dest_path = os.path.join(dest_dir, f"{base}_{counter}{ext}")
            counter  += 1

    with open(dest_path, "wb") as f:
        f.write(data)

    rel_path = os.path.relpath(dest_path, INVENTORY_FILES_BASE_DIR)
    logger.debug("Saved inventory file: %s", rel_path)
    return rel_path


def extract_data_from_receipt(
    image_path: str,
) -> Tuple[Optional[float], Optional[date]]:
    """
    Attempt to extract a purchase price and date from a receipt image.

    Uses easyocr when available.  Falls back gracefully to (None, None) if
    the library is not installed or the image cannot be read.

    Returns:
        (price, date) — either value may be None if extraction fails.
    """
    try:
        import easyocr  # optional dependency
    except ImportError:
        logger.debug("easyocr not installed — receipt OCR disabled.")
        return None, None

    if not os.path.exists(image_path):
        logger.warning("Receipt image not found: %s", image_path)
        return None, None

    try:
        reader  = easyocr.Reader(["en"], gpu=False, verbose=False)
        results = reader.readtext(image_path, detail=0)
        text    = " ".join(results)
        return _parse_price(text), _parse_date(text)
    except Exception as exc:
        logger.warning("Receipt OCR failed: %s", exc)
        return None, None


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _sanitise_filename(name: str) -> str:
    """Strip path traversal and replace unsafe characters."""
    name = os.path.basename(name)
    name = re.sub(r"[^\w.\-]", "_", name)
    return name or "file"


def _parse_price(text: str) -> Optional[float]:
    """Extract the largest dollar amount found in OCR text."""
    matches = re.findall(r"\$\s*(\d{1,6}(?:[.,]\d{2})?)", text)
    if not matches:
        return None
    try:
        amounts = [float(m.replace(",", "")) for m in matches]
        return max(amounts)
    except ValueError:
        return None


def _parse_date(text: str) -> Optional[date]:
    """Try common receipt date formats: MM/DD/YYYY, YYYY-MM-DD, Month DD YYYY."""
    patterns = [
        (r"(\d{1,2})[/-](\d{1,2})[/-](\d{4})", "%m/%d/%Y"),
        (r"(\d{4})[/-](\d{2})[/-](\d{2})",      "%Y-%m-%d"),
    ]
    from datetime import datetime as dt
    for pattern, fmt in patterns:
        m = re.search(pattern, text)
        if m:
            try:
                raw = m.group(0).replace("-", "/")
                return dt.strptime(raw, fmt).date()
            except ValueError:
                continue
    return None
