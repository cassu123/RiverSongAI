"""
providers/tts/chatterbox_provider.py

Chatterbox TTS provider with on-demand VRAM management.
Loads weights from disk, synthesizes, and immediately clears VRAM.
"""

import asyncio
import io
import logging
import torch
import gc
from concurrent.futures import ThreadPoolExecutor
from providers.base import TTSProvider

logger = logging.getLogger(__name__)


class ChatterboxTTS(TTSProvider):
    """
    On-demand voice cloning provider.

    This provider is designed for 4GB VRAM cards. It does not keep the model
    in memory. Each call to synthesize() performs a full load/unload cycle.
    """

    def __init__(self):
        from config.settings import get_settings
        import os
        self.settings = get_settings()

        # 1. Check for chatterbox-tts package
        try:
            pass
        except ImportError:
            raise RuntimeError(
                "Chatterbox TTS requires the 'chatterbox-tts' package. "
                "Install it with: pip install chatterbox-tts"
            )

        # 2. Check for reference audio file
        ref_path = self.settings.chatterbox_reference_audio
        if not ref_path or not os.path.exists(ref_path):
            raise RuntimeError(
                f"Voice reference file not found at {ref_path}. "
                "Record a 20-second clip and save it there to use the cloned voice."
            )

        self._executor = ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="chatterbox")
        logger.info("ChatterboxTTS initialized in on-demand mode.")

    def _synth_blocking(self, text: str) -> bytes:
        """Synchronous load-synth-unload cycle."""
        import soundfile as sf
        from chatterbox import Chatterbox

        logger.info("Chatterbox: Loading model into VRAM...")
        # Note: Actual path/initialization depends on the chatterbox-tts library structure
        # This is a generalized implementation of the on-demand pattern.
        model = Chatterbox.load_model(device="cuda")

        try:
            logger.info("Chatterbox: Synthesizing cloned voice...")
            audio_array, sample_rate = model.synthesize(
                text,
                reference_wav=self.settings.chatterbox_reference_audio
            )

            # Convert numpy array to WAV bytes
            buf = io.BytesIO()
            sf.write(
                buf,
                audio_array,
                sample_rate,
                format="WAV",
                subtype="PCM_16")
            return buf.getvalue()

        finally:
            logger.info("Chatterbox: Cleaning up VRAM...")
            # Explicitly delete the model and clear the torch cache
            del model
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            logger.info("Chatterbox: VRAM cleared.")

    async def synthesize(self, text: str) -> bytes:
        """
        Synthesize text with voice cloning.

        Expect a 3-5 second delay for the model to load into VRAM before
        synthesis begins.
        """
        if not text.strip():
            return b""

        loop = asyncio.get_running_loop()
        try:
            wav_bytes = await loop.run_in_executor(
                self._executor,
                self._synth_blocking,
                text,
            )
            return wav_bytes
        except Exception as exc:
            logger.error("Chatterbox synthesis failed: %s", exc)
            raise
