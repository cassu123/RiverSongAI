"""
api/routes/routines.py

CRUD + manual run for user routines.

GET    /api/routines            -- list routines for user
POST   /api/routines            -- create routine
PATCH  /api/routines/{id}       -- update routine
DELETE /api/routines/{id}       -- delete routine
POST   /api/routines/{id}/run   -- run routine now (returns River's response)
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from core.auth import decode_token

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/routines", tags=["routines"])
_bearer = HTTPBearer(auto_error=False)


def _require_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> str:
    if not creds:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = decode_token(creds.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token.")
    return payload["sub"]


class RoutineIn(BaseModel):
    name: str
    trigger: str = "manual"
    time: Optional[str] = None
    days: List[str] = []
    prompt: str = ""
    enabled: bool = True


class RoutinePatch(BaseModel):
    name: Optional[str] = None
    trigger: Optional[str] = None
    time: Optional[str] = None
    days: Optional[List[str]] = None
    prompt: Optional[str] = None
    enabled: Optional[bool] = None


@router.get("")
async def list_routines(request: Request, user_id: str = Depends(_require_user)):
    store = request.app.state.memory_manager._store
    return await store.list_routines(user_id)


@router.post("")
async def create_routine(body: RoutineIn, request: Request, user_id: str = Depends(_require_user)):
    store = request.app.state.memory_manager._store
    routine = await store.create_routine({
        "user_id": user_id,
        **body.model_dump(),
    })
    return routine


@router.patch("/{routine_id}")
async def update_routine(routine_id: str, body: RoutinePatch, request: Request, user_id: str = Depends(_require_user)):
    store = request.app.state.memory_manager._store
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    # Preserve explicit False for boolean fields
    if body.enabled is not None:
        fields["enabled"] = body.enabled
    result = await store.update_routine(routine_id, user_id, fields)
    if not result:
        raise HTTPException(status_code=404, detail="Routine not found.")
    return result


@router.delete("/{routine_id}")
async def delete_routine(routine_id: str, request: Request, user_id: str = Depends(_require_user)):
    store = request.app.state.memory_manager._store
    deleted = await store.delete_routine(routine_id, user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Routine not found.")
    return {"ok": True}


@router.post("/{routine_id}/run")
async def run_routine(routine_id: str, request: Request, user_id: str = Depends(_require_user)):
    from datetime import datetime, timezone
    from core.conversation_loop import ConversationLoop

    store = request.app.state.memory_manager._store
    routines = await store.list_routines(user_id)
    routine = next((r for r in routines if r["id"] == routine_id), None)
    if not routine:
        raise HTTPException(status_code=404, detail="Routine not found.")
    if not routine["prompt"]:
        return {"output": "(No prompt set for this routine.)"}

    output_parts: list = []

    async def collect(event: dict) -> None:
        if event.get("type") == "response_chunk" and event.get("text"):
            output_parts.append(event["text"])
        elif event.get("type") == "response_complete" and event.get("text"):
            # response_complete fires with the full text when intent router handles it
            if not output_parts:
                output_parts.append(event["text"])

    try:
        loop = ConversationLoop(
            memory_manager=request.app.state.memory_manager,
            user_id=user_id,
        )
        await loop.initialize()
        await loop.run_text(routine["prompt"], collect)
    except Exception as e:
        logger.error("Routine run failed: %s", e)
        return {"output": f"Error running routine: {e}"}

    await store.update_routine(routine_id, user_id, {"last_run": datetime.now(timezone.utc).isoformat()})
    return {"output": "".join(output_parts) or "(No response generated.)"}
