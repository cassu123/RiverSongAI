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
    Return the active TTS provider, the full voice registry, and which voices
    are installed on disk. Uses the curated VoiceRegistry display names.
    """
    _require_user(authorization)
    settings   = get_settings()
    provider   = settings.tts_provider
    model_path = settings.piper_model_path

    from providers.tts.voice_registry import VoiceRegistry
    import os

    model_dir       = os.path.dirname(model_path) if model_path else ""
    active_voice_id = getattr(settings, "active_voice_id", "") or ""

    # Build the voice list from the registry, annotating installed/active status
    voices = []
    for entry in VoiceRegistry.list_all():
        if entry.engine == "kokoro":
            # Kokoro voices: available only if the kokoro package is importable.
            # kokoro requires Python <3.13; mark unavailable on Python 3.13+.
            try:
                import kokoro  # noqa: F401
                installed = True
            except ImportError:
                installed = False
            path = None
        else:
            # Piper voices: check for the .onnx file on disk
            installed_path = os.path.join(model_dir, entry.filename) if model_dir and entry.filename else ""
            installed = bool(installed_path and os.path.exists(installed_path))
            path      = installed_path if installed else None

        active = entry.voice_id == active_voice_id

        voices.append({
            "voice_id":    entry.voice_id,
            "display_name":entry.display_name,
            "engine":      entry.engine,
            "filename":    entry.filename,
            "lang":        entry.lang,
            "accent":      entry.accent,
            "gender":      entry.gender,
            "quality":     entry.quality,
            "size_mb":     entry.size_mb,
            "description": entry.description,
            "default":     entry.default,
            "installed":   installed,
            "active":      active,
            "path":        path,
        })

    active_entry   = next((v for v in voices if v["active"]), None)
    active_name    = active_entry["display_name"] if active_entry else (active_voice_id or "None")
    active_engine  = active_entry["engine"] if active_entry else provider
    provider_labels = {
        "piper":  "Piper (local binary)",
        "kokoro": "Kokoro (neural, CPU)",
        "none":   "Disabled",
    }

    return {
        "provider":        active_engine,
        "provider_label":  provider_labels.get(active_engine, active_engine),
        "active_voice":    active_name,
        "active_path":     model_path,
        "active_voice_id": active_voice_id,
        "voices":          voices,
    }


class VoiceSwitchBody(BaseModel):
    voice_id: str


@router.post("/settings/voice")
async def set_active_voice(
    body: VoiceSwitchBody,
    authorization: Optional[str] = Header(default=None),
):
    """
    Switch the active voice by writing ACTIVE_VOICE_ID (and PIPER_MODEL_PATH
    for Piper voices) to .env.  Kokoro voices need no file check — the model
    auto-downloads on first use.
    """
    _require_user(authorization)
    settings = get_settings()

    from providers.tts.voice_registry import VoiceRegistry
    import os
    import re

    entry = VoiceRegistry.get(body.voice_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Unknown voice ID: {body.voice_id}")

    # Piper voices need the .onnx file to be present
    if entry.engine == "piper":
        model_dir = os.path.dirname(settings.piper_model_path) if settings.piper_model_path else ""
        if not model_dir:
            raise HTTPException(status_code=500, detail="PIPER_MODEL_PATH not configured.")
        new_piper_path = os.path.join(model_dir, entry.filename)
        if not os.path.exists(new_piper_path):
            raise HTTPException(
                status_code=404,
                detail=f"{entry.display_name} is not installed. "
                       f"Run: python scripts/download_voices.py {entry.voice_id}",
            )
    else:
        new_piper_path = None  # Kokoro doesn't use a file path

    # Rewrite .env
    env_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env"
    )
    if not os.path.exists(env_path):
        raise HTTPException(status_code=500, detail=".env file not found.")

    with open(env_path, "r") as f:
        content = f.read()

    def _replace_or_append(text: str, key: str, value: str) -> str:
        pattern     = rf"^{re.escape(key)}=.*$"
        replacement = f"{key}={value}"
        updated = re.sub(pattern, replacement, text, flags=re.MULTILINE)
        if updated == text and replacement not in text:
            updated = text.rstrip() + f"\n{replacement}\n"
        return updated

    content = _replace_or_append(content, "ACTIVE_VOICE_ID", entry.voice_id)
    if new_piper_path:
        content = _replace_or_append(content, "PIPER_MODEL_PATH", new_piper_path)

    tmp = env_path + ".tmp"
    with open(tmp, "w") as f:
        f.write(content)
    os.replace(tmp, env_path)

    logger.info("Voice switched to %s (%s) [%s]", entry.display_name, entry.voice_id, entry.engine)
    return {
        "ok":           True,
        "voice_id":     entry.voice_id,
        "display_name": entry.display_name,
        "engine":       entry.engine,
        "note":         "Restart the service for the new voice to take effect.",
    }


# =============================================================================
# Voice preview — synthesize a voice's intro phrase and return WAV base64
# =============================================================================

@router.get("/tts/preview/{voice_id}")
async def preview_voice(
    voice_id: str,
    authorization: Optional[str] = Header(default=None),
):
    """
    Synthesize the preview phrase for a given voice and return it as
    base64-encoded WAV audio. The frontend plays this directly in the browser.
    Works for both Piper (if installed) and Kokoro voices.
    """
    _require_user(authorization)

    from providers.tts.voice_registry import VoiceRegistry
    import base64
    import os

    entry = VoiceRegistry.get(voice_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Unknown voice ID: {voice_id}")

    settings = get_settings()

    # Build a temporary provider for this specific voice
    try:
        if entry.engine == "kokoro":
            from providers.tts.kokoro_provider import KokoroTTS
            provider = KokoroTTS(voice_code=entry.voice_code)

        elif entry.engine == "piper":
            model_dir = os.path.dirname(settings.piper_model_path) if settings.piper_model_path else ""
            if not model_dir:
                raise HTTPException(status_code=503, detail="PIPER_MODEL_PATH not configured.")
            model_path = os.path.join(model_dir, entry.filename)
            if not os.path.exists(model_path):
                raise HTTPException(
                    status_code=404,
                    detail=f"{entry.display_name} is not installed. "
                           f"Run: python scripts/download_voices.py {entry.voice_id}",
                )
            from providers.tts.piper import PiperTTS
            # Override the model path for this preview only
            provider = PiperTTS(model_path_override=model_path)

        else:
            raise HTTPException(status_code=400, detail=f"Unsupported engine: {entry.engine}")

        wav_bytes = await provider.synthesize(entry.preview_text)

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Voice preview failed for %s: %s", voice_id, exc)
        raise HTTPException(status_code=502, detail=f"Synthesis failed: {exc}")

    if not wav_bytes:
        raise HTTPException(status_code=502, detail="No audio produced.")

    return {
        "voice_id":    entry.voice_id,
        "display_name":entry.display_name,
        "preview_text":entry.preview_text,
        "audio_b64":   base64.b64encode(wav_bytes).decode("ascii"),
    }
