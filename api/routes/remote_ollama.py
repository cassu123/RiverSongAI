"""
api/routes/remote_ollama.py

Q3#14 — Admin CRUD for remote Ollama rigs + on-demand health-check.

Flag-gated by settings.remote_ollama_enabled (default OFF). All routes
require admin role.

Endpoints:
  GET    /api/remote-ollama/rigs                 — list registered rigs
  POST   /api/remote-ollama/rigs                 — register a rig
  PUT    /api/remote-ollama/rigs/{rig_id}        — update (label/url/notes/active)
  DELETE /api/remote-ollama/rigs/{rig_id}        — delete
  POST   /api/remote-ollama/rigs/{rig_id}/health — probe + persist health
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Header, Request
from pydantic import BaseModel, Field

from config.settings import get_settings
from core.auth import decode_token
from core.errors import bad_request, forbidden, not_found, unauthorized
from providers.llm.remote_ollama import health_check

router = APIRouter(prefix="/api/remote-ollama", tags=["remote-ollama"])


class RigCreate(BaseModel):
    label: str = Field(..., min_length=1, max_length=80)
    base_url: str = Field(..., min_length=8, max_length=300)
    notes: str = Field(default="")


class RigUpdate(BaseModel):
    label: Optional[str] = Field(default=None, min_length=1, max_length=80)
    base_url: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


def _require_enabled() -> None:
    if not getattr(get_settings(), "remote_ollama_enabled", False):
        raise not_found("Remote Ollama is disabled.")


async def _require_admin(
        authorization: Optional[str] = Header(default=None)) -> str:
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
        raise not_found("Rig store not available.")
    return mm._store


@router.get("/rigs")
async def list_rigs(
    request: Request,
    include_inactive: bool = True,
    admin_id: str = Depends(_require_admin),
):
    _require_enabled()
    return {"rigs": await _store(request).list_remote_rigs(include_inactive=include_inactive)}


@router.post("/rigs", status_code=201)
async def create_rig(
    body: RigCreate,
    request: Request,
    admin_id: str = Depends(_require_admin),
):
    _require_enabled()
    url = body.base_url.strip()
    if not (url.startswith("http://") or url.startswith("https://")):
        raise bad_request("base_url must start with http:// or https://")
    rig = await _store(request).create_remote_rig(
        label=body.label.strip(),
        base_url=url,
        notes=body.notes,
        created_by=admin_id,
    )
    return rig


@router.put("/rigs/{rig_id}")
async def update_rig(
    rig_id: str,
    body: RigUpdate,
    request: Request,
    admin_id: str = Depends(_require_admin),
):
    _require_enabled()
    if body.base_url is not None:
        url = body.base_url.strip()
        if not (url.startswith("http://") or url.startswith("https://")):
            raise bad_request("base_url must start with http:// or https://")
    rig = await _store(request).update_remote_rig(
        rig_id,
        label=body.label,
        base_url=body.base_url,
        notes=body.notes,
        is_active=body.is_active,
    )
    if rig is None:
        raise not_found("Rig not found.")
    return rig


@router.delete("/rigs/{rig_id}", status_code=204)
async def delete_rig(
    rig_id: str,
    request: Request,
    admin_id: str = Depends(_require_admin),
):
    _require_enabled()
    ok = await _store(request).delete_remote_rig(rig_id)
    if not ok:
        raise not_found("Rig not found.")


@router.post("/rigs/{rig_id}/health")
async def probe_rig_health(
    rig_id: str,
    request: Request,
    admin_id: str = Depends(_require_admin),
):
    _require_enabled()
    store = _store(request)
    rig = await store.get_remote_rig(rig_id)
    if rig is None:
        raise not_found("Rig not found.")
    health, models = await health_check(rig["base_url"])
    updated = await store.record_remote_rig_health(rig_id, health=health, models=models)
    return updated or {"id": rig_id,
                       "last_health": health, "last_models": models}
