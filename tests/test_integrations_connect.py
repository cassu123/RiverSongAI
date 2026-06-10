"""
tests/test_integrations_connect.py

Connected Accounts flows: shop-domain validation for the Shopify OAuth
flow and auth requirements on the integrations endpoints.
"""

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from api.routes.shopify_auth import _normalize_shop
from main import app

client = TestClient(app)


def test_normalize_shop_accepts_valid_domains():
    assert _normalize_shop("my-store.myshopify.com") == "my-store.myshopify.com"
    assert _normalize_shop("my-store") == "my-store.myshopify.com"
    assert _normalize_shop("https://My-Store.myshopify.com/") == "my-store.myshopify.com"


def test_normalize_shop_rejects_attacker_shapes():
    for bad in [
        "evil.com",                          # arbitrary host
        "evil.com/x.myshopify.com",          # path trick
        "store.myshopify.com.evil.com",      # suffix trick
        "a b.myshopify.com",                 # whitespace
        "",
    ]:
        with pytest.raises(HTTPException):
            _normalize_shop(bad)


def test_integrations_status_requires_auth():
    assert client.get("/api/integrations/status").status_code == 401


def test_google_authorize_requires_auth():
    assert client.get("/api/integrations/google/authorize").status_code == 401


def test_shopify_auth_url_requires_auth():
    assert client.get("/api/shopify/auth/url?shop=my-store").status_code == 401
