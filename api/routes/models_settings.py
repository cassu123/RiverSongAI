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

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

from config.settings import get_settings
from core.auth import decode_token
from providers.llm.registry import LLMRegistry, ModelEntry
from providers.memory.models import LLMSettings, MemorySettings, TTLOption


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["settings"])


# =============================================================================
# Helpers
# =============================================================================

_OLLAMA_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def _get_ollama_installed_models() -> Set[str]:
    """Query the local Ollama daemon for pulled model names. Returns empty set on failure."""
    try:
        settings = get_settings()
        base = getattr(settings, "ollama_base_url", "http://localhost:11434").rstrip("/")
        from urllib.parse import urlparse
        parsed = urlparse(base)
        if parsed.scheme == "http" and parsed.hostname not in _OLLAMA_LOCAL_HOSTS:
            raise ValueError(
                f"Insecure HTTP connection to remote Ollama host '{parsed.hostname}' is not allowed. "
                "Use HTTPS or restrict OLLAMA_BASE_URL to localhost."
            )
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
        "bedrock":    s.bedrock_enabled    and bool(s.aws_access_key_id) and bool(s.aws_secret_access_key),
        "ollama":     True,
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


def _require_user(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    return payload["sub"]


@router.get("/settings/llm")
async def get_llm_settings(request: Request, authorization: Optional[str] = Header(default=None)):
    """Return the current LLM provider + model selection for a user."""
    user_id = _require_user(authorization)
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
    authorization: Optional[str] = Header(default=None),
):
    user_id = _require_user(authorization)
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
    _strip = lambda s: str(s).replace("\r", "").replace("\n", "").replace("\t", "")
    logger.info("LLM settings saved (user=%s, provider=%s, model=%s).", _strip(user_id), _strip(body.provider), _strip(body.model_id))
    return {"status": "ok", "provider": body.provider, "model": body.model_id}


# =============================================================================
# Memory settings
# =============================================================================

class MemorySettingsBody(BaseModel):
    summaries_enabled: bool = True
    default_ttl: str = "standard"
    auto_extend: bool = True


@router.get("/settings/memory")
async def get_memory_settings(request: Request, authorization: Optional[str] = Header(default=None)):
    """Return the current memory settings for a user."""
    user_id = _require_user(authorization)
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
    authorization: Optional[str] = Header(default=None),
):
    user_id = _require_user(authorization)
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
    logger.info("Memory settings saved (user=%s).", str(user_id).replace("\r", "").replace("\n", "").replace("\t", ""))
    return {"status": "ok"}


# =============================================================================
# Voice / TTS settings
# =============================================================================

@router.get("/settings/voice")
async def get_voice_settings(authorization: Optional[str] = Header(default=None)):
    """
    Return the active TTS provider info and list of available Piper voice models
    found in the configured model directory.
    """
    _require_user(authorization)
    settings = get_settings()

    provider   = settings.tts_provider          # "piper" | "none"
    model_path = settings.piper_model_path       # full path to active .onnx

    # Scan the model directory for installed Piper voices
    import os
    model_dir = os.path.dirname(model_path) if model_path else ""
    available_voices: list[dict] = []

    if model_dir and os.path.isdir(model_dir):
        for fname in sorted(os.listdir(model_dir)):
            if not fname.endswith(".onnx"):
                continue
            full = os.path.join(model_dir, fname)
            # Parse a human-readable name from the filename
            # e.g. "en_US-lessac-medium.onnx" → "Lessac Medium (en-US)"
            stem = fname.removesuffix(".onnx")
            parts = stem.split("-")          # ["en_US", "lessac", "medium"]
            lang   = parts[0].replace("_", "-") if parts else stem
            name   = " ".join(p.capitalize() for p in parts[1:]) if len(parts) > 1 else stem
            available_voices.append({
                "path":   full,
                "name":   f"{name} ({lang})",
                "lang":   lang,
                "active": full == model_path,
            })

    # Derive a display name for the active voice
    active_name = "Unknown"
    for v in available_voices:
        if v["active"]:
            active_name = v["name"]
            break
    if not available_voices and model_path:
        stem = os.path.basename(model_path).removesuffix(".onnx")
        parts = stem.split("-")
        lang  = parts[0].replace("_", "-") if parts else stem
        name  = " ".join(p.capitalize() for p in parts[1:]) if len(parts) > 1 else stem
        active_name = f"{name} ({lang})"

    return {
        "provider":       provider,
        "active_voice":   active_name,
        "active_path":    model_path,
        "available":      available_voices,
        "provider_label": {
            "piper": "Piper (local, zero-latency)",
            "none":  "Disabled",
        }.get(provider, provider),
    }
