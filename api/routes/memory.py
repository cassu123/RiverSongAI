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
from core.errors import bad_request, not_found, unauthorized

router = APIRouter(prefix="/api/memory", tags=["memory"])


class FactCreate(BaseModel):
    key: str
    value: str

class FactUpdate(BaseModel):
    key: Optional[str] = None
    value: Optional[str] = None

class PreferenceCreate(BaseModel):
    category: str
    value: str
    confidence: Optional[str] = "low"

class PreferenceUpdate(BaseModel):
    category: Optional[str] = None
    value: Optional[str] = None

class SummaryUpdate(BaseModel):
    ttl_setting: Optional[str] = None


def _mm(request: Request):
    mm = getattr(request.app.state, "memory_manager", None)
    if mm is None:
        raise HTTPException(
            status_code=503,
            detail="Memory manager not available")
    return mm


async def _require_user(authorization: Optional[str]) -> str:
    """Validate Bearer token and return the user's sub claim."""
    if not authorization or not authorization.startswith("Bearer "):
        raise unauthorized("Not authenticated.")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise unauthorized("Invalid or expired token.")
    return payload["sub"]


@router.get("/facts")
async def get_facts(request: Request,
                    authorization: Optional[str] = Header(default=None)):
    user_id = await _require_user(authorization)
    mm = _mm(request)
    facts = await mm.get_facts(user_id)
    return [
        {
            "id": f.id,
            "key": f.key,
            "value": f.value,
            "source": f.source,
            "source_kind": f.source_kind,
            "source_ref": f.source_ref,
            "created_at": f.created_at.isoformat() if f.created_at else None,
            "updated_at": f.updated_at.isoformat() if f.updated_at else None,
        }
        for f in facts
    ]


@router.post("/facts", status_code=201)
async def create_fact(body: FactCreate, request: Request,
                      authorization: Optional[str] = Header(default=None)):
    user_id = await _require_user(authorization)
    if not body.key.strip() or not body.value.strip():
        raise bad_request("key and value are required")
    mm = _mm(request)
    await mm.upsert_fact(user_id=user_id, key=body.key, value=body.value, source="manual")
    facts = await mm.get_facts(user_id)
    created = next((f for f in reversed(facts) if f.key ==
                   body.key.lower().strip()), None)
    if created:
        return {
            "id": created.id,
            "key": created.key,
            "value": created.value,
            "source": created.source,
            "source_kind": created.source_kind,
            "source_ref": created.source_ref,
            "created_at": created.created_at.isoformat() if created.created_at else None,
            "updated_at": created.updated_at.isoformat() if created.updated_at else None,
        }
    return {"status": "ok"}


@router.patch("/facts/{fact_id}")
async def update_fact(fact_id: str, body: FactUpdate, request: Request,
                      authorization: Optional[str] = Header(default=None)):
    user_id = await _require_user(authorization)
    mm = _mm(request)
    existing = await mm._store.get_fact_by_id(user_id, fact_id)
    if not existing:
        raise not_found("Fact not found")

    new_key = body.key if body.key is not None else existing.key
    new_value = body.value if body.value is not None else existing.value

    if not new_key.strip() or not new_value.strip():
        raise bad_request("key and value cannot be empty")

    ok = await mm.update_fact(fact_id, user_id, new_key, new_value)
    if not ok:
        raise not_found("Fact not found or not modified")
    return {"status": "ok"}


@router.delete("/facts/{fact_id}", status_code=204)
async def delete_fact(fact_id: str, request: Request,
                      authorization: Optional[str] = Header(default=None)):
    user_id = await _require_user(authorization)
    mm = _mm(request)
    ok = await mm.delete_fact(fact_id, user_id)
    if not ok:
        raise not_found("Fact not found")


@router.get("/preferences")
async def get_preferences(request: Request,
                          authorization: Optional[str] = Header(default=None)):
    user_id = await _require_user(authorization)
    mm = _mm(request)
    prefs = await mm.get_preferences(user_id)
    return [
        {
            "id": p.id,
            "category": p.category,
            "value": p.value,
            "confidence": p.confidence,
            "source_kind": p.source_kind,
            "source_ref": p.source_ref,
            "last_updated": p.last_updated.isoformat() if p.last_updated else None,
        }
        for p in prefs
    ]


@router.post("/preferences", status_code=201)
async def create_preference(body: PreferenceCreate, request: Request,
                            authorization: Optional[str] = Header(default=None)):
    user_id = await _require_user(authorization)
    if not body.category.strip() or not body.value.strip():
        raise bad_request("category and value are required")
    mm = _mm(request)
    await mm.upsert_preference(
        user_id=user_id,
        category=body.category,
        value=body.value,
        confidence=body.confidence or "low",
        source_kind="manual"
    )
    return {"status": "ok"}


