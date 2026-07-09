from starlette.requests import Request as StarletteRequest
from slowapi import Limiter
from slowapi.util import get_remote_address


def get_rate_limit_key(request: StarletteRequest) -> str:
    """
    Prefer JWT sub if available, else fallback to remote IP.

    NOTE: core.auth.decode_token is async (it performs an async DB revocation
    check), but slowapi's key_func must be synchronous. We can't await here, so
    we decode the JWT inline just to read the `sub` claim for the rate-limit
    bucket. This is intentionally lightweight — real authentication and
    revocation enforcement still happen in each endpoint's auth dependency.
    """
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        import jwt
        from config.settings import get_settings
        token = auth_header.removeprefix("Bearer ").strip()
        try:
            settings = get_settings()
            payload = jwt.decode(
                token,
                settings.jwt_secret_key,
                algorithms=[settings.jwt_algorithm],
            )
            sub = payload.get("sub")
            if sub:
                return sub
        except Exception:
            # Malformed/expired token: fall back to IP-based limiting.
            pass
    return get_remote_address(request)


def get_fleet_unit_key(request: StarletteRequest) -> str:
    """
    Rate-limit key for fleet device endpoints: bucket per unit token so one
    unit's traffic (or one leaked/abused token) can't exhaust the shared IP
    budget, and a flood from a single unit is throttled independently.
    Falls back to remote IP when no token is present.
    """
    token = request.headers.get("X-Unit-Token")
    if token:
        return f"unit:{token}"
    return get_remote_address(request)


limiter = Limiter(key_func=get_rate_limit_key)
