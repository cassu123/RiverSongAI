# =============================================================================
# providers/tts/kokoro_provider.py
#
# Kokoro TTS provider for River Song AI.
#
# Kokoro is an 82M parameter neural TTS model that runs on CPU in real-time.
# Install: pip install kokoro  (torch already required by openai-whisper)
# Model auto-downloads ~325 MB from HuggingFace on first use.
#
# Supported voice IDs (prefix key):
#   American female: af_sky, af_bella, af_river, af_heart, af_nicole, af_sarah,
#                    af_jessica, af_kore, af_nova, af_alloy, af_aoede
#   American male:   am_adam, am_echo, am_eric, am_fenrir, am_liam, am_michael,
#                    am_onyx, am_puck, am_santa
#   British female:  bf_alice, bf_emma, bf_isabella, bf_lily
#   British male:    bm_daniel, bm_fable, bm_george, bm_lewis
#
# The lang_code is derived from the voice_code prefix:
#   'a' prefix → American English ('a')
#   'b' prefix → British English  ('b')
# =============================================================================

from __future__ import annotations

import asyncio
import io
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from providers.base import TTSProvider

logger = logging.getLogger(__name__)


def _lang_code_from_voice(voice_code: str) -> str:
    """Derive Kokoro lang_code from voice prefix (af_* → 'a', bf_* → 'b')."""
    if voice_code.startswith("b"):
        return "b"   # British English
    return "a"       # American English (default)


class KokoroTTS(TTSProvider):
    """
    TTS provider backed by the Kokoro 82M parameter neural model.

    Runs entirely on CPU — no VRAM required.  The KPipeline is initialized
    lazily on the first synthesize() call and kept in memory for the lifetime
    of the connection.

    Returns raw WAV bytes (same contract as PiperTTS) so the browser can
    decode and play them via the Web Audio API.
    """

    def __init__(self, voice_code: str = "af_river") -> None:
        self._voice_code  = voice_code
        self._lang_code   = _lang_code_from_voice(voice_code)
        self._pipeline    = None          # lazy — initialized on first use
        self._executor    = ThreadPoolExecutor(max_workers=1, thread_name_prefix="kokoro")
        logger.info("KokoroTTS configured (voice=%s, lang=%s)", voice_code, self._lang_code)

    # -------------------------------------------------------------------------
    # Internal helpers
    # -------------------------------------------------------------------------

    def _load_pipeline(self):
        """Import and initialize KPipeline (downloads model on first run)."""
        if self._pipeline is not None:
            return
        try:
            from kokoro import KPipeline
        except ImportError as exc:
            raise RuntimeError(
                "Kokoro is not installed. Run: pip install kokoro"
            ) from exc

        logger.info("Loading Kokoro pipeline (lang=%s) — first run downloads ~325 MB …", self._lang_code)
        self._pipeline = KPipeline(lang_code=self._lang_code)
        logger.info("Kokoro pipeline ready.")

    def _synth_blocking(self, text: str) -> bytes:
        """Run Kokoro synthesis in the calling thread (must be in executor)."""
        import numpy as np
        import soundfile as sf

        self._load_pipeline()

        # KPipeline returns a generator of (graphemes, phonemes, audio_array) tuples.
        # We collect all chunks and concatenate.
        chunks = []
        sample_rate = 24_000   # Kokoro outputs at 24 kHz

        generator = self._pipeline(text, voice=self._voice_code, speed=1.0)
        for _, _, audio in generator:
            if audio is not None and len(audio) > 0:
                chunks.append(audio)

        if not chunks:
            logger.warning("Kokoro produced no audio for text: %.60r", text)
            return b""

        audio_np = np.concatenate(chunks)

        # Convert numpy float32 array → WAV bytes
        buf = io.BytesIO()
        sf.write(buf, audio_np, sample_rate, format="WAV", subtype="PCM_16")
        return buf.getvalue()

    # -------------------------------------------------------------------------
    # TTSProvider interface
    # -------------------------------------------------------------------------

    async def synthesize(self, text: str) -> bytes:
        """
        Synthesize text using Kokoro and return WAV bytes.

        Args:
            text: Plain text to speak. Empty strings return b"".

        Returns:
            Raw WAV file bytes at 24 kHz, or b"" if text is empty.
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
            logger.error("Kokoro synthesis failed: %s", exc)
            raise
