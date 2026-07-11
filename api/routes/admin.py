# =============================================================================
# api/routes/admin.py
#
# Endpoints (admin role required):
#   GET   /api/admin/users           -- list all users
#   PATCH /api/admin/users/{user_id} -- approve or change role
# =============================================================================

from __future__ import annotations

import logging
import uuid
from typing import List, Optional

import bcrypt
from core.family_migration import migrate_member_to_family

from fastapi import APIRouter, Request, Header, Response
from pydantic import BaseModel

from api.routes.features import ALL_FEATURES, ALL_FEATURE_KEYS

from config.settings import get_settings
from core.auth import decode_token, create_access_token
from core.errors import bad_request, forbidden, not_found, unauthorized

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["admin"])


def _get_store(request: Request):
    return request.app.state.memory_manager._store


async def _require_admin(request: Request,
                         authorization: Optional[str]) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise unauthorized("Not authenticated.")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise unauthorized("Invalid or expired token.")
    if payload.get("role") != "admin":
        raise forbidden("Admin access required.")
    return payload


def _set_auth_cookie(response: Response, token: str) -> None:
    """Set the HttpOnly access_token cookie exactly as the login flow does
    (auth.py). Cookie-only auth means impersonation/revert must swap it here."""
    s = get_settings()
    response.set_cookie(
        "access_token", token, httponly=True,
        secure=s.environment == "production", samesite="lax",
        max_age=s.jwt_expire_minutes * 60)


class UpdateUserBody(BaseModel):
    role: Optional[str] = None
    is_approved: Optional[bool] = None
    force_password_change: Optional[bool] = None
    is_suspended: Optional[bool] = None


class AdminChangePasswordBody(BaseModel):
    new_password: str


class ModelVisibilityBody(BaseModel):
    hidden_voices: list[str] = []
    hidden_llms: list[str] = []


VALID_ROLES = {"admin", "parent", "user", "child", "guest"}


@router.get("/users")
async def list_users(request: Request,
                     authorization: Optional[str] = Header(default=None)):
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
        raise bad_request(
            f"Invalid role. Must be one of: {
                ', '.join(VALID_ROLES)}")

    # Prevent admin from demoting themselves
    if payload["sub"] == user_id and body.role and body.role != "admin":
        raise bad_request("You cannot change your own role.")

    store = _get_store(request)
    target = await store.get_user_by_id(user_id)
    if not target:
        raise not_found("User not found.")

    await store.update_user(user_id, role=body.role, is_approved=body.is_approved, force_password_change=body.force_password_change, is_suspended=body.is_suspended)
    logger.info(
        "Admin %s updated user %s: role=%s approved=%s force_password_change=%s is_suspended=%s",
        payload["sub"],
        user_id,
        body.role,
        body.is_approved,
        body.force_password_change,
        body.is_suspended)

    updated = await store.get_user_by_id(user_id)
    return updated


