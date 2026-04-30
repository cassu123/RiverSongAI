# =============================================================================
# providers/tts/voice_registry.py
#
# Curated catalog of Piper TTS voice models available to River Song AI.
#
# Each entry has a display_name (the cool name shown in the UI) and maps
# to a specific .onnx model file on HuggingFace. The download script
# (scripts/download_voices.py) uses hf_path to pull any missing voices.
#
# Voice quality tiers:
#   low    ~60 MB   fastest — good for quick responses, lower fidelity
#   medium ~60 MB   sweet spot — natural sound, fast inference
#   high   ~110 MB  best quality — slightly slower, noticeably richer
#
# Usage:
#   from providers.tts.voice_registry import VoiceRegistry
#   entry = VoiceRegistry.get("river")
#   all_english = VoiceRegistry.list_all()
# =============================================================================

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional

_HF_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0"


@dataclass(frozen=True)
class VoiceEntry:
    """Metadata for one Piper voice model."""
    voice_id:     str    # unique key used in .env and API
    display_name: str    # shown in Settings UI
    filename:     str    # local .onnx filename  (e.g. en_US-lessac-medium.onnx)
    hf_path:      str    # path on HuggingFace after _HF_BASE
    lang:         str    # BCP-47 tag  (en_US, en_GB …)
    accent:       str    # "American" | "British" | …
    gender:       str    # "female" | "male"
    quality:      str    # "low" | "medium" | "high"
    size_mb:      float  # approximate .onnx size
    description:  str    # one-line character note
    default:      bool = False   # pre-selected on fresh install


