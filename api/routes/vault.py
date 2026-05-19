"""
api/routes/vault.py

REST API endpoints for CHRONOS local markdown vault.
"""

from __future__ import annotations

import logging
from typing import Optional, Literal

from fastapi import APIRouter, Header, HTTPException, Request, Query
from pydantic import BaseModel

from core.auth import decode_token
from providers.vault.vault_provider import VaultProvider

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/vault", tags=["vault"])

class NoteWriteBody(BaseModel):
    path: str
    content: str

class NoteRenameBody(BaseModel):
    old: str
    new: str

async def _require_user(authorization: Optional[str]) -> str:
    """Validate Bearer token and return the user's sub claim."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    return payload["sub"]

def _get_provider(request: Request) -> VaultProvider:
    return VaultProvider(store=request.app.state.memory_manager._store)

@router.get("/tree")
async def get_tree(
    request: Request,
    root: Literal["personal", "household", "shared"] = Query(...),
    authorization: Optional[str] = Header(default=None)
):
    user_id = await _require_user(authorization)
    provider = _get_provider(request)
    return await provider.list_tree(user_id, root)

@router.get("/note")
async def get_note(
    request: Request,
    path: str = Query(...),
    authorization: Optional[str] = Header(default=None)
):
    user_id = await _require_user(authorization)
    provider = _get_provider(request)
    try:
        content = await provider.read_note(user_id, path)
        return {"content": content}
    except PermissionError as e:
        raise HTTPException(status_code=403, detail="path outside permitted roots")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Note not found")
    except Exception as e:
        logger.error("Failed to read note: %s", e)
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/note")
async def put_note(
    request: Request,
    body: NoteWriteBody,
    authorization: Optional[str] = Header(default=None)
):
    user_id = await _require_user(authorization)
    provider = _get_provider(request)
    try:
        result = await provider.write_note(user_id, body.path, body.content)
        return result
    except PermissionError:
        raise HTTPException(status_code=403, detail="path outside permitted roots")
    except Exception as e:
        logger.error("Failed to write note: %s", e)
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/note")
async def delete_note(
    request: Request,
    path: str = Query(...),
    authorization: Optional[str] = Header(default=None)
):
    user_id = await _require_user(authorization)
    provider = _get_provider(request)
    try:
        await provider.delete_note(user_id, path)
        return {"status": "ok"}
    except PermissionError:
        raise HTTPException(status_code=403, detail="path outside permitted roots")
    except Exception as e:
        logger.error("Failed to delete note: %s", e)
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/note/rename")
async def rename_note(
    request: Request,
    body: NoteRenameBody,
    authorization: Optional[str] = Header(default=None)
):
    user_id = await _require_user(authorization)
    provider = _get_provider(request)
    try:
        result = await provider.rename_note(user_id, body.old, body.new)
        return result
    except PermissionError:
        raise HTTPException(status_code=403, detail="path outside permitted roots")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Source not found")
    except Exception as e:
        logger.error("Failed to rename note: %s", e)
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/note/summarize")
async def summarize_note(
    request: Request,
    path: str = Query(...),
    authorization: Optional[str] = Header(default=None)
):
    user_id = await _require_user(authorization)
    provider = _get_provider(request)
    try:
        content = await provider.read_note(user_id, path)
        
        from core.conversation_loop import _build_llm_provider
        llm = _build_llm_provider()
        
        prompt = (
            "Summarize the following markdown note in 2-3 concise sentences. "
            "Focus on the core intent and key points. Plain text only.\n\n"
            f"--- NOTE CONTENT ---\n{content}\n--- END ---"
        )
        
        summary = ""
        async for chunk in llm.stream_response([
            {"role": "system", "content": "You are a concise summarizer."},
            {"role": "user", "content": prompt}
        ]):
            summary += chunk
            
        return {"summary": summary.strip()}
    except Exception as e:
        logger.error("Failed to summarize note: %s", e)
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/daily/today")
async def get_daily_today(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """Return today's daily note, creating an empty templated one if missing."""
    user_id = await _require_user(authorization)
    provider = _get_provider(request)
    try:
        return await provider.get_or_create_daily_note(user_id)
    except Exception as e:
        logger.error("Failed to get daily note: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/daily/{date_str}")
async def get_daily_for_date(
    date_str: str,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """Return the daily note for a given YYYY-MM-DD date, creating if missing."""
    user_id = await _require_user(authorization)
    provider = _get_provider(request)
    try:
        return await provider.get_or_create_daily_note(user_id, date_str)
    except Exception as e:
        logger.error("Failed to get daily note for %s: %s", date_str, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/search")
async def search_vault(
    request: Request,
    q: str = Query(...),
    authorization: Optional[str] = Header(default=None)
):
    user_id = await _require_user(authorization)
    provider = _get_provider(request)
    return await provider.search_text(user_id, q)

@router.get("/backlinks")
async def get_backlinks(
    request: Request,
    path: str = Query(...),
    authorization: Optional[str] = Header(default=None)
):
    user_id = await _require_user(authorization)
    provider = _get_provider(request)
    return await provider.get_backlinks(user_id, path)
