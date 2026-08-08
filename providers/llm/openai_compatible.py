"""
providers/llm/openai_compatible.py

Shared base for cloud LLM providers that speak the OpenAI chat-completions
protocol over a different base URL.

A growing number of providers ship an OpenAI-compatible endpoint precisely so
that clients do not need bespoke code — DeepSeek and Alibaba's DashScope both
do. Writing a fourth and fifth hand-rolled copy of the same streaming loop
would mean five places to fix the next time a usage field moves or an error
shape changes, so the loop lives here once and the subclasses supply only what
actually differs: the settings they read, and how their errors read to a user.

Deliberately NOT retrofitted onto `openai_api.py` or `nvidia_nim.py`. Those
work, are exercised in production, and rewriting them buys nothing here — this
base exists to stop the duplication growing, not to relitigate what is already
running.

Usage accounting is the reason the streaming path asks for
`stream_options={"include_usage": True}`: without it the final chunk carries
no token counts and every streamed reply would be recorded as zero spend,
which for a metered provider means a usage dashboard that reads $0.00 while
the bill climbs.
"""

from __future__ import annotations

import logging
from typing import AsyncGenerator, List, Optional

import openai

from core.token_tracker import record_usage
from providers.base import LLMProvider

logger = logging.getLogger(__name__)


class OpenAICompatibleLLM(LLMProvider):
    """Chat + streaming against any OpenAI-protocol endpoint.

    Subclasses set `provider_key` (the string used in usage records and the
    model registry) and pass the connection details to __init__.
    """

    #: Provider name recorded in token_usage rows. Must match the `provider`
    #: field used by registry entries, or the admin usage panel cannot join
    #: spend to models.
    provider_key: str = "openai_compatible"

    #: Human-readable name used in the fallback error messages.
    display_name: str = "this model"

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        model: str,
        max_tokens: int,
        temperature: float,
        timeout: Optional[float] = None,
    ) -> None:
        self._model = model
        self._max_tokens = max_tokens
        self._temperature = temperature
        client_kwargs = {"api_key": api_key, "base_url": base_url}
        if timeout is not None:
            client_kwargs["timeout"] = timeout
        self._client = openai.AsyncOpenAI(**client_kwargs)
        logger.info(
            "%s initialized (model=%s, base_url=%s).",
            type(self).__name__,
            model,
            base_url,
        )

    # -------------------------------------------------------------------------
    # Error surface
    # -------------------------------------------------------------------------

    def friendly_error(self, exc: Exception) -> str:
        """Turn a provider exception into something worth saying out loud.

        These strings are spoken by River, so they name the problem and who
        can fix it rather than echoing a stack trace at someone standing in
        their kitchen. Subclasses override to add provider-specific cases —
        an exhausted prepaid balance, say — and should fall back to super().
        """
        err = str(exc).lower()
        if "rate limit" in err or "429" in err:
            return f"I'm at my {self.display_name} rate limit — try again in a moment."
        if "insufficient" in err or "quota" in err or "billing" in err or "402" in err:
            return f"My {self.display_name} account is out of credit — let your admin know."
        if any(s in err for s in ("authentication", "api key", "401", "403")):
            return f"My {self.display_name} connection isn't working — let your admin know."
        if "timeout" in err or "timed out" in err:
            return "That took too long, try again."
        return "I had trouble responding."

    # -------------------------------------------------------------------------
    # Completions
    # -------------------------------------------------------------------------

    async def chat(self, messages: List[dict]) -> str:
        """Non-streaming chat completion."""
        if not messages:
            return ""
        try:
            response = await self._client.chat.completions.create(
                model=self._model,
                messages=messages,  # type: ignore[arg-type]
                max_tokens=self._max_tokens,
                temperature=self._temperature,
            )
            self._record(response.usage, call_type="chat")
            return response.choices[0].message.content or ""
        except Exception as exc:
            logger.error(
                "%s chat failed: %s", type(self).__name__, exc, exc_info=True
            )
            return self.friendly_error(exc)

    async def stream_response(
        self, messages: List[dict]
    ) -> AsyncGenerator[str, None]:
        """Stream a chat completion."""
        if not messages:
            return
        try:
            stream = await self._client.chat.completions.create(  # type: ignore[call-overload]
                model=self._model,
                messages=messages,
                max_tokens=self._max_tokens,
                temperature=self._temperature,
                stream=True,
                stream_options={"include_usage": True},
            )
            last_usage = None
            async for chunk in stream:
                if getattr(chunk, "usage", None):
                    last_usage = chunk.usage
                delta = chunk.choices[0].delta if chunk.choices else None
                text = getattr(delta, "content", None) if delta else None
                if text:
                    yield text
            self._record(last_usage, call_type="stream")
        except Exception as exc:
            logger.error(
                "%s streaming failed: %s", type(self).__name__, exc, exc_info=True
            )
            yield self.friendly_error(exc)

    async def stream_response_thinking(
        self, messages: List[dict]
    ) -> AsyncGenerator[str, None]:
        """No separate thinking mode by default — falls through to streaming."""
        async for chunk in self.stream_response(messages):
            yield chunk

    # -------------------------------------------------------------------------
    # Internals
    # -------------------------------------------------------------------------

    def _record(self, usage, call_type: str) -> None:
        """Write one token_usage row, if the response carried counts.

        Never raises: a provider that omits usage, or renames a field, must
        not turn a successful answer into an error the user sees.
        """
        if not usage:
            return
        try:
            record_usage(
                self.provider_key,
                self._model,
                getattr(usage, "prompt_tokens", 0) or 0,
                getattr(usage, "completion_tokens", 0) or 0,
                call_type=call_type,
            )
        except Exception as exc:  # pragma: no cover - defensive
            logger.debug("usage recording failed for %s: %s", self.provider_key, exc)
