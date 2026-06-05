"""
core/wake_word_service.py

Handles wake word detection using openWakeWord.
Provides a stream-based interface for detecting "Hey River" from browser audio.
"""

import logging
import numpy as np
from typing import Callable

logger = logging.getLogger(__name__)


class WakeWordService:
    """
    Wake word detector for "The Companion" mode.

    Expects mono 16-bit PCM audio at 16,000 Hz.
    """

    def __init__(self, on_wake_word: Callable[[], None]):
        self.on_wake_word = on_wake_word
        self._model = None
        self._initialized = False

    def _initialize(self):
        """Lazy load openWakeWord to save resources."""
        if self._initialized:
            return
        try:
            from openwakeword.model import Model
            from config.settings import get_settings

            settings = get_settings()
            self._threshold = settings.wake_word_threshold

            self._model = Model(
                wakeword_models=[settings.wake_word_model],
                inference_framework=settings.wake_word_inference_framework
            )
            self._initialized = True
            logger.info("WakeWordService initialized (model=%s, framework=%s).",
                        settings.wake_word_model, settings.wake_word_inference_framework)
        except ImportError:
            logger.error(
                "openWakeWord not installed. Wake word detection disabled.")
        except Exception as exc:
            logger.error("Failed to initialize WakeWordService: %s", exc)

    def process_chunk(self, audio_chunk: bytes):
        """
        Feed an audio chunk into the detector.

        Args:
            audio_chunk: Raw PCM bytes (16-bit, 16kHz, mono).
        """
        if not self._initialized:
            self._initialize()

        if not self._model:
            return

        # Convert bytes to numpy array (float32 between -1.0 and 1.0)
        audio_np = np.frombuffer(
            audio_chunk,
            dtype=np.int16).astype(
            np.float32) / 32768.0

        prediction = self._model.predict(audio_np)

        for wakeword, score in prediction.items():
            if score > self._threshold:
                logger.info("Wake word detected! (score: %.2f)", score)
                self.on_wake_word()
