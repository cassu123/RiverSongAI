"""
api/routes/memory.py

Memory CRUD endpoints for the Memory page UI.

GET    /api/memory/facts?user_id=default        -- all facts for a user
POST   /api/memory/facts?user_id=default        -- create / upsert a fact
DELETE /api/memory/facts/{fact_id}              -- delete one fact by id
GET    /api/memory/preferences?user_id=default  -- all preferences for a user
GET    /api/memory/summaries?user_id=default    -- recent summaries for a user
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

from core.auth import decode_token

router = APIRouter(prefix="/api/memory", tags=["memory"])


class FactCreate(BaseModel):
    key: str
    value: str


def _mm(request: Request):
    mm = getattr(request.app.state, "memory_manager", None)
    if mm is None:
        raise HTTPException(status_code=503, detail="Memory manager not available")
    return mm


def _require_user(authorization: Optional[str]) -> str:
    """Validate Bearer token and return the user's sub claim."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    return payload["sub"]


@router.get("/facts")
async def get_facts(request: Request, authorization: Optional[str] = Header(default=None)):
    user_id = _require_user(authorization)
    mm = _mm(request)
    facts = await mm.get_facts(user_id)
    return [
        {
            "id":         f.id,
            "key":        f.key,
            "value":      f.value,
            "source":     f.source,
            "created_at": f.created_at.isoformat() if f.created_at else None,
            "updated_at": f.updated_at.isoformat() if f.updated_at else None,
        }
        for f in facts
    ]


@router.post("/facts", status_code=201)
async def create_fact(body: FactCreate, request: Request, authorization: Optional[str] = Header(default=None)):
    user_id = _require_user(authorization)
    if not body.key.strip() or not body.value.strip():
        raise HTTPException(status_code=422, detail="key and value are required")
    mm = _mm(request)
    await mm.upsert_fact(user_id=user_id, key=body.key, value=body.value, source="manual")
    facts = await mm.get_facts(user_id)
    created = next((f for f in reversed(facts) if f.key == body.key.lower().strip()), None)
    if created:
        return {
            "id":         created.id,
            "key":        created.key,
            "value":      created.value,
            "source":     created.source,
            "created_at": created.created_at.isoformat() if created.created_at else None,
            "updated_at": created.updated_at.isoformat() if created.updated_at else None,
        }
    return {"status": "ok"}


@router.delete("/facts/{fact_id}", status_code=204)
async def delete_fact(fact_id: str, request: Request, authorization: Optional[str] = Header(default=None)):
    _require_user(authorization)
    mm = _mm(request)
    await mm.delete_fact(fact_id)


@router.get("/preferences")
async def get_preferences(request: Request, authorization: Optional[str] = Header(default=None)):
    user_id = _require_user(authorization)
    mm = _mm(request)
    prefs = await mm.get_preferences(user_id)
    return [
        {
            "id":           p.id,
            "category":     p.category,
            "value":        p.value,
            "confidence":   p.confidence,
            "last_updated": p.last_updated.isoformat() if p.last_updated else None,
        }
        for p in prefs
    ]


@router.get("/summaries")
async def get_summaries(request: Request, limit: int = 50, authorization: Optional[str] = Header(default=None)):
    user_id = _require_user(authorization)
    mm = _mm(request)
    summaries = await mm._store.get_recent_summaries(user_id, limit=limit)
    return [
        {
            "id":              s.id,
            "summary":         s.summary,
            "ttl_setting":     s.ttl_setting,
            "expires_at":      s.expires_at.isoformat() if s.expires_at else None,
            "reference_count": s.reference_count,
            "created_at":      s.created_at.isoformat() if s.created_at else None,
        }
        for s in summaries
    ]
