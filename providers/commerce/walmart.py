# =============================================================================
# providers/commerce/walmart.py
#
# Walmart Marketplace Seller API interface for River Song AI.
#
# Provides:
#   - Inventory queries by SKU or bulk (all items)
#   - Low-stock detection against a configurable threshold
#   - Recent order queries filtered by status
#
# Authentication:
#   Walmart uses OAuth2 client credentials (client_id + client_secret).
#   A token is fetched automatically before each request and cached for
#   its lifetime (typically 15 minutes). No user interaction required.
#
#   Setup steps (one-time):
#     1. Apply for Walmart Marketplace seller access at marketplace.walmart.com
#     2. Register a solution provider app in the Walmart Developer Center
#     3. Copy Client ID and Client Secret from the app credentials page
#   See docs/api_registry/walmart_seller.txt for step-by-step instructions.
#
# Rate limiting:
#   Walmart enforces per-endpoint rate limits. Bulk inventory fetches are
#   paginated automatically. All calls use httpx.AsyncClient.
#
# Dependencies:
#   httpx>=0.27.0  (already in requirements.txt)
#
# Environment variables (via config/settings.py):
#   WALMART_CLIENT_ID            -- OAuth2 client ID from Walmart Developer Center
#   WALMART_CLIENT_SECRET        -- OAuth2 client secret
#   WALMART_MARKETPLACE_ID       -- Walmart marketplace (default: US)
#   WALMART_LOW_STOCK_THRESHOLD  -- Units below this count = low stock (default 5)
# =============================================================================

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

_TOKEN_URL = "https://marketplace.walmartapis.com/v3/token"
_BASE_URL = "https://marketplace.walmartapis.com/v3"
_DEFAULT_HEADERS = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "WM_SVC.NAME": "Walmart Marketplace",
    "WM_QOS.CORRELATION_ID": "river-song",
}


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class WalmartInventoryItem:
    sku: str
    quantity: int
    unit: str = "EACH"
    fulfillment_lag_time: int = 0


@dataclass
class WalmartOrder:
    purchase_order_id: str
    customer_order_id: str
    status: str
    order_date: str
    item_count: int
    ship_by: Optional[str] = None
    estimated_delivery: Optional[str] = None


# ---------------------------------------------------------------------------
# Token cache (per provider instance)
# ---------------------------------------------------------------------------

@dataclass
class _TokenCache:
    access_token: str = ""
    expires_at: float = 0.0

    def is_valid(self) -> bool:
        return bool(self.access_token) and time.monotonic() < self.expires_at


# ---------------------------------------------------------------------------
# Provider
# ---------------------------------------------------------------------------

