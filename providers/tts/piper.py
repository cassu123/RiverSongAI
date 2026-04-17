# =============================================================================
# providers/tts/piper.py
#
# Piper-backed Text-to-Speech provider for River Song AI.
#
# Piper (https://github.com/rhasspy/piper) is a fast, fully local neural
# TTS engine. This provider shells out to the Piper binary, captures WAV
# output to a temp file, then plays it through the system audio output via
# sounddevice + soundfile.
#
# Piper must be installed separately -- it is NOT available via pip.
# Download from: https://github.com/rhasspy/piper/releases
# Voice models: https://huggingface.co/rhasspy/piper-voices
#
# All subprocess calls and audio playback run in a ThreadPoolExecutor
# to avoid blocking the asyncio event loop.
#
# Required packages: sounddevice, soundfile
# =============================================================================

from __future__ import annotations

import asyncio
import logging
import os
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from typing import Optional

import sounddevice as sd
import soundfile as sf

from config.settings import get_settings
from providers.base import TTSProvider


logger = logging.getLogger(__name__)


class PiperTTS(TTSProvider):
    """
    TTS provider that synthesizes speech using the local Piper binary.

    speak() is fully async-safe. Internally, synthesis and playback block
    a worker thread while the event loop remains free to handle other work
    (e.g., incoming WebSocket messages).
    """

    def __init__(self) -> None:
        """
        Validate Piper configuration and verify files exist on disk.

        Raises:
            ValueError: If PIPER_MODEL_PATH is empty.
            FileNotFoundError: If the Piper executable or model file is missing.
        """
        settings = get_settings()
        self._piper_path: str = settings.piper_executable_path
        self._model_path: str = settings.piper_model_path
        self._output_device: Optional[int] = settings.audio_output_device

        # Single worker: TTS is inherently sequential -- one sentence at a time.
        self._executor = ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="piper"
        )

        self._validate_configuration()

        logger.info(
            "PiperTTS initialized (model=%s).",
            os.path.basename(self._model_path),
        )

    # -------------------------------------------------------------------------
    # Public interface (TTSProvider)
    # -------------------------------------------------------------------------

    async def speak(self, text: str) -> None:
        """
        Synthesize text with Piper and play the resulting audio.

        Awaiting this coroutine blocks until playback has fully completed,
        ensuring the conversation loop does not start listening again while
        River Song is still speaking.

        Args:
            text: Plain text to synthesize. Empty strings are silently skipped.

        Raises:
            RuntimeError: If Piper synthesis fails or audio playback fails.
        """
        if not text or not text.strip():
            logger.warning("speak() called with empty text -- skipping.")
            return

        cleaned = text.strip()
        logger.debug("Synthesizing %d characters with Piper.", len(cleaned))

        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            self._executor,
            partial(self._synthesize_and_play, cleaned),
        )

    # -------------------------------------------------------------------------
    # Blocking helpers (executed in thread pool, not on the event loop)
    # -------------------------------------------------------------------------

    def _synthesize_and_play(self, text: str) -> None:
        """
        Shell out to Piper, write WAV to a temp file, play it, clean up.

        Args:
            text: Text to synthesize.

        Raises:
            RuntimeError: On Piper failure or sounddevice playback error.
        """
        wav_path: Optional[str] = None
        try:
            with tempfile.NamedTemporaryFile(
                suffix=".wav", delete=False, prefix="riversong_tts_"
            ) as tmp:
                wav_path = tmp.name

            self._run_piper(text, wav_path)
            self._play_wav(wav_path)

        finally:
            if wav_path and os.path.exists(wav_path):
                try:
                    os.unlink(wav_path)
                except OSError as exc:
                    logger.warning(
                        "Could not delete temp WAV '%s': %s", wav_path, exc
                    )

    def _run_piper(self, text: str, output_wav_path: str) -> None:
        """
        Invoke the Piper binary to synthesize text into a WAV file.

        Args:
            text: Text to synthesize.
            output_wav_path: Destination path for the generated WAV file.

        Raises:
            RuntimeError: If Piper times out or exits with a non-zero code.
        """
        command = [
            self._piper_path,
            "--model", self._model_path,
            "--output_file", output_wav_path,
        ]

        try:
            result = subprocess.run(
                command,
                input=text.encode("utf-8"),
                capture_output=True,
                timeout=60,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError(
                "Piper synthesis timed out after 60 seconds."
            ) from exc
        except FileNotFoundError as exc:
            raise RuntimeError(
                f"Piper binary not found at '{self._piper_path}'. "
                "Check PIPER_EXECUTABLE_PATH in .env."
            ) from exc

        if result.returncode != 0:
            stderr = result.stderr.decode("utf-8", errors="replace")
            raise RuntimeError(
                f"Piper exited with code {result.returncode}: {stderr}"
            )

        logger.debug("Piper synthesis complete -> '%s'.", output_wav_path)

    def _play_wav(self, wav_path: str) -> None:
        """
        Play a WAV file through the configured audio output device.

        Blocks until playback is fully complete.

        Args:
            wav_path: Absolute path to the WAV file to play.

        Raises:
            RuntimeError: If the file cannot be read or playback fails.
        """
        try:
            data, sample_rate = sf.read(wav_path, dtype="float32")
        except Exception as exc:
            raise RuntimeError(
                f"Failed to read synthesized WAV '{wav_path}': {exc}"
            ) from exc

        duration = len(data) / sample_rate
        logger.debug("Playing %.2f seconds at %d Hz.", duration, sample_rate)

        try:
            sd.play(data, samplerate=sample_rate, device=self._output_device)
            sd.wait()  # Blocks until playback finishes
        except sd.PortAudioError as exc:
            raise RuntimeError(f"Audio playback failed: {exc}") from exc

    # -------------------------------------------------------------------------
    # Internal validation
    # -------------------------------------------------------------------------

    def _validate_configuration(self) -> None:
        """
        Verify that required files exist before accepting any speak() calls.

        Raises:
            ValueError: If PIPER_MODEL_PATH is not configured.
            FileNotFoundError: If either required file is missing from disk.
        """
        if not self._model_path:
            raise ValueError(
                "PIPER_MODEL_PATH is not set. "
                "Add it to .env pointing to your .onnx voice model file."
            )
        if not os.path.isfile(self._piper_path):
            raise FileNotFoundError(
                f"Piper executable not found at '{self._piper_path}'. "
                "Install Piper and set PIPER_EXECUTABLE_PATH in .env."
            )
        if not os.path.isfile(self._model_path):
            raise FileNotFoundError(
                f"Piper voice model not found at '{self._model_path}'. "
                "Download a voice from https://huggingface.co/rhasspy/piper-voices "
                "and set PIPER_MODEL_PATH in .env."
            )
