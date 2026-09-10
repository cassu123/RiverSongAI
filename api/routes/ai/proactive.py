"""
api/routes/proactive.py

Per-user preferences and delivery log for proactive notifications.

Two things were wrong here and they hid each other. The router carried no
prefix, so it mounted at `/prefs` and `/log` while every caller in the
frontend asks for `/api/proactive/prefs` and `/api/proactive/log` — a 404 on
all three pages that use it. And the handlers read `request.state.user_id`,
which nothing in this application sets, so even at the right path they would
have raised before reaching the query. Both are fixed below: the prefix
matches the callers, and the user comes from the authenticated token rather
than from request state that no middleware populates.
"""

import json
import logging
from typing import List, Optional, Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from core.auth import require_role

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/proactive", tags=["proactive"])

_DEFAULT_PREFS = {
    "quiet_start": None,
    "quiet_end": None,
    "min_push_severity": "info",
    "kinds_muted": [],
}


class ProactivePrefsPatch(BaseModel):
    quiet_start: Optional[int] = Field(default=None, ge=0, le=23)
    quiet_end: Optional[int] = Field(default=None, ge=0, le=23)
    min_push_severity: Optional[Literal["debug", "info", "warning", "critical"]] = None
    kinds_muted: Optional[List[str]] = None


def _store(request: Request):
    return request.app.state.memory_manager._store


async def _load_prefs(request: Request, user_id: str) -> dict:
    row = await _store(request).execute_read_one_async(
        "SELECT * FROM proactive_prefs WHERE user_id = ?", (user_id,)
    )
    if not row:
        return dict(_DEFAULT_PREFS)
    prefs = dict(row)
    prefs.pop("user_id", None)
    raw = prefs.get("kinds_muted")
    try:
        prefs["kinds_muted"] = json.loads(raw) if raw else []
    except (TypeError, ValueError):
        prefs["kinds_muted"] = []
    return prefs


@router.get("/prefs")
async def get_prefs(request: Request, user: dict = Depends(require_role())):
    return {"prefs": await _load_prefs(request, user["sub"])}


@router.patch("/prefs")
async def patch_prefs(
    request: Request,
    patch: ProactivePrefsPatch,
    user: dict = Depends(require_role()),
):
    user_id = user["sub"]
    current = await _load_prefs(request, user_id)

    for field in ("quiet_start", "quiet_end", "min_push_severity", "kinds_muted"):
        value = getattr(patch, field)
        if value is not None:
            current[field] = value

    await _store(request).execute_write_async(
        """INSERT INTO proactive_prefs (user_id, quiet_start, quiet_end, min_push_severity, kinds_muted)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
           quiet_start=excluded.quiet_start,
           quiet_end=excluded.quiet_end,
           min_push_severity=excluded.min_push_severity,
           kinds_muted=excluded.kinds_muted""",
        (
            user_id,
            current["quiet_start"],
            current["quiet_end"],
            current["min_push_severity"],
            json.dumps(current.get("kinds_muted", [])),
        ),
    )

    return {"status": "ok", "prefs": current}


@router.get("/log")
async def get_log(request: Request, user: dict = Depends(require_role())):
    rows = await _store(request).execute_read_async(
        "SELECT * FROM proactive_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 100",
        (user["sub"],),
    )

    result = []
    for row in rows:
        entry = dict(row)
        raw = entry.get("channels")
        try:
            entry["channels"] = json.loads(raw) if raw else []
        except (TypeError, ValueError):
            entry["channels"] = []
        result.append(entry)

    return {"log": result}
