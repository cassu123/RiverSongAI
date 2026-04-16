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

import numpy as np


logger = logging.getLogger(__name__)


class STTProvider(ABC):
    """
    Abstract base class for Speech-to-Text providers.

    Implementors handle both audio capture from the microphone and
    transcription of that audio to text. Both methods are async to
    avoid blocking the event loop during I/O-bound audio operations.
    All blocking device calls must be dispatched to a thread pool
    by the concrete implementation.
    """

    @abstractmethod
    async def record_until_silence(self) -> np.ndarray:
        """
        Capture audio from the microphone until a silence threshold is reached.

        Implementations should:
        - Wait for speech to begin before accumulating audio
        - Stop recording after a configurable silence duration
        - Enforce a hard upper cap on recording length

        Returns:
            np.ndarray: 1-D float32 array of audio samples at 16 000 Hz.

        Raises:
            RuntimeError: If the audio device is unavailable or capture fails.
        """
        ...

    @abstractmethod
    async def transcribe(self, audio: np.ndarray) -> str:
        """
        Transcribe a numpy audio array to plain text.

        Args:
            audio: 1-D float32 numpy array sampled at 16 000 Hz.

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

    Implementors convert text to audio and play it through the system audio
    output device. Awaiting speak() must block until playback has fully
    completed so the conversation loop knows when it is safe to start
    listening again.
    """

    @abstractmethod
    async def speak(self, text: str) -> None:
        """
        Synthesize text to speech and play it through the audio output device.

        Args:
            text: Plain text to synthesize. No SSML or markup expected.
                  Empty strings should be silently ignored.

        Raises:
            RuntimeError: If synthesis or audio playback fails.
        """
        ...
