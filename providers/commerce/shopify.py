"""
providers/commerce/shopify.py

Python port of the Shopify webhook and sync logic.
Bridges incoming Shopify webhooks to the local commerce DB using raw SQLite.
"""

import logging
import sqlite3
import os
import asyncio
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

logger = logging.getLogger(__name__)

class ShopifySyncWrapper:
    def __init__(self, db_path: str, workspace_id: str, user_id: str):
        self.db_path = db_path
        self.workspace_id = workspace_id
        self.user_id = user_id
        self._init_db()

    def _init_db(self):
        """Ensure required tables exist in the commerce database."""
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        conn = sqlite3.connect(self.db_path)
        try:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS customers (
                    id TEXT PRIMARY KEY,
                    workspace_id TEXT,
                    name TEXT,
                    email TEXT,
                    phone TEXT,
                    notes TEXT,
                    shopify_customer_id TEXT,
                    created_at TEXT
                );
                CREATE TABLE IF NOT EXISTS products (
                    id TEXT PRIMARY KEY,
                    workspace_id TEXT,
                    sku TEXT,
                    name TEXT,
                    stock_qty INTEGER,
                    unit_price REAL,
                    created_at TEXT
                );
                CREATE TABLE IF NOT EXISTS sales (
                    id TEXT PRIMARY KEY,
                    workspace_id TEXT,
                    customer_id TEXT,
                    total REAL,
                    status TEXT,
                    notes TEXT,
                    created_at TEXT
                );
                CREATE TABLE IF NOT EXISTS sale_line_items (
                    id TEXT PRIMARY KEY,
                    sale_id TEXT,
                    product_id TEXT,
                    qty INTEGER,
                    unit_price REAL
                );
            """)
            conn.commit()
        finally:
            conn.close()

    def handle_order_created(self, payload: dict) -> None:
        """
        Handle incoming Shopify Webhook for Order Creation.
        """
        order_id = str(payload.get("id"))
        logger.info("[SYNC] Processing new order from Shopify: %s", order_id)

        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            customer_data = payload.get("customer")
            local_customer_id = None

            if customer_data:
                shopify_cust_id = f"gid://shopify/Customer/{customer_data.get('id')}"
                cur = conn.execute(
                    "SELECT id FROM customers WHERE workspace_id = ? AND shopify_customer_id = ?",
                    (self.workspace_id, shopify_cust_id)
                )
                row = cur.fetchone()
                if row:
                    local_customer_id = row["id"]
                else:
                    import uuid
                    local_customer_id = str(uuid.uuid4())
                    logger.info("[SYNC] Creating new customer profile for: %s", customer_data.get("email"))
                    conn.execute(
                        "INSERT INTO customers (id, workspace_id, name, email, phone, notes, shopify_customer_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            local_customer_id, 
                            self.workspace_id,
                            f"{customer_data.get('first_name', '')} {customer_data.get('last_name', '')}".strip(),
                            customer_data.get("email", ""),
                            customer_data.get("phone", ""),
                            "Auto-synced from Shopify Order",
                            shopify_cust_id,
                            datetime.now(timezone.utc).isoformat()
                        )
                    )

            line_items = payload.get("line_items", [])
            import uuid
            sale_id = str(uuid.uuid4())
            total = Decimal("0.0")
            items_processed = 0

            for item in line_items:
                sku = item.get("sku")
                qty = item.get("quantity", 1)
                price = Decimal(str(item.get("price", "0.0")))
                
                if not sku:
                    continue

                cur = conn.execute(
                    "SELECT id, stock_qty, name FROM products WHERE workspace_id = ? AND sku = ?",
                    (self.workspace_id, sku)
                )
                product = cur.fetchone()

                if product:
                    if product["stock_qty"] < qty:
                        logger.warning("[SYNC] Insufficient stock for %s, skipping", sku)
                        continue

                    # Decrement stock
                    conn.execute(
                        "UPDATE products SET stock_qty = stock_qty - ? WHERE id = ?",
                        (qty, product["id"])
                    )
                    
                    # Create line item
                    conn.execute(
                        "INSERT INTO sale_line_items (id, sale_id, product_id, qty, unit_price) VALUES (?, ?, ?, ?, ?)",
                        (str(uuid.uuid4()), sale_id, product["id"], qty, float(price))
                    )
                    total += price * qty
                    items_processed += 1

            if items_processed > 0:
                conn.execute(
                    "INSERT INTO sales (id, workspace_id, customer_id, total, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (
                        sale_id,
                        self.workspace_id,
                        local_customer_id,
                        float(total),
                        "COMPLETED",
                        f"Shopify Order {order_id}",
                        datetime.now(timezone.utc).isoformat()
                    )
                )
                conn.commit()
                logger.info("[SYNC] Order %s synced. Total: %s", order_id, total)
            else:
                logger.warning("[SYNC] No items processed for order %s", order_id)

        except Exception as e:
            conn.rollback()
            logger.error("[SYNC ERROR] Failed to sync order %s: %s", order_id, e)
        finally:
            conn.close()

    async def push_local_sale_to_shopify(self, sale_id: str) -> None:
        """Simulate pushing local POS sale to Shopify."""
        logger.info("[SYNC] Pushing local sale %s to Shopify", sale_id)
        # Mock implementation as per audit requirements (no real API call)
        await asyncio.sleep(0.5)
        logger.info("[SYNC] Successfully pushed transaction %s to Shopify.", sale_id)
