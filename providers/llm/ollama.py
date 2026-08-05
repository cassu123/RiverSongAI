# =============================================================================
# providers/llm/ollama.py
#
# Ollama-backed Language Model provider for River Song AI.
#
# Communicates with a locally running Ollama instance via the official
# ollama Python client. Responses are streamed chunk-by-chunk to enable
# real-time text display in the frontend without waiting for the full
# response to be generated.
#
# Prerequisites:
#   1. Install Ollama: https://ollama.com
#   2. Start the server: `ollama serve`
#   3. Pull the model:  `ollama pull llama3.1:8b`
#
# Required packages: ollama==0.3.3
# =============================================================================

from __future__ import annotations

import logging
from typing import AsyncGenerator, List

import ollama as ollama_client

from config.settings import get_settings
from providers.base import LLMProvider


logger = logging.getLogger(__name__)


class OllamaLLM(LLMProvider):
    """
    LLM provider that streams responses from a local Ollama instance.

    Maintains no state between calls -- conversation history is passed
    in with every call as the `messages` argument. The caller
    (ConversationLoop) owns and manages the history.
    """

    def __init__(self, model: str | None = None) -> None:
        """
        Initialize the Ollama async client from application settings.

        Raises:
            RuntimeError: If the Ollama base URL is malformed.
        """
        settings = get_settings()
        self._model: str = model or settings.llm_model
        self._max_tokens: int = settings.llm_max_tokens
        self._temperature: float = settings.llm_temperature
        self._base_url: str = settings.ollama_base_url

        logger.info(
            "OllamaLLM initialized (model=%s, url=%s).",
            self._model,
            self._base_url,
        )

        self._client = ollama_client.AsyncClient(host=self._base_url)

    # -------------------------------------------------------------------------
    # Public interface (LLMProvider)
    # -------------------------------------------------------------------------

    async def stream_response(
        self, messages: List[dict]
    ) -> AsyncGenerator[str, None]:
        """
        Stream a chat completion from Ollama, yielding text chunks as they arrive.

        Args:
            messages: Conversation history in OpenAI-compatible format:
                      [{"role": "system"|"user"|"assistant", "content": "..."}]
                      The system prompt must be the first entry; the caller
                      is responsible for building this list.

        Yields:
            str: Individual text fragments from the model output.

        Raises:
            RuntimeError: If Ollama is unreachable, the model is not found,
                          or the API returns an unexpected error.

        Example:
            full = ""
            async for chunk in provider.stream_response(messages):
                full += chunk
                print(chunk, end="", flush=True)
        """
        if not messages:
            logger.warning(
                "stream_response called with an empty messages list.")
            return

        logger.debug(
            "Sending %d message(s) to Ollama model '%s'.", len(
                messages), self._model
        )

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
                # The ollama library returns dict-like objects. Support both
                # attribute and dict access defensively.
                if isinstance(part, dict):
                    message = part.get("message", {})
                    chunk = (
                        message.get("content", "")
                        if isinstance(message, dict)
                        else getattr(message, "content", "")
                    )
                else:
                    chunk = getattr(
                        getattr(part, "message", None), "content", ""
                    ) or ""

                if chunk:
                    yield chunk

        except ollama_client.ResponseError as exc:
            raise RuntimeError(
                f"Ollama returned an error for model '{self._model}': {exc}"
            ) from exc
        except Exception as exc:
            raise RuntimeError(
                f"Failed to communicate with Ollama at '{
                    self._base_url}': {exc}"
            ) from exc

    async def stream_chat(
            self, messages: list[dict]) -> AsyncGenerator[str, None]:
        """
        Alias for stream_response, specifically for Phase 2 implementation.
        """
        async for chunk in self.stream_response(messages):
            yield chunk

    async def chat_with_tools(self, messages: list, tools: list) -> dict:  # type: ignore
        """
        Send a message to Ollama with a list of available tools.
        Returns a tool_call dict if a tool is requested, else a text response.
        """
        try:
            # We must map our tool schemas to Ollama's format if they differ.
            # Ollama uses the same format as OpenAI/Anthropic for the most
            # part.
            formatted_tools = []
            for t in tools:
                formatted_tools.append({
                    "type": "function",
                    "function": {
                        "name": t["name"],
                        "description": t["description"],
                        "parameters": t["input_schema"]
                    }
                })

            response = await self._client.chat(
                model=self._model,
                messages=messages,
                tools=formatted_tools,
                options={"temperature": self._temperature}
            )

            message = response.get("message", {})
            if message.get("tool_calls"):
                tc = message["tool_calls"][0]
                return {
                    "type": "tool_call",
                    "tool_name": tc["function"]["name"],
                    "tool_input": tc["function"]["arguments"],
                    "tool_use_id": None
                }

            return {"type": "text", "content": message.get("content", "")}

        except Exception as exc:
            logger.error("Ollama tool use call failed: %s", exc)
            return {
                "type": "text", "content": f"My local brain had a hiccup during tool use: {exc}"}
