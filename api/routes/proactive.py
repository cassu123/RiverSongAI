from fastapi import APIRouter, Request
from pydantic import BaseModel
from typing import Optional, List
import json
import logging

logger = logging.getLogger(__name__)

router = APIRouter()

class ProactivePrefsPatch(BaseModel):
    quiet_start: Optional[int] = None
    quiet_end: Optional[int] = None
    min_push_severity: Optional[str] = None
    kinds_muted: Optional[List[str]] = None

@router.get("/prefs")
async def get_prefs(request: Request):
    user_id = request.state.user_id
    store = request.app.state.memory_manager._store
    prefs = await store._fetch_one("SELECT * FROM proactive_prefs WHERE user_id = ?", (user_id,))
    if prefs:
        prefs_dict = dict(prefs)
        if prefs_dict.get("kinds_muted"):
            prefs_dict["kinds_muted"] = json.loads(prefs_dict["kinds_muted"])
        return {"prefs": prefs_dict}
    return {"prefs": {"quiet_start": None, "quiet_end": None, "min_push_severity": "info", "kinds_muted": []}}

@router.patch("/prefs")
async def patch_prefs(request: Request, patch: ProactivePrefsPatch):
    user_id = request.state.user_id
    store = request.app.state.memory_manager._store
    
    prefs = await store._fetch_one("SELECT * FROM proactive_prefs WHERE user_id = ?", (user_id,))
    current = dict(prefs) if prefs else {"quiet_start": None, "quiet_end": None, "min_push_severity": "info", "kinds_muted": []}
    
    if patch.quiet_start is not None:
        current["quiet_start"] = patch.quiet_start
    if patch.quiet_end is not None:
        current["quiet_end"] = patch.quiet_end
    if patch.min_push_severity is not None:
        current["min_push_severity"] = patch.min_push_severity
    if patch.kinds_muted is not None:
        current["kinds_muted"] = patch.kinds_muted
        
    await store._execute(
        """INSERT INTO proactive_prefs (user_id, quiet_start, quiet_end, min_push_severity, kinds_muted)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
           quiet_start=excluded.quiet_start,
           quiet_end=excluded.quiet_end,
           min_push_severity=excluded.min_push_severity,
           kinds_muted=excluded.kinds_muted""",
        (user_id, current["quiet_start"], current["quiet_end"], current["min_push_severity"], json.dumps(current.get("kinds_muted", [])))
    )
    
    return {"status": "ok", "prefs": current}

@router.get("/log")
async def get_log(request: Request):
    user_id = request.state.user_id
    store = request.app.state.memory_manager._store
    
    logs = await store._fetch_all(
        "SELECT * FROM proactive_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 100",
        (user_id,)
    )
    
    result = []
    for row in logs:
        d = dict(row)
        if d.get("channels"):
            d["channels"] = json.loads(d["channels"])
        result.append(d)
        
    return {"log": result}
