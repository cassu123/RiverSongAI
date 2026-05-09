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
import asyncio
import time
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Request
from pydantic import BaseModel

from core.kill_switch import is_kill_switch_active
from config.settings import get_settings


logger = logging.getLogger(__name__)
router = APIRouter(tags=["health"])

# Global start time for uptime calculation
START_TIME = time.time()

class OllamaHealth(BaseModel):
    reachable: bool
    active_model: Optional[str] = None
    response_time_ms: Optional[int] = None

class ProviderHealth(BaseModel):
    stt: str
    stt_model: str
    tts: str
    active_voice: str
    llm: str
    llm_model: str

class MemoryHealth(BaseModel):
    fact_count: int
    habit_count: int

class HealthResponse(BaseModel):
    status: str
    timestamp: str
    kill_switch_active: bool
    uptime_seconds: int
    ollama: OllamaHealth
    providers: ProviderHealth
    memory: MemoryHealth
    push_notifications_enabled: bool
    last_briefing: Optional[str] = None


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="System health check",
)
async def health_check(request: Request) -> HealthResponse:
    settings = get_settings()
    kill_active = is_kill_switch_active()
    
    status = "ok"
    if kill_active:
        status = "kill_switch_active"
        logger.warning("Health check called while kill switch is active.")

    # 1. Ollama Health
    ollama_reachable = False
    active_model = None
    response_time = None
    
    try:
        start = time.time()
        async with httpx.AsyncClient() as client:
            resp = await client.get(settings.ollama_base_url, timeout=2.0)
            if resp.status_code == 200:
                ollama_reachable = True
                response_time = int((time.time() - start) * 1000)
                
                # Try to get active models
                tags_resp = await client.get(f"{settings.ollama_base_url}/api/tags", timeout=1.0)
                if tags_resp.status_code == 200:
                    models = tags_resp.json().get("models", [])
                    if models:
                        active_model = models[0].get("name")
    except Exception as exc:
        logger.debug("Ollama health check failed: %s", exc)
        status = "degraded"

    # 2. Providers
    providers = ProviderHealth(
        stt="whisper_local",  # Fixed for now
        stt_model=settings.whisper_model,
        tts=settings.tts_provider,
        active_voice=settings.tts_voice_id,
        llm="ollama", # Primary
        llm_model=settings.llm_model
    )

    # 3. Memory & Last Briefing
    fact_count = 0
    habit_count = 0
    last_briefing = None
    
    mm = getattr(request.app.state, "memory_manager", None)
    if mm:
        try:
            store = mm._store
            user_id = "primary_user" # Default
            
            # These might be expensive if tables are huge, but fine for now
            facts = await store.get_facts(user_id)
            fact_count = len(facts)
            
            prefs = await store.get_preferences(user_id)
            habit_count = len(prefs)
            
            routines = await store.list_routines(user_id)
            if routines:
                # Find most recent last_run
                runs = [r["last_run"] for r in routines if r.get("last_run")]
                if runs:
                    last_briefing = max(runs)
        except Exception as exc:
            logger.warning("Memory health check failed: %s", exc)

    return HealthResponse(
        status=status,
        timestamp=datetime.now(timezone.utc).isoformat(),
        kill_switch_active=kill_active,
        uptime_seconds=int(time.time() - START_TIME),
        ollama=OllamaHealth(
            reachable=ollama_reachable,
            active_model=active_model,
            response_time_ms=response_time
        ),
        providers=providers,
        memory=MemoryHealth(
            fact_count=fact_count,
            habit_count=habit_count
        ),
        push_notifications_enabled=settings.push_notifications_enabled,
        last_briefing=last_briefing
    )
