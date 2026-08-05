"""Unit tests for providers.stt.audio and providers.stt.parakeet helpers.

The model itself is not exercised -- NeMo is an optional heavy dependency.
These cover the parts that run on every transcription regardless of backend:
audio normalisation, device resolution, and NeMo's shifting output shapes.
"""

from __future__ import annotations

import io

import numpy as np
import pytest
import soundfile as sf

from providers.stt.audio import TARGET_SAMPLE_RATE, decode_to_16k_mono
from providers.stt.parakeet import _first_text, _resolve_device


def _wav_bytes(samples: np.ndarray, rate: int) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, samples, rate, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def _tone(seconds: float, rate: int, channels: int = 1) -> np.ndarray:
    t = np.linspace(0, seconds, int(seconds * rate), endpoint=False)
    mono = (0.5 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
    if channels == 1:
        return mono
    return np.stack([mono] * channels, axis=1)


# ---------------------------------------------------------------------------
# decode_to_16k_mono
# ---------------------------------------------------------------------------

def test_empty_input_returns_empty_array():
    out = decode_to_16k_mono(b"")
    assert out.size == 0
    assert out.dtype == np.float32


def test_wav_at_target_rate_passes_through():
    audio = _tone(0.25, TARGET_SAMPLE_RATE)
    out = decode_to_16k_mono(_wav_bytes(audio, TARGET_SAMPLE_RATE))
    assert out.dtype == np.float32
    assert out.ndim == 1
    assert abs(len(out) - len(audio)) <= 1


@pytest.mark.parametrize("source_rate", [8_000, 22_050, 44_100, 48_000])
def test_wav_is_resampled_to_16k(source_rate):
    seconds = 0.5
    audio = _tone(seconds, source_rate)
    out = decode_to_16k_mono(_wav_bytes(audio, source_rate))
    expected = int(seconds * TARGET_SAMPLE_RATE)
    # Resampling is not sample-exact; a 1% window is plenty to catch a
    # wrong-rate bug without being brittle.
    assert abs(len(out) - expected) < expected * 0.01


def test_stereo_is_mixed_to_mono():
    audio = _tone(0.25, TARGET_SAMPLE_RATE, channels=2)
    out = decode_to_16k_mono(_wav_bytes(audio, TARGET_SAMPLE_RATE))
    assert out.ndim == 1


def test_raw_pcm_is_scaled_into_unit_range():
    pcm = np.array([0, 16384, -16384, 32767, -32768], dtype=np.int16)
    out = decode_to_16k_mono(pcm.tobytes())
    assert out.dtype == np.float32
    assert out[0] == pytest.approx(0.0)
    assert out[1] == pytest.approx(0.5, abs=1e-4)
    assert out[2] == pytest.approx(-0.5, abs=1e-4)
    assert np.all(out <= 1.0) and np.all(out >= -1.0)


def test_undecodable_wav_raises():
    with pytest.raises(RuntimeError, match="Failed to decode WAV"):
        decode_to_16k_mono(b"RIFF" + b"garbage" * 10)


# ---------------------------------------------------------------------------
# Device resolution
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "configured,expected",
    [("cpu", "cpu"), ("CPU", "cpu"), ("cuda", "cuda"), ("cuda:1", "cuda:1")],
)
def test_explicit_devices_pass_through(configured, expected):
    assert _resolve_device(configured) == expected


def test_auto_falls_back_to_cpu_without_working_cuda():
    """No CUDA in CI, so 'auto' must resolve to cpu rather than raising."""
    assert _resolve_device("auto") == "cpu"


def test_blank_device_is_treated_as_auto():
    assert _resolve_device("") in {"cpu", "cuda"}


# ---------------------------------------------------------------------------
# NeMo output normalisation
# ---------------------------------------------------------------------------

class _Hypothesis:
    def __init__(self, text):
        self.text = text


def test_plain_string_list():
    assert _first_text(["hello there"]) == "hello there"


def test_hypothesis_object_list():
    assert _first_text([_Hypothesis("hello there")]) == "hello there"


def test_tuple_of_hypotheses():
    """Older NeMo returned (best_hypotheses, all_hypotheses)."""
    assert _first_text(([_Hypothesis("hello")], [[]])) == "hello"


def test_bare_string_not_in_a_list():
    assert _first_text("hello") == "hello"


@pytest.mark.parametrize("empty", [None, [], (), ([], [])])
def test_empty_outputs_return_empty_string(empty):
    assert _first_text(empty) == ""


def test_unrecognised_shape_returns_empty_not_raises():
    assert _first_text([{"unexpected": "dict"}]) == ""
