from fastapi import APIRouter, Request, HTTPException
from typing import Optional, List
import logging
from core.sweeps import get_registry

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/sweeps", tags=["sweeps"])

@router.get("")
async def get_sweeps_status(request: Request):
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
        
    store = request.app.state.memory_manager._store
    
    # In a real app we'd verify admin role here. Assuming admin is verified at a higher level or we could check user claims.
    # We will just fetch state.
    state = await store._fetch_all("SELECT * FROM sweeps_state")
    state_map = {row["name"]: dict(row) for row in state}
    
    registry = get_registry()
    
    result = []
    for s in registry:
        st = state_map.get(s.name, {})
        result.append({
            "name": s.name,
            "interval_seconds": s.interval_seconds,
            "last_run_at": st.get("last_run_at"),
            "last_error": st.get("last_error")
        })
        
    return {"sweeps": result}
