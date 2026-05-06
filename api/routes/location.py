"""
api/routes/location.py

Geolocation endpoints for River Song AI.

GET /api/location/city  -- Get user's city based on IP
"""

from __future__ import annotations

import logging
from typing import Optional

import httpx
from fastapi import APIRouter, Header, HTTPException, Request

from core.auth import decode_token

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/location", tags=["location"])


def _require_user(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    return payload["sub"]


@router.get("/city")
async def get_city(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """
    Retrieve the user's current city based on their IP address.
    Uses ip-api.com (free for non-commercial use, 45 req/min).
    """
    _require_user(authorization)
    
    # In many production setups, request.client.host is the load balancer IP.
    # main.py includes _CloudflareIPMiddleware which sets request.scope["client"]
    # from the CF-Connecting-IP header if present.
    client_host = request.client.host if request.client else None
    
    url = "http://ip-api.com/json/"
    # If we have a public IP, pass it to the API. Otherwise, ip-api uses the caller's IP.
    if client_host and not client_host.startswith(("127.", "192.168.", "10.", "172.16.")):
        url += client_host

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
            
            if data.get("status") == "fail":
                logger.error("IP-API failed for IP %s: %s", client_host, data.get("message"))
                raise HTTPException(
                    status_code=502, 
                    detail=f"Location lookup failed: {data.get('message')}"
                )
                
            return {
                "city": data.get("city"),
                "region": data.get("regionName"),
                "country": data.get("country"),
                "lat": data.get("lat"),
                "lon": data.get("lon"),
                "query": data.get("query"),
                "timezone": data.get("timezone"),
            }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Location lookup error: %s", exc)
        raise HTTPException(status_code=502, detail=f"Location lookup error: {exc}")
