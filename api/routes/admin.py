# =============================================================================
# api/routes/admin.py
#
# Endpoints (admin role required):
#   GET   /api/admin/users           -- list all users
#   PATCH /api/admin/users/{user_id} -- approve or change role
# =============================================================================

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, Header
from pydantic import BaseModel

from core.auth import decode_token

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["admin"])


def _get_store(request: Request):
    return request.app.state.memory_manager._store


async def _require_admin(request: Request, authorization: Optional[str]) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    return payload


class UpdateUserBody(BaseModel):
    role: Optional[str] = None
    is_approved: Optional[bool] = None


VALID_ROLES = {"admin", "user", "child", "guest"}


@router.get("/users")
async def list_users(request: Request, authorization: Optional[str] = Header(default=None)):
    await _require_admin(request, authorization)
    store = _get_store(request)
    return await store.list_users()


@router.patch("/users/{user_id}")
async def update_user(
    user_id: str,
    body: UpdateUserBody,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    payload = await _require_admin(request, authorization)

    if body.role is not None and body.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {', '.join(VALID_ROLES)}")

    # Prevent admin from demoting themselves
    if payload["sub"] == user_id and body.role and body.role != "admin":
        raise HTTPException(status_code=400, detail="You cannot change your own role.")

    store = _get_store(request)
    target = await store.get_user_by_id(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")

    await store.update_user(user_id, role=body.role, is_approved=body.is_approved)
    logger.info("Admin %s updated user %s: role=%s approved=%s", payload["sub"], user_id, body.role, body.is_approved)

    updated = await store.get_user_by_id(user_id)
    return updated
