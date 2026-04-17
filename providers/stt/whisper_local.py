# =============================================================================
# providers/stt/whisper_local.py
#
# Local Whisper-based Speech-to-Text provider for River Song AI.
#
# Uses sounddevice to capture microphone audio and OpenAI Whisper
# (running fully locally, no API key required) for transcription.
#
# Audio capture is blocking by nature, so all device calls are dispatched
# to a ThreadPoolExecutor to avoid stalling the asyncio event loop.
#
# First run: Whisper auto-downloads the selected model. Model sizes and
# approximate disk usage:
#   tiny   ~75 MB    fast, lower accuracy
#   base   ~145 MB   good balance for desktop use
#   small  ~460 MB
#   medium ~1.5 GB
#   large  ~3 GB     highest accuracy, requires significant VRAM
#
# Required packages: openai-whisper, sounddevice, numpy
# =============================================================================

from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from typing import Optional

import numpy as np
import sounddevice as sd
import whisper

from config.settings import get_settings
from providers.base import STTProvider


logger = logging.getLogger(__name__)

# Whisper requires 16 kHz mono audio
SAMPLE_RATE: int = 16_000
CHANNELS: int = 1

# Voice activity detection tuning constants
VAD_CHUNK_DURATION_SEC: float = 0.1    # Length of each read chunk
VAD_SILENCE_THRESHOLD: float = 0.01   # RMS energy below this is silence
VAD_SILENCE_DURATION_SEC: float = 1.5  # Seconds of silence that ends recording
VAD_MAX_RECORD_SEC: float = 30.0       # Hard cap -- never record longer than this
VAD_PRESPEECH_LIMIT: int = 600         # Max chunks to wait before speech begins


class WhisperLocalSTT(STTProvider):
    """
    STT provider backed by a locally running Whisper model.

    The Whisper model is loaded once during __init__ and kept in memory
    for the lifetime of the application. Model download (on first use)
    can take several minutes depending on model size and network speed.
    Subsequent starts use the cached model from disk and are fast.
    """

    def __init__(self) -> None:
        """
        Load the Whisper model specified in application settings.

        Raises:
            RuntimeError: If the model cannot be loaded (bad name, OOM, etc.).
        """
        settings = get_settings()
        self._model_size: str = settings.whisper_model_size
        self._input_device: Optional[int] = settings.audio_input_device

        # Limit to 2 workers: one for recording, one for transcribing.
        # They never run simultaneously but a pool avoids thread-creation
        # overhead on every call.
        self._executor = ThreadPoolExecutor(
            max_workers=2, thread_name_prefix="whisper"
        )

        logger.info(
            "Loading Whisper model '%s' -- this may take a moment on first run.",
            self._model_size,
        )
        try:
            self._model = whisper.load_model(self._model_size)
            logger.info("Whisper model '%s' loaded.", self._model_size)
        except Exception as exc:
            raise RuntimeError(
                f"Failed to load Whisper model '{self._model_size}': {exc}"
            ) from exc

    # -------------------------------------------------------------------------
    # Public interface (STTProvider)
    # -------------------------------------------------------------------------

    async def record_until_silence(self) -> np.ndarray:
        """
        Capture microphone audio until a silence boundary is detected.

        Recording begins as soon as speech energy exceeds VAD_SILENCE_THRESHOLD
        and stops after VAD_SILENCE_DURATION_SEC of consecutive silence.
        A hard cap of VAD_MAX_RECORD_SEC prevents runaway recordings.

        Returns:
            np.ndarray: 1-D float32 audio at SAMPLE_RATE Hz.

        Raises:
            RuntimeError: If the audio device is unavailable.
        """
        loop = asyncio.get_running_loop()
        audio = await loop.run_in_executor(
            self._executor,
            partial(_record_blocking, self._input_device),
        )
        return audio

    async def transcribe(self, audio: np.ndarray) -> str:
        """
        Transcribe a captured audio array with the local Whisper model.

        Args:
            audio: 1-D float32 numpy array at SAMPLE_RATE Hz.

        Returns:
            Transcribed text stripped of leading/trailing whitespace.
            Empty string if Whisper produces no output.

        Raises:
            RuntimeError: If transcription fails unexpectedly.
        """
        if audio is None or len(audio) == 0:
            logger.warning("transcribe() received an empty audio array.")
            return ""

        loop = asyncio.get_running_loop()
        try:
            text = await loop.run_in_executor(
                self._executor,
                partial(self._transcribe_blocking, audio),
            )
            stripped = text.strip()
            logger.info("Transcription result: '%s'", stripped)
            return stripped
        except Exception as exc:
            raise RuntimeError(f"Whisper transcription failed: {exc}") from exc

    # -------------------------------------------------------------------------
    # Blocking helpers (executed in thread pool, not on the event loop)
    # -------------------------------------------------------------------------

    def _transcribe_blocking(self, audio: np.ndarray) -> str:
        """
        Synchronous Whisper transcription call.

        Args:
            audio: 1-D float32 numpy array.

        Returns:
            Raw transcribed text string (may include leading/trailing spaces).
        """
        result = self._model.transcribe(audio, fp16=False, language="en")
        return result.get("text", "")


