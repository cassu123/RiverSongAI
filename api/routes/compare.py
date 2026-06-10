"""
api/routes/compare.py

Q3#12 — Blind model comparison.

Endpoints:
  POST  /api/compare/run            — submit a prompt + two model picks;
                                      returns identities HIDDEN in the
                                      response payload (the UI doesn't
                                      know which side is which until the
                                      user votes).
  POST  /api/compare/{run_id}/vote  — record a vote (a | b | tie). Returns
                                      the run with model identities now
                                      revealed.
  GET   /api/compare/history        — recent runs for current user.
  GET   /api/compare/leaderboard    — aggregated win-rates per model.

Flag-gated by settings.blind_compare_enabled (default OFF).
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import random
from typing import Optional

from fastapi import APIRouter, Header, Request
from pydantic import BaseModel, Field

from config.settings import get_settings
from core.auth import decode_token
from core.errors import bad_request, not_found, unauthorized

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/compare", tags=["compare"])


# -----------------------------------------------------------------------------
# Schemas
# -----------------------------------------------------------------------------

class ModelRef(BaseModel):
    provider: str = Field(..., min_length=1)
    model: str = Field(..., min_length=1)


class CompareRunRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=6000)
    model_a: ModelRef
    model_b: ModelRef


class CompareVote(BaseModel):
    winner: str = Field(..., pattern=r"^(a|b|tie)$")


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

def _require_enabled() -> None:
    if not getattr(get_settings(), "blind_compare_enabled", False):
        raise not_found("Blind model comparison is disabled.")


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
        raise not_found("Compare store not available.")
    return mm._store


def _prompt_hash(prompt: str) -> str:
    return hashlib.sha256(prompt.strip().encode("utf-8")).hexdigest()[:32]


async def _resolve_llm(provider: str, model: str, request: Request):
    """
    Build the right LLM instance. Supports the standard provider keys plus
    Q3#14's `remote_ollama:<rig_id_or_label>` wire format, which is
    resolved against the registered-rig store at the route layer (so we
    don't have to make `_instantiate_llm` itself async).
    """
    if isinstance(provider, str) and provider.startswith("remote_ollama"):
        if not getattr(get_settings(), "remote_ollama_enabled", False):
            raise RuntimeError("Remote Ollama is disabled.")
        rig_ref = provider.split(":", 1)[1] if ":" in provider else ""
        store = _store(request)
        from providers.llm.remote_ollama import build_remote_llm_from_rig, resolve_rig
        if rig_ref:
            rig = await resolve_rig(rig_ref, store)
        else:
            rigs = await store.list_remote_rigs(include_inactive=False)
            rig = rigs[0] if rigs else None
        if rig is None:
            raise RuntimeError(
                f"No active remote rig matches '{
                    rig_ref or '(default)'}'.")
        return build_remote_llm_from_rig(rig, model)
    from core.conversation_loop import _instantiate_llm
    return _instantiate_llm(provider, model)


async def _run_one(provider: str, model: str, prompt: str,
                   request: Request) -> str:
    """Instantiate a single LLM and return the full response text."""
    llm = await _resolve_llm(provider, model, request)
    messages = [{"role": "user", "content": prompt}]
    if hasattr(llm, "chat"):
        res = await llm.chat(messages)
        if isinstance(res, dict):
            return res.get("content") or res.get("text") or ""
        return str(res)
    stream_fn = getattr(
        llm,
        "stream_chat",
        None) or getattr(
        llm,
        "stream_response",
        None)
    if stream_fn is None:
        return ""
    out = ""
    async for chunk in stream_fn(messages):
        out += chunk
        if len(out) > 60_000:
            break
    return out


# -----------------------------------------------------------------------------
# Routes
# -----------------------------------------------------------------------------

@router.post("/run")
async def run_compare(
    body: CompareRunRequest,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """
    Run the prompt against both models in parallel and persist the
    comparison row. The response HIDES which model produced which text
    until the user votes — the client never sees the identity ↔ side
    mapping pre-vote.
    """
    from core.token_tracker import set_usage_source
    set_usage_source("compare")
    _require_enabled()
    user_id = await _require_user(authorization)
    store = _store(request)

    a = {"provider": body.model_a.provider.strip(),
         "model": body.model_a.model.strip()}
    b = {"provider": body.model_b.provider.strip(),
         "model": body.model_b.model.strip()}

    try:
        resp_a, resp_b = await asyncio.gather(
            _run_one(a["provider"], a["model"], body.prompt, request),
            _run_one(b["provider"], b["model"], body.prompt, request),
        )
    except Exception as exc:
        logger.warning("Blind compare run failed: %s", exc)
        raise bad_request(f"Compare run failed: {exc}")

    # Randomize the displayed side ↔ stored side mapping so identities
    # are not predictable from the request order.
    if random.choice((True, False)):
        a, b = b, a
        resp_a, resp_b = resp_b, resp_a

    run = await store.create_compare_run(
        owner_id=user_id,
        prompt=body.prompt,
        prompt_hash=_prompt_hash(body.prompt),
        model_a=a,
        model_b=b,
        response_a=resp_a,
        response_b=resp_b,
    )

    # Identities hidden in the response payload — only sides labeled.
    return {
        "id": run["id"],
        "prompt": body.prompt,
        "response_a": resp_a,
        "response_b": resp_b,
        "voted": False,
    }


@router.post("/{run_id}/vote")
async def vote_compare(
    run_id: str,
    body: CompareVote,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    _require_enabled()
    user_id = await _require_user(authorization)
    store = _store(request)
    updated = await store.record_compare_vote(run_id, user_id, body.winner)
    if updated is None:
        raise not_found("Compare run not found or already voted.")
    # Now safe to reveal model identities.
    return {**updated, "voted": True}


@router.get("/history")
async def list_history(
    request: Request,
    limit: int = 20,
    authorization: Optional[str] = Header(default=None),
):
    _require_enabled()
    user_id = await _require_user(authorization)
    rows = await _store(request).list_compare_history(user_id, limit=limit)
    return {"runs": rows}


@router.get("/leaderboard")
async def leaderboard(
    request: Request,
    scope: str = "user",  # 'user' | 'global'
    authorization: Optional[str] = Header(default=None),
):
    _require_enabled()
    user_id = await _require_user(authorization)
    target = user_id if scope == "user" else None
    rows = await _store(request).compare_leaderboard(owner_id=target)
    return {"leaderboard": rows, "scope": scope}
