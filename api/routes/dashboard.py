"""
api/routes/dashboard.py

GET /api/dashboard  — aggregated stats for the dashboard UI.
Returns system health, memory counts, and uptime.
Per-user stats scoped by user_id query param (defaults to "default").
"""

from __future__ import annotations

import time
from datetime import datetime, timezone

from fastapi import APIRouter, Request

router = APIRouter(prefix="/api", tags=["dashboard"])

# Recorded once at import time — good enough for uptime display
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
async def get_dashboard(request: Request, user_id: str = "default"):
    """
    Aggregate dashboard stats in a single request.
    Measures its own response latency for the latency tile.
    """
    t0 = time.monotonic()

    mm = getattr(request.app.state, "memory_manager", None)

    fact_count    = 0
    summary_count = 0
    pref_count    = 0

    if mm:
        try:
            facts     = await mm.get_facts(user_id)
            fact_count = len(facts)
        except Exception:
            pass

        try:
            summaries     = await mm._store.get_recent_summaries(user_id, limit=9999)
            summary_count = len(summaries)
        except Exception:
            pass

        try:
            prefs      = await mm.get_preferences(user_id)
            pref_count = len(prefs)
        except Exception:
            pass

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
