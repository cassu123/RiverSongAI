"""
api/routes/skills.py

Q2#7 — Skills system. CRUD for user-owned skills + a /relevant retrieval
endpoint used by the conversation/chat layer to inject vector-matched
skills into the system prompt.

Flag-gated by settings.skills_enabled (default OFF).

Endpoints:
  GET    /api/skills                — list current user's skills
  POST   /api/skills                — create a new skill
  PUT    /api/skills/{skill_id}     — update an existing skill
  DELETE /api/skills/{skill_id}     — delete a skill
  POST   /api/skills/relevant       — return top-k skills semantically
                                      matched to a query (used by the
                                      conversation layer to assemble the
                                      system prompt)
"""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Header, Request
from pydantic import BaseModel, Field

from config.settings import get_settings
from core.auth import decode_token
from core.errors import bad_request, not_found, unauthorized
from core.skills import (
    get_relevant_skills,
    index_skill,
    remove_skill_from_index,
)

router = APIRouter(prefix="/api/skills", tags=["skills"])


# -----------------------------------------------------------------------------
# Schemas
# -----------------------------------------------------------------------------

class SkillCreate(BaseModel):
    name:            str = Field(..., min_length=1, max_length=120)
    prompt:          str = Field(..., min_length=1)
    trigger_phrases: str = Field(default="")


class SkillUpdate(BaseModel):
    name:            Optional[str]  = Field(default=None, min_length=1, max_length=120)
    prompt:          Optional[str]  = None
    trigger_phrases: Optional[str]  = None
    is_active:       Optional[bool] = None


class RelevantQuery(BaseModel):
    query: str = Field(..., min_length=1)
    top_k: Optional[int] = Field(default=None, ge=1, le=10)


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

def _require_enabled() -> None:
    if not getattr(get_settings(), "skills_enabled", False):
        raise not_found("Skills system is disabled.")


async def _require_user(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise unauthorized("Not authenticated.")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise unauthorized("Invalid or expired token.")
    return payload["sub"]


def _store(request: Request):
    mm = getattr(request.app.state, "memory_manager", None)
    if mm is None or getattr(mm, "_store", None) is None:
        raise not_found("Skill store not available.")
    return mm._store


# -----------------------------------------------------------------------------
# Routes
# -----------------------------------------------------------------------------

@router.get("")
async def list_skills(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    _require_enabled()
    user_id = await _require_user(authorization)
    skills = await _store(request).list_skills(user_id)
    return {"skills": skills}


@router.post("", status_code=201)
async def create_skill(
    body: SkillCreate,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    _require_enabled()
    user_id = await _require_user(authorization)
    store   = _store(request)

    cap = int(getattr(get_settings(), "skills_max_per_user", 100))
    count = await store.count_skills(user_id)
    if count >= cap:
        raise bad_request(f"Skill cap reached ({cap}). Delete one to add another.")

    skill = await store.create_skill(
        owner_id=user_id,
        name=body.name.strip(),
        prompt=body.prompt,
        trigger_phrases=body.trigger_phrases or "",
    )
    await index_skill(skill, owner_id=user_id)
    return skill


@router.put("/{skill_id}")
async def update_skill(
    skill_id: str,
    body: SkillUpdate,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    _require_enabled()
    user_id = await _require_user(authorization)

    name = body.name.strip() if body.name is not None else None
    updated = await _store(request).update_skill(
        user_id, skill_id,
        name=name,
        prompt=body.prompt,
        trigger_phrases=body.trigger_phrases,
        is_active=body.is_active,
    )
    if updated is None:
        raise not_found("Skill not found.")
    await index_skill(updated, owner_id=user_id)
    return updated


@router.delete("/{skill_id}", status_code=204)
async def delete_skill(
    skill_id: str,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    _require_enabled()
    user_id = await _require_user(authorization)
    ok = await _store(request).delete_skill(user_id, skill_id)
    if not ok:
        raise not_found("Skill not found.")
    await remove_skill_from_index(skill_id)


@router.post("/relevant")
async def relevant_skills(
    body: RelevantQuery,
    authorization: Optional[str] = Header(default=None),
):
    _require_enabled()
    user_id = await _require_user(authorization)
    hits = await get_relevant_skills(body.query, owner_id=user_id, top_k=body.top_k)
    return {"skills": hits}
