# =============================================================================
# api/routes/health.py
#
# Health check endpoint for River Song AI.
#
# GET /health returns current system status including provider configuration
# and kill switch state. Used by monitoring tools and the frontend to verify
# the backend is reachable before attempting a conversation.
# =============================================================================

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter
from pydantic import BaseModel

from core.kill_switch import is_kill_switch_active


logger = logging.getLogger(__name__)
router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: str
    timestamp: str
    kill_switch_active: bool


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="System health check",
)
async def health_check() -> HealthResponse:
    kill_active = is_kill_switch_active()
    if kill_active:
        logger.warning("Health check called while kill switch is active.")
    return HealthResponse(
        status="kill_switch_active" if kill_active else "ok",
        timestamp=datetime.now(timezone.utc).isoformat(),
        kill_switch_active=kill_active,
    )
