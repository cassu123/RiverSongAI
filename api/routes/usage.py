"""
api/routes/usage.py

Token usage summary endpoint.

Endpoints:
  GET /api/usage/tokens?days=30  -- aggregated token counts + estimated cost
"""

from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Query

from core.auth import decode_token
from core.token_tracker import get_summary

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
