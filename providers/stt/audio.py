"""
providers/stt/audio.py

Shared audio decoding for STT providers.

Every speech model in this codebase wants the same thing: mono, 16 kHz,
float32 in [-1, 1]. What arrives from the browser varies -- a WAV file at
whatever rate the device chose, or raw 16-bit PCM from the AudioWorklet --
so the normalisation lives here rather than being reimplemented per backend.
"""

from __future__ import annotations

import io
import logging

import numpy as np
import scipy.signal
import soundfile as sf

logger = logging.getLogger(__name__)

TARGET_SAMPLE_RATE: int = 16_000


def decode_to_16k_mono(audio_bytes: bytes) -> np.ndarray:
    """
    Decode browser audio to a mono 16 kHz float32 array.

    Handles two shapes:
      - WAV files (detected by the RIFF header), at any sample rate, mono or
        stereo. Stereo is averaged down; anything not already at 16 kHz is
        resampled.
      - Raw 16-bit PCM, assumed to already be 16 kHz mono -- that is what the
        AudioWorklet path sends.

    Args:
        audio_bytes: Raw bytes as received from the browser.

    Returns:
        float32 samples in [-1, 1]. Empty array for empty input.

    Raises:
        RuntimeError: If WAV bytes are present but cannot be decoded.
    """
    if not audio_bytes:
        return np.zeros(0, dtype=np.float32)

    if audio_bytes.startswith(b"RIFF"):
        try:
            audio_np, sample_rate = sf.read(
                io.BytesIO(audio_bytes), dtype="float32"
            )
        except Exception as exc:
            raise RuntimeError(f"Failed to decode WAV bytes: {exc}") from exc

        if audio_np.ndim > 1:
            audio_np = audio_np.mean(axis=1)

        if sample_rate != TARGET_SAMPLE_RATE:
            target_length = int(
                len(audio_np) * TARGET_SAMPLE_RATE / sample_rate)
            audio_np = scipy.signal.resample(
                audio_np, target_length).astype(np.float32)

        return audio_np.astype(np.float32)

    # Raw 16-bit PCM at 16 kHz from the AudioWorklet.
    return np.frombuffer(
        audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
