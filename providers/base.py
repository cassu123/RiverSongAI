# =============================================================================
# providers/base.py
#
# Abstract base classes for all River Song AI providers.
#
# Every swappable component (STT, LLM, TTS) implements one of these
# interfaces. The conversation loop depends only on these abstractions --
# never on concrete implementations -- so any provider can be swapped by
# changing a single line in .env.
#
# Audio architecture (Codespaces / remote server):
#   Recording happens in the browser (Web Audio API). The browser encodes
#   PCM audio as a WAV file, base64-encodes it, and sends it over the
#   WebSocket as {"type": "audio_data", "data": "<b64>"}.
#   The server calls STTProvider.transcribe(audio_bytes) directly.
#
#   TTS synthesis produces WAV bytes on the server. Those bytes are
#   base64-encoded and sent to the browser as {"type": "audio", "data": "<b64>"}.
#   The browser decodes and plays them via the Web Audio API.
#
#   sounddevice is NOT used for recording or playback anywhere in the pipeline.
#
# Adding a new provider:
#   1. Create a new file under providers/<type>/<name>.py
#   2. Subclass the appropriate abstract base class here
#   3. Register the provider key in core/conversation_loop.py
#   4. Update .env.example with the new provider key
# =============================================================================

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import AsyncGenerator, List


logger = logging.getLogger(__name__)


class STTProvider(ABC):
    """
    Abstract base class for Speech-to-Text providers.

    Audio bytes arrive from the browser over the WebSocket as a WAV file.
    Concrete implementations receive those bytes and return transcribed text.
    """

    @abstractmethod
    async def transcribe(self, audio_bytes: bytes) -> str:
        """
        Transcribe audio bytes (WAV format) to plain text.

        Args:
            audio_bytes: Raw WAV file bytes captured by the browser mic.
                         May be at any sample rate -- implementations must
                         resample to 16 kHz if the model requires it.

        Returns:
            Transcribed text string. Empty string if nothing was recognized.

        Raises:
            RuntimeError: If the transcription model fails or is not loaded.
        """
        ...


class LLMProvider(ABC):
    """
    Abstract base class for Language Model providers.

    Implementors accept a conversation history (list of role/content dicts
    in OpenAI-compatible format) and yield response text chunks as an async
    generator. Streaming is required -- callers assume chunks arrive
    progressively and forward them to the frontend in real time.
    """

    @abstractmethod
    async def stream_response(
        self, messages: List[dict]
    ) -> AsyncGenerator[str, None]:
        """
        Stream a response from the language model.

        Args:
            messages: Conversation history, e.g.:
                [
                    {"role": "system",    "content": "You are River Song..."},
                    {"role": "user",      "content": "Hello!"},
                    {"role": "assistant", "content": "Spoilers, sweetie."},
                    {"role": "user",      "content": "What is today?"},
                ]
                The caller (ConversationLoop) is responsible for prepending
                the system message and maintaining history.

        Yields:
            str: Individual text fragments from the model as they arrive.

        Raises:
            RuntimeError: If the LLM service is unreachable or returns an error.
        """
        ...


class TTSProvider(ABC):
    """
    Abstract base class for Text-to-Speech providers.

    Implementors convert text to a WAV audio file and return the raw bytes.
    The caller (ConversationLoop) base64-encodes those bytes and sends them
    to the browser over the WebSocket. Playback happens entirely in the browser.
    """

    @abstractmethod
    async def synthesize(self, text: str) -> bytes:
        """
        Synthesize text to speech and return the audio as WAV bytes.

        Args:
            text: Plain text to synthesize. No SSML or markup expected.
                  Empty strings should return empty bytes without error.

        Returns:
            Raw WAV file bytes. Empty bytes if text was empty.

        Raises:
            RuntimeError: If synthesis fails (binary not found, model error, etc.).
        """
        ...
