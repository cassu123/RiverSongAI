"""
api/routes/sweeps.py

Read-only status for the background sweep scheduler: what is registered, how
often it runs, when each last ran and whether it failed.

Admin-only. The previous gate read `request.state.user_id`, which nothing in
this application ever sets — so the check was simultaneously the only thing
standing between a stranger and the scheduler's internals, and permanently
closed. It is now the same `require_role("admin")` dependency every other
admin route uses.
"""

import logging

from fastapi import APIRouter, Depends, Request

from core.auth import require_role
from core.sweeps import get_registry

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/sweeps", tags=["sweeps"])


@router.get("", dependencies=[Depends(require_role("admin"))])
async def get_sweeps_status(request: Request):
    store = request.app.state.memory_manager._store
    state_map = {row["name"]: row for row in await store.get_sweep_states()}

    return {
        "sweeps": [
            {
                "name": s.name,
                "interval_seconds": s.interval_seconds,
                "last_run_at": state_map.get(s.name, {}).get("last_run_at"),
                "last_error": state_map.get(s.name, {}).get("last_error"),
            }
            for s in get_registry()
        ]
    }
