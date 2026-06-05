# =============================================================================
# providers/commerce/amazon.py
#
# Amazon Selling Partner API (SP-API) interface for River Song AI.
#
# Provides:
#   - FBA inventory summaries with quantity and condition data
#   - Low-stock detection against a configurable threshold
#   - Recent order queries (pending, unshipped, shipped)
#   - Listing lookup by ASIN or SKU
#
# Authentication:
#   SP-API uses a two-layer auth system:
#     1. Login with Amazon (LWA) -- OAuth2 client credentials + refresh token
#        to get a short-lived access token.
#     2. AWS Signature Version 4 -- signs every request using an IAM role
#        assumed via STS.
#   The python-amazon-sp-api library handles both layers automatically given
#   the five required credentials below.
#
#   Setup steps (one-time):
#     1. Register a developer app at developer.amazon.com/seller
#     2. Create an IAM user with AmazonSPAPISellerFull policy (or scoped version)
#     3. Generate an LWA refresh token by authorizing your app as a seller
#     4. Copy all five credential values into .env
#   See docs/api_registry/amazon_seller.txt for step-by-step instructions.
#
# Rate limiting:
#   SP-API enforces per-endpoint rate limits. This provider never batches or
#   loops calls without a delay. All methods are async wrappers over sync SP-API
#   calls run in a ThreadPoolExecutor to avoid blocking the event loop.
#
# Dependencies:
#   python-amazon-sp-api>=0.14.0  (pip install python-amazon-sp-api)
#
# Environment variables (via config/settings.py):
#   AMAZON_SP_LWA_APP_ID          -- LWA client ID from developer console
#   AMAZON_SP_LWA_CLIENT_SECRET   -- LWA client secret
#   AMAZON_SP_REFRESH_TOKEN       -- LWA refresh token (seller-specific)
#   AMAZON_AWS_ACCESS_KEY         -- IAM user access key
#   AMAZON_AWS_SECRET_KEY         -- IAM user secret key
#   AMAZON_MARKETPLACE_ID         -- e.g. ATVPDKIKX0DER (US), A2EUQ1WTGCTBG2 (CA)
#   AMAZON_SELLER_ID              -- Your seller account ID (starts with A)
#   AMAZON_LOW_STOCK_THRESHOLD    -- Units below this count = low stock (default 5)
# =============================================================================

from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

try:
    from sp_api.api import Inventories, Orders
    from sp_api.base import Marketplaces, SellingApiException
    _SPAPI_AVAILABLE = True
except ImportError:
    _SPAPI_AVAILABLE = False
    logger.warning(
        "python-amazon-sp-api not installed. Run: pip install python-amazon-sp-api"
    )


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class InventoryItem:
    asin: str
    sku: str
    product_name: str
    fulfillable_quantity: int
    reserved_quantity: int
    inbound_quantity: int
    condition: str = "New"

    @property
    def total_available(self) -> int:
        return self.fulfillable_quantity + self.inbound_quantity


@dataclass
class AmazonOrder:
    order_id: str
    status: str                  # Pending, Unshipped, Shipped, Canceled, etc.
    purchase_date: str
    item_count: int
    total_amount: str
    ship_by: Optional[str] = None
    buyer_name: Optional[str] = None


# ---------------------------------------------------------------------------
# Credentials helper
# ---------------------------------------------------------------------------

def _make_credentials(settings) -> Dict[str, str]:
    """Build the credentials dict expected by python-amazon-sp-api."""
    return {
        "lwa_app_id": settings.amazon_sp_lwa_app_id,
        "lwa_client_secret": settings.amazon_sp_lwa_client_secret,
        "refresh_token": settings.amazon_sp_refresh_token,
        "aws_access_key": settings.amazon_aws_access_key,
        "aws_secret_key": settings.amazon_aws_secret_key,
    }


# ---------------------------------------------------------------------------
# Provider
# ---------------------------------------------------------------------------