def _record_blocking(input_device: Optional[int]) -> np.ndarray:
    """
    Synchronous microphone capture loop using sounddevice.

    This is a module-level function (not a method) so it can be passed
    to run_in_executor without capturing the instance via self.

    Args:
        input_device: Sounddevice device index, or None for system default.

    Returns:
        np.ndarray: Concatenated float32 audio samples at SAMPLE_RATE Hz.

    Raises:
        RuntimeError: If the audio stream cannot be opened.
    """
    chunk_frames = int(SAMPLE_RATE * VAD_CHUNK_DURATION_SEC)
    silence_chunk_limit = int(VAD_SILENCE_DURATION_SEC / VAD_CHUNK_DURATION_SEC)
    max_speech_chunks = int(VAD_MAX_RECORD_SEC / VAD_CHUNK_DURATION_SEC)

    chunks: list[np.ndarray] = []
    silence_count: int = 0
    speech_started: bool = False

    logger.debug("Opening audio input stream (device=%s).", input_device)

    try:
        with sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=CHANNELS,
            device=input_device,
            dtype="float32",
        ) as stream:
            logger.info("Listening -- waiting for speech...")

            for _ in range(VAD_PRESPEECH_LIMIT + max_speech_chunks):
                chunk, _ = stream.read(chunk_frames)
                rms = float(np.sqrt(np.mean(chunk ** 2)))

                if not speech_started:
                    if rms > VAD_SILENCE_THRESHOLD:
                        speech_started = True
                        logger.debug("Speech detected (RMS=%.4f), recording.", rms)
                        chunks.append(chunk.copy())
                    # No speech yet -- keep polling
                    continue

                # Speech is in progress -- accumulate
                chunks.append(chunk.copy())

                if rms < VAD_SILENCE_THRESHOLD:
                    silence_count += 1
                    if silence_count >= silence_chunk_limit:
                        logger.debug(
                            "%.1f s of silence reached, stopping.", VAD_SILENCE_DURATION_SEC
                        )
                        break
                else:
                    silence_count = 0

                if len(chunks) >= max_speech_chunks:
                    logger.warning(
                        "Hit hard recording cap of %.1f seconds.", VAD_MAX_RECORD_SEC
                    )
                    break

    except sd.PortAudioError as exc:
        raise RuntimeError(f"Audio device error during recording: {exc}") from exc

    if not chunks:
        logger.warning("No speech was detected during the recording window.")
        return np.zeros(chunk_frames, dtype="float32")

    audio = np.concatenate(chunks, axis=0).flatten()
    logger.debug("Captured %.2f seconds of audio.", len(audio) / SAMPLE_RATE)
    return audio
