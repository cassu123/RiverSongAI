from fastapi import APIRouter, Depends, HTTPException, Request
from typing import List, Dict, Any
from pydantic import BaseModel

from typing import List, Dict, Any, Optional
from pydantic import BaseModel

from core.auth import decode_token

async def _require_user(authorization: Optional[str] = Depends(lambda request: request.headers.get("Authorization"))) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token.")
    return payload["sub"]

router = APIRouter()

class CreateSessionRequest(BaseModel):
    title: str = ""

@router.get("/sessions")
async def list_sessions(request: Request, scope: Optional[str] = None, user_id: str = Depends(_require_user)):
    memory_manager = getattr(request.app.state, "memory_manager", None)
    if not memory_manager:
        raise HTTPException(status_code=500, detail="Memory manager not initialized")
    
    sessions = await memory_manager._store.get_chat_sessions(user_id, scope=scope)
    return {"sessions": sessions}

@router.post("/sessions")
async def create_session(request: Request, body: CreateSessionRequest, user_id: str = Depends(_require_user)):
    memory_manager = getattr(request.app.state, "memory_manager", None)
    if not memory_manager:
        raise HTTPException(status_code=500, detail="Memory manager not initialized")
    
    session_id = await memory_manager._store.create_chat_session(user_id, body.title)
    return {"id": session_id}

@router.get("/sessions/{session_id}")
async def get_session(session_id: str, request: Request, user_id: str = Depends(_require_user)):
    memory_manager = getattr(request.app.state, "memory_manager", None)
    if not memory_manager:
        raise HTTPException(status_code=500, detail="Memory manager not initialized")
    
    session = await memory_manager._store.get_chat_session(user_id, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
        
    messages = await memory_manager._store.get_chat_messages(user_id, session_id)
    session["messages"] = messages
    return session

@router.delete("/sessions/{session_id}")
async def archive_session(session_id: str, request: Request, user_id: str = Depends(_require_user)):
    memory_manager = getattr(request.app.state, "memory_manager", None)
    if not memory_manager:
        raise HTTPException(status_code=500, detail="Memory manager not initialized")
    
    session = await memory_manager._store.get_chat_session(user_id, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
        
    await memory_manager._store.archive_chat_session(user_id, session_id)
    return {"success": True}
