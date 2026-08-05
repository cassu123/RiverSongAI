"""
providers/llm/nvidia_nim.py

NVIDIA NIM provider for River Song AI.
Uses the OpenAI-compatible endpoint at integrate.api.nvidia.com/v1.
One API key unlocks the full 100+ model catalog — model is swapped per-request.

Requires: NVIDIA_API_KEY and NVIDIA_NIM_ENABLED=true in .env.
"""

from __future__ import annotations

import logging
from typing import AsyncGenerator, List, Optional

import openai

from config.settings import get_settings
from core.token_tracker import record_usage
from providers.base import LLMProvider

logger = logging.getLogger(__name__)


def _friendly_error(exc: Exception) -> str:
    err_str = str(exc).lower()
    if "rate limit" in err_str or "429" in err_str:
        return "I'm at my NIM rate limit — try again in a moment."
    if "authentication" in err_str or "api key" in err_str or "401" in err_str or "403" in err_str:
        return "My NVIDIA NIM connection isn't working — let your admin know."
    if "timeout" in err_str:
        return "That took too long, try again."
    return "I had trouble responding."


class NvidiaNimLLM(LLMProvider):
    """
    Stream responses from NVIDIA NIM via its OpenAI-compatible API.
    Base URL and model are configurable; auth is the nvapi- key.
    """

    def __init__(self, model: Optional[str] = None) -> None:
        settings = get_settings()
        self._model: str = model or settings.nvidia_nim_model
        self._max_tokens: int = settings.llm_max_tokens
        self._temperature: float = settings.llm_temperature
        self._client = openai.AsyncOpenAI(
            api_key=settings.nvidia_api_key,
            base_url=settings.nvidia_nim_base_url,
        )
        logger.info("NvidiaNimLLM initialized (model=%s).", self._model)

    async def chat(self, messages: List[dict]) -> str:
        """Non-streaming chat completion."""
        if not messages:
            return ""
        try:
            response = await self._client.chat.completions.create(
                model=self._model,
                messages=messages,  # type: ignore
                max_tokens=self._max_tokens,
                temperature=self._temperature,
            )
            usage = response.usage
            if usage:
                record_usage("nvidia_nim", self._model,
                             usage.prompt_tokens, usage.completion_tokens,
                             call_type="chat")
            return response.choices[0].message.content or ""
        except Exception as exc:
            logger.error("NIM chat failed: %s", exc, exc_info=True)
            return _friendly_error(exc)

    async def stream_response(
            self, messages: List[dict]) -> AsyncGenerator[str, None]:
        """Stream a chat completion from NIM."""
        if not messages:
            return
        try:
            stream = await self._client.chat.completions.create(  # type: ignore
                model=self._model,
                messages=messages,
                max_tokens=self._max_tokens,
                temperature=self._temperature,
                stream=True,
                stream_options={"include_usage": True},
            )
            last_usage = None
            async for chunk in stream:
                if chunk.usage:
                    last_usage = chunk.usage
                delta = chunk.choices[0].delta if chunk.choices else None
                text = getattr(delta, "content", None) if delta else None
                if text:
                    yield text

            if last_usage:
                record_usage("nvidia_nim", self._model,
                             last_usage.prompt_tokens, last_usage.completion_tokens,
                             call_type="stream")
        except Exception as exc:
            logger.error("NIM streaming failed: %s", exc, exc_info=True)
            yield _friendly_error(exc)

    async def stream_response_thinking(
            self, messages: List[dict]) -> AsyncGenerator[str, None]:
        """NIM has no dedicated thinking mode — falls through to standard streaming."""
        async for chunk in self.stream_response(messages):
            yield chunk
