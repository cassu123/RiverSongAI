"""
api/routes/dashboard.py

GET /api/dashboard  — aggregated stats for the dashboard UI.
Returns system health, memory counts, and uptime.
Per-user stats scoped by user_id query param (defaults to "default").
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request

from core.auth import decode_token

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["dashboard"])

_START_TIME = time.monotonic()
_START_WALL  = datetime.now(timezone.utc)


def _uptime_str() -> str:
    elapsed = int(time.monotonic() - _START_TIME)
    d, rem  = divmod(elapsed, 86400)
    h, rem  = divmod(rem, 3600)
    m, _    = divmod(rem, 60)
    if d:   return f"{d}d {h}h"
    if h:   return f"{h}h {m}m"
    return f"{m}m"


@router.get("/dashboard")
async def get_dashboard(request: Request, authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    user_id = payload["sub"]
    t0 = time.monotonic()

    mm = getattr(request.app.state, "memory_manager", None)

    fact_count    = 0
    summary_count = 0
    pref_count    = 0

    if mm:
        try:
            # amazonq-ignore-next-line
            facts     = await mm.get_facts(user_id)
            fact_count = len(facts)
        except (AttributeError, TypeError, ValueError) as e:
            logger.warning("Dashboard: failed to fetch facts for %s: %s", user_id, e)

        try:
            summaries     = await mm._store.get_recent_summaries(user_id, limit=9999)
            summary_count = len(summaries)
        except (AttributeError, TypeError, ValueError) as e:
            logger.warning("Dashboard: failed to fetch summaries for %s: %s", user_id, e)

        try:
            prefs      = await mm.get_preferences(user_id)
            pref_count = len(prefs)
        except (AttributeError, TypeError, ValueError) as e:
            logger.warning("Dashboard: failed to fetch preferences for %s: %s", user_id, e)

    latency_ms = round((time.monotonic() - t0) * 1000)

    return {
        "status":        "operational",
        "latency_ms":    latency_ms,
        "uptime":        _uptime_str(),
        "started_at":    _START_WALL.isoformat(),
        "memory": {
            "facts":     fact_count,
            "summaries": summary_count,
            "prefs":     pref_count,
            "today":     0,           # incremental tracking not yet wired
        },
    }
