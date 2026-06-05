from starlette.requests import Request as StarletteRequest
from slowapi import Limiter
from slowapi.util import get_remote_address


def get_rate_limit_key(request: StarletteRequest) -> str:
    """
    Prefer JWT sub if available, else fallback to remote IP.
    """
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        from core.auth import decode_token
        token = auth_header.removeprefix("Bearer ").strip()
        payload: dict = decode_token(token) or {}  # type: ignore
        if payload and "sub" in payload:
            return payload["sub"]
    return get_remote_address(request)


limiter = Limiter(key_func=get_rate_limit_key)
