# =============================================================================
# providers/llm/bedrock.py
#
# File Purpose:
#   Amazon Bedrock LLM provider for River Song AI.
#   Uses the Bedrock Runtime Converse API, which normalizes the request/response
#   format across all Bedrock models (Nova, Claude, Llama, DeepSeek, Mistral).
#   One provider file covers every model available on Bedrock.
#
# Key Classes:
#   BedrockLLM -- LLMProvider implementation using boto3 converse_stream
#
# Dependencies:
#   boto3>=1.34.0
#   providers.base (LLMProvider)
#   config.settings (get_settings)
#
# AWS credentials are read from settings (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
# AWS_REGION). IAM permissions required: bedrock:InvokeModelWithResponseStream
#
# Usage Example:
#   provider = BedrockLLM(model="amazon.nova-pro-v1:0")
#   async for chunk in provider.stream_response(messages):
#       print(chunk, end="", flush=True)
# =============================================================================

from __future__ import annotations

import asyncio
import logging
from typing import AsyncGenerator, List

from config.settings import get_settings
from providers.base import LLMProvider


logger = logging.getLogger(__name__)

_CLOUD_DELAY_WARNING = (
    "[Cloud LLM] Request sent to Amazon Bedrock. "
    "Response time depends on network and model load."
)


def _friendly_error(exc: Exception) -> str:
    err_str = str(exc).lower()
    if "rate limit" in err_str or "429" in err_str or "throttling" in err_str:
        return "I'm at my message limit, try again in a moment."
    if "authentication" in err_str or "api key" in err_str or "forbidden" in err_str or "403" in err_str:
        return "My connection to that model isn't working — let your admin know."
    if "timeout" in err_str:
        return "That took too long, try again."
    return "I had trouble responding."


class BedrockLLM(LLMProvider):
    """
    Purpose:
        Stream responses from Amazon Bedrock via the Converse API.
        Supports all Bedrock models: Nova, Claude, Llama, DeepSeek, Mistral, etc.

    Assumptions/Constraints:
        - AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION must be set in .env
        - BEDROCK_ENABLED=true must be set in .env
        - IAM user/role needs bedrock:InvokeModelWithResponseStream permission
        - messages[0] with role "system" is extracted and passed as the system prompt
        - boto3 is synchronous; streaming is run in a thread pool to stay async
    """

    def __init__(self, model: str | None = None) -> None:
        settings = get_settings()
        self._model: str = model or settings.llm_model
        self._max_tokens: int = settings.llm_max_tokens
        self._temperature: float = settings.llm_temperature
        self._region: str = settings.aws_region

        import boto3
        self._client = boto3.client(
            "bedrock-runtime",
            region_name=self._region,
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
        )

        logger.info(
            "BedrockLLM initialized (model=%s, region=%s).",
            self._model,
            self._region)

    async def stream_response(
            self, messages: List[dict]) -> AsyncGenerator[str, None]:
        """
        Stream a chat completion from Amazon Bedrock via the Converse API.

        Args:
            messages: Conversation history. If messages[0].role == "system",
                      it is extracted and passed as the Bedrock system parameter.

        Yields:
            str: Text chunks as they stream from the API.

        Raises:
            RuntimeError: On API error, auth failure, or network timeout.
        """
        if not messages:
            logger.warning("stream_response called with empty messages list.")
            return

        logger.info(_CLOUD_DELAY_WARNING)

        system_blocks = []
        chat_messages = messages

        if messages and messages[0].get("role") == "system":
            system_blocks = [{"text": messages[0]["content"]}]
            chat_messages = messages[1:]

        # Convert to Bedrock Converse format
        converse_messages = []
        for m in chat_messages:
            role = m.get("role", "user")
            content = m.get("content", "")
            if role in ("user", "assistant") and content:
                converse_messages.append({
                    "role": role,
                    "content": [{"text": content}],
                })

        if not converse_messages:
            return

        inference_config = {
            "maxTokens": self._max_tokens,
            "temperature": self._temperature,
        }

        # boto3 is synchronous — run in thread pool to avoid blocking the event
        # loop
        queue: asyncio.Queue[str | None] = asyncio.Queue()
        loop = asyncio.get_running_loop()

        def _stream_sync():
            try:
                kwargs = {
                    "modelId": self._model,
                    "messages": converse_messages,
                    "inferenceConfig": inference_config,
                }
                if system_blocks:
                    kwargs["system"] = system_blocks

                response = self._client.converse_stream(**kwargs)
                stream = response.get("stream")
                if not stream:
                    loop.call_soon_threadsafe(queue.put_nowait, None)
                    return

                for event in stream:
                    if "contentBlockDelta" in event:
                        delta = event["contentBlockDelta"].get("delta", {})
                        text = delta.get("text", "")
                        if text:
                            loop.call_soon_threadsafe(queue.put_nowait, text)
                    elif "messageStop" in event:
                        break

            except Exception as exc:
                logger.error("Bedrock API call failed: %s", exc, exc_info=True)
                loop.call_soon_threadsafe(
                    queue.put_nowait,
                    _friendly_error(exc)
                )
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, None)

        thread = asyncio.get_running_loop().run_in_executor(None, _stream_sync)

        try:
            while True:
                chunk = await queue.get()
                if chunk is None:
                    break
                yield chunk
        finally:
            await thread
