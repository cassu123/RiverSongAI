# =============================================================================
# providers/llm/claude_api.py
#
# File Purpose:
#   Anthropic Claude API provider for River Song AI.
#   Cloud LLM -- requires ANTHROPIC_API_KEY in .env.
#   Displays a delay warning before each request (user preference).
#
# Key Classes:
#   ClaudeAPILLM -- LLMProvider implementation using the Anthropic streaming API
#
# Dependencies:
#   anthropic==0.96.0
#   providers.base (LLMProvider)
#   config.settings (get_settings)
#
# Usage Example:
#   provider = ClaudeAPILLM()
#   async for chunk in provider.stream_response(messages):
#       print(chunk, end="", flush=True)
# =============================================================================

from __future__ import annotations

import logging
from typing import AsyncGenerator, List

import anthropic

from config.settings import get_settings
from providers.base import LLMProvider


logger = logging.getLogger(__name__)

_CLOUD_DELAY_WARNING = (
    "[Cloud LLM] Request sent to Anthropic Claude API. "
    "Response time depends on network and API load."
)


class ClaudeAPILLM(LLMProvider):
    """
    Purpose:
        Stream responses from Anthropic Claude via the official SDK.

    Assumptions/Constraints:
        - ANTHROPIC_API_KEY must be set in .env
        - messages[0] must be the system prompt with role "system"
        - The Anthropic API separates the system prompt from the message list;
          this provider handles that extraction automatically
        - A delay warning is logged before every request (cloud latency notice)
    """

    def __init__(self) -> None:
        settings = get_settings()
        self._model: str = settings.llm_model
        self._max_tokens: int = settings.llm_max_tokens
        self._temperature: float = settings.llm_temperature
        self._client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

        logger.info("ClaudeAPILLM initialized (model=%s).", self._model)

    async def stream_response(
        self, messages: List[dict]
    ) -> AsyncGenerator[str, None]:
        """
        Stream a chat completion from Claude.

        Args:
            messages: Conversation history. If messages[0].role == "system",
                      it is extracted and passed as the Anthropic system parameter.
                      Remaining messages must alternate user/assistant.

        Yields:
            str: Text chunks as they stream from the API.

        Raises:
            RuntimeError: On API error, auth failure, or network timeout.
        """
        if not messages:
            logger.warning("stream_response called with empty messages list.")
            return

        logger.info(_CLOUD_DELAY_WARNING)

        system_prompt = ""
        chat_messages = messages

        if messages and messages[0].get("role") == "system":
            system_prompt = messages[0]["content"]
            chat_messages = messages[1:]

        try:
            async with self._client.messages.stream(
                model=self._model,
                max_tokens=self._max_tokens,
                system=system_prompt,
                messages=chat_messages,
            ) as stream:
                async for text in stream.text_stream:
                    if text:
                        yield text

        except anthropic.AuthenticationError as exc:
            raise RuntimeError(
                "Anthropic API authentication failed. Check ANTHROPIC_API_KEY in .env."
            ) from exc
        except anthropic.RateLimitError as exc:
            raise RuntimeError(
                "Anthropic API rate limit exceeded. Try again shortly."
            ) from exc
        except anthropic.APIError as exc:
            raise RuntimeError(
                f"Anthropic API error (model={self._model}): {exc}"
            ) from exc
        except Exception as exc:
            raise RuntimeError(
                f"Unexpected error communicating with Anthropic API: {exc}"
            ) from exc