# =============================================================================
# Voice catalog
# =============================================================================
#
# Naming theme: River Song universe + clean sci-fi/fantasy call-signs.
# Grouped by accent, then gender, then quality.
#
_CATALOG: List[VoiceEntry] = [

    # ── American Female ──────────────────────────────────────────────────────

    VoiceEntry(
        voice_id    = "river",
        display_name= "River",
        filename    = "en_US-lessac-medium.onnx",
        hf_path     = "en/en_US/lessac/medium/en_US-lessac-medium.onnx",
        lang        = "en_US",
        accent      = "American",
        gender      = "female",
        quality     = "medium",
        size_mb     = 60.3,
        description = "Warm, clear American female. Default River Song voice.",
        default     = True,
    ),
    VoiceEntry(
        voice_id    = "river-hd",
        display_name= "River HD",
        filename    = "en_US-lessac-high.onnx",
        hf_path     = "en/en_US/lessac/high/en_US-lessac-high.onnx",
        lang        = "en_US",
        accent      = "American",
        gender      = "female",
        quality     = "high",
        size_mb     = 108.6,
        description = "River at full fidelity — richer, slightly slower.",
    ),
    VoiceEntry(
        voice_id    = "aurora",
        display_name= "Aurora",
        filename    = "en_US-amy-medium.onnx",
        hf_path     = "en/en_US/amy/medium/en_US-amy-medium.onnx",
        lang        = "en_US",
        accent      = "American",
        gender      = "female",
        quality     = "medium",
        size_mb     = 60.3,
        description = "Bright, energetic American female.",
    ),
    VoiceEntry(
        voice_id    = "sage",
        display_name= "Sage",
        filename    = "en_US-kristin-medium.onnx",
        hf_path     = "en/en_US/kristin/medium/en_US-kristin-medium.onnx",
        lang        = "en_US",
        accent      = "American",
        gender      = "female",
        quality     = "medium",
        size_mb     = 60.6,
        description = "Calm, measured American female.",
    ),
    VoiceEntry(
        voice_id    = "echo",
        display_name= "Echo",
        filename    = "en_US-ljspeech-medium.onnx",
        hf_path     = "en/en_US/ljspeech/medium/en_US-ljspeech-medium.onnx",
        lang        = "en_US",
        accent      = "American",
        gender      = "female",
        quality     = "medium",
        size_mb     = 60.6,
        description = "Classic, crisp American female.",
    ),
    VoiceEntry(
        voice_id    = "echo-hd",
        display_name= "Echo HD",
        filename    = "en_US-ljspeech-high.onnx",
        hf_path     = "en/en_US/ljspeech/high/en_US-ljspeech-high.onnx",
        lang        = "en_US",
        accent      = "American",
        gender      = "female",
        quality     = "high",
        size_mb     = 108.9,
        description = "Echo at full fidelity.",
    ),
    VoiceEntry(
        voice_id    = "nova",
        display_name= "Nova",
        filename    = "en_US-hfc_female-medium.onnx",
        hf_path     = "en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx",
        lang        = "en_US",
        accent      = "American",
        gender      = "female",
        quality     = "medium",
        size_mb     = 60.3,
        description = "Smooth, modern American female.",
    ),

    # ── American Male ────────────────────────────────────────────────────────

    VoiceEntry(
        voice_id    = "atlas",
        display_name= "Atlas",
        filename    = "en_US-ryan-medium.onnx",
        hf_path     = "en/en_US/ryan/medium/en_US-ryan-medium.onnx",
        lang        = "en_US",
        accent      = "American",
        gender      = "male",
        quality     = "medium",
        size_mb     = 60.3,
        description = "Natural, confident American male.",
    ),
    VoiceEntry(
        voice_id    = "atlas-hd",
        display_name= "Atlas HD",
        filename    = "en_US-ryan-high.onnx",
        hf_path     = "en/en_US/ryan/high/en_US-ryan-high.onnx",
        lang        = "en_US",
        accent      = "American",
        gender      = "male",
        quality     = "high",
        size_mb     = 115.2,
        description = "Atlas at full fidelity — deep and rich.",
    ),
    VoiceEntry(
        voice_id    = "orion",
        display_name= "Orion",
        filename    = "en_US-joe-medium.onnx",
        hf_path     = "en/en_US/joe/medium/en_US-joe-medium.onnx",
        lang        = "en_US",
        accent      = "American",
        gender      = "male",
        quality     = "medium",
        size_mb     = 60.3,
        description = "Casual, friendly American male.",
    ),
    VoiceEntry(
        voice_id    = "sterling",
        display_name= "Sterling",
        filename    = "en_US-john-medium.onnx",
        hf_path     = "en/en_US/john/medium/en_US-john-medium.onnx",
        lang        = "en_US",
        accent      = "American",
        gender      = "male",
        quality     = "medium",
        size_mb     = 60.6,
        description = "Authoritative American male.",
    ),
    VoiceEntry(
        voice_id    = "falcon",
        display_name= "Falcon",
        filename    = "en_US-norman-medium.onnx",
        hf_path     = "en/en_US/norman/medium/en_US-norman-medium.onnx",
        lang        = "en_US",
        accent      = "American",
        gender      = "male",
        quality     = "medium",
        size_mb     = 60.6,
        description = "Smooth, broadcast-style American male.",
    ),
    VoiceEntry(
        voice_id    = "ghost",
        display_name= "Ghost",
        filename    = "en_US-ryan-low.onnx",
        hf_path     = "en/en_US/ryan/low/en_US-ryan-low.onnx",
        lang        = "en_US",
        accent      = "American",
        gender      = "male",
        quality     = "low",
        size_mb     = 60.2,
        description = "Fast low-latency American male — best for quick responses.",
    ),
    VoiceEntry(
        voice_id    = "vector",
        display_name= "Vector",
        filename    = "en_US-hfc_male-medium.onnx",
        hf_path     = "en/en_US/hfc_male/medium/en_US-hfc_male-medium.onnx",
        lang        = "en_US",
        accent      = "American",
        gender      = "male",
        quality     = "medium",
        size_mb     = 60.3,
        description = "Clean, neutral American male.",
    ),

    # ── British Female ───────────────────────────────────────────────────────

    VoiceEntry(
        voice_id    = "aria",
        display_name= "Aria",
        filename    = "en_GB-cori-medium.onnx",
        hf_path     = "en/en_GB/cori/medium/en_GB-cori-medium.onnx",
        lang        = "en_GB",
        accent      = "British",
        gender      = "female",
        quality     = "medium",
        size_mb     = 60.6,
        description = "Warm, refined British female.",
    ),
    VoiceEntry(
        voice_id    = "aria-hd",
        display_name= "Aria HD",
        filename    = "en_GB-cori-high.onnx",
        hf_path     = "en/en_GB/cori/high/en_GB-cori-high.onnx",
        lang        = "en_GB",
        accent      = "British",
        gender      = "female",
        quality     = "high",
        size_mb     = 108.9,
        description = "Aria at full fidelity.",
    ),
    VoiceEntry(
        voice_id    = "luna",
        display_name= "Luna",
        filename    = "en_GB-alba-medium.onnx",
        hf_path     = "en/en_GB/alba/medium/en_GB-alba-medium.onnx",
        lang        = "en_GB",
        accent      = "British",
        gender      = "female",
        quality     = "medium",
        size_mb     = 60.3,
        description = "Soft Scottish-accented female.",
    ),
    VoiceEntry(
        voice_id    = "ember",
        display_name= "Ember",
        filename    = "en_GB-jenny_dioco-medium.onnx",
        hf_path     = "en/en_GB/jenny_dioco/medium/en_GB-jenny_dioco-medium.onnx",
        lang        = "en_GB",
        accent      = "British",
        gender      = "female",
        quality     = "medium",
        size_mb     = 60.3,
        description = "Clear, expressive British female.",
    ),

    # ── British Male ─────────────────────────────────────────────────────────

    VoiceEntry(
        voice_id    = "rex",
        display_name= "Rex",
        filename    = "en_GB-alan-medium.onnx",
        hf_path     = "en/en_GB/alan/medium/en_GB-alan-medium.onnx",
        lang        = "en_GB",
        accent      = "British",
        gender      = "male",
        quality     = "medium",
        size_mb     = 60.3,
        description = "Steady, authoritative British male.",
    ),
    VoiceEntry(
        voice_id    = "blaze",
        display_name= "Blaze",
        filename    = "en_GB-northern_english_male-medium.onnx",
        hf_path     = "en/en_GB/northern_english_male/medium/en_GB-northern_english_male-medium.onnx",
        lang        = "en_GB",
        accent      = "British (Northern)",
        gender      = "male",
        quality     = "medium",
        size_mb     = 60.3,
        description = "Northern English male — grounded and direct.",
    ),
]


