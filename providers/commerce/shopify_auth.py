"""
providers/commerce/shopify_auth.py

Shopify OAuth 2.0 flow for River Song AI.
Handles offline access tokens for multi-shop integration.
"""

import logging
import httpx
import hmac
import hashlib
from typing import Dict, Optional
from dataclasses import dataclass

logger = logging.getLogger(__name__)

@dataclass
class ShopifyCredentials:
    shop: str
    access_token: str
    scope: str

class ShopifyAuthProvider:
    """
    Handles Shopify OAuth flow.
    Requires SHOPIFY_API_KEY and SHOPIFY_API_SECRET in settings.
    """

    def __init__(self, api_key: str, api_secret: str, redirect_uri: str):
        self.api_key = api_key
        self.api_secret = api_secret
        self.redirect_uri = redirect_uri
        self.scopes = "read_products,read_orders,read_customers,read_inventory"

    def get_auth_url(self, shop: str, state: str) -> str:
        """
        Generate the initial authorization URL.
        'shop' should be the myshopify.com domain.
        """
        # Ensure shop is in the correct format (myshopify.com)
        if not shop.endswith(".myshopify.com"):
            shop = f"{shop}.myshopify.com"
        
        return (
            f"https://{shop}/admin/oauth/authorize?"
            f"client_id={self.api_key}&"
            f"scope={self.scopes}&"
            f"redirect_uri={self.redirect_uri}&"
            f"state={state}&"
            f"grant_options[]=offline"
        )

    async def exchange_code(self, shop: str, code: str) -> ShopifyCredentials:
        """
        Exchange the authorization code for an offline access token.
        """
        url = f"https://{shop}/admin/oauth/access_token"
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, json={
                "client_id": self.api_key,
                "client_secret": self.api_secret,
                "code": code
            })
            resp.raise_for_status()
            data = resp.json()
            
            return ShopifyCredentials(
                shop=shop,
                access_token=data["access_token"],
                scope=data["scope"]
            )

    def verify_hmac(self, params: Dict[str, str]) -> bool:
        """
        Verify the HMAC signature from Shopify to ensure the request is valid.
        """
        if "hmac" not in params:
            return False
            
        received_hmac = params["hmac"]
        # Remove hmac from params to calculate
        filtered_params = {k: v for k, v in params.items() if k != "hmac"}
        # Sort keys and join
        sorted_params = sorted(filtered_params.items())
        query_string = "&".join([f"{k}={v}" for k, v in sorted_params])
        
        calculated_hmac = hmac.new(
            self.api_secret.encode("utf-8"),
            query_string.encode("utf-8"),
            hashlib.sha256
        ).hexdigest()
        
        return hmac.compare_digest(calculated_hmac, received_hmac)
