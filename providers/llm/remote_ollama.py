"""
providers/llm/remote_ollama.py

Q3#14 — Remote Ollama provider. Drives the same Ollama HTTP API as
`providers/llm/ollama.py`, but pointed at a remote `base_url` registered
via the admin API. Typical deployment: a remote rig's Ollama is bound to
localhost and tunneled via SSH (`ssh -L 11500:localhost:11434 …`) so the
admin only registers `http://localhost:11500`.

Provider key wire-format for `_instantiate_llm`:
    "remote_ollama:<rig_id>"     — exact rig
    "remote_ollama"              — first active rig (admin UI default)

`list_remote_models(base_url)` and `health_check(base_url)` are
standalone helpers used by the route layer to discover available
models and update the rig's `last_health` column. Both timeout fast
per `settings.remote_ollama_health_timeout_seconds`.
"""

from __future__ import annotations

import asyncio
import logging
from typing import AsyncGenerator, List, Optional, Tuple

import ollama as ollama_client

from config.settings import get_settings
from providers.base import LLMProvider

logger = logging.getLogger(__name__)


class RemoteOllamaLLM(LLMProvider):
    """
    Streams from a remote Ollama instance via the official client.
    Same surface as OllamaLLM — accepts an explicit `base_url` and
    falls back to local Ollama when the remote rig is unreachable
    (only if `fallback_local=True`).
    """

    def __init__(
        self,
        base_url: str,
        model: Optional[str] = None,
        *,
        fallback_local: bool = True,
        rig_label: Optional[str] = None,
    ) -> None:
        settings = get_settings()
        self._model: str = model or settings.llm_model
        self._max_tokens: int = settings.llm_max_tokens
        self._temperature: float = settings.llm_temperature
        self._base_url: str = (base_url or "").rstrip("/")
        self._fallback_local = bool(fallback_local)
        self._rig_label = rig_label or self._base_url

        if not self._base_url:
            raise ValueError("RemoteOllamaLLM requires a non-empty base_url.")

        self._client = ollama_client.AsyncClient(host=self._base_url)
        logger.info(
            "RemoteOllamaLLM initialized (rig=%s, base_url=%s, model=%s).",
            self._rig_label, self._base_url, self._model,
        )

    # -------------------------------------------------------------------------
    # Streaming chat — same shape as OllamaLLM.stream_response
    # -------------------------------------------------------------------------

    async def stream_response(self, messages: List[dict]) -> AsyncGenerator[str, None]:
        if not messages:
            return
        try:
            stream = await self._client.chat(
                model=self._model,
                messages=messages,
                stream=True,
                options={
                    "num_predict": self._max_tokens,
                    "temperature": self._temperature,
                },
            )
            async for part in stream:
                if isinstance(part, dict):
                    message = part.get("message", {})
                    chunk = (
                        message.get("content", "")
                        if isinstance(message, dict)
                        else getattr(message, "content", "")
                    )
                else:
                    chunk = getattr(getattr(part, "message", None), "content", "") or ""
                if chunk:
                    yield chunk
            return
        except Exception as exc:
            logger.warning("Remote Ollama (%s) failed: %s", self._rig_label, exc)
            if not self._fallback_local:
                raise

        # Fallback to local Ollama, preserving the requested model.
        try:
            from providers.llm.ollama import OllamaLLM
            local = OllamaLLM(model=self._model)
        except Exception as exc:
            logger.warning("Local Ollama fallback also unavailable: %s", exc)
            return
        async for chunk in local.stream_response(messages):
            yield chunk

    async def stream_chat(self, messages: list[dict]) -> AsyncGenerator[str, None]:
        async for chunk in self.stream_response(messages):
            yield chunk

    async def chat(self, messages: list[dict]) -> dict:
        out = ""
        async for chunk in self.stream_response(messages):
            out += chunk
        return {"content": out}


# -----------------------------------------------------------------------------
# Health-check + model discovery (used by the admin route)
# -----------------------------------------------------------------------------

async def health_check(base_url: str, *, timeout: Optional[float] = None) -> Tuple[str, List[str]]:
    """
    Probe a rig's `/api/tags` and return `("ok" | "down" | "unknown", [model_ids])`.
    Never raises — failure is reflected via the "down" / "unknown" status.
    """
    settings = get_settings()
    t = float(timeout if timeout is not None else getattr(settings, "remote_ollama_health_timeout_seconds", 3.0))
    base = (base_url or "").rstrip("/")
    if not base:
        return ("unknown", [])
    try:
        import httpx
    except ImportError:
        return ("unknown", [])
    try:
        async with httpx.AsyncClient(timeout=t) as client:
            resp = await client.get(f"{base}/api/tags")
            if resp.status_code != 200:
                return ("down", [])
            data = resp.json()
            models = []
            for m in (data.get("models") or []):
                name = m.get("name") if isinstance(m, dict) else None
                if name:
                    models.append(str(name))
            return ("ok", models)
    except Exception as exc:
        logger.info("Remote Ollama health-check failed for %s: %s", base, exc)
        return ("down", [])


async def resolve_rig(rig_id_or_label: str, store) -> Optional[dict]:
    """
    Find a remote rig by id or label. Returns None if not found or not active.
    """
    if not rig_id_or_label:
        return None
    row = await store.get_remote_rig(rig_id_or_label)
    if row is None:
        # Try by label (case-insensitive).
        rigs = await store.list_remote_rigs(include_inactive=True)
        match = next(
            (r for r in rigs if (r.get("label") or "").lower() == rig_id_or_label.lower()),
            None,
        )
        row = match
    if row is None or not row.get("is_active", True):
        return None
    return row


def build_remote_llm_from_rig(rig: dict, model: Optional[str]) -> RemoteOllamaLLM:
    return RemoteOllamaLLM(
        base_url=rig["base_url"],
        model=model,
        rig_label=rig.get("label", rig.get("id", "remote")),
    )
