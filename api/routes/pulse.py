"""
api/routes/pulse.py

Pulse dashboard data — three ambient feeds (news/markets/flights).
"""
import logging
from typing import Optional, Any
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel

from core.auth import decode_token
from config.settings import get_settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/pulse", tags=["pulse"])


async def _require_user(
        authorization: Optional[str] = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return payload["sub"]


def _require_daemon_secret(
        authorization: Optional[str] = Header(default=None)) -> None:
    """Internal-only auth using the daemon shared secret."""
    settings = get_settings()
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    token = authorization.removeprefix("Bearer ")
    if token != settings.daemon_internal_secret:
        raise HTTPException(status_code=403, detail="Forbidden")


class SnapshotBody(BaseModel):
    source: str
    data: Any
    ts: float


@router.get("/latest")
async def get_latest(request: Request,
                     user_id: str = Depends(_require_user)) -> dict:
    """Return the latest snapshot per source."""
    store = request.app.state.memory_manager._store
    news = await store.get_latest_pulse_snapshot("news")
    markets = await store.get_latest_pulse_snapshot("markets")
    flights = await store.get_latest_pulse_snapshot("flights")
    config = await store.get_admin_config()
    pulse_news_enabled = config.get("pulse_news_enabled", True)
    pulse_markets_enabled = config.get("pulse_markets_enabled", True)
    pulse_flights_enabled = config.get("pulse_flights_enabled", True)

    return {
        "news": news["data"] if news and pulse_news_enabled else None,
        "markets": markets["data"] if markets and pulse_markets_enabled else None,
        "flights": flights["data"] if flights and pulse_flights_enabled else None,
        "ts": {
            "news": news["ts"] if news and pulse_news_enabled else None,
            "markets": markets["ts"] if markets and pulse_markets_enabled else None,
            "flights": flights["ts"] if flights and pulse_flights_enabled else None,
        },
    }


# Internal — called by the Pulse daemon over HTTP loopback.
@router.post("/_internal/snapshot")
async def _save_snapshot(
    body: SnapshotBody,
    request: Request,
    authorization: Optional[str] = Header(None)
) -> dict:
    _require_daemon_secret(authorization)
    store = request.app.state.memory_manager._store
    await store.save_pulse_snapshot(body.source, body.data)
    return {"saved": True}


@router.post("/_internal/prune")
async def _prune_all(
    request: Request,
    authorization: Optional[str] = Header(None)
) -> dict:
    _require_daemon_secret(authorization)
    store = request.app.state.memory_manager._store
    total = 0
    for source in ("news", "markets", "flights"):
        total += await store.prune_pulse_snapshots(source, keep=100)
    return {"pruned": total}
