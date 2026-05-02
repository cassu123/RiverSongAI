"""
api/routes/analytics.py

Sales & growth analytics endpoints.

GET    /api/analytics/platforms              -- list connected platforms
PUT    /api/analytics/platforms/{platform}   -- upsert platform config
DELETE /api/analytics/platforms/{platform}   -- remove platform config

GET    /api/analytics/snapshots              -- get snapshots (?platform=&days=)
POST   /api/analytics/snapshots              -- add/update a snapshot
DELETE /api/analytics/snapshots/{snap_id}    -- delete a snapshot
"""

from __future__ import annotations

import logging
from typing import Dict, Optional

from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel

from core.auth import decode_token

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/analytics", tags=["analytics"])


def _require_user(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    return payload["sub"]


def _store(request: Request):
    mm = getattr(request.app.state, "memory_manager", None)
    if mm is None:
        raise HTTPException(status_code=503, detail="Memory manager not available.")
    return mm._store


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class PlatformBody(BaseModel):
    enabled: bool = True
    api_key: str = ""
    api_secret: str = ""
    notes: str = ""


class SnapshotBody(BaseModel):
    platform: str
    date: str          # YYYY-MM-DD
    metrics: Dict[str, float] = {}


# ---------------------------------------------------------------------------
# Platforms
# ---------------------------------------------------------------------------

@router.get("/platforms")
async def list_platforms(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user_id = _require_user(authorization)
    store = _store(request)
    platforms = await store.get_analytics_platforms(user_id)
    for p in platforms:
        if p.get("api_secret"):
            p["api_secret"] = "••••••••"
    return platforms


@router.put("/platforms/{platform}")
async def upsert_platform(
    platform: str,
    body: PlatformBody,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user_id = _require_user(authorization)
    store = _store(request)
    await store.upsert_analytics_platform(
        user_id, platform.lower(), body.enabled,
        body.api_key, body.api_secret, body.notes,
    )
    return {"ok": True}


@router.delete("/platforms/{platform}")
async def delete_platform(
    platform: str,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user_id = _require_user(authorization)
    store = _store(request)
    await store.delete_analytics_platform(user_id, platform.lower())
    return {"ok": True}


# ---------------------------------------------------------------------------
# Snapshots
# ---------------------------------------------------------------------------

@router.get("/snapshots")
async def list_snapshots(
    request: Request,
    platform: Optional[str] = Query(default=None),
    days: int = Query(default=90, ge=1, le=365),
    authorization: Optional[str] = Header(default=None),
):
    user_id = _require_user(authorization)
    store = _store(request)
    snapshots = await store.get_analytics_snapshots(user_id, platform, days)
    return snapshots


@router.post("/snapshots")
async def add_snapshot(
    body: SnapshotBody,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user_id = _require_user(authorization)
    store = _store(request)
    snap_id = await store.upsert_analytics_snapshot(
        user_id, body.platform.lower(), body.date, body.metrics,
    )
    return {"id": snap_id, "ok": True}


@router.delete("/snapshots/{snap_id}")
async def delete_snapshot(
    snap_id: str,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user_id = _require_user(authorization)
    store = _store(request)
    await store.delete_analytics_snapshot(snap_id, user_id)
    return {"ok": True}
