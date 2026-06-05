"""
api/routes/research.py

Q3#11 — Deep Research route. POST /api/research/run kicks off the
orchestrator, returns the final report + document id once the run is
complete. The report is persisted as a `research`-kind document via the
Q2#6 store so the Documents page can list it.

Flag-gated by settings.deep_research_enabled (default OFF).
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Header, Request
from pydantic import BaseModel, Field

from config.settings import get_settings
from core.auth import decode_token
from core.errors import bad_request, not_found, unauthorized

router = APIRouter(prefix="/api/research", tags=["research"])


class ResearchRequest(BaseModel):
    query: str = Field(..., min_length=3, max_length=600)


def _require_enabled() -> None:
    if not getattr(get_settings(), "deep_research_enabled", False):
        raise not_found("Deep Research is disabled.")


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
    # Deep Research also requires the Documents store flag, since the
    # report is persisted as a `research`-kind document.
    if not getattr(get_settings(), "documents_enabled", False):
        raise bad_request(
            "Documents must be enabled before Deep Research can save reports."
        )
    return mm._store


@router.post("/run")
async def run_research(
    body: ResearchRequest,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    _require_enabled()
    user_id = await _require_user(authorization)
    store = _store(request)
    from core.deep_research import run_deep_research
    result = await run_deep_research(body.query, user_id=user_id, store=store)
    return result
