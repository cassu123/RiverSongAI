# =============================================================================
# providers/llm/mistral_api.py
#
# File Purpose:
#   Mistral AI API provider for River Song AI.
#   Cloud LLM -- requires MISTRAL_API_KEY in .env.
#   Displays a delay warning before each request (user preference).
#
# Key Classes:
#   MistralAILLM -- LLMProvider implementation using the Mistral streaming API
#
# Dependencies:
#   mistralai (pip install mistralai)
#   providers.base (LLMProvider)
#   config.settings (get_settings)
#
# Usage Example:
#   provider = MistralAILLM()
#   async for chunk in provider.stream_response(messages):
#       print(chunk, end="", flush=True)
# =============================================================================

from __future__ import annotations

import logging
from typing import AsyncGenerator, List

from mistralai import Mistral

from config.settings import get_settings
from providers.base import LLMProvider


logger = logging.getLogger(__name__)

_CLOUD_DELAY_WARNING = (
    "[Cloud LLM] Request sent to Mistral AI API. "
    "Response time depends on network and API load."
)


def _friendly_error(exc: Exception) -> str:
    err_str = str(exc).lower()
    if "rate limit" in err_str or "429" in err_str:
        return "I'm at my message limit, try again in a moment."
    if "authentication" in err_str or "api key" in err_str or "unauthorized" in err_str or "401" in err_str or "403" in err_str:
        return "My connection to that model isn't working — let your admin know."
    if "timeout" in err_str:
        return "That took too long, try again."
    return "I had trouble responding."


class MistralAILLM(LLMProvider):
    """
    Purpose:
        Stream responses from Mistral AI via the official SDK.

    Assumptions/Constraints:
        - MISTRAL_API_KEY must be set in .env
        - messages format is OpenAI-compatible (role/content dicts)
        - A delay warning is logged before every request
    """

    def __init__(self, model: str | None = None) -> None:
        settings = get_settings()
        self._model: str = model or settings.llm_model
        self._max_tokens: int = settings.llm_max_tokens
        self._temperature: float = settings.llm_temperature
        self._client = Mistral(api_key=settings.mistral_api_key)

        logger.info("MistralAILLM initialized (model=%s).", self._model)

    async def stream_response(
        self, messages: List[dict]
    ) -> AsyncGenerator[str, None]:
        """
        Stream a chat completion from Mistral AI.

        Args:
            messages: Conversation history in OpenAI-compatible format.
                      Passed through directly -- Mistral uses the same schema.

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
            async with self._client.chat.stream_async(  # type: ignore
                model=self._model,
                messages=messages,  # type: ignore
                max_tokens=self._max_tokens,
                temperature=self._temperature,
            ) as stream:
                async for event in stream:
                    delta = (
                        event.data.choices[0].delta
                        if event.data and event.data.choices
                        else None
                    )
                    text = getattr(delta, "content", None) if delta else None
                    if text:
                        yield text

        except Exception as exc:
            logger.error("Mistral AI API call failed: %s", exc, exc_info=True)
            yield _friendly_error(exc)
