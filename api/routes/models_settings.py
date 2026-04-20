# =============================================================================
# api/routes/models_settings.py
#
# File Purpose:
#   REST API endpoints for LLM model listing and per-user settings.
#   Used by the Settings page to read and write model selection, memory
#   settings, and to display cloud provider cost information.
#
# Endpoints:
#   GET  /api/models             -- full model catalog with enabled_providers map
#   GET  /api/settings/llm       -- current LLM settings for a user
#   POST /api/settings/llm       -- save LLM model selection
#   GET  /api/settings/memory    -- current memory settings for a user
#   POST /api/settings/memory    -- save memory settings
#
# Dependencies:
#   providers.llm.registry (LLMRegistry)
#   providers.memory.models (LLMSettings, MemorySettings, TTLOption)
#   core.memory_manager (accessed via request.app.state)
#   config.settings (get_settings)
# =============================================================================

from __future__ import annotations

import logging
import urllib.request
import urllib.error
import json
from typing import Optional, Set

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from config.settings import get_settings
from providers.llm.registry import LLMRegistry, ModelEntry
from providers.memory.models import LLMSettings, MemorySettings, TTLOption


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["settings"])


# =============================================================================
# Helpers
# =============================================================================

def _get_ollama_installed_models() -> Set[str]:
    """Query the local Ollama daemon for pulled model names. Returns empty set on failure."""
    try:
        settings = get_settings()
        base = getattr(settings, "ollama_base_url", "http://localhost:11434").rstrip("/")
        req = urllib.request.Request(f"{base}/api/tags", headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read())
        return {m["name"] for m in data.get("models", [])}
    except Exception:
        return set()


def _model_to_dict(m: ModelEntry, installed: Optional[Set[str]] = None) -> dict:
    available: bool
    if m.is_cloud:
        available = True  # cloud availability is gated by API key, handled separately
    elif installed is None:
        available = True  # unknown — assume available
    else:
        # Match exact name or base name without tag (e.g. "mistral:7b" matches "mistral:7b" or "mistral")
        model_base = m.model_id.split(":")[0]
        available = m.model_id in installed or any(
            n == m.model_id or n.split(":")[0] == model_base
            for n in installed
        )
    return {
        "provider":              m.provider,
        "model_id":              m.model_id,
        "display_name":          m.display_name,
        "context_window":        m.context_window,
        "is_cloud":              m.is_cloud,
        "vram_gb":               m.vram_gb,
        "cost_per_1k_input_usd": m.cost_per_1k_input_usd,
        "cost_per_1k_output_usd":m.cost_per_1k_output_usd,
        "notes":                 m.notes,
        "priority":              m.priority,
        "available":             available,
    }


def _get_enabled_providers() -> dict:
    s = get_settings()
    return {
        "anthropic":  s.anthropic_enabled  and bool(s.anthropic_api_key),
        "gemini":     s.gemini_enabled     and bool(s.gemini_api_key),
        "openai":     s.openai_enabled     and bool(s.openai_api_key),
        "mistral_ai": s.mistral_ai_enabled and bool(s.mistral_api_key),
        "ollama":     True,  # always available locally
    }


# =============================================================================
# GET /api/models
# =============================================================================

@router.get("/models")
async def list_models():
    """
    Return the LLM model catalog split into local and cloud sections.
    Local models include an `available` flag based on what Ollama has pulled.
    Cloud models include an `available` flag based on configured API keys.
    """
    installed = _get_ollama_installed_models()
    enabled   = _get_enabled_providers()

    local_models = [_model_to_dict(m, installed) for m in LLMRegistry.list_local()]
    cloud_models = [
        {**_model_to_dict(m), "available": enabled.get(m.provider, False)}
        for m in LLMRegistry.list_cloud()
    ]

    return {
        "local":             local_models,
        "cloud":             cloud_models,
        "enabled_providers": enabled,
        "ollama_reachable":  bool(installed) or True,  # True even if 0 models pulled
    }


# =============================================================================
# LLM settings
# =============================================================================

class LLMSettingsBody(BaseModel):
    provider: str
    model_id: str
    cloud_fallback_enabled: bool = False
    cloud_fallback_provider: Optional[str] = None
    cloud_fallback_model: Optional[str] = None


@router.get("/settings/llm")
async def get_llm_settings(request: Request, user_id: str = "default"):
    """Return the current LLM provider + model selection for a user."""
    memory = request.app.state.memory_manager
    s = await memory.get_llm_settings(user_id)
    return {
        "provider":               s.provider,
        "model":                  s.model,
        "cloud_fallback_enabled": s.cloud_fallback_enabled,
        "cloud_fallback_provider":s.cloud_fallback_provider,
        "cloud_fallback_model":   s.cloud_fallback_model,
    }


@router.post("/settings/llm")
async def save_llm_settings(
    request: Request,
    body: LLMSettingsBody,
    user_id: str = "default",
):
    """
    Save LLM model selection for a user.

    Validates that the provider+model exist in the registry, and that cloud
    providers are enabled before allowing selection.
    """
    entry = LLMRegistry.get(body.provider, body.model_id)
    if not entry:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown model '{body.model_id}' for provider '{body.provider}'. "
                   f"Check /api/models for valid options.",
        )

    if entry.is_cloud:
        enabled = _get_enabled_providers()
        if not enabled.get(body.provider, False):
            raise HTTPException(
                status_code=400,
                detail=f"Provider '{body.provider}' is not enabled or has no API key set. "
                       f"Set {body.provider.upper()}_ENABLED=true and {body.provider.upper()}_API_KEY in .env.",
            )

    memory = request.app.state.memory_manager
    settings = LLMSettings(
        user_id=user_id,
        provider=body.provider,
        model=body.model_id,
        cloud_fallback_enabled=body.cloud_fallback_enabled,
        cloud_fallback_provider=body.cloud_fallback_provider,
        cloud_fallback_model=body.cloud_fallback_model,
    )
    await memory.save_llm_settings(settings)
    logger.info("LLM settings saved (user=%s, provider=%s, model=%s).", user_id, body.provider, body.model_id)
    return {"status": "ok", "provider": body.provider, "model": body.model_id}


# =============================================================================
# Memory settings
# =============================================================================

class MemorySettingsBody(BaseModel):
    summaries_enabled: bool = True
    default_ttl: str = "standard"
    auto_extend: bool = True


@router.get("/settings/memory")
async def get_memory_settings(request: Request, user_id: str = "default"):
    """Return the current memory settings for a user."""
    memory = request.app.state.memory_manager
    s = await memory.get_memory_settings(user_id)
    return {
        "summaries_enabled": s.summaries_enabled,
        "default_ttl":       s.default_ttl,
        "auto_extend":       s.auto_extend,
        "ttl_options":       TTLOption.ALL,
    }


@router.post("/settings/memory")
async def save_memory_settings(
    request: Request,
    body: MemorySettingsBody,
    user_id: str = "default",
):
    """Save memory settings for a user."""
    if not TTLOption.is_valid(body.default_ttl):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid TTL '{body.default_ttl}'. Valid options: {TTLOption.ALL}",
        )

    memory = request.app.state.memory_manager
    settings = MemorySettings(
        user_id=user_id,
        summaries_enabled=body.summaries_enabled,
        default_ttl=body.default_ttl,
        auto_extend=body.auto_extend,
    )
    await memory.save_memory_settings(settings)
    logger.info("Memory settings saved (user=%s).", user_id)
    return {"status": "ok"}
