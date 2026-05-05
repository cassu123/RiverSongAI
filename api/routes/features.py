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

    # Admin always sees everything
    if role == "admin":
        return {"features": ALL_FEATURE_KEYS}

    store  = request.app.state.memory_manager._store
    config = await store.get_admin_config()
    hidden = set(config.get("hidden_features", []))
    globally_on = [k for k in ALL_FEATURE_KEYS if k not in hidden]

    if role == "child":
        child_features = await store.get_child_features(user_id)
        allowed = set(globally_on) & set(child_features)
        return {"features": [k for k in ALL_FEATURE_KEYS if k in allowed]}

    # parent or user
    return {"features": globally_on}
