"""
api/routes/usage.py

Token usage summary endpoint.

Endpoints:
  GET /api/usage/tokens?days=30&scope=mine|family|all
                                 -- token counts + estimated cost, scoped to
                                    the caller, their family, or (admin only)
                                    the whole instance
  GET /api/usage/rate/{provider} -- request/token counts in a short window
  GET /api/usage/models          -- per-model breakdown with accounts (admin)
"""

from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Query

from core.auth import decode_token
from core.family import family_member_ids
from core.token_tracker import get_model_usage, get_summary, get_provider_rate

router = APIRouter(prefix="/api/usage", tags=["usage"])


@router.get("/tokens")
async def token_usage(
    days: int = Query(default=30, ge=1, le=365),
    scope: str = Query(default="mine", pattern="^(mine|family|all)$"),
    authorization: str = Header(default=""),
):
    """Token usage for the caller, their family, or the whole instance.

    This returned the instance total to every authenticated account, which
    on a single-household box merely looked like your own usage and was
    close enough to it not to matter. With a second family on the same box
    it is a leak: their spending, their model choices, and the shape of how
    much they use River, handed to anyone with a login. The /models endpoint
    below was already admin-gated for exactly this reason -- this one was
    not, and sat directly above it.

    scope=mine (the default) is the caller's own rows. scope=family adds the
    rest of their group, which is the honest unit for "what is this household
    costing". scope=all is the instance and stays admin-only.

    Background work records under 'system' and belongs to no account, so a
    scoped total is smaller than the instance total. The scope is echoed back
    so the UI can label which number it is showing instead of calling every
    one of them "usage".
    """
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user_id = str(payload.get("sub") or "")
    if scope == "all":
        if payload.get("role") != "admin":
            raise HTTPException(
                status_code=403,
                detail="Admin role required for instance-wide usage.")
        user_ids = None
    elif scope == "family":
        user_ids = family_member_ids(user_id)
    else:
        user_ids = [user_id]

    summary = get_summary(days=days, user_ids=user_ids)
    summary["scope"] = scope
    summary["accounts_counted"] = len(user_ids) if user_ids is not None else None
    return summary


@router.get("/rate/{provider}")
async def provider_rate(
    provider: str,
    window: int = Query(default=60, ge=10, le=3600),
    authorization: str = Header(default=""),
):
    """Return request count + token totals for a provider in the last `window` seconds."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return get_provider_rate(provider, window_seconds=window)


@router.get("/models")
async def model_usage(
    days: int = Query(default=30, ge=1, le=365),
    model: str = Query(default=""),
    authorization: str = Header(default=""),
):
    """Per-model recorded usage, including which account spent it.

    Admin-only, unlike /tokens: the per-user breakdown says what every other
    household member has been asking River, by volume and by model, and that
    is not something an ordinary account should be able to read.
    """
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")

    return get_model_usage(days=days, model=model or None)