class WalmartProvider:
    """
    Walmart Marketplace Seller API interface.

    Uses async httpx throughout. Token refresh is handled transparently:
    the cached token is reused until it has less than 60 seconds remaining,
    then a new one is fetched automatically.
    """

    def __init__(
        self,
        client_id: str,
        client_secret: str,
        low_stock_threshold: int = 5,
    ) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._threshold = low_stock_threshold
        self._token = _TokenCache()
        self._token_lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Auth
    # ------------------------------------------------------------------

    async def _get_token(self) -> str:
        """Return a valid access token, refreshing if needed."""
        async with self._token_lock:
            if self._token.is_valid():
                return self._token.access_token

            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(
                    _TOKEN_URL,
                    headers={
                        "Accept": "application/json",
                        "Content-Type": "application/x-www-form-urlencoded",
                        "WM_SVC.NAME": "Walmart Marketplace",
                        "WM_QOS.CORRELATION_ID": "river-song-auth",
                    },
                    data={"grant_type": "client_credentials"},
                    auth=(self._client_id, self._client_secret),
                )
                resp.raise_for_status()
                data = resp.json()

            token = data.get("access_token", "")
            expires_in = int(data.get("expires_in", 900))
            self._token = _TokenCache(
                access_token=token,
                # Subtract 60s buffer so we never use an about-to-expire token.
                expires_at=time.monotonic() + expires_in - 60,
            )
            return token

    async def _headers(self) -> Dict[str, str]:
        token = await self._get_token()
        return {
            **_DEFAULT_HEADERS,
            "Authorization": f"Bearer {token}",
        }

    # ------------------------------------------------------------------
    # Inventory
    # ------------------------------------------------------------------

    async def get_inventory(
        self, limit: int = 50, offset: int = 0
    ) -> List[WalmartInventoryItem]:
        """
        Fetch seller inventory. Paginates automatically until all items are
        retrieved or the limit is reached.
        """
        headers = await self._headers()
        items: List[WalmartInventoryItem] = []
        current_offset = offset

        async with httpx.AsyncClient(timeout=20.0) as client:
            while True:
                resp = await client.get(
                    f"{_BASE_URL}/inventories",
                    headers=headers,
                    params={"limit": min(limit, 50), "offset": current_offset},
                )
                resp.raise_for_status()
                data = resp.json()

                elements = (
                    data.get("elements", {})
                    .get("ItemInventory", [])
                )
                for elem in elements:
                    qty_block = elem.get(
                        "inventories", {}).get(
                        "inventory", [
                            {}])
                    qty_entry = qty_block[0] if qty_block else {}
                    items.append(WalmartInventoryItem(
                        sku=elem.get("sku", ""),
                        quantity=int(qty_entry.get("amount", 0)),
                        unit=qty_entry.get("unit", "EACH"),
                        fulfillment_lag_time=int(
                            elem.get("fulfillmentLagTime", 0) or 0
                        ),
                    ))

                meta = data.get("meta", {})
                total = int(meta.get("totalCount", 0))
                current_offset += len(elements)

                if current_offset >= total or len(elements) == 0:
                    break

        return items

    async def get_low_stock_items(self) -> List[WalmartInventoryItem]:
        """Return items at or below the low-stock threshold."""
        inventory = await self.get_inventory(limit=200)
        return [i for i in inventory if i.quantity <= self._threshold]

    async def get_inventory_by_sku(
            self, sku: str) -> Optional[WalmartInventoryItem]:
        """Return inventory for a single SKU, or None if not found."""
        headers = await self._headers()
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{_BASE_URL}/inventory",
                headers=headers,
                params={"sku": sku},
            )
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            data = resp.json()

        inventories = data.get("inventories", {}).get("inventory", [{}])
        entry = inventories[0] if inventories else {}
        return WalmartInventoryItem(
            sku=sku,
            quantity=int(entry.get("amount", 0)),
            unit=entry.get("unit", "EACH"),
        )

    # ------------------------------------------------------------------
    # Orders
    # ------------------------------------------------------------------

    async def get_orders(
        self, status: str = "Created", days_back: int = 7
    ) -> List[WalmartOrder]:
        """
        Fetch recent orders filtered by status.

        Common status values: Created, Acknowledged, Shipped, Delivered, Cancelled.
        """
        created_start = (
            datetime.now(tz=timezone.utc) - timedelta(days=days_back)
        ).strftime("%Y-%m-%dT%H:%M:%SZ")

        headers = await self._headers()
        orders: List[WalmartOrder] = []

        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(
                f"{_BASE_URL}/orders",
                headers=headers,
                params={
                    "status": status,
                    "createdStartDate": created_start,
                    "limit": 200,
                },
            )
            resp.raise_for_status()
            data = resp.json()

        for o in (
            data.get("list", {})
            .get("elements", {})
            .get("order", [])
        ):
            lines = o.get("orderLines", {}).get("orderLine", [])
            orders.append(WalmartOrder(
                purchase_order_id=o.get("purchaseOrderId", ""),
                customer_order_id=o.get("customerOrderId", ""),
                status=o.get("orderLines", {})
                        .get("orderLine", [{}])[0]
                        .get("orderLineStatuses", {})
                        .get("orderLineStatus", [{}])[0]
                        .get("status", status),
                order_date=o.get("orderDate", ""),
                item_count=len(lines),
                ship_by=o.get("shippingInfo", {}).get("estimatedShipDate"),
                estimated_delivery=o.get(
                    "shippingInfo", {}).get("estimatedDeliveryDate"),
            ))
        return orders

    # ------------------------------------------------------------------
    # Speech formatting
    # ------------------------------------------------------------------

    def format_low_stock_for_speech(
            self, items: List[WalmartInventoryItem]) -> str:
        if not items:
            return (
                f"All your Walmart inventory is above the "
                f"{self._threshold}-unit threshold. Nothing is low right now."
            )
        out_of_stock = [i for i in items if i.quantity == 0]
        low = [i for i in items if 0 < i.quantity <= self._threshold]

        parts: List[str] = []
        if out_of_stock:
            skus = ", ".join(i.sku for i in out_of_stock[:5])
            parts.append(
                f"{len(out_of_stock)} Walmart item{'s are' if len(out_of_stock) != 1 else ' is'} "
                f"out of stock: {skus}."
            )
        if low:
            detail = ", ".join(
                f"{i.sku} ({i.quantity} left)" for i in low[:5]
            )
            parts.append(
                f"{len(low)} Walmart item{'s are' if len(low) != 1 else ' is'} running low: {detail}."
            )
        return " ".join(parts)

    @staticmethod
    def format_orders_for_speech(orders: List[WalmartOrder]) -> str:
        if not orders:
            return "You have no new Walmart orders right now."
        return (
            f"You have {len(orders)} new Walmart "
            f"order{'s' if len(orders) != 1 else ''} to process."
        )


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def build_walmart_provider(settings=None) -> WalmartProvider:
    if settings is None:
        from config.settings import get_settings
        settings = get_settings()
    return WalmartProvider(
        client_id=settings.walmart_client_id,
        client_secret=settings.walmart_client_secret,
        low_stock_threshold=settings.walmart_low_stock_threshold,
    )
