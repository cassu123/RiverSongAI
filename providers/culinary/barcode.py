"""
providers/culinary/barcode.py

Open Food Facts lookups for the stockroom scanner.
"""

from __future__ import annotations

import logging
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


async def _lookup_barcode(upc: str) -> Optional[dict]:
    url = f"https://world.openfoodfacts.org/api/v0/product/{upc}.json"
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.get(url)
            data = resp.json()
            if data.get("status") == 1:
                product = data.get("product", {})
                return {
                    "name": product.get("product_name") or product.get("product_name_en") or upc,
                    "brand": product.get("brands", ""),
                }
        except Exception:
            pass
    return None
