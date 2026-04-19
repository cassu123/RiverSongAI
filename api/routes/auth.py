# =============================================================================
# api/routes/auth.py
#
# Endpoints:
#   POST /api/auth/signup  -- create new account
#   POST /api/auth/login   -- returns JWT token
#   GET  /api/auth/me      -- returns current user from token
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


def _get_store(request: Request):
    return request.app.state.memory_manager._store


@router.post("/signup")
async def signup(request: Request, body: SignupBody):
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")

    store = _get_store(request)

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
    )

    token = create_access_token(user_id=user_id, email=body.email.lower(), role="user")
    logger.info("New user registered: %s", body.email)
    return {"token": token, "user": {"id": user_id, "email": body.email.lower(), "display_name": body.display_name, "role": "user"}}


@router.post("/login")
async def login(request: Request, body: LoginBody):
    store = _get_store(request)
    user = await store.get_user_by_email(body.email.lower())

    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    if not bcrypt.checkpw(body.password.encode(), user["password_hash"].encode()):
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    token = create_access_token(user_id=user["id"], email=user["email"], role=user["role"])
    logger.info("User logged in: %s", body.email)
    return {
        "token": token,
        "user": {"id": user["id"], "email": user["email"], "display_name": user["display_name"], "role": user["role"]},
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