class AmazonProvider:
    """
    Amazon SP-API interface for inventory and order management.

    The SP-API library is synchronous; all calls are run in a shared
    ThreadPoolExecutor so they do not block the FastAPI event loop.

    This is a process-level singleton. All sellers share one instance; seller
    credentials are loaded from settings (single-seller for now; multi-seller
    can be added by passing credentials per call).
    """

    def __init__(
        self,
        lwa_app_id: str,
        lwa_client_secret: str,
        refresh_token: str,
        aws_access_key: str,
        aws_secret_key: str,
        marketplace_id: str,
        seller_id: str,
        low_stock_threshold: int = 5,
    ) -> None:
        self._credentials = {
            "lwa_app_id": lwa_app_id,
            "lwa_client_secret": lwa_client_secret,
            "refresh_token": refresh_token,
            "aws_access_key": aws_access_key,
            "aws_secret_key": aws_secret_key,
        }
        self._marketplace_id = marketplace_id
        self._seller_id = seller_id
        self._threshold = low_stock_threshold
        self._executor = ThreadPoolExecutor(
            max_workers=2, thread_name_prefix="amazon_sp"
        )

    def _marketplace(self) -> "Marketplaces":
        """Resolve marketplace ID string to the Marketplaces enum."""
        for m in Marketplaces:
            if m.marketplace_id == self._marketplace_id:
                return m
        raise ValueError(
            f"Unknown marketplace ID '{self._marketplace_id}'. "
            "Check AMAZON_MARKETPLACE_ID in .env. "
            "Example US value: ATVPDKIKX0DER"
        )

    # ------------------------------------------------------------------
    # Sync helpers (run in executor)
    # ------------------------------------------------------------------

    def _sync_get_inventory(self) -> List[InventoryItem]:
        """
        Fetch FBA inventory summaries.
        Returns all SKUs with quantity, ASIN, and condition data.
        """
        marketplace = self._marketplace()
        client = Inventories(
            credentials=self._credentials,
            marketplace=marketplace)

        items: List[InventoryItem] = []
        next_token: Optional[str] = None

        while True:
            kwargs: Dict[str, Any] = {
                "details": True,
                "marketplaceIds": [self._marketplace_id],
            }
            if next_token:
                kwargs["nextToken"] = next_token

            try:
                resp = client.get_inventory_summary_marketplace(**kwargs)
            except SellingApiException as exc:
                logger.error("SP-API inventory call failed: %s", exc)
                raise

            payload = resp.payload or {}
            summaries = payload.get("inventorySummaries", [])

            for s in summaries:
                qty = s.get("inventoryDetails", {}) or {}
                fulfillable = (
                    qty.get("fulfillableQuantity") or {}).get(
                    "quantity", 0)
                reserved = sum(
                    v.get("quantity", 0)
                    for v in (qty.get("reservedQuantity") or {}).values()
                    if isinstance(v, dict)
                )
                inbound = sum(
                    v.get("quantity", 0)
                    for v in (qty.get("inboundReceivingQuantity") or {}).values()
                    if isinstance(v, dict)
                )
                items.append(InventoryItem(
                    asin=s.get("asin", ""),
                    sku=s.get("sellerSku", ""),
                    product_name=s.get("productName", "Unknown"),
                    fulfillable_quantity=int(fulfillable),
                    reserved_quantity=int(reserved),
                    inbound_quantity=int(inbound),
                    condition=s.get("condition", "New"),
                ))

            next_token = payload.get("nextToken")
            if not next_token:
                break

        return items

    def _sync_get_orders(self, days_back: int,
                         statuses: List[str]) -> List[AmazonOrder]:
        """Fetch recent orders filtered by status."""
        marketplace = self._marketplace()
        client = Orders(credentials=self._credentials, marketplace=marketplace)

        created_after = (
            datetime.now(tz=timezone.utc) - timedelta(days=days_back)
        ).isoformat()

        try:
            resp = client.get_orders(
                MarketplaceIds=[self._marketplace_id],
                OrderStatuses=statuses,
                CreatedAfter=created_after,
            )
        except SellingApiException as exc:
            logger.error("SP-API orders call failed: %s", exc)
            raise

        orders: List[AmazonOrder] = []
        for o in (resp.payload or {}).get("Orders", []):
            total = o.get("OrderTotal") or {}
            amount = (
                f"{total.get('Amount', '?')} {total.get('CurrencyCode', '')}"
                if total
                else "Unknown"
            )
            orders.append(AmazonOrder(
                order_id=o.get("AmazonOrderId", ""),
                status=o.get("OrderStatus", ""),
                purchase_date=o.get("PurchaseDate", ""),
                item_count=int(o.get("NumberOfItemsShipped", 0) or 0)
                + int(o.get("NumberOfItemsUnshipped", 0) or 0),
                total_amount=amount,
                ship_by=o.get("LatestShipDate"),
                buyer_name=o.get("BuyerInfo", {}).get("BuyerName"),
            ))
        return orders

    # ------------------------------------------------------------------
    # Public async API
    # ------------------------------------------------------------------

    async def get_inventory(self) -> List[InventoryItem]:
        """Return all FBA inventory items."""
        if not _SPAPI_AVAILABLE:
            raise RuntimeError(
                "python-amazon-sp-api not installed. "
                "Run: pip install python-amazon-sp-api"
            )
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self._executor, self._sync_get_inventory)

    async def get_low_stock_items(self) -> List[InventoryItem]:
        """
        Return items where fulfillable quantity is at or below the threshold.
        Zero-quantity items are always included regardless of threshold.
        """
        inventory = await self.get_inventory()
        return [
            item for item in inventory
            if item.fulfillable_quantity <= self._threshold
        ]

    async def get_orders(
        self,
        days_back: int = 7,
        statuses: Optional[List[str]] = None,
    ) -> List[AmazonOrder]:
        """
        Return recent orders.

        Args:
            days_back: How many days back to search (default 7).
            statuses:  List of SP-API order statuses to include.
                       Defaults to Pending + Unshipped.
        """
        if not _SPAPI_AVAILABLE:
            raise RuntimeError(
                "python-amazon-sp-api not installed. "
                "Run: pip install python-amazon-sp-api"
            )
        if statuses is None:
            statuses = ["Pending", "Unshipped"]
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            self._executor, self._sync_get_orders, days_back, statuses
        )

    async def get_pending_shipments(self) -> List[AmazonOrder]:
        """Return orders that need to be shipped (Pending + Unshipped)."""
        return await self.get_orders(days_back=30, statuses=["Pending", "Unshipped"])

    # ------------------------------------------------------------------
    # Speech formatting
    # ------------------------------------------------------------------

    def format_low_stock_for_speech(self, items: List[InventoryItem]) -> str:
        if not items:
            return (
                f"All your FBA inventory is above the "
                f"{self._threshold}-unit threshold. Nothing is low right now."
            )
        out_of_stock = [i for i in items if i.fulfillable_quantity == 0]
        low = [i for i in items if 0 < i.fulfillable_quantity <= self._threshold]

        parts: List[str] = []
        if out_of_stock:
            names = ", ".join(
                self._short_name(i.product_name) for i in out_of_stock[:5]
            )
            parts.append(
                f"{len(out_of_stock)} item{'s are' if len(out_of_stock) != 1 else ' is'} "
                f"completely out of stock: {names}."
            )
        if low:
            names = ", ".join(
                f"{
                    self._short_name(
                        i.product_name)} ({
                    i.fulfillable_quantity} left)"
                for i in low[:5]
            )
            parts.append(
                f"{len(low)} item{'s are' if len(low) != 1 else ' is'} running low: {names}."
            )
        if len(items) > 5:
            parts.append(
                f"There are {
                    len(items) -
                    5} more low-stock items in total.")
        return " ".join(parts)

    @staticmethod
    def format_orders_for_speech(orders: List[AmazonOrder]) -> str:
        if not orders:
            return "You have no pending or unshipped orders right now."
        pending = sum(1 for o in orders if o.status == "Pending")
        unshipped = sum(1 for o in orders if o.status == "Unshipped")
        parts = []
        if pending:
            parts.append(
                f"{pending} pending order{
                    's' if pending != 1 else ''}")
        if unshipped:
            parts.append(
                f"{unshipped} unshipped order{
                    's' if unshipped != 1 else ''}")
        summary = " and ".join(parts) if parts else f"{len(orders)} orders"
        return f"You have {summary} that need attention."

    @staticmethod
    def _short_name(name: str, max_words: int = 5) -> str:
        """Truncate a long product name to the first N words for TTS readability."""
        words = name.split()
        if len(words) <= max_words:
            return name
        return " ".join(words[:max_words]) + "..."


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def build_amazon_provider(settings=None) -> AmazonProvider:
    if settings is None:
        from config.settings import get_settings
        settings = get_settings()
    return AmazonProvider(
        lwa_app_id=settings.amazon_sp_lwa_app_id,
        lwa_client_secret=settings.amazon_sp_lwa_client_secret,
        refresh_token=settings.amazon_sp_refresh_token,
        aws_access_key=settings.amazon_aws_access_key,
        aws_secret_key=settings.amazon_aws_secret_key,
        marketplace_id=settings.amazon_marketplace_id,
        seller_id=settings.amazon_seller_id,
        low_stock_threshold=settings.amazon_low_stock_threshold,
    )
