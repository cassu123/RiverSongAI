"""
api/routes/usage.py

Token usage summary endpoint.

Endpoints:
  GET /api/usage/tokens?days=30&scope=mine|dependents|all[&user_id=]
                                 -- token counts + estimated cost, scoped to
                                    the caller, the accounts they answer for,
                                    a named account they are allowed to see,
                                    or (admin only) the whole instance
  GET /api/usage/rate/{provider} -- request/token counts in a short window
  GET /api/usage/models          -- per-model breakdown with accounts (admin)
"""

from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Query, Request

from core.auth import decode_token
from core.family import may_view_usage
from core.token_tracker import get_model_usage, get_summary, get_provider_rate

router = APIRouter(prefix="/api/usage", tags=["usage"])


@router.get("/tokens")
async def token_usage(
    request: Request,
    days: int = Query(default=30, ge=1, le=365),
    scope: str = Query(default="mine", pattern="^(mine|dependents|all)$"),
    user_id: str = Query(default=""),
    authorization: str = Header(default=""),
):
    """Token usage for the caller, an account they answer for, or everything.

    This returned the instance total to every authenticated account. On a
    single-household box that merely looked like your own usage and was close
    enough not to notice; with a second family on the same box it hands over
    their spending, their model choices, and the shape of how much they use
    River. The /models endpoint below was already admin-gated for exactly
    this reason -- this one was not, and sat directly above it.

    Who may see whose usage is a question about responsibility, not about
    sharing a pantry. Family group membership is the wrong test on both
    sides: it exposes one adult's spending to another who merely pools
    recipes with them, and it misses a parent and child who are not in a
    group at all. The rule is:

      * your own usage, always;
      * a child's usage, if you are recorded as their parent;
      * everything, if you are an admin.

    scope=dependents rolls up the first two -- you plus the accounts you
    answer for -- which is the number a parent actually wants. user_id names
    a single account and is checked against the same rule, so a parent can
    look at one child rather than at the total.

    Background work records under 'system' and belongs to no account, so
    every scoped total is smaller than the instance total. The scope comes
    back with the figures so the UI can say which number it is showing.
    """
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    me = str(payload.get("sub") or "")
    is_admin = payload.get("role") == "admin"
    store = request.app.state.memory_manager._store

    async def _dependents() -> list:
        """Accounts this caller answers for, not counting themselves."""
        try:
            return list(await store.get_children_of_parent(me))
        except Exception:
            return []

    if user_id:
        # A named account. Admins may name anyone; everyone else may name
        # themselves or one of their children, and nobody else.
        if not may_view_usage(me, is_admin, user_id, await _dependents()):
            raise HTTPException(
                status_code=403,
                detail="You can only view your own usage, or a child's.")
        user_ids = [user_id]
        scope = "account"
    elif scope == "all":
        if not is_admin:
            raise HTTPException(
                status_code=403,
                detail="Admin role required for instance-wide usage.")
        user_ids = None
    elif scope == "dependents":
        user_ids = [me, *await _dependents()]
    else:
        user_ids = [me]

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
