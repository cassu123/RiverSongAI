import asyncio
import logging
from typing import Optional, Dict, Tuple

from config.settings import get_settings

logger = logging.getLogger(__name__)

class ProviderPool:
    _instance = None
    _lock = asyncio.Lock()
    
    def __init__(self):
        self.stt = None
        self.tts = None
        self.stt_model_size = None
        self.tts_voice_id = None
        
    @classmethod
    async def get_instance(cls):
        if cls._instance is None:
            async with cls._lock:
                if cls._instance is None:
                    cls._instance = ProviderPool()
        return cls._instance

    async def get_stt(self, model_size: Optional[str] = None):
        settings = get_settings()
        # Only rebuild if the model size changes
        # Whisper model size is the main config
        target_size = model_size or settings.stt_provider # using stt_provider as proxy
        async with self._lock:
            if self.stt is None or self.stt_model_size != target_size:
                from core.conversation_loop import _build_stt_provider
                self.stt = _build_stt_provider(model_size=model_size)
                self.stt_model_size = target_size
            return self.stt

    async def get_tts(self, voice_id: Optional[str] = None):
        async with self._lock:
            if self.tts is None or self.tts_voice_id != voice_id:
                from core.conversation_loop import _build_tts_provider
                self.tts = _build_tts_provider(voice_id_override=voice_id)
                self.tts_voice_id = voice_id
            return self.tts
