# =============================================================================
# api/routes/auth.py
#
# Endpoints:
#   GET  /api/auth/setup-status -- returns whether first admin setup is needed
#   POST /api/auth/setup        -- create the first admin account (one-time)
#   POST /api/auth/signup       -- create new account (pending approval)
#   POST /api/auth/login        -- returns JWT token
#   GET  /api/auth/me           -- returns current user from token
# =============================================================================

from __future__ import annotations

import uuid
import logging

import bcrypt
from fastapi import APIRouter, HTTPException, Request, Header
from pydantic import BaseModel, EmailStr
from typing import Optional

from core.auth import create_access_token, decode_token

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])


class SignupBody(BaseModel):
    email: EmailStr
    password: str
    display_name: str


class LoginBody(BaseModel):
    email: EmailStr
    password: str


class ChangePasswordBody(BaseModel):
    current_password: str
    new_password: str


class SetupBody(BaseModel):
    email: EmailStr
    password: str
    display_name: str


def _get_store(request: Request):
    return request.app.state.memory_manager._store


@router.get("/setup-status")
async def setup_status(request: Request):
    store = _get_store(request)
    admin_exists = await store.has_admin()
    return {"setup_required": not admin_exists}


@router.post("/setup")
async def setup(request: Request, body: SetupBody):
    store = _get_store(request)

    if await store.has_admin():
        raise HTTPException(status_code=409, detail="Admin account already exists.")

    if len(body.password) < 12:
        raise HTTPException(status_code=400, detail="Password must be at least 12 characters.")

    if await store.email_exists(body.email.lower()):
        raise HTTPException(status_code=409, detail="An account with that email already exists.")

    password_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    user_id = str(uuid.uuid4())

    await store.create_user(
        id=user_id,
        email=body.email.lower(),
        password_hash=password_hash,
        display_name=body.display_name,
        role="admin",
        is_approved=True,
    )

    token = create_access_token(user_id=user_id, email=body.email.lower(), role="admin")
    logger.info("Master admin account created: %s", body.email)
    return {"token": token, "user": {"id": user_id, "email": body.email.lower(), "display_name": body.display_name, "role": "admin", "is_approved": True}}


@router.post("/signup")
async def signup(request: Request, body: SignupBody):
    if len(body.password) < 12:
        raise HTTPException(status_code=400, detail="Password must be at least 12 characters.")

    store = _get_store(request)

    if not await store.has_admin():
        raise HTTPException(status_code=400, detail="System not yet configured. Please complete admin setup first.")

    if await store.email_exists(body.email.lower()):
        raise HTTPException(status_code=409, detail="An account with that email already exists.")

    password_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    user_id = str(uuid.uuid4())

    await store.create_user(
        id=user_id,
        email=body.email.lower(),
        password_hash=password_hash,
        display_name=body.display_name,
        role="user",
        is_approved=False,
    )

    logger.info("New user registered (pending approval): %s", body.email)
    return {"pending": True, "message": "Account created. An admin must approve your account before you can log in."}


@router.post("/login")
async def login(request: Request, body: LoginBody):
    store = _get_store(request)
    user = await store.get_user_by_email(body.email.lower())

    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    if not bcrypt.checkpw(body.password.encode(), user["password_hash"].encode()):
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    if not user["is_approved"]:
        raise HTTPException(status_code=403, detail="Your account is pending admin approval.")

    token = create_access_token(user_id=user["id"], email=user["email"], role=user["role"])
    logger.info("User logged in: %s", body.email)
    return {
        "token": token,
        "user": {"id": user["id"], "email": user["email"], "display_name": user["display_name"], "role": user["role"], "is_approved": user["is_approved"]},
    }


@router.get("/me")
async def me(request: Request, authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")

    token = authorization.removeprefix("Bearer ")
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")

    store = _get_store(request)
    user = await store.get_user_by_id(payload["sub"])
    if not user:
        raise HTTPException(status_code=401, detail="User not found.")

    return user

@router.patch("/password")
async def change_password(body: ChangePasswordBody, request: Request, authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")

    token = authorization.removeprefix("Bearer ")
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")

    store = _get_store(request)
    user = await store.get_user_by_id(payload["sub"])
    if not user:
        raise HTTPException(status_code=401, detail="User not found.")

    if not bcrypt.checkpw(body.current_password.encode("utf-8"), user["password_hash"].encode("utf-8")):
        raise HTTPException(status_code=401, detail="Current password is incorrect.")

    new_hash = bcrypt.hashpw(body.new_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    await store.update_user_password(user["id"], new_hash)
    
    return {"status": "ok"}
