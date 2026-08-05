"""
providers/llm/claude_api.py

Anthropic Claude API provider for River Song AI.
"""

from __future__ import annotations

import logging
from typing import AsyncGenerator, List, Optional

import anthropic
from config.settings import get_settings
from core.observability import trace_llm
from core.token_tracker import record_usage
from providers.base import LLMProvider

logger = logging.getLogger(__name__)


def _friendly_error(exc: Exception) -> str:
    err_str = str(exc).lower()
    if "rate limit" in err_str or "429" in err_str:
        return "I'm at my message limit, try again in a moment."
    if "authentication" in err_str or "api key" in err_str or "401" in err_str or "403" in err_str:
        return "My connection to that model isn't working — let your admin know."
    if "timeout" in err_str:
        return "That took too long, try again."
    return "I had trouble responding."


class ClaudeAPILLM(LLMProvider):
    """
    Stream responses from Anthropic Claude via the official SDK.
    """

    def __init__(self, model: Optional[str] = None) -> None:
        settings = get_settings()
        self._model: str = model or settings.llm_model
        self._max_tokens: int = settings.llm_max_tokens
        self._temperature: float = settings.llm_temperature
        self._client = anthropic.AsyncAnthropic(
            api_key=settings.anthropic_api_key)

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
                messages=chat_messages  # type: ignore
            )
            record_usage("anthropic", self._model,
                         response.usage.input_tokens, response.usage.output_tokens,
                         call_type="chat")
            return "".join(
                b.text for b in response.content if b.type == "text")
        except Exception as exc:
            logger.error("Claude API call failed: %s", exc, exc_info=True)
            return _friendly_error(exc)

    @trace_llm("anthropic")
    async def stream_response(
            self, messages: List[dict]) -> AsyncGenerator[str, None]:
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
                messages=chat_messages  # type: ignore
            ) as stream:
                async for text in stream.text_stream:
                    yield text
                try:
                    msg = await stream.get_final_message()
                    record_usage("anthropic", self._model,
                                 msg.usage.input_tokens, msg.usage.output_tokens,
                                 call_type="stream")
                except Exception:
                    pass
        except Exception as exc:
            logger.error("Claude streaming failed: %s", exc, exc_info=True)
            yield _friendly_error(exc)

    @trace_llm("anthropic")
    async def stream_response_thinking(
            self, messages: List[dict]) -> AsyncGenerator[str, None]:
        """Extended thinking mode for Claude. Temperature forced to 1, budget 5000 tokens."""
        system_prompt = ""
        chat_messages = messages
        if messages and messages[0].get("role") == "system":
            system_prompt = messages[0]["content"]
            chat_messages = messages[1:]
        try:
            async with self._client.messages.stream(  # type: ignore
                model=self._model,
                max_tokens=max(self._max_tokens, 16000),
                temperature=1,
                thinking={"type": "enabled", "budget_tokens": 5000},
                system=system_prompt,
                messages=chat_messages,  # type: ignore
                betas=["interleaved-thinking-2025-05-14"],
            ) as stream:
                async for text in stream.text_stream:
                    yield text
        except Exception as exc:
            logger.warning(
                "Claude thinking mode failed, falling back: %s", exc)
            async for chunk in self.stream_response(messages):
                yield chunk

    async def chat_with_tools(self, messages: list,
                              tools: list, system: str = "") -> dict:
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

            record_usage("anthropic", self._model,
                         response.usage.input_tokens, response.usage.output_tokens,
                         call_type="tools")

            if response.stop_reason == "tool_use":
                # Find the first tool_use block
                tool_use_block = next(
                    (b for b in response.content if b.type == "tool_use"), None)
                if tool_use_block:
                    return {
                        "type": "tool_call",
                        "tool_name": tool_use_block.name,
                        "tool_input": tool_use_block.input,
                        "tool_use_id": tool_use_block.id
                    }

            # Default to text response
            text = "".join(
                b.text for b in response.content if b.type == "text")
            return {"type": "text", "content": text}

        except Exception as exc:
            logger.error("Claude tool use call failed: %s", exc, exc_info=True)
            return {"type": "text", "content": _friendly_error(exc)}
