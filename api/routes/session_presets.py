"""
api/routes/session_presets.py

Q2#9 — Session presets. Saved combinations of (model, voice, thinking,
web_search, tool_use, system_prompt_addendum) that the user can switch
between from the Conversation / Chat pages.

Flag-gated by settings.session_presets_enabled (default OFF). Routes
return 404 when off.

Endpoints:
  GET    /api/presets                       — list current user's presets
  POST   /api/presets                       — create a preset
  PUT    /api/presets/{preset_id}           — update a preset
  DELETE /api/presets/{preset_id}           — delete a preset
  POST   /api/presets/{preset_id}/apply     — apply preset to active LLM
                                              settings (provider, model,
                                              voice_id). Returns the
                                              persisted llm settings.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Header, Request
from pydantic import BaseModel, Field

from config.settings import get_settings
from core.auth import decode_token
from core.errors import bad_request, not_found, unauthorized

router = APIRouter(prefix="/api/presets", tags=["presets"])


# -----------------------------------------------------------------------------
# Schemas
# -----------------------------------------------------------------------------

class PresetConfig(BaseModel):
    """All fields optional — preset can specialise any subset."""
    provider:                Optional[str]  = None
    model:                   Optional[str]  = None
    voice_id:                Optional[str]  = None
    thinking_mode:           Optional[str]  = None  # off | thinking | pro
    web_search:              Optional[bool] = None
    tool_use_enabled:        Optional[bool] = None
    system_prompt_addendum:  Optional[str]  = None


class PresetCreate(BaseModel):
    name:   str = Field(..., min_length=1, max_length=80)
    config: PresetConfig = Field(default_factory=PresetConfig)


class PresetUpdate(BaseModel):
    name:       Optional[str]          = Field(default=None, min_length=1, max_length=80)
    config:     Optional[PresetConfig] = None
    is_default: Optional[bool]         = None


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

def _require_enabled() -> None:
    if not getattr(get_settings(), "session_presets_enabled", False):
        raise not_found("Session presets are disabled.")


async def _require_user(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise unauthorized("Not authenticated.")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise unauthorized("Invalid or expired token.")
    return payload["sub"]


def _store(request: Request):
    mm = getattr(request.app.state, "memory_manager", None)
    if mm is None or getattr(mm, "_store", None) is None:
        raise not_found("Preset store not available.")
    return mm._store


def _config_dict(cfg: Optional[PresetConfig]) -> Dict[str, Any]:
    if cfg is None:
        return {}
    return cfg.model_dump(exclude_none=True)


# -----------------------------------------------------------------------------
# Routes
# -----------------------------------------------------------------------------

@router.get("")
async def list_presets(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    _require_enabled()
    user_id = await _require_user(authorization)
    presets = await _store(request).list_presets(user_id)
    return {"presets": presets}


@router.post("", status_code=201)
async def create_preset(
    body: PresetCreate,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    _require_enabled()
    user_id = await _require_user(authorization)
    store   = _store(request)

    cap = int(getattr(get_settings(), "session_presets_max_per_user", 30))
    count = await store.count_presets(user_id)
    if count >= cap:
        raise bad_request(f"Preset cap reached ({cap}). Delete one to add another.")

    preset = await store.create_preset(user_id, body.name.strip(), _config_dict(body.config))
    return preset


@router.put("/{preset_id}")
async def update_preset(
    preset_id: str,
    body: PresetUpdate,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    _require_enabled()
    user_id = await _require_user(authorization)
    name = body.name.strip() if body.name is not None else None
    cfg  = _config_dict(body.config) if body.config is not None else None
    updated = await _store(request).update_preset(
        user_id, preset_id, name=name, config=cfg, is_default=body.is_default,
    )
    if updated is None:
        raise not_found("Preset not found.")
    return updated


@router.delete("/{preset_id}", status_code=204)
async def delete_preset(
    preset_id: str,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    _require_enabled()
    user_id = await _require_user(authorization)
    ok = await _store(request).delete_preset(user_id, preset_id)
    if not ok:
        raise not_found("Preset not found.")


@router.post("/{preset_id}/apply")
async def apply_preset(
    preset_id: str,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """
    Apply the preset to the user's persisted LLM settings (provider,
    model, voice_id). Non-persistent fields (thinking_mode, web_search,
    tool_use_enabled, system_prompt_addendum) are returned for the
    client to apply session-local.
    """
    _require_enabled()
    user_id = await _require_user(authorization)
    store   = _store(request)
    mm      = request.app.state.memory_manager

    preset = await store.get_preset(user_id, preset_id)
    if preset is None:
        raise not_found("Preset not found.")

    cfg = preset.get("config") or {}

    # Persist the subset that maps to LLMSettings.
    current = await store.get_llm_settings(user_id)
    if cfg.get("provider"): current.provider = cfg["provider"]
    if cfg.get("model"):    current.model    = cfg["model"]
    if cfg.get("voice_id"): current.voice_id = cfg["voice_id"]
    await store.save_llm_settings(current)

    return {
        "applied":         True,
        "preset_id":       preset_id,
        "persisted":       {
            "provider": current.provider,
            "model":    current.model,
            "voice_id": current.voice_id,
        },
        "session_overlay": {
            k: v for k, v in cfg.items()
            if k in {"thinking_mode", "web_search", "tool_use_enabled", "system_prompt_addendum"}
        },
    }
