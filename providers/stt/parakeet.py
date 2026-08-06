"""
providers/stt/parakeet.py

Local speech-to-text using NVIDIA's Parakeet models via NeMo.

Why this exists alongside whisper_local: Parakeet TDT 0.6B is roughly a
quarter the size of Whisper large-v3 while scoring better on the Open ASR
Leaderboard for English, and it is fast enough on a plain CPU to be usable
there. On a machine where the GPU is the scarce resource -- one small card
shared with the LLM -- running transcription on the CPU frees more VRAM than
the accuracy difference is worth on its own.

The tradeoff is language coverage. Whisper handles 99 languages; Parakeet
targets English and major European ones. Keep whisper_local as the STT
provider if anyone speaks outside that set.

Configured by:
  stt_provider     -- set to "parakeet" to select this backend
  parakeet_model   -- any NeMo ASR model id from the Hub
  parakeet_device  -- "auto" | "cpu" | "cuda" (or e.g. "cuda:1")

Defaults to CPU deliberately, for the VRAM reason above. After a GPU
upgrade, set parakeet_device to "auto" or "cuda".

Required packages: nemo_toolkit[asr], soundfile, scipy, numpy
"""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from typing import Optional

import soundfile as sf

from config.settings import get_settings
from providers.base import STTProvider
from providers.stt.audio import TARGET_SAMPLE_RATE, decode_to_16k_mono

logger = logging.getLogger(__name__)


def _resolve_device(configured: str) -> str:
    """
    Map the parakeet_device setting to a torch device string.

    "auto" resolves to CUDA when it is actually usable and CPU otherwise --
    "usable" meaning a real tensor op succeeds, not merely that torch reports
    a device. A driver mismatch shows up as an exception on first use, not in
    torch.cuda.is_available(). Anything else is passed through verbatim so
    explicit devices like "cuda:1" work unchanged.
    """
    value = (configured or "auto").strip().lower()
    if value != "auto":
        return value
    try:
        import torch
        t = torch.tensor([1.0], device="cuda")
        _ = t + t
        return "cuda"
    except Exception:
        return "cpu"


class ParakeetSTT(STTProvider):
    """
    STT provider backed by a local NeMo Parakeet model.

    The model is loaded once at construction and held for the process
    lifetime. First run downloads weights from the Hub, which can take a few
    minutes; later starts use the cache.
    """

    def __init__(self, model_name: Optional[str] = None,
                 device: Optional[str] = None) -> None:
        settings = get_settings()
        self._model_name: str = model_name or getattr(
            settings, "parakeet_model", "nvidia/parakeet-tdt-0.6b-v3")
        self._device: str = _resolve_device(
            device or getattr(settings, "parakeet_device", "cpu"))

        self._executor = ThreadPoolExecutor(
            max_workers=2, thread_name_prefix="parakeet"
        )

        logger.info(
            "Loading Parakeet model '%s' on %s -- this may take a moment on "
            "first run.", self._model_name, self._device,
        )
        try:
            # Lazy-import the heavy dep so module-load doesn't require NeMo
            # on installs that use Whisper.
            from nemo.collections.asr.models import ASRModel

            self._model = ASRModel.from_pretrained(model_name=self._model_name)
            self._model = self._model.to(self._device)
            self._model.eval()
            logger.info(
                "Parakeet model '%s' loaded on %s.",
                self._model_name, self._device,
            )
        except ImportError as exc:
            raise RuntimeError(
                "stt_provider='parakeet' requires NeMo. Install it with: "
                "pip install nemo_toolkit[asr]"
            ) from exc
        except Exception as exc:
            raise RuntimeError(
                f"Failed to load Parakeet model '{self._model_name}' on "
                f"{self._device}: {exc}"
            ) from exc

    async def transcribe(self, audio_bytes: bytes) -> str:
        """
        Transcribe browser audio to plain text.

        Args:
            audio_bytes: WAV bytes at any sample rate, or raw 16-bit PCM.

        Returns:
            Transcribed text, stripped. Empty string on silence.
        """
        if not audio_bytes:
            return ""

        loop = asyncio.get_running_loop()
        try:
            text = await loop.run_in_executor(
                self._executor,
                partial(self._transcribe_blocking, audio_bytes),
            )
        except Exception as exc:
            raise RuntimeError(
                f"Parakeet transcription failed: {exc}") from exc

        stripped = text.strip()
        if stripped:
            logger.info("Transcription result: '%s'", stripped)
        return stripped

    def _transcribe_blocking(self, audio_bytes: bytes) -> str:
        """
        Decode audio and run NeMo inference.

        NeMo is written around file paths, and which in-memory forms it
        accepts has moved between releases. Writing a small temp WAV is the
        one input every version handles, and these clips are short enough
        that the write is negligible next to inference.
        """
        audio_np = decode_to_16k_mono(audio_bytes)
        if audio_np.size == 0:
            return ""

        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(
                    suffix=".wav", delete=False) as tmp:
                tmp_path = tmp.name
                sf.write(tmp, audio_np, TARGET_SAMPLE_RATE, format="WAV")

            output = self._model.transcribe([tmp_path])
        finally:
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.unlink(tmp_path)
                except OSError:
                    logger.debug(
                        "Could not remove temp audio file %s", tmp_path)

        return _first_text(output)


def _first_text(output) -> str:
    """
    Pull the transcript out of whatever NeMo returned.

    Across NeMo versions transcribe() has returned a list of plain strings, a
    list of Hypothesis objects carrying `.text`, and a (hypotheses,
    all_hypotheses) tuple. Normalising here keeps that churn out of the
    provider and out of the caller.
    """
    if not output:
        return ""

    # Older multi-return signature: (best_hypotheses, all_hypotheses)
    if isinstance(output, tuple):
        output = output[0]
        if not output:
            return ""

    first = output[0] if isinstance(output, (list, tuple)) else output

    if isinstance(first, str):
        return first
    text = getattr(first, "text", None)
    if isinstance(text, str):
        return text

    logger.warning(
        "Unrecognised NeMo transcribe() output type: %s", type(first).__name__)
    return ""
