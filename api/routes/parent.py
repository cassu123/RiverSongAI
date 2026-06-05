# =============================================================================
# api/routes/parent.py
#
# Endpoints (parent or admin role required):
#   GET /api/parent/children                       -- list children + feature states
#   PUT /api/parent/children/{child_id}/features   -- update a child's enabled features
# =============================================================================

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

from core.auth import decode_token
from api.routes.features import ALL_FEATURE_KEYS

router = APIRouter(prefix="/api/parent", tags=["parent"])


async def _require_parent(authorization: Optional[str]) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token.")
    if payload.get("role") not in ("parent", "admin"):
        raise HTTPException(status_code=403, detail="Parent access required.")
    return payload


class ChildFeaturesBody(BaseModel):
    enabled_features: list[str]


@router.get("/children")
async def list_children(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    payload = await _require_parent(authorization)
    store = request.app.state.memory_manager._store

    # Admins see all parent-child links; parents see only their own children
    if payload.get("role") == "admin":
        links = await store.list_all_parent_child()
        all_ids = list({l["child_id"] for l in links})
    else:
        all_ids = await store.get_children_of_parent(payload["sub"])

    config = await store.get_admin_config()
    hidden = set(config.get("hidden_features", []))
    globally_on = [k for k in ALL_FEATURE_KEYS if k not in hidden]

    children = []
    for child_id in all_ids:
        user = await store.get_user_by_id(child_id)
        if not user:
            continue
        enabled = await store.get_child_features(child_id)
        parents = await store.get_parents_of_child(child_id)
        children.append({
            "id": child_id,
            "display_name": user["display_name"],
            "email": user["email"],
            "enabled_features": enabled,
            "globally_on": globally_on,
            "parents": parents,
        })

    return {"children": children, "globally_on": globally_on}


@router.put("/children/{child_id}/features")
async def set_child_features(
    child_id: str,
    body: ChildFeaturesBody,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    payload = await _require_parent(authorization)
    store = request.app.state.memory_manager._store

    # Verify the requester is actually a parent of this child (admin bypasses)
    if payload.get("role") != "admin":
        children = await store.get_children_of_parent(payload["sub"])
        if child_id not in children:
            raise HTTPException(
                status_code=403,
                detail="Not a parent of this child.")

    # Strip any features that are globally hidden — parent cannot grant what
    # admin blocked
    config = await store.get_admin_config()
    hidden = set(config.get("hidden_features", []))
    valid_keys = set(ALL_FEATURE_KEYS) - hidden
    cleaned = [k for k in body.enabled_features if k in valid_keys]

    await store.set_child_features(child_id, cleaned)
    return {"child_id": child_id, "enabled_features": cleaned}
