"""
api/routes/webhook_tokens.py

Q2#10 — Admin-issuable webhook tokens. CRUD + audit list.

Flag-gated by settings.webhook_tokens_enabled (default OFF). All routes
require an authenticated admin caller (Bearer JWT). The freshly-minted
plaintext token is returned ONCE on creation and is never recoverable
afterward — only a sha256 digest persists.

Endpoints:
  GET    /api/webhook-tokens                  — list tokens (no plaintext)
  POST   /api/webhook-tokens                  — issue a new token
  POST   /api/webhook-tokens/{id}/revoke      — revoke (soft)
  GET    /api/webhook-tokens/{id}/audit       — audit log entries for one
  GET    /api/webhook-tokens/audit            — recent audit entries (all)
"""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, Header, Request
from pydantic import BaseModel, Field

from config.settings import get_settings
from core.auth import decode_token
from core.errors import bad_request, forbidden, not_found, unauthorized
from core.webhook_tokens import generate_token, hash_token

router = APIRouter(prefix="/api/webhook-tokens", tags=["webhook-tokens"])


# -----------------------------------------------------------------------------
# Schemas
# -----------------------------------------------------------------------------

class TokenCreate(BaseModel):
    label:      str           = Field(..., min_length=1, max_length=120)
    scopes:     List[str]     = Field(default_factory=list)
    expires_at: Optional[str] = Field(
        default=None,
        description="ISO-8601 UTC timestamp. Omit for no expiry.",
    )


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

def _require_enabled() -> None:
    if not getattr(get_settings(), "webhook_tokens_enabled", False):
        raise not_found("Webhook tokens are disabled.")


async def _require_admin(authorization: Optional[str] = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise unauthorized("Not authenticated.")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise unauthorized("Invalid or expired token.")
    if payload.get("role") != "admin":
        raise forbidden("Admin access required.")
    return payload["sub"]


def _store(request: Request):
    mm = getattr(request.app.state, "memory_manager", None)
    if mm is None or getattr(mm, "_store", None) is None:
        raise not_found("Webhook token store not available.")
    return mm._store


# -----------------------------------------------------------------------------
# Routes
# -----------------------------------------------------------------------------

@router.get("")
async def list_tokens(
    request: Request,
    include_revoked: bool = False,
    admin_id: str = Depends(_require_admin),
):
    _require_enabled()
    tokens = await _store(request).list_webhook_tokens(include_revoked=include_revoked)
    return {"tokens": tokens}


@router.post("", status_code=201)
async def create_token(
    body: TokenCreate,
    request: Request,
    admin_id: str = Depends(_require_admin),
):
    _require_enabled()
    scopes = [s.strip() for s in (body.scopes or []) if s and s.strip()]
    plaintext = generate_token()
    digest = hash_token(plaintext)
    row = await _store(request).create_webhook_token(
        label=body.label.strip(),
        token_hash=digest,
        scopes=scopes,
        created_by=admin_id,
        expires_at=body.expires_at,
    )
    # Plaintext returned once — caller must capture it now.
    return {**row, "token": plaintext}


@router.post("/{token_id}/revoke")
async def revoke_token(
    token_id: str,
    request: Request,
    admin_id: str = Depends(_require_admin),
):
    _require_enabled()
    ok = await _store(request).revoke_webhook_token(token_id, actor=admin_id)
    if not ok:
        raise not_found("Token not found or already revoked.")
    return {"revoked": True, "id": token_id}


@router.get("/audit")
async def list_audit(
    request: Request,
    limit: int = 100,
    admin_id: str = Depends(_require_admin),
):
    _require_enabled()
    entries = await _store(request).list_webhook_token_audit(token_id=None, limit=limit)
    return {"entries": entries}


@router.get("/{token_id}/audit")
async def list_token_audit(
    token_id: str,
    request: Request,
    limit: int = 100,
    admin_id: str = Depends(_require_admin),
):
    _require_enabled()
    entries = await _store(request).list_webhook_token_audit(token_id=token_id, limit=limit)
    return {"entries": entries}
