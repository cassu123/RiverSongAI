from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

import uuid
import jwt

from config.settings import get_settings


def create_access_token(user_id: str, email: str, role: str) -> str:
    settings = get_settings()
    expire = datetime.now(tz=timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": expire,
        "jti": str(uuid.uuid4()),
    }
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
                    
        return payload
    except jwt.PyJWTError:
        return None
