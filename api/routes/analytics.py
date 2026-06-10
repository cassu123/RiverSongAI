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
import json
from typing import Dict, Optional

from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel

from config.settings import get_settings
from core.auth import decode_token

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/analytics", tags=["analytics"])


async def _require_user(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token.")
    return payload["sub"]


def _store(request: Request):
    mm = getattr(request.app.state, "memory_manager", None)
    if mm is None:
        raise HTTPException(status_code=503,
                            detail="Memory manager not available.")
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

@router.get("/business-report")
async def get_business_report(
    request: Request,
    days: int = Query(default=30, ge=1, le=365),
    authorization: Optional[str] = Header(default=None),
):
    """
    Generate an AI-driven business report.
    This reuses the logic from the LLM tool but exposes it as a clean API.
    """
    user_id = await _require_user(authorization)
    from core.tools import _exec_generate_business_report

    try:
        report = await _exec_generate_business_report({"days": days}, user_id)
        return {"report": report}
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate report: {
                str(exc)}")


@router.get("/platforms")
async def list_platforms(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user_id = await _require_user(authorization)
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
    user_id = await _require_user(authorization)
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
    user_id = await _require_user(authorization)
    store = _store(request)
    await store.delete_analytics_platform(user_id, platform.lower())
    return {"ok": True}


@router.get("/{platform}/summary")
async def get_platform_summary(
    platform: str,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """
    Generate an AI-driven summary and insights for a specific platform.
    Uses the local Ollama LLM to generate 3 concise bullet-point insights.
    """
    allowed_platforms = ["tiktok", "instagram", "amazon", "etsy", "facebook"]
    platform = platform.lower()
    if platform not in allowed_platforms:
        raise HTTPException(
            status_code=400,
            detail=f"Platform '{platform}' not supported for AI summary. Use one of: {
                ', '.join(allowed_platforms)}"
        )

    user_id = await _require_user(authorization)
    store = _store(request)

    settings = get_settings()
    if not settings.analytics_ai_enabled:
        raise HTTPException(
            status_code=503,
            detail="Analytics AI summaries are disabled by configuration.")

    # 1. Fetch recent metrics
    snapshots = await store.get_analytics_snapshots(user_id, platform, days=30)
    if not snapshots:
        raise HTTPException(
            status_code=404,
            detail=f"No analytics data found for {platform} in the last 30 days.")

    # 2. Call OllamaLLM to generate insights
    from core.conversation_loop import _build_llm_provider
    from datetime import datetime

    try:
        # Honor ANALYTICS_LLM_MODEL when set; otherwise provider default.
        llm, _ = _build_llm_provider(
            model_override=settings.analytics_llm_model or None)
    except Exception as exc:
        logger.error("Failed to initialize LLM provider: %s", exc)
        raise HTTPException(status_code=503,
                            detail="Ollama LLM is currently unavailable.")

    prompt = (
        f"Analyze these {platform} analytics snapshots from the last 30 days:\n"
        f"{json.dumps(snapshots)}\n\n"
        f"Provide exactly 3 concise bullet-point insights about trends, growth, or anomalies. "
        f"Keep it brief and professional. Do not include any other text."
    )

    try:
        insights = await llm.chat([{"role": "user", "content": prompt}])

        return {
            "platform": platform,
            "insights": insights.strip(),
            "generated_at": datetime.now().isoformat()
        }
    except Exception as exc:
        logger.error("Ollama analysis failed for %s: %s", platform, exc)
        raise HTTPException(status_code=503,
                            detail="Ollama LLM failed to generate insights.")


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
    user_id = await _require_user(authorization)
    store = _store(request)
    snapshots = await store.get_analytics_snapshots(user_id, platform, days)
    return snapshots


@router.post("/snapshots")
async def add_snapshot(
    body: SnapshotBody,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user_id = await _require_user(authorization)
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
    user_id = await _require_user(authorization)
    store = _store(request)
    await store.delete_analytics_snapshot(snap_id, user_id)
    return {"ok": True}
