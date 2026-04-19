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
from mistralai.models import SDKError

from config.settings import get_settings
from providers.base import LLMProvider


logger = logging.getLogger(__name__)

_CLOUD_DELAY_WARNING = (
    "[Cloud LLM] Request sent to Mistral AI API. "
    "Response time depends on network and API load."
)


class MistralAILLM(LLMProvider):
    """
    Purpose:
        Stream responses from Mistral AI via the official SDK.

    Assumptions/Constraints:
        - MISTRAL_API_KEY must be set in .env
        - messages format is OpenAI-compatible (role/content dicts)
        - A delay warning is logged before every request
    """

    def __init__(self) -> None:
        settings = get_settings()
        self._model: str = settings.llm_model
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
            async with self._client.chat.stream_async(
                model=self._model,
                messages=messages,
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

        except SDKError as exc:
            status = getattr(exc, "status_code", None)
            if status in (401, 403):
                raise RuntimeError(
                    "Mistral AI authentication failed. Check MISTRAL_API_KEY in .env."
                ) from exc
            if status == 429:
                raise RuntimeError(
                    "Mistral AI rate limit exceeded. Try again shortly."
                ) from exc
            raise RuntimeError(
                f"Mistral AI API error (model={self._model}): {exc}"
            ) from exc
        except Exception as exc:
            raise RuntimeError(
                f"Unexpected error communicating with Mistral AI API: {exc}"
            ) from exc