@router.patch("/preferences/{pref_id}")
async def update_preference(pref_id: str, body: PreferenceUpdate, request: Request,
                            authorization: Optional[str] = Header(default=None)):
    user_id = await _require_user(authorization)
    mm = _mm(request)
    existing = await mm._store.get_preference_by_id(user_id, pref_id)
    if not existing:
        raise not_found("Preference not found")

    new_category = body.category if body.category is not None else existing.category
    new_value = body.value if body.value is not None else existing.value

    if not new_category.strip() or not new_value.strip():
        raise bad_request("category and value cannot be empty")

    ok = await mm.update_preference(pref_id, user_id, new_category, new_value)
    if not ok:
        raise not_found("Preference not found or not modified")
    return {"status": "ok"}


@router.delete("/preferences/{pref_id}", status_code=204)
async def delete_preference(pref_id: str, request: Request,
                            authorization: Optional[str] = Header(default=None)):
    user_id = await _require_user(authorization)
    mm = _mm(request)
    ok = await mm.delete_preference(pref_id, user_id)
    if not ok:
        raise not_found("Preference not found")


@router.get("/pending-habits")
async def get_pending_habits(
        request: Request, authorization: Optional[str] = Header(default=None)):
    user_id = await _require_user(authorization)
    mm = _mm(request)
    habits = await mm.get_pending_habits(user_id)
    return habits


@router.post("/pending-habits/{habit_id}/approve")
async def approve_habit(habit_id: str, request: Request,
                        authorization: Optional[str] = Header(default=None)):
    user_id = await _require_user(authorization)
    mm = _mm(request)
    # Find the habit
    habits = await mm.get_pending_habits(user_id)
    habit = next((h for h in habits if h["id"] == habit_id), None)
    if not habit:
        raise not_found("Pending habit not found")

    # Move to preferences. Structured suggestions (e.g. distiller preferences)
    # carry a JSON payload with the real category/value/provenance; plain habit
    # inferences fall back to a "habit" category keyed off the pattern text.
    import json
    category = "habit"
    value = habit.get("pattern", "")
    source_kind = "habit_inference"
    source_ref = None
    payload_raw = habit.get("payload")
    if payload_raw:
        try:
            p = json.loads(payload_raw)
            category = p.get("category", category)
            value = p.get("value", value)
            source_kind = p.get("source_kind", source_kind)
            source_ref = p.get("source_ref")
        except (ValueError, TypeError):
            pass

    # Route through the manager so the vector is written and provenance is set.
    # Human approval upgrades confidence to high.
    await mm.upsert_preference(
        user_id=user_id,
        category=category,
        value=value,
        confidence="high",
        source_kind=source_kind,
        source_ref=source_ref,
    )

    # Delete from pending
    await mm.delete_pending_habit(habit_id, user_id)
    return {"status": "approved"}


@router.delete("/pending-habits/{habit_id}", status_code=204)
async def delete_pending_habit(
        habit_id: str, request: Request, authorization: Optional[str] = Header(default=None)):
    user_id = await _require_user(authorization)
    mm = _mm(request)
    ok = await mm.delete_pending_habit(habit_id, user_id)
    if not ok:
        raise not_found("Pending habit not found")


@router.get("/summaries")
async def get_summaries(request: Request, limit: int = 50,
                        authorization: Optional[str] = Header(default=None)):
    user_id = await _require_user(authorization)
    mm = _mm(request)
    summaries = await mm._store.get_recent_summaries(user_id, limit=limit)
    return [
        {
            "id": s.id,
            "summary": s.summary,
            "ttl_setting": s.ttl_setting,
            "expires_at": s.expires_at.isoformat() if s.expires_at else None,
            "reference_count": s.reference_count,
            "source_kind": s.source_kind,
            "source_ref": s.source_ref,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        }
        for s in summaries
    ]


@router.patch("/summaries/{summary_id}/ttl")
async def update_summary_ttl_setting(summary_id: str, body: SummaryUpdate, request: Request,
                             authorization: Optional[str] = Header(default=None)):
    user_id = await _require_user(authorization)
    mm = _mm(request)
    
    if not body.ttl_setting:
        raise bad_request("ttl_setting is required")
        
    from providers.memory.models import TTLOption
    if not TTLOption.is_valid(body.ttl_setting):
        raise bad_request(f"Invalid ttl_setting. Allowed: {TTLOption.ALL}")
        
    summary = await mm._store.get_summary_by_id(summary_id)
    if not summary or summary.user_id != user_id:
        raise not_found("Summary not found")
        
    from providers.memory.ttl_engine import calculate_expires_at
    new_expires_at = calculate_expires_at(body.ttl_setting)
    
    # Update directly in sqlite_store
    conn = mm._store._get_conn()
    from core.utils import _dt_to_str
    conn.execute(
        "UPDATE conversation_summaries SET ttl_setting = ?, expires_at = ? WHERE id = ? AND user_id = ?",
        (body.ttl_setting, _dt_to_str(new_expires_at), summary_id, user_id)
    )
    conn.commit()
    
    return {"status": "ok"}


@router.delete("/summaries/{summary_id}", status_code=204)
async def delete_summary(summary_id: str, request: Request,
                         authorization: Optional[str] = Header(default=None)):
    user_id = await _require_user(authorization)
    mm = _mm(request)
    ok = await mm.delete_summary(summary_id, user_id)
    if not ok:
        raise not_found("Summary not found")
