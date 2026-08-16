from __future__ import annotations
from fastapi import Request, HTTPException

from datetime import datetime, timedelta, timezone
from typing import Optional

import inspect
import uuid
import jwt

from config.settings import get_settings


def create_totp_challenge_token(user_id: str, ttl_seconds: int = 300) -> str:
    """
    Short-lived JWT issued after step 1 of 2FA login (email+password
    verified, awaiting TOTP code). Carries `purpose='totp_challenge'`
    so it can't be confused with an access token.
    """
    settings = get_settings()
    now = datetime.now(tz=timezone.utc)
    expire = now + timedelta(seconds=ttl_seconds)
    payload = {
        "sub": user_id,
        "purpose": "totp_challenge",
        "iat": now,
        "exp": expire,
        "jti": str(uuid.uuid4()),
    }
    return jwt.encode(payload, settings.jwt_secret_key,
                      algorithm=settings.jwt_algorithm)


def decode_challenge_token(token: str) -> Optional[dict]:
    """Verify a TOTP challenge token. Returns payload if valid and unexpired."""
    settings = get_settings()
    try:
        payload = jwt.decode(
            token, settings.jwt_secret_key, algorithms=[
                settings.jwt_algorithm])
    except jwt.PyJWTError:
        return None
    if payload.get("purpose") != "totp_challenge":
        return None
    return payload


def create_access_token(user_id: str, email: str, role: str,
                        impersonator_id: Optional[str] = None) -> str:
    settings = get_settings()
    now = datetime.now(tz=timezone.utc)
    expire = now + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "iat": now,
        "exp": expire,
        "jti": str(uuid.uuid4()),
    }
    if impersonator_id:
        payload["impersonator_id"] = impersonator_id
    return jwt.encode(payload, settings.jwt_secret_key,
                      algorithm=settings.jwt_algorithm)


async def decode_token(token: str) -> Optional[dict]:
    settings = get_settings()
    try:
        payload = jwt.decode(
            token, settings.jwt_secret_key, algorithms=[
                settings.jwt_algorithm])

        # Reject any token that carries a `purpose` claim (e.g. TOTP challenge
        # tokens with purpose='totp_challenge'). Access tokens are minted by
        # create_access_token() which never sets a purpose; only short-lived
        # ceremonial tokens do. Without this guard, a challenge token leaked
        # between step 1 and step 2 of 2FA login could be presented as a
        # Bearer token to any endpoint and authenticate as the user.
        if payload.get("purpose"):
            return None

        # Check revocation, user suspension, and forced logout
        jti = payload.get("jti")
        user_id = payload.get("sub")
        from main import get_app
        app = get_app()
        if app and hasattr(app.state, "memory_manager"):
            store = getattr(app.state.memory_manager, "_store", None)
            if store:
                rev_fn = getattr(store, "is_token_revoked", None)
                if jti and callable(rev_fn):
                    rev_res = rev_fn(jti)
                    if inspect.isawaitable(rev_res):
                        rev_res = await rev_res
                    if rev_res:
                        return None

                user_fn = getattr(store, "get_user_by_id", None)
                if user_id and callable(user_fn):
                    user_res = user_fn(user_id)
                    if inspect.isawaitable(user_res):
                        user = await user_res
                    else:
                        user = user_res
                    if user:
                        if user.get("is_suspended"):
                            return None

                        tokens_valid_after = user.get("tokens_valid_after")
                        iat = payload.get("iat")
                        if tokens_valid_after and iat:
                            # Convert isoformat to UTC timestamp
                            try:
                                # handle trailing 'Z' if present
                                ts_str = tokens_valid_after.replace("Z", "+00:00")
                                cutoff_dt = datetime.fromisoformat(ts_str)
                                if iat < cutoff_dt.timestamp():
                                    return None
                            except ValueError:
                                pass

        return payload
    except jwt.PyJWTError:
        return None


def require_role(*roles: str):
    async def role_checker(request: Request):
        # We assume middleware has set request.state.user
        user = getattr(request.state, "user", None)
        if not user:
            # check header
            auth = request.headers.get("Authorization")
            token = None
            if auth and auth.lower().startswith("bearer "):
                parts = auth.split(" ", 1)
                if len(parts) > 1:
                    token = parts[1].strip()
            if not token:
                token = request.cookies.get("access_token")
            if token:
                user = await decode_token(token)
                if user:
                    request.state.user = user

        if not user:
            raise HTTPException(status_code=401, detail="Unauthorized")

        user_role = user.get("role", "viewer")
        if user_role == "admin":
            return user

        if roles and user_role not in roles:
            raise HTTPException(status_code=403, detail="Forbidden")

        return user
    return role_checker
