"""
api/routes/broadcast.py

Internal broadcasting endpoint for system-wide notifications.
Typically called by daemons (e.g., Herald for lip-sync events).
"""

import logging
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Header, HTTPException, Request, WebSocket
from pydantic import BaseModel

from config.settings import get_settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/broadcast", tags=["broadcast"])

class LipSyncPayload(BaseModel):
    type: str = "lip_sync"
    timings: List[Dict[str, Any]]

@router.post("/lip_sync")
async def broadcast_lip_sync(
    body: LipSyncPayload,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """
    Broadcasts lip-sync timing data to all connected WebSocket clients.
    Auth: Daemon internal secret only.
    """
    settings = get_settings()
    if authorization != f"Bearer {settings.daemon_internal_secret}":
        raise HTTPException(status_code=403, detail="Invalid internal secret.")

    # Access active connections from app state
    active_connections = getattr(request.app.state, "active_connections", {})
    
    count = 0
    payload = body.model_dump()
    
    for user_id, sockets in active_connections.items():
        for ws in sockets:
            try:
                await ws.send_json(payload)
                count += 1
            except Exception:
                # Sockets might be stale; they are cleaned up by the WS handler
                pass
                
    logger.debug(f"Broadcasted lip_sync event to {count} client(s).")
    return {"ok": True, "clients": count}
