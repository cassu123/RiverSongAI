# =============================================================================
# api/routes/features.py
#
# Endpoints:
#   GET /api/features  -- returns enabled feature keys for the current user
#
# Permission cascade (3 layers):
#   Admin          → always sees all features
#   Parent / User  → sees features not globally hidden by admin
#   Child          → sees features both globally enabled AND parent-approved
# =============================================================================

from __future__ import annotations
from pydantic import BaseModel

from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request

from core.auth import decode_token

router = APIRouter(prefix="/api", tags=["features"])

# Canonical feature catalog — keys must match the nav item keys in
# frontend/src/utils/constants.js (NAV_GROUPS). A drawer entry whose key is
# absent here AND absent from ALWAYS_VISIBLE can never be enabled for a
# non-admin, so the two lists have to be kept in step.
ALL_FEATURES = [
    {"key": "speak", "label": "Speaking"},
    {"key": "chat", "label": "Chat"},
    {"key": "memory", "label": "Memory"},
    {"key": "inventory", "label": "Stash"},
    {"key": "vehicles", "label": "Garage"},
    {"key": "commerce", "label": "Store"},
    {"key": "culinary", "label": "Kitchen"},
    {"key": "feeds", "label": "Feeds"},
    {"key": "google", "label": "Google"},
    {"key": "chronos", "label": "Notes"},
    {"key": "dashboard", "label": "Dashboard"},
    {"key": "briefing", "label": "Briefing"},
    {"key": "routines", "label": "Routines"},
    {"key": "home", "label": "Home Node"},
    {"key": "analytics", "label": "Analytics"},
    {"key": "reading", "label": "Reading"},
    {"key": "environment", "label": "Environment"},
]
ALL_FEATURE_KEYS = [f["key"] for f in ALL_FEATURES]

# Local AI Features (Phase 1-10)
AI_FEATURE_MAP = {
    "SEMANTIC_MEMORY_ENABLED": "semantic_memory_enabled",
    "VISION_ENABLED": "vision_enabled",
    "IMAGE_GENERATION_ENABLED": "image_generation_enabled",
    "RAG_ENABLED": "rag_enabled",
    "LLM_STREAMING_ENABLED": "llm_streaming_enabled",
    "CHATTERBOX_ENABLED": "chatterbox_enabled",
    "WAKE_WORD_ENABLED": "wake_word_enabled",
    "WAKE_WORD_MODEL": "wake_word_model",
    "WAKE_WORD_THRESHOLD": "wake_word_threshold",
    "CAD_ENABLED": "cad_enabled",
    "SANDBOX_ENABLED": "sandbox_enabled",
}


class FeatureUpdateBody(BaseModel):
    enabled: bool


async def _get_auth_payload(request: Request, authorization: Optional[str]) -> dict:
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        parts = authorization.split(" ", 1)
        if len(parts) > 1:
            token = parts[1].strip()
    if not token and request:
        token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = await decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    return payload


@router.get("/features")
async def get_features(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    payload = await _get_auth_payload(request, authorization)
    role = payload.get("role", "user")
    user_id = payload.get("sub")

    from config.settings import get_settings
    settings = get_settings()

    ai_features = {
        key: getattr(settings, attr, False)
        for key, attr in AI_FEATURE_MAP.items()
    }

    # "catalog" is every key this endpoint knows how to gate, regardless of
    # whether it is on for this user. The client needs it to tell "disabled"
    # apart from "not a gated page at all" — without it, an uncatalogued page
    # is indistinguishable from a switched-off one.
    catalog = list(ALL_FEATURE_KEYS)

    # Admin always sees everything
    if role == "admin":
        return {
            "features": ALL_FEATURE_KEYS,
            "catalog": catalog,
            "ai_features": ai_features,
        }

    store = request.app.state.memory_manager._store
    config = await store.get_admin_config()
    hidden = set(config.get("hidden_features", []))
    globally_on = [k for k in ALL_FEATURE_KEYS if k not in hidden]

    if role == "child":
        child_features = await store.get_child_features(user_id)
        allowed = set(globally_on) & set(child_features)
        return {
            "features": [k for k in ALL_FEATURE_KEYS if k in allowed],
            "catalog": catalog,
            "ai_features": ai_features,
        }

    # parent or user
    return {
        "features": globally_on,
        "catalog": catalog,
        "ai_features": ai_features,
    }


@router.put("/features/{flag_name}")
async def update_feature_flag(
    flag_name: str,
    body: FeatureUpdateBody,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """
    Update a global AI feature flag.
    Requires admin role as these affect the entire server.
    """
    payload = await _get_auth_payload(request, authorization)
    if payload.get("role") != "admin":
        raise HTTPException(
            status_code=403,
            detail="Only admins can toggle global AI features.")

    if flag_name not in AI_FEATURE_MAP:
        raise HTTPException(status_code=400,
                            detail=f"Unknown AI feature flag: {flag_name}")

    attr = AI_FEATURE_MAP[flag_name]
    from config.settings import get_settings
    settings = get_settings()

    # Update in-memory settings
    setattr(settings, attr, body.enabled)

    # Persist to admin_config so it survives restart
    store = request.app.state.memory_manager._store
    config = await store.get_admin_config()
    ai_config = config.get("ai_features", {})
    ai_config[flag_name] = body.enabled
    config["ai_features"] = ai_config
    await store.set_admin_config(config)

    import logging
    logging.getLogger(__name__).info(
        "Admin toggled AI feature %s to %s",
        flag_name,
        body.enabled)

    return {"flag": flag_name, "enabled": body.enabled}
