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
    upc_clean = str(upc).strip()
    headers = {"User-Agent": "RiverSongAI/1.0 (culinary-stockroom; https://riversongai.com)"}
    async with httpx.AsyncClient(timeout=10, headers=headers) as client:
        try:
            resp = await client.get(f"https://world.openfoodfacts.org/api/v0/product/{upc_clean}.json")
            if resp.status_code == 200:
                data = resp.json()
                if data.get("status") == 1:
                    product = data.get("product", {})
                    name = product.get("product_name") or product.get("product_name_en")
                    if name:
                        return {
                            "name": name,
                            "brand": product.get("brands", ""),
                        }

            # Try 13-digit EAN if 12-digit UPC was passed
            if len(upc_clean) == 12:
                resp13 = await client.get(f"https://world.openfoodfacts.org/api/v0/product/0{upc_clean}.json")
                if resp13.status_code == 200:
                    data13 = resp13.json()
                    if data13.get("status") == 1:
                        product13 = data13.get("product", {})
                        name13 = product13.get("product_name") or product13.get("product_name_en")
                        if name13:
                            return {
                                "name": name13,
                                "brand": product13.get("brands", ""),
                            }
        except Exception as e:
            logger.debug("Open Food Facts lookup failed for %s: %s", upc_clean, e)

    # Fallback to UPCItemDB if available
    try:
        from providers.product_lookup import get_product_lookup_provider
        provider = get_product_lookup_provider()
        res = provider.lookup_upc(upc_clean)
        if res and res.name:
            return {
                "name": res.name,
                "brand": res.manufacturer or "",
            }
    except Exception as e:
        logger.debug("UPCItemDB fallback lookup failed for %s: %s", upc_clean, e)

    return None
