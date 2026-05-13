"""
providers/llm/claude_api.py

Anthropic Claude API provider for River Song AI.
"""

from __future__ import annotations

import logging
from typing import AsyncGenerator, List, Optional

import anthropic
from config.settings import get_settings
from providers.base import LLMProvider

logger = logging.getLogger(__name__)

class ClaudeAPILLM(LLMProvider):
    """
    Stream responses from Anthropic Claude via the official SDK.
    """

    def __init__(self) -> None:
        settings = get_settings()
        self._model: str = settings.llm_model
        self._max_tokens: int = settings.llm_max_tokens
        self._temperature: float = settings.llm_temperature
        self._client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

    async def chat(self, messages: List[dict]) -> str:
        """Non-streaming chat."""
        system_prompt = ""
        chat_messages = messages
        if messages and messages[0].get("role") == "system":
            system_prompt = messages[0]["content"]
            chat_messages = messages[1:]

        try:
            response = await self._client.messages.create(
                model=self._model,
                max_tokens=self._max_tokens,
                temperature=self._temperature,
                system=system_prompt,
                messages=chat_messages
            )
            return "".join(b.text for b in response.content if b.type == "text")
        except Exception as exc:
            logger.error("Claude API call failed: %s", exc)
            return f"I had trouble reaching my cloud brain: {exc}"

    async def stream_response(self, messages: List[dict]) -> AsyncGenerator[str, None]:
        """Stream response from Claude."""
        system_prompt = ""
        chat_messages = messages
        if messages and messages[0].get("role") == "system":
            system_prompt = messages[0]["content"]
            chat_messages = messages[1:]

        try:
            async with self._client.messages.stream(
                model=self._model,
                max_tokens=self._max_tokens,
                temperature=self._temperature,
                system=system_prompt,
                messages=chat_messages
            ) as stream:
                async for text in stream.text_stream:
                    yield text
        except Exception as exc:
            logger.error("Claude streaming failed: %s", exc)
            yield f"\n[Claude API Error]: {exc}"

    async def stream_response_thinking(self, messages: List[dict]) -> AsyncGenerator[str, None]:
        """Extended thinking mode for Claude. Temperature forced to 1, budget 5000 tokens."""
        system_prompt = ""
        chat_messages = messages
        if messages and messages[0].get("role") == "system":
            system_prompt = messages[0]["content"]
            chat_messages = messages[1:]
        try:
            async with self._client.messages.stream(
                model=self._model,
                max_tokens=max(self._max_tokens, 16000),
                temperature=1,
                thinking={"type": "enabled", "budget_tokens": 5000},
                system=system_prompt,
                messages=chat_messages,
                betas=["interleaved-thinking-2025-05-14"],
            ) as stream:
                async for text in stream.text_stream:
                    yield text
        except Exception as exc:
            logger.warning("Claude thinking mode failed, falling back: %s", exc)
            async for chunk in self.stream_response(messages):
                yield chunk

    async def chat_with_tools(self, messages: list, tools: list, system: str = "") -> dict:
        """
        Send a message to Claude with a list of available tools.
        If Claude chooses to use a tool, returns a tool_call dict.
        Otherwise returns a text response.
        """
        if not system and messages and messages[0].get("role") == "system":
            system = messages[0]["content"]
            messages = messages[1:]

        try:
            response = await self._client.messages.create(
                model=self._model,
                max_tokens=self._max_tokens,
                temperature=self._temperature,
                system=system,
                messages=messages,
                tools=tools
            )

            if response.stop_reason == "tool_use":
                # Find the first tool_use block
                tool_use_block = next((b for b in response.content if b.type == "tool_use"), None)
                if tool_use_block:
                    return {
                        "type": "tool_call",
                        "tool_name": tool_use_block.name,
                        "tool_input": tool_use_block.input,
                        "tool_use_id": tool_use_block.id
                    }

            # Default to text response
            text = "".join(b.text for b in response.content if b.type == "text")
            return {"type": "text", "content": text}

        except Exception as exc:
            logger.error("Claude tool use call failed: %s", exc)
            return {"type": "text", "content": f"I had trouble reaching my cloud brain for tool use: {exc}"}
