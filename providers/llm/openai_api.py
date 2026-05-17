# =============================================================================
# providers/llm/openai_api.py
#
# File Purpose:
#   OpenAI API provider for River Song AI.
#   Cloud LLM -- requires OPENAI_API_KEY in .env.
#   Displays a delay warning before each request (user preference).
#
# Key Classes:
#   OpenAILLM -- LLMProvider implementation using the OpenAI streaming API
#
# Dependencies:
#   openai (pip install openai)
#   providers.base (LLMProvider)
#   config.settings (get_settings)
#
# Usage Example:
#   provider = OpenAILLM()
#   async for chunk in provider.stream_response(messages):
#       print(chunk, end="", flush=True)
# =============================================================================

from __future__ import annotations

import logging
from typing import AsyncGenerator, List

import openai

from config.settings import get_settings
from core.token_tracker import record_usage
from providers.base import LLMProvider


logger = logging.getLogger(__name__)

_CLOUD_DELAY_WARNING = (
    "[Cloud LLM] Request sent to OpenAI API. "
    "Response time depends on network and API load."
)

def _friendly_error(exc: Exception) -> str:
    err_str = str(exc).lower()
    if "rate limit" in err_str or "429" in err_str:
        return "I'm at my message limit, try again in a moment."
    if "authentication" in err_str or "api key" in err_str or "unauthorized" in err_str or "401" in err_str:
        return "My connection to that model isn't working — let your admin know."
    if "timeout" in err_str:
        return "That took too long, try again."
    return "I had trouble responding."


class OpenAILLM(LLMProvider):
    """
    Purpose:
        Stream responses from OpenAI via the official SDK.

    Assumptions/Constraints:
        - OPENAI_API_KEY must be set in .env
        - messages format is already OpenAI-compatible (role/content dicts)
          so no translation is needed
        - A delay warning is logged before every request
    """

    def __init__(self, model: str | None = None) -> None:
        settings = get_settings()
        self._model: str = model or settings.llm_model
        self._max_tokens: int = settings.llm_max_tokens
        self._temperature: float = settings.llm_temperature
        self._client = openai.AsyncOpenAI(api_key=settings.openai_api_key)

        logger.info("OpenAILLM initialized (model=%s).", self._model)

    async def stream_response(
        self, messages: List[dict]
    ) -> AsyncGenerator[str, None]:
        """
        Stream a chat completion from OpenAI.

        Args:
            messages: Conversation history in OpenAI-compatible format.
                      Passed through directly -- no translation required.

        Yields:
            str: Text chunks as they stream from the API.

        Raises:
            RuntimeError: On API error, auth failure, or network timeout.
        """
        if not messages:
            logger.warning("stream_response called with empty messages list.")
            return

        logger.info(_CLOUD_DELAY_WARNING)

        try:
            stream = await self._client.chat.completions.create(
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
                record_usage("openai", self._model,
                             last_usage.prompt_tokens, last_usage.completion_tokens,
                             call_type="stream")

        except Exception as exc:
            logger.error("OpenAI API call failed: %s", exc, exc_info=True)
            yield _friendly_error(exc)
