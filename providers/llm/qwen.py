"""
providers/llm/qwen.py

Qwen (Alibaba Cloud Model Studio / DashScope), via its OpenAI-compatible mode.

Separate from the local `ollama` qwen2.5:* entries, which stay free and stay
where they are. This route reaches the full-size hosted models — qwen-max in
particular has no local equivalent that will fit on a home GPU.

Requires QWEN_API_KEY and QWEN_ENABLED=true.

**Region matters here in a way it does not for the other providers.**
DashScope runs separate international and mainland-China deployments with
different hostnames, and a key issued in one region returns an authentication
error against the other. The default base URL is the international endpoint;
if a valid-looking key gets 401s, that mismatch is the first thing to check,
not the key itself.
"""

from __future__ import annotations

import logging
from typing import Optional

from config.settings import get_settings
from providers.llm.openai_compatible import OpenAICompatibleLLM

logger = logging.getLogger(__name__)


class QwenLLM(OpenAICompatibleLLM):
    """Stream responses from Qwen via DashScope's OpenAI-compatible endpoint."""

    provider_key = "qwen"
    display_name = "Qwen"

    def __init__(self, model: Optional[str] = None) -> None:
        settings = get_settings()
        super().__init__(
            api_key=settings.qwen_api_key,
            base_url=settings.qwen_base_url,
            model=model or settings.qwen_model,
            max_tokens=settings.llm_max_tokens,
            temperature=settings.llm_temperature,
        )

    def friendly_error(self, exc: Exception) -> str:
        err = str(exc).lower()
        # The region mismatch described in the module docstring surfaces as a
        # plain auth failure, which sends people to regenerate a key that was
        # never the problem. Name it instead.
        if "invalidapikey" in err.replace(" ", "") or "invalid api-key" in err:
            return (
                "My Qwen key was rejected — it may have been issued for a "
                "different DashScope region. Let your admin know."
            )
        if "arrearage" in err or "insufficient balance" in err:
            return "My Qwen account is out of credit — let your admin know."
        return super().friendly_error(exc)
