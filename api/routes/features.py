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

from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request

from core.auth import decode_token

router = APIRouter(prefix="/api", tags=["features"])

# Canonical feature catalog — keys must match nav item keys in Sidebar.jsx
ALL_FEATURES = [
    {"key": "speak",       "label": "Speak (Voice Conversation)"},
    {"key": "chat",        "label": "Chat"},
    {"key": "memory",      "label": "Memory"},
    {"key": "inventory",   "label": "Inventory"},
    {"key": "maintenance", "label": "Maintenance Pulse"},
    {"key": "commerce",    "label": "Store"},
    {"key": "culinary",    "label": "Culinary"},
    {"key": "feeds",       "label": "Feeds"},
    {"key": "google",      "label": "Google"},
    {"key": "reading",     "label": "Reading Shelf"},
    {"key": "links",       "label": "Links"},
    {"key": "dashboard",   "label": "Dashboard"},
    {"key": "routines",    "label": "Routines"},
    {"key": "home",        "label": "Home Node"},
    {"key": "analytics",   "label": "Analytics"},
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
}

from pydantic import BaseModel
class FeatureUpdateBody(BaseModel):
    enabled: bool

@router.get("/features")
async def get_features(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")

    role    = payload.get("role", "user")
    user_id = payload.get("sub")

    from config.settings import get_settings
    settings = get_settings()
    
    ai_features = {
        key: getattr(settings, attr, False)
        for key, attr in AI_FEATURE_MAP.items()
    }

    # Admin always sees everything
    if role == "admin":
        return {"features": ALL_FEATURE_KEYS, "ai_features": ai_features}

    store  = request.app.state.memory_manager._store
    config = await store.get_admin_config()
    hidden = set(config.get("hidden_features", []))
    globally_on = [k for k in ALL_FEATURE_KEYS if k not in hidden]

    if role == "child":
        child_features = await store.get_child_features(user_id)
        allowed = set(globally_on) & set(child_features)
        return {"features": [k for k in ALL_FEATURE_KEYS if k in allowed], "ai_features": ai_features}

    # parent or user
    return {"features": globally_on, "ai_features": ai_features}


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
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = decode_token(authorization.removeprefix("Bearer "))
    if not payload or payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only admins can toggle global AI features.")

    if flag_name not in AI_FEATURE_MAP:
        raise HTTPException(status_code=400, detail=f"Unknown AI feature flag: {flag_name}")

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
    logging.getLogger(__name__).info("Admin toggled AI feature %s to %s", flag_name, body.enabled)
    
    return {"flag": flag_name, "enabled": body.enabled}
