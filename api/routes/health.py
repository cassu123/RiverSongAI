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
import platform
import sys
from datetime import datetime, timezone

from fastapi import APIRouter
from pydantic import BaseModel

from config.settings import get_settings
from core.kill_switch import is_kill_switch_active


logger = logging.getLogger(__name__)
router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    """Response schema for the health check endpoint."""

    status: str
    timestamp: str
    kill_switch_active: bool
    stt_provider: str
    llm_provider: str
    tts_provider: str
    python_version: str
    platform: str


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="System health check",
    description=(
        "Returns the current status of the River Song AI backend, including "
        "active provider configuration and kill switch state. A status of "
        "'kill_switch_active' means conversation turns will be blocked until "
        "the kill switch is reset and the system is restarted."
    ),
)
async def health_check() -> HealthResponse:
    """
    Return the current health status of the River Song AI backend.

    Returns:
        HealthResponse: Status, timestamp, provider info, and kill switch state.
    """
    settings = get_settings()
    kill_active = is_kill_switch_active()

    if kill_active:
        logger.warning("Health check called while kill switch is active.")

    return HealthResponse(
        status="kill_switch_active" if kill_active else "ok",
        timestamp=datetime.now(timezone.utc).isoformat(),
        kill_switch_active=kill_active,
        stt_provider=settings.stt_provider,
        llm_provider=settings.llm_provider,
        tts_provider=settings.tts_provider,
        python_version=sys.version,
        platform=platform.platform(),
    )
