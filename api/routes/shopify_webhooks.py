"""
api/routes/shopify_webhooks.py

Webhook endpoint for Shopify.
"""

import asyncio
from fastapi import APIRouter, Request
from providers.commerce.shopify import ShopifySyncWrapper

router = APIRouter(prefix="/api/webhooks/shopify", tags=["commerce"])

@router.post("/orders")
async def shopify_order_webhook(request: Request):
    payload = await request.json()
    wrapper = ShopifySyncWrapper(db_path="data/commercial_inventory.db", workspace_id="default", user_id="system")
    
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, wrapper.handle_order_created, payload)
    
    return {"status": "ok"}
