"""
core/wake_word_service.py

Handles wake word detection using openWakeWord.
Provides a stream-based interface for detecting "Hey River" from browser audio.
"""

import logging
import numpy as np
import asyncio
from typing import Optional, Callable

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
            import openwakeword
            from openwakeword.model import Model
            
            # Note: hey_river model should be in the search path or provided
            self._model = Model(
                wakeword_models=["hey_river"],
                inference_framework="onnx"
            )
            self._initialized = True
            logger.info("WakeWordService initialized with 'hey_river' model.")
        except ImportError:
            logger.error("openWakeWord not installed. Wake word detection disabled.")
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
        audio_np = np.frombuffer(audio_chunk, dtype=np.int16).astype(np.float32) / 32768.0
        
        # openWakeWord expects chunks of 1280 samples (80ms at 16kHz)
        # We might need to buffer if the chunks are different sizes.
        # For now, we assume the model handles internal buffering or the chunk is the right size.
        prediction = self._model.predict(audio_np)
        
        for wakeword, score in prediction.items():
            if score > 0.5: # Threshold from settings ideally
                logger.info("Wake word detected! (score: %.2f)", score)
                self.on_wake_word()
