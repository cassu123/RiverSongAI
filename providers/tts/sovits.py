# providers/tts/sovits.py
from __future__ import annotations
import logging
import os
from typing import Any
import httpx

logger = logging.getLogger(__name__)

_BASE = os.getenv("SOVITS_URL", "http://localhost:9880")
_CACHE_TTL = 30
_cache: dict[str, tuple[Any, float]] = {}


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(base_url=_BASE, timeout=30)


async def synthesize(text: str, persona: str = "river") -> bytes | None:
    """
    Synthesize speech using GPT-SoVITS.
    Each persona has a reference audio clip in config/voices/<persona>/sample.wav.
    """
    async with _client() as c:
        try:
            # GPT-SoVITS API expects the reference audio path and text
            # This is a simplified call to the typical SoVITS API wrapper
            params = {
                "text": text,
                "text_language": "en",
                "refer_wav_path": f"/workspace/reference_voices/{persona}/sample.wav",
                "prompt_text": "Sample text for reference audio",  # Should ideally be from a file
                "prompt_language": "en"
            }
            r = await c.get("/", params=params)
            r.raise_for_status()
            return r.content
        except Exception as exc:
            logger.warning("GPT-SoVITS synthesis failed: %s", exc)
            return None
