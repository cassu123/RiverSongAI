from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

import uuid
import jwt

from config.settings import get_settings


def create_access_token(user_id: str, email: str, role: str, impersonator_id: Optional[str] = None) -> str:
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
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


async def decode_token(token: str) -> Optional[dict]:
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
        
        # Check revocation
        jti = payload.get("jti")
        if jti:
            from main import get_app
            app = get_app()
            if app and hasattr(app.state, "memory_manager"):
                store = app.state.memory_manager._store
                if await store.is_token_revoked(jti):
                    return None
                
                # Check user suspension and forced logout
                user_id = payload.get("sub")
                if user_id:
                    user = await store.get_user_by_id(user_id)
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
