"""
core/observability.py

Langfuse LLM tracing for River Song AI.

This module is the single source of truth for "did the LLM call work, how long
did it take, what did it say." Decorators wrap provider stream methods so every
LLM round-trip becomes a span tagged with the calling agent role.

Behaviour when Langfuse is disabled (the default):
  - get_langfuse() returns None.
  - The @trace_llm decorator becomes a transparent pass-through.
  - Zero overhead vs. the un-decorated call.

Behaviour when Langfuse is enabled:
  - SDK is initialised once at import time and reused.
  - Each decorated call yields a Langfuse `generation` span: input messages,
    streamed output text, model name, latency, and metadata (agent role +
    provider).
  - The agent-role registry is also poked so the SLAE admin panel shows the
    last invocation for the role.

Plan: docs/LANGFUSE_INTEGRATION_PLAN.md.
"""

from __future__ import annotations

import functools
import inspect
import logging
import threading
import time
from typing import Any, AsyncIterator, Callable, Optional

from config.settings import get_settings
from providers.llm.agent_roles import AgentRole, get_role_registry

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Lazy singleton — built once, cheap to call repeatedly.
# ---------------------------------------------------------------------------

_client: Optional[Any] = None
_client_lock = threading.Lock()
_client_initialized = False


def _build_client() -> Optional[Any]:
    """Construct the Langfuse client from settings, or return None if disabled."""
    settings = get_settings()
    if not getattr(settings, "langfuse_enabled", False):
        return None
    if not (settings.langfuse_public_key and settings.langfuse_secret_key):
        logger.warning(
            "Langfuse enabled but keys are empty — tracing is OFF. "
            "Generate keys at %s and set LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY.",
            settings.langfuse_host,
        )
        return None

    try:
        from langfuse import Langfuse  # type: ignore
    except ImportError:
        logger.warning(
            "LANGFUSE_ENABLED=true but the `langfuse` package is not installed. "
            "Run: pip install -r requirements.txt"
        )
        return None

    try:
        client = Langfuse(
            host=settings.langfuse_host,
            public_key=settings.langfuse_public_key,
            secret_key=settings.langfuse_secret_key,
            flush_interval=settings.langfuse_flush_interval_seconds,
            release=settings.langfuse_project_id,
        )
        logger.info("Langfuse client initialised at %s", settings.langfuse_host)
        return client
    except Exception as e:
        logger.error("Failed to initialise Langfuse client: %s", e)
        return None


def get_langfuse() -> Optional[Any]:
    """Return the process-wide Langfuse client, or None if disabled / failed."""
    global _client, _client_initialized
    if _client_initialized:
        return _client
    with _client_lock:
        if not _client_initialized:
            _client = _build_client()
            _client_initialized = True
    return _client


def shutdown() -> None:
    """Flush + close the Langfuse client. Call from FastAPI shutdown hook."""
    global _client, _client_initialized
    if _client is not None:
        try:
            _client.flush()
            _client.shutdown()
        except Exception as e:
            logger.warning("Langfuse shutdown failed: %s", e)
    _client = None
    _client_initialized = False


# ---------------------------------------------------------------------------
# @trace_llm — wraps stream_response-style async-generator methods.
# ---------------------------------------------------------------------------

def trace_llm(
    provider: str,
    *,
    role: Optional[AgentRole] = None,
    model_attr: str = "_model",
) -> Callable:
    """Decorator for async-generator LLM stream methods.

    Wrap `stream_response(self, messages, ...) -> AsyncIterator[str]` so that:
      1. A Langfuse `generation` span is opened with the input messages.
      2. Each streamed chunk is concatenated and recorded as output on End.
      3. Elapsed time + success/failure are recorded.
      4. The role registry's `record_invocation` is also poked so the SLAE
         admin panel shows the call.

    Args:
        provider: provider key used as the Langfuse "model.provider" tag.
        role: optional AgentRole — if provided, recorded on the trace and into
              the role registry. Daemons that already know their role pass it;
              ad-hoc calls leave it None.
        model_attr: instance attribute on `self` that exposes the model id
                    string (defaults to `_model`, the convention in
                    providers/llm/*.py).

    The decorator is a no-op when Langfuse is disabled.
    """

    def decorator(fn: Callable[..., AsyncIterator[str]]) -> Callable[..., AsyncIterator[str]]:
        if not inspect.isasyncgenfunction(fn):
            raise TypeError(
                f"@trace_llm only wraps async-generator functions, got {fn.__qualname__!r}"
            )

        @functools.wraps(fn)
        async def wrapper(self, *args, **kwargs):
            client = get_langfuse()
            model_id = getattr(self, model_attr, "unknown")
            messages = args[0] if args else kwargs.get("messages")
            started = time.perf_counter()

            generation = None
            if client is not None:
                try:
                    generation = client.generation(
                        name=f"{provider}.stream_response",
                        model=model_id,
                        input=messages,
                        metadata={
                            "provider": provider,
                            "agent_role": role.value if role else None,
                        },
                    )
                except Exception as e:
                    logger.debug("Langfuse generation() open failed: %s", e)
                    generation = None

            collected_chunks: list[str] = []
            ok = True
            err_msg: Optional[str] = None
            try:
                async for chunk in fn(self, *args, **kwargs):
                    collected_chunks.append(chunk)
                    yield chunk
            except Exception as e:
                ok = False
                err_msg = str(e)
                raise
            finally:
                elapsed_ms = int((time.perf_counter() - started) * 1000)
                output_text = "".join(collected_chunks)

                if generation is not None:
                    try:
                        generation.end(
                            output=output_text,
                            level="ERROR" if not ok else "DEFAULT",
                            status_message=err_msg or "ok",
                        )
                    except Exception as e:
                        logger.debug("Langfuse generation.end() failed: %s", e)

                if role is not None:
                    try:
                        get_role_registry().record_invocation(
                            role,
                            success=ok,
                            elapsed_ms=elapsed_ms,
                            error=err_msg,
                            model_id_override=model_id,
                        )
                    except Exception as e:
                        logger.debug("Role invocation record failed: %s", e)

        return wrapper

    return decorator