@router.post("/users/{user_id}/password")
async def change_user_password(
    user_id: str,
    body: AdminChangePasswordBody,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    payload = await _require_admin(request, authorization)

    if len(body.new_password) < 12:
        raise bad_request("Password must be at least 12 characters.")

    store = _get_store(request)
    target = await store.get_user_by_id(user_id)
    if not target:
        raise not_found("User not found.")

    new_hash = bcrypt.hashpw(
        body.new_password.encode("utf-8"),
        bcrypt.gensalt()).decode("utf-8")
    await store.update_user_password(user_id, new_hash, force_change=True)
    logger.info(
        "Admin %s reset password for user %s and forced change",
        payload["sub"],
        user_id)

    return {"success": True, "message": "Password updated successfully."}


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: str,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    payload = await _require_admin(request, authorization)

    # Prevent admin from deleting themselves
    if payload["sub"] == user_id:
        raise bad_request("You cannot terminate your own account.")

    store = _get_store(request)
    target = await store.get_user_by_id(user_id)
    if not target:
        raise not_found("User not found.")

    await store.delete_user(user_id)
    logger.info("Admin %s terminated user %s", payload["sub"], user_id)

    return {"success": True, "message": "User terminated successfully."}


@router.post("/users/{user_id}/force-logout")
async def force_logout(
    user_id: str,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    payload = await _require_admin(request, authorization)

    store = _get_store(request)
    target = await store.get_user_by_id(user_id)
    if not target:
        raise not_found("User not found.")

    await store.force_logout(user_id)
    logger.info("Admin %s forced logout for user %s", payload["sub"], user_id)

    return {"success": True, "message": "User active sessions invalidated."}


@router.post("/users/{user_id}/impersonate")
async def impersonate_user(
    user_id: str,
    request: Request,
    response: Response,
    authorization: Optional[str] = Header(default=None),
):
    payload = await _require_admin(request, authorization)

    store = _get_store(request)
    target = await store.get_user_by_id(user_id)
    if not target:
        raise not_found("User not found.")

    admin_id = payload["sub"]
    if admin_id == user_id:
        raise bad_request("You cannot impersonate yourself.")

    # Create a token for the target user, carrying the impersonator id so
    # revert can restore the admin session.
    token = create_access_token(
        user_id=target["id"],
        email=target["email"],
        role=target["role"],
        impersonator_id=admin_id)
    logger.info(
        "Admin %s initiated impersonation of user %s",
        admin_id,
        user_id)

    # Swap the session cookie to the impersonated user (cookie-only auth).
    _set_auth_cookie(response, token)
    return {"access_token": token, "token_type": "bearer",
            "impersonated_user": target}


@router.post("/revert-impersonation")
async def revert_impersonation(
    request: Request,
    response: Response,
    authorization: Optional[str] = Header(default=None),
):
    """End an impersonation session and restore the admin's own session.

    Reads the impersonator id from the current (impersonation) token — issued
    by impersonate_user — reissues a clean admin token, and swaps the cookie
    back. No admin role is required on the *current* token because during
    impersonation it carries the target user's (possibly non-admin) role; the
    impersonator id is the authority, and it must still resolve to an admin.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise unauthorized("Not authenticated.")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise unauthorized("Invalid or expired token.")

    impersonator_id = payload.get("impersonator_id")
    if not impersonator_id:
        raise bad_request("Not an impersonation session.")

    store = _get_store(request)
    admin = await store.get_user_by_id(impersonator_id)
    if not admin or admin.get("role") != "admin":
        raise forbidden("Impersonator is no longer an admin.")

    token = create_access_token(
        user_id=admin["id"], email=admin["email"], role=admin["role"])
    logger.info("Reverted impersonation back to admin %s", impersonator_id)
    _set_auth_cookie(response, token)
    return {"access_token": token, "token_type": "bearer", "user": admin}

# =============================================================================
# Model visibility
# =============================================================================


@router.get("/model-visibility")
async def get_model_visibility(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    await _require_admin(request, authorization)
    store = _get_store(request)
    config = await store.get_admin_config()

    hidden_voices = config.get("hidden_voices", [])
    hidden_llms = config.get("hidden_llms", [])

    # Full catalogs so the admin UI can render all toggles without a second
    # call
    import os
    from config.settings import get_settings
    from providers.tts.voice_registry import VoiceRegistry
    from providers.llm.registry import LLMRegistry

    settings = get_settings()
    model_dir = os.path.dirname(
        settings.piper_model_path) if settings.piper_model_path else ""

    try:
        import kokoro  # noqa: F401
        kokoro_ok = True
    except ImportError:
        kokoro_ok = False

    all_voices = []
    for e in VoiceRegistry.list_all():
        if e.engine == "kokoro" and not kokoro_ok:
            continue
        installed_path = os.path.join(
            model_dir, e.filename) if model_dir and e.filename else ""
        all_voices.append({
            "voice_id": e.voice_id,
            "display_name": e.display_name,
            "engine": e.engine,
            "accent": e.accent,
            "installed": bool(installed_path and os.path.exists(installed_path)),
            "hidden": e.voice_id in hidden_voices,
        })

    all_llms = []
    for m in [*LLMRegistry.list_local(), *LLMRegistry.list_cloud()]:
        all_llms.append({
            "model_id": m.model_id,
            "display_name": m.display_name,
            "provider": m.provider,
            "is_cloud": m.is_cloud,
            "hidden": m.model_id in hidden_llms,
        })

    return {
        "hidden_voices": hidden_voices,
        "hidden_llms": hidden_llms,
        "all_voices": all_voices,
        "all_llms": all_llms,
    }


@router.put("/model-visibility")
async def set_model_visibility(
    body: ModelVisibilityBody,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    await _require_admin(request, authorization)
    store = _get_store(request)
    config = await store.get_admin_config()
    config["hidden_voices"] = body.hidden_voices
    config["hidden_llms"] = body.hidden_llms
    await store.set_admin_config(config)
    logger.info("Admin updated model visibility: %d voices hidden, %d LLMs hidden",
                len(body.hidden_voices), len(body.hidden_llms))
    return {"hidden_voices": body.hidden_voices,
            "hidden_llms": body.hidden_llms}


# =============================================================================
# Feature visibility (global show/hide per feature key)
# =============================================================================

class FeatureVisibilityBody(BaseModel):
    hidden_features: list[str] = []


@router.get("/feature-visibility")
async def get_feature_visibility(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    await _require_admin(request, authorization)
    store = _get_store(request)
    config = await store.get_admin_config()
    hidden = config.get("hidden_features", [])
    return {
        "hidden_features": hidden,
        "all_features": [
            {**f, "hidden": f["key"] in hidden}
            for f in ALL_FEATURES
        ],
    }


@router.put("/feature-visibility")
async def set_feature_visibility(
    body: FeatureVisibilityBody,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    await _require_admin(request, authorization)
    # Validate keys
    invalid = [k for k in body.hidden_features if k not in ALL_FEATURE_KEYS]
    if invalid:
        raise bad_request(f"Unknown feature keys: {invalid}")
    store = _get_store(request)
    config = await store.get_admin_config()
    config["hidden_features"] = body.hidden_features
    await store.set_admin_config(config)
    logger.info(
        "Admin updated feature visibility: %d features hidden", len(
            body.hidden_features))
    return {"hidden_features": body.hidden_features}


# =============================================================================
# Family management — parent-child link assignment
# =============================================================================

class ParentChildBody(BaseModel):
    parent_id: str
    child_id: str


@router.get("/family")
async def list_family(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    await _require_admin(request, authorization)
    store = _get_store(request)
    links = await store.list_all_parent_child()
    users = await store.list_users()
    return {"links": links, "users": users}


@router.post("/family")
async def add_family_link(
    body: ParentChildBody,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    payload = await _require_admin(request, authorization)
    store = _get_store(request)

    parent = await store.get_user_by_id(body.parent_id)
    child = await store.get_user_by_id(body.child_id)
    if not parent:
        raise not_found("Parent user not found.")
    if not child:
        raise not_found("Child user not found.")
    if body.parent_id == body.child_id:
        raise bad_request("Parent and child cannot be the same user.")

    await store.add_parent_child(body.parent_id, body.child_id)

    # Auto-promote parent's role to 'parent' if they're a plain user
    if parent["role"] == "user":
        await store.update_user(body.parent_id, role="parent")

    logger.info(
        "Admin %s linked parent %s → child %s",
        payload["sub"],
        body.parent_id,
        body.child_id)
    return {"parent_id": body.parent_id, "child_id": body.child_id}


@router.delete("/family/{parent_id}/{child_id}")
async def remove_family_link(
    parent_id: str,
    child_id: str,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    payload = await _require_admin(request, authorization)
    store = _get_store(request)
    await store.remove_parent_child(parent_id, child_id)

    # If parent now has no children, demote back to user
    remaining = await store.get_children_of_parent(parent_id)
    if not remaining:
        parent = await store.get_user_by_id(parent_id)
        if parent and parent["role"] == "parent":
            await store.update_user(parent_id, role="user")

    logger.info("Admin %s removed parent %s → child %s link",
                payload["sub"], parent_id, child_id)
    return {"removed": True}


# =============================================================================
# Family Groups — shared access to culinary / inventory / store / maintenance
# =============================================================================

VALID_MODULES = {"culinary", "inventory", "store", "maintenance"}
VALID_RELATIONS = {"parent", "child", "spouse", "guardian", "member", "other"}


class FamilyGroupCreate(BaseModel):
    name: str
    shared_modules: List[str] = [
        "culinary",
        "inventory",
        "store",
        "maintenance"]


class FamilyGroupUpdate(BaseModel):
    name: Optional[str] = None
    shared_modules: Optional[List[str]] = None


class FamilyMemberAdd(BaseModel):
    profile_id: str
    relationship: str = "member"


@router.get("/family-groups")
async def list_family_groups(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    await _require_admin(request, authorization)
    store = _get_store(request)
    groups = await store.list_family_groups()
    users = await store.list_users()
    return {"groups": groups, "users": users}


@router.post("/family-groups", status_code=201)
async def create_family_group(
    body: FamilyGroupCreate,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    payload = await _require_admin(request, authorization)
    invalid = [m for m in body.shared_modules if m not in VALID_MODULES]
    if invalid:
        raise bad_request(f"Invalid modules: {invalid}")
    store = _get_store(request)
    group_id = str(uuid.uuid4())
    group = await store.create_family_group(group_id, body.name.strip(), body.shared_modules)
    logger.info("Admin %s created family group %s (%s)",
                payload["sub"], group_id, body.name)
    return group


@router.patch("/family-groups/{group_id}")
async def update_family_group(
    group_id: str,
    body: FamilyGroupUpdate,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    await _require_admin(request, authorization)
    if body.shared_modules is not None:
        invalid = [m for m in body.shared_modules if m not in VALID_MODULES]
        if invalid:
            raise bad_request(f"Invalid modules: {invalid}")
    store = _get_store(request)
    result = await store.update_family_group(group_id, body.name, body.shared_modules)
    if not result:
        raise not_found("Family group not found.")
    return result


@router.delete("/family-groups/{group_id}", status_code=204)
async def delete_family_group(
    group_id: str,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    payload = await _require_admin(request, authorization)
    store = _get_store(request)
    group = await store.get_family_group(group_id)
    if not group:
        raise not_found("Family group not found.")
    await store.delete_family_group(group_id)
    logger.info("Admin %s deleted family group %s", payload["sub"], group_id)


@router.post("/family-groups/{group_id}/members", status_code=201)
async def add_family_member(
    group_id: str,
    body: FamilyMemberAdd,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    payload = await _require_admin(request, authorization)
    if body.relationship not in VALID_RELATIONS:
        raise bad_request(
            f"Invalid relationship. Choose from: {
                ', '.join(VALID_RELATIONS)}")
    store = _get_store(request)
    group = await store.get_family_group(group_id)
    if not group:
        raise not_found("Family group not found.")
    user = await store.get_user_by_id(body.profile_id)
    if not user:
        raise not_found("User not found.")
    result = await store.add_family_member(group_id, body.profile_id, body.relationship)
    logger.info(
        "Admin %s added %s to family group %s as %s",
        payload["sub"],
        body.profile_id,
        group_id,
        body.relationship)

    # Migrate any existing personal module data to the shared family scope
    summary = migrate_member_to_family(
        group_id, body.profile_id, group["shared_modules"])
    logger.info("Auto-migration for %s → group %s: %s",
                body.profile_id[:8], group_id[:8], summary)

    return {**result, "migration": summary}


@router.delete("/family-groups/{group_id}/members/{profile_id}",
               status_code=204)
async def remove_family_member(
    group_id: str,
    profile_id: str,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    payload = await _require_admin(request, authorization)
    store = _get_store(request)
    await store.remove_family_member(group_id, profile_id)
    logger.info("Admin %s removed %s from family group %s",
                payload["sub"], profile_id, group_id)
