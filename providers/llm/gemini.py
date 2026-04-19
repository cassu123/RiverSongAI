# =============================================================================
# providers/llm/gemini.py
#
# File Purpose:
#   Google Gemini API provider for River Song AI.
#   Cloud LLM -- requires GEMINI_API_KEY in .env.
#   Displays a delay warning before each request (user preference).
#
# Key Classes:
#   GeminiLLM -- LLMProvider implementation using the google-genai streaming API
#
# Dependencies:
#   google-genai (pip install google-genai)
#   providers.base (LLMProvider)
#   config.settings (get_settings)
#
# Usage Example:
#   provider = GeminiLLM()
#   async for chunk in provider.stream_response(messages):
#       print(chunk, end="", flush=True)
# =============================================================================

from __future__ import annotations

import logging
from typing import AsyncGenerator, List

from google import genai
from google.genai import types as genai_types

from config.settings import get_settings
from providers.base import LLMProvider


logger = logging.getLogger(__name__)

_CLOUD_DELAY_WARNING = (
    "[Cloud LLM] Request sent to Google Gemini API. "
    "Response time depends on network and API load."
)


class GeminiLLM(LLMProvider):
    """
    Purpose:
        Stream responses from Google Gemini via the google-genai SDK.

    Assumptions/Constraints:
        - GEMINI_API_KEY must be set in .env
        - messages[0] with role "system" is extracted as the system instruction
        - Gemini uses "user" / "model" roles -- this provider maps
          OpenAI-compatible "assistant" -> "model" automatically
        - A delay warning is logged before every request
    """

    def __init__(self) -> None:
        settings = get_settings()
        self._model: str = settings.llm_model
        self._max_tokens: int = settings.llm_max_tokens
        self._temperature: float = settings.llm_temperature
        self._client = genai.Client(api_key=settings.gemini_api_key)

        logger.info("GeminiLLM initialized (model=%s).", self._model)

    async def stream_response(
        self, messages: List[dict]
    ) -> AsyncGenerator[str, None]:
        """
        Stream a chat completion from Gemini.

        Args:
            messages: Conversation history in OpenAI-compatible format.
                      "system" role extracted as system_instruction.
                      "assistant" role mapped to "model" for Gemini.

        Yields:
            str: Text chunks as they stream from the API.

        Raises:
            RuntimeError: On API error, auth failure, or network timeout.
        """
        if not messages:
            logger.warning("stream_response called with empty messages list.")
            return

        logger.info(_CLOUD_DELAY_WARNING)

        system_instruction = None
        chat_messages: List[genai_types.Content] = []

        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")

            if role == "system":
                system_instruction = content
                continue

            gemini_role = "model" if role == "assistant" else "user"
            chat_messages.append(
                genai_types.Content(
                    role=gemini_role,
                    parts=[genai_types.Part(text=content)],
                )
            )

        config = genai_types.GenerateContentConfig(
            max_output_tokens=self._max_tokens,
            temperature=self._temperature,
            system_instruction=system_instruction,
        )

        try:
            async for chunk in await self._client.aio.models.generate_content_stream(
                model=self._model,
                contents=chat_messages,
                config=config,
            ):
                text = chunk.text
                if text:
                    yield text

        except Exception as exc:
            error_str = str(exc).lower()
            if "api_key" in error_str or "unauthorized" in error_str or "403" in error_str:
                raise RuntimeError(
                    "Gemini API authentication failed. Check GEMINI_API_KEY in .env."
                ) from exc
            if "quota" in error_str or "429" in error_str:
                raise RuntimeError(
                    "Gemini API quota exceeded. Try again later."
                ) from exc
            raise RuntimeError(
                f"Gemini API error (model={self._model}): {exc}"
            ) from exc
