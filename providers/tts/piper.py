# =============================================================================
# providers/tts/piper.py
#
# Piper-backed Text-to-Speech provider for River Song AI.
#
# Piper (https://github.com/rhasspy/piper) is a fast, fully local neural
# TTS engine. This provider shells out to the Piper binary, captures WAV
# output to a temp file, reads the bytes, and returns them to the caller.
#
# The caller (ConversationLoop) base64-encodes the WAV bytes and sends them
# to the browser over the WebSocket. Playback is handled entirely in the
# browser via the Web Audio API. sounddevice is NOT used.
#
# Piper must be installed separately -- it is NOT available via pip.
# Download from: https://github.com/rhasspy/piper/releases
# Voice models: https://huggingface.co/rhasspy/piper-voices
#
# All subprocess calls run in a ThreadPoolExecutor to avoid blocking
# the asyncio event loop.
#
# Required packages: (none beyond the standard library + subprocess)
# =============================================================================

from __future__ import annotations

import asyncio
import logging
import os
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from functools import partial

from config.settings import get_settings
from providers.base import TTSProvider


logger = logging.getLogger(__name__)


class PiperTTS(TTSProvider):
    """
    TTS provider that synthesizes speech using the local Piper binary.

    synthesize() is fully async-safe. The Piper subprocess runs in a
    worker thread so the event loop stays free during synthesis.

    Returns raw WAV bytes -- no audio device is opened on the server.
    """

    def __init__(self, model_path_override: str = "") -> None:
        settings = get_settings()
        self._piper_path: str = settings.piper_executable_path
        self._model_path: str = model_path_override or settings.piper_model_path

        # Single worker: TTS is sequential -- one response at a time.
        self._executor = ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="piper"
        )

        self._validate_configuration()

        logger.info(
            "PiperTTS initialized (model=%s).",
            os.path.basename(self._model_path),
        )

    async def synthesize(self, text: str) -> bytes:
        """
        Synthesize text with Piper and return WAV file bytes.

        The WAV bytes are sent to the browser over the WebSocket and played
        there via the Web Audio API.

        Args:
            text: Plain text to synthesize. Empty strings return b"".

        Returns:
            Raw WAV file bytes, or b"" if text was empty.

        Raises:
            RuntimeError: If Piper synthesis fails.
        """
        if not text or not text.strip():
            return b""

        cleaned = text.strip()
        logger.debug("Synthesizing %d characters with Piper.", len(cleaned))

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            self._executor,
            partial(self._synthesize_to_bytes, cleaned),
        )

    def _synthesize_to_bytes(self, text: str) -> bytes:
        """
        Shell out to Piper, write WAV to a temp file, read bytes, clean up.
        """
        wav_path: str | None = None
        try:
            with tempfile.NamedTemporaryFile(
                suffix=".wav", delete=False, prefix="riversong_tts_"
            ) as tmp:
                wav_path = tmp.name

            self._run_piper(text, wav_path)

            with open(wav_path, "rb") as f:
                return f.read()

        finally:
            if wav_path and os.path.exists(wav_path):
                try:
                    os.unlink(wav_path)
                except OSError as exc:
                    logger.warning(
                        "Could not delete temp WAV '%s': %s", wav_path, exc)

    def _run_piper(self, text: str, output_wav_path: str) -> None:
        """
        Invoke the Piper binary to synthesize text into a WAV file.

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
                shell=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError(
                "Piper synthesis timed out after 60 seconds.") from exc
        except FileNotFoundError as exc:
            raise RuntimeError(
                f"Piper binary not found at '{self._piper_path}'. "
                "Check PIPER_EXECUTABLE_PATH in .env."
            ) from exc

        if result.returncode != 0:
            stderr = result.stderr.decode("utf-8", errors="replace")
            raise RuntimeError(
                f"Piper exited with code {
                    result.returncode}: {stderr}")

        logger.debug("Piper synthesis complete -> '%s'.", output_wav_path)

    def _validate_configuration(self) -> None:
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