# =============================================================================
# Registry class
# =============================================================================

class VoiceRegistry:
    _index: Dict[str, VoiceEntry] = {v.voice_id: v for v in _CATALOG}

    @classmethod
    def get(cls, voice_id: str) -> Optional[VoiceEntry]:
        return cls._index.get(voice_id)

    @classmethod
    def get_default(cls) -> Optional[VoiceEntry]:
        for v in _CATALOG:
            if v.default:
                return v
        return _CATALOG[0] if _CATALOG else None

    @classmethod
    def list_all(cls) -> List[VoiceEntry]:
        return list(_CATALOG)

    @classmethod
    def list_by_gender(cls, gender: str) -> List[VoiceEntry]:
        return [v for v in _CATALOG if v.gender == gender]

    @classmethod
    def list_by_accent(cls, accent: str) -> List[VoiceEntry]:
        return [v for v in _CATALOG if v.accent.startswith(accent)]

    @classmethod
    def hf_url(cls, voice_id: str) -> Optional[str]:
        entry = cls.get(voice_id)
        if not entry:
            return None
        return f"{_HF_BASE}/{entry.hf_path}"

    @classmethod
    def hf_json_url(cls, voice_id: str) -> Optional[str]:
        """URL for the companion .onnx.json config file."""
        entry = cls.get(voice_id)
        if not entry:
            return None
        json_path = entry.hf_path + ".json"
        return f"{_HF_BASE}/{json_path}"
