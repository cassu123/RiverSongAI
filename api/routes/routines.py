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
from core.errors import bad_request, forbidden, not_found, unauthorized

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/routines", tags=["routines"])
_bearer = HTTPBearer(auto_error=False)


async def _require_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> str:
    if not creds:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = await decode_token(creds.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token.")
    return payload["sub"]


class RoutineIn(BaseModel):
    name: str
    trigger: str = "manual"
    time: Optional[str] = None
    days: List[str] = []
    prompt: str = ""
    type: str = "simple"
    webhook_url: Optional[str] = None
    enabled: bool = True


class RoutinePatch(BaseModel):
    name: Optional[str] = None
    trigger: Optional[str] = None
    time: Optional[str] = None
    days: Optional[List[str]] = None
    prompt: Optional[str] = None
    type: Optional[str] = None
    webhook_url: Optional[str] = None
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
    import httpx
    from core.conversation_loop import ConversationLoop

    store = request.app.state.memory_manager._store
    routines = await store.list_routines(user_id)
    routine = next((r for r in routines if r["id"] == routine_id), None)
    if not routine:
        raise HTTPException(status_code=404, detail="Routine not found.")

    output_text = ""

    if routine.get("type") == "advanced" and routine.get("webhook_url"):
        # Trigger n8n/external webhook
        try:
            async with httpx.AsyncClient() as client:
                res = await client.post(routine["webhook_url"], json={"routine_name": routine["name"], "user_id": user_id}, timeout=30.0)
                if res.status_code >= 400:
                    output_text = f"Webhook failed with status {res.status_code}: {res.text}"
                else:
                    output_text = f"Webhook triggered successfully. Response: {res.text[:200]}"
        except Exception as e:
            logger.error("Advanced routine webhook failed: %s", e)
            output_text = f"Error triggering webhook: {e}"
    else:
        # Simple routine: use LLM
        if not routine["prompt"]:
            return {"output": "(No prompt set for this routine.)"}

        output_parts: list = []

        async def collect(event: dict) -> None:
            if event.get("type") == "response_chunk" and event.get("text"):
                output_parts.append(event["text"])
            elif event.get("type") == "response_complete" and event.get("text"):
                if not output_parts:
                    output_parts.append(event["text"])

        try:
            loop = ConversationLoop(
                memory_manager=request.app.state.memory_manager,
                user_id=user_id,
            )
            await loop.initialize()
            await loop.run_text(routine["prompt"], collect)
            output_text = "".join(output_parts) or "(No response generated.)"
        except Exception as e:
            logger.error("Routine run failed: %s", e)
            return {"output": f"Error running routine: {e}"}

    await store.update_routine(routine_id, user_id, {"last_run": datetime.now(timezone.utc).isoformat()})
    return {"output": output_text}
