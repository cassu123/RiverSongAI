"""
api/routes/documents.py

Q2#6 — Documents workspace. Per-user CRUD for Markdown/plaintext/CSV documents,
plus the storage layer behind future Deep Research reports (Q3#11).

Flag-gated by settings.documents_enabled (default OFF). Every endpoint returns
404 when the flag is off so the surface area is invisible until explicitly
enabled by the admin.

Endpoints:
  GET    /api/documents                  — list current user's documents
  POST   /api/documents                  — create a new document
  GET    /api/documents/{doc_id}         — fetch a single document body
  PUT    /api/documents/{doc_id}         — update title / kind / body / pinned
  DELETE /api/documents/{doc_id}         — delete a single document
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Header, Request
from pydantic import BaseModel, Field

from config.settings import get_settings
from core.auth import decode_token
from core.errors import bad_request, not_found, unauthorized

router = APIRouter(prefix="/api/documents", tags=["documents"])


_ALLOWED_KINDS = {"markdown", "text", "csv", "html", "research"}


# -----------------------------------------------------------------------------
# Request schemas
# -----------------------------------------------------------------------------

class DocumentCreate(BaseModel):
    title: str = Field(default="Untitled", max_length=200)
    kind:  str = Field(default="markdown")
    body:  str = Field(default="")


class DocumentUpdate(BaseModel):
    title:  Optional[str]  = Field(default=None, max_length=200)
    kind:   Optional[str]  = None
    body:   Optional[str]  = None
    pinned: Optional[bool] = None


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

def _require_enabled() -> None:
    if not getattr(get_settings(), "documents_enabled", False):
        raise not_found("Documents workspace is disabled.")


async def _require_user(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise unauthorized("Not authenticated.")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise unauthorized("Invalid or expired token.")
    return payload["sub"]


def _store(request: Request):
    mm = getattr(request.app.state, "memory_manager", None)
    if mm is None or getattr(mm, "_store", None) is None:
        raise not_found("Document store not available.")
    return mm._store


def _validate_kind(kind: str) -> str:
    k = (kind or "markdown").strip().lower()
    if k not in _ALLOWED_KINDS:
        raise bad_request(f"kind must be one of {sorted(_ALLOWED_KINDS)}.")
    return k


def _validate_body(body: str) -> None:
    limit = int(getattr(get_settings(), "documents_max_bytes", 2_000_000))
    if len(body.encode("utf-8", errors="ignore")) > limit:
        raise bad_request(f"Document body exceeds {limit} bytes.")


# -----------------------------------------------------------------------------
# Routes
# -----------------------------------------------------------------------------

@router.get("")
async def list_documents(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    _require_enabled()
    user_id = await _require_user(authorization)
    docs = await _store(request).list_documents(user_id)
    return {"documents": docs}


@router.post("", status_code=201)
async def create_document(
    body: DocumentCreate,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    _require_enabled()
    user_id = await _require_user(authorization)
    store   = _store(request)

    cap = int(getattr(get_settings(), "documents_max_per_user", 500))
    count = await store.count_documents(user_id)
    if count >= cap:
        raise bad_request(f"Document cap reached ({cap}). Delete one to add another.")

    kind = _validate_kind(body.kind)
    _validate_body(body.body or "")
    title = (body.title or "Untitled").strip() or "Untitled"

    doc = await store.create_document(user_id, title, kind, body.body or "")
    return doc


@router.get("/{doc_id}")
async def get_document(
    doc_id: str,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    _require_enabled()
    user_id = await _require_user(authorization)
    doc = await _store(request).get_document(user_id, doc_id)
    if doc is None:
        raise not_found("Document not found.")
    return doc


@router.put("/{doc_id}")
async def update_document(
    doc_id: str,
    body: DocumentUpdate,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    _require_enabled()
    user_id = await _require_user(authorization)

    kind = _validate_kind(body.kind) if body.kind is not None else None
    if body.body is not None:
        _validate_body(body.body)

    title: Optional[str] = None
    if body.title is not None:
        title = body.title.strip() or "Untitled"

    doc = await _store(request).update_document(
        user_id, doc_id,
        title=title, kind=kind, body=body.body, pinned=body.pinned,
    )
    if doc is None:
        raise not_found("Document not found.")
    return doc


@router.delete("/{doc_id}", status_code=204)
async def delete_document(
    doc_id: str,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    _require_enabled()
    user_id = await _require_user(authorization)
    ok = await _store(request).delete_document(user_id, doc_id)
    if not ok:
        raise not_found("Document not found.")
