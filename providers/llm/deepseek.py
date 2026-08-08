"""
providers/llm/deepseek.py

DeepSeek's first-party cloud API (platform.deepseek.com), OpenAI-compatible.

This is the third route to a DeepSeek model in this codebase and the only one
that costs money. The other two stay where they are:

  ollama      deepseek-r1:1.5b … :14b   local, free, limited by your VRAM
  nvidia_nim  deepseek-ai/deepseek-r1   free tier, ~40 req/min, shared
  deepseek    deepseek-chat / -reasoner metered, full-size, no rate ceiling

Requires DEEPSEEK_API_KEY and DEEPSEEK_ENABLED=true.

A note on `deepseek-reasoner`: it emits chain-of-thought before its answer and
bills that thinking as output tokens. A reply that looks the same length as
one from `deepseek-chat` can cost several times more, so the per-token price
difference understates the real gap. The usage panel shows actual tokens
rather than an estimate for exactly this reason.
"""

from __future__ import annotations

import logging
from typing import AsyncGenerator, List, Optional

from config.settings import get_settings
from providers.llm.openai_compatible import OpenAICompatibleLLM

logger = logging.getLogger(__name__)

#: Models that stream reasoning content in a separate delta field.
_REASONING_MODELS = frozenset({"deepseek-reasoner"})


class DeepSeekLLM(OpenAICompatibleLLM):
    """Stream responses from DeepSeek's cloud API."""

    provider_key = "deepseek"
    display_name = "DeepSeek"

    def __init__(self, model: Optional[str] = None) -> None:
        settings = get_settings()
        super().__init__(
            api_key=settings.deepseek_api_key,
            base_url=settings.deepseek_base_url,
            model=model or settings.deepseek_model,
            max_tokens=settings.llm_max_tokens,
            temperature=settings.llm_temperature,
        )

    def friendly_error(self, exc: Exception) -> str:
        err = str(exc).lower()
        # DeepSeek is prepaid: a spent balance returns 402 with this phrasing
        # rather than the "quota" wording the base class looks for.
        if "insufficient balance" in err:
            return "My DeepSeek balance is empty — let your admin know."
        return super().friendly_error(exc)

    async def stream_response_thinking(
        self, messages: List[dict]
    ) -> AsyncGenerator[str, None]:
        """Stream the reasoning trace, then the answer.

        `deepseek-reasoner` puts its chain of thought in `reasoning_content`
        on the delta, separate from `content`. Only that model emits it; for
        every other DeepSeek model this is identical to normal streaming, so
        it falls straight through rather than opening a request that would
        return nothing extra.
        """
        if self._model not in _REASONING_MODELS:
            async for chunk in self.stream_response(messages):
                yield chunk
            return

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
                if not delta:
                    continue
                thought = getattr(delta, "reasoning_content", None)
                if thought:
                    yield thought
                text = getattr(delta, "content", None)
                if text:
                    yield text
            self._record(last_usage, call_type="stream")
        except Exception as exc:
            logger.error("DeepSeek thinking stream failed: %s", exc, exc_info=True)
            raise RuntimeError(self.friendly_error(exc)) from exc
