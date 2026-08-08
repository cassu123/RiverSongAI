"""
api/routes/usage.py

Token usage summary endpoint.

Endpoints:
  GET /api/usage/tokens?days=30  -- aggregated token counts + estimated cost
"""

from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Query

from core.auth import decode_token
from core.token_tracker import get_model_usage, get_summary, get_provider_rate

router = APIRouter(prefix="/api/usage", tags=["usage"])


@router.get("/tokens")
async def token_usage(
    days: int = Query(default=30, ge=1, le=365),
    authorization: str = Header(default=""),
):
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    return get_summary(days=days)


@router.get("/rate/{provider}")
async def provider_rate(
    provider: str,
    window: int = Query(default=60, ge=10, le=3600),
    authorization: str = Header(default=""),
):
    """Return request count + token totals for a provider in the last `window` seconds."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return get_provider_rate(provider, window_seconds=window)


@router.get("/models")
async def model_usage(
    days: int = Query(default=30, ge=1, le=365),
    model: str = Query(default=""),
    authorization: str = Header(default=""),
):
    """Per-model recorded usage, including which account spent it.

    Admin-only, unlike /tokens: the per-user breakdown says what every other
    household member has been asking River, by volume and by model, and that
    is not something an ordinary account should be able to read.
    """
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")

    return get_model_usage(days=days, model=model or None)
