"""
providers/tts/elevenlabs.py

ElevenLabs TTS provider for River Song AI.
Supports high-quality British female voice clone with streaming.
"""

import asyncio
import logging
import io
from typing import AsyncGenerator, Optional

import httpx
from providers.base import TTSProvider
from config.settings import get_settings

logger = logging.getLogger(__name__)

class ElevenLabsTTS(TTSProvider):
    """
    TTS provider using the ElevenLabs API.
    
    Supports streaming audio chunks to the browser for near-instant playback.
    Note: ElevenLabs charges per character.
    """

    def __init__(self, voice_code: Optional[str] = None):
        self.settings = get_settings()
        self.voice_code = voice_code or self.settings.elevenlabs_voice_id
        
        if not self.settings.elevenlabs_api_key:
            raise RuntimeError("ElevenLabs requires an API key. Set ELEVENLABS_API_KEY in your .env")
        
        # We'll build the base URL without the voice ID for now, 
        # and append it in synthesize/stream_synthesize if we want to be flexible,
        # but the prompt says use the voice_code from the VoiceEntry.
        self.base_url = "https://api.elevenlabs.io/v1/text-to-speech"

    async def synthesize(self, text: str) -> bytes:
        """Fetch full audio as a single block (non-streaming fallback)."""
        if not text.strip():
            return b""
            
        url = f"{self.base_url}/{self.voice_code}"
            
        async with httpx.AsyncClient() as client:
            headers = {
                "xi-api-key": self.settings.elevenlabs_api_key,
                "Content-Type": "application/json"
            }
            payload = {
                "text": text,
                "model_id": self.settings.elevenlabs_model_id,
                "voice_settings": {
                    "stability": 0.5,
                    "similarity_boost": 0.75
                }
            }
            params = {"output_format": "mp3_44100_128"}
            
            resp = await client.post(url, json=payload, headers=headers, params=params, timeout=30.0)
            if resp.status_code in (401, 422):
                raise RuntimeError(f"ElevenLabs API error {resp.status_code}: {resp.text}")
            elif resp.status_code != 200:
                raise RuntimeError(f"ElevenLabs API error {resp.status_code}: {resp.text}")
            
            return resp.content

    async def stream_synthesize(self, text: str) -> AsyncGenerator[bytes, None]:
        """Stream audio chunks from ElevenLabs."""
        if not text.strip():
            return

        url = f"{self.base_url}/{self.voice_code}/stream"

        headers = {
            "xi-api-key": self.settings.elevenlabs_api_key,
            "Content-Type": "application/json"
        }
        payload = {
            "text": text,
            "model_id": self.settings.elevenlabs_model_id,
            "voice_settings": {
                "stability": 0.5,
                "similarity_boost": 0.75
            }
        }
        params = {"output_format": "mp3_44100_128"}

        async with httpx.AsyncClient() as client:
            async with client.stream("POST", url, json=payload, headers=headers, params=params, timeout=60.0) as resp:
                if resp.status_code in (401, 422):
                    err_text = await resp.aread()
                    raise RuntimeError(f"ElevenLabs streaming error {resp.status_code}: {err_text.decode()}")
                elif resp.status_code != 200:
                    err_text = await resp.aread()
                    raise RuntimeError(f"ElevenLabs streaming error {resp.status_code}: {err_text.decode()}")
                
                async for chunk in resp.aiter_bytes(chunk_size=4096):
                    yield chunk
