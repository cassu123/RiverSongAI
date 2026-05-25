# =============================================================================
# providers/stt/whisper_local.py
#
# Local Whisper-based Speech-to-Text provider for River Song AI.
#
# Receives WAV bytes from the browser (captured via Web Audio API and sent
# over the WebSocket). Decodes them to a numpy array, resamples to 16 kHz
# if necessary, and runs the local Whisper model for transcription.
#
# No sounddevice or microphone access occurs on the server.
#
# First run: Whisper auto-downloads the selected model to ~/.cache/whisper/.
# Model sizes and approximate disk usage:
#   tiny   ~75 MB    fast, lower accuracy
#   base   ~145 MB   good balance for server use
#   small  ~460 MB
#   medium ~1.5 GB
#   large  ~3 GB     highest accuracy, requires significant VRAM
#
# Required packages: openai-whisper, soundfile, scipy, numpy
# =============================================================================

from __future__ import annotations

import asyncio
import io
import logging
import os
import tempfile
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from typing import Optional

import numpy as np
import scipy.signal
import soundfile as sf

from config.settings import get_settings
from providers.base import STTProvider


logger = logging.getLogger(__name__)

WHISPER_SAMPLE_RATE: int = 16_000


def _cuda_usable() -> bool:
    """Return True only if CUDA is available AND a quick tensor op succeeds."""
    try:
        import torch
        t = torch.tensor([1.0], device="cuda")
        _ = t + t
        return True
    except Exception:
        return False


class WhisperLocalSTT(STTProvider):
    """
    STT provider backed by a locally running Whisper model.

    The Whisper model is loaded once during __init__ and kept in memory
    for the lifetime of the application. Model download (on first use)
    can take several minutes depending on model size and network speed.
    Subsequent starts use the cached model from disk and are fast.

    Audio arrives as WAV bytes from the browser and is decoded server-side.
    """

    def __init__(self, model_size: Optional[str] = None) -> None:
        settings = get_settings()
        self._model_size: str = model_size or settings.whisper_model_size

        self._executor = ThreadPoolExecutor(
            max_workers=2, thread_name_prefix="whisper"
        )

        logger.info(
            "Loading Faster-Whisper model '%s' -- this may take a moment on first run.",
            self._model_size,
        )
        try:
            # Lazy-import the heavy dep so module-load doesn't require it.
            from faster_whisper import WhisperModel
            import torch
            device = "cuda" if torch.cuda.is_available() and _cuda_usable() else "cpu"
            # Faster-Whisper uses CTranslate2. Recommended compute_type:
            # - float16 for CUDA
            # - int8 for CPU
            compute_type = "float16" if device == "cuda" else "int8"

            self._model = WhisperModel(
                self._model_size,
                device=device,
                compute_type=compute_type
            )
            logger.info("Faster-Whisper model '%s' loaded on %s (%s).", 
                        self._model_size, device, compute_type)
        except Exception as exc:
            raise RuntimeError(
                f"Failed to load Faster-Whisper model '{self._model_size}': {exc}"
            ) from exc

    async def transcribe(self, audio_bytes: bytes) -> str:
        """
        Transcribe WAV bytes captured by the browser to plain text.

        Args:
            audio_bytes: Raw WAV file bytes at any sample rate.

        Returns:
            Transcribed text, stripped of whitespace. Empty string on silence.
        """
        if not audio_bytes:
            return ""

        loop = asyncio.get_running_loop()
        try:
            text = await loop.run_in_executor(
                self._executor,
                partial(self._transcribe_blocking, audio_bytes),
            )
            stripped = text.strip()
            if stripped:
                logger.info("Transcription result: '%s'", stripped)
            return stripped
        except Exception as exc:
            raise RuntimeError(f"Whisper transcription failed: {exc}") from exc

    def _transcribe_blocking(self, audio_bytes: bytes) -> str:
        """
        Decode audio bytes (WAV or raw PCM), resample to 16 kHz, and run Faster-Whisper.
        """
        if audio_bytes.startswith(b"RIFF"):
            try:
                audio_np, sample_rate = sf.read(
                    io.BytesIO(audio_bytes), dtype="float32"
                )
            except Exception as exc:
                raise RuntimeError(f"Failed to decode WAV bytes: {exc}") from exc

            # Convert stereo to mono if needed
            if audio_np.ndim > 1:
                audio_np = audio_np.mean(axis=1)

            # Resample to 16 kHz if the browser sent a different rate
            if sample_rate != WHISPER_SAMPLE_RATE:
                target_length = int(len(audio_np) * WHISPER_SAMPLE_RATE / sample_rate)
                audio_np = scipy.signal.resample(audio_np, target_length).astype(np.float32)
        else:
            # Assume raw 16-bit PCM at 16kHz from AudioWorklet
            audio_np = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0

        segments, _ = self._model.transcribe(audio_np, beam_size=5, language="en")
        return " ".join(s.text.strip() for s in segments)
