# =============================================================================
# providers/tts/voice_registry.py
#
# Curated catalog of TTS voices for River Song AI.
# Two engines supported:
#
#   piper  — local binary, .onnx model files, zero Python deps
#            Models downloaded via: python scripts/download_voices.py
#
#   kokoro — Python package (pip install kokoro), 82M params, CPU-native
#            28 built-in English voices, auto-downloads ~325 MB model
#            on first use from HuggingFace.  No VRAM required.
#
# Usage:
#   from providers.tts.voice_registry import VoiceRegistry
#   entry = VoiceRegistry.get("sky")       # Kokoro voice
#   entry = VoiceRegistry.get("atlas")     # Piper voice
#   all_kokoro = VoiceRegistry.list_by_engine("kokoro")
# =============================================================================

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional

from config.settings import get_settings

_HF_PIPER = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0"


@dataclass(frozen=True)
class VoiceEntry:
    """Metadata for a single TTS voice."""
    voice_id: str    # unique key used in .env / API  (e.g. "river", "sky")
    display_name: str    # shown in Settings UI
    engine: str    # "piper" | "kokoro"
    voice_code: str    # engine-specific identifier
    #   piper  → .onnx filename stem  (e.g. "en_US-lessac-medium")
    #   kokoro → kokoro voice ID      (e.g. "af_river")
    lang: str    # BCP-47 language tag
    accent: str    # "American" | "British" | …
    gender: str    # "female" | "male"
    quality: str    # "fast" | "balanced" | "high"
    size_mb: float  # approximate download size
    description: str    # one-line character note
    preview_text: str    # short intro phrase played by the preview button
    default: bool = False
    # Piper-only extras (blank for Kokoro)
    filename: str = ""      # .onnx filename on disk
    hf_path: str = ""      # path on HuggingFace after /v1.0.0/


# =============================================================================
# Catalog
# =============================================================================

_CATALOG: List[VoiceEntry] = [

    # =========================================================================
    # PIPER VOICES
    # =========================================================================

    # ── Piper · American Female ─────────────────────────────────────────────
    VoiceEntry(
        voice_id="river", display_name="River",
        engine="piper", voice_code="en_US-lessac-medium",
        filename="en_US-lessac-medium.onnx",
        hf_path="en/en_US/lessac/medium/en_US-lessac-medium.onnx",
        lang="en_US", accent="American", gender="female", quality="balanced",
        size_mb=60.3, description="Warm, clear American female. Default River Song voice.",
        preview_text="Hi, I'm River — your personal AI assistant. I'm ready when you are.",
        default=True,
    ),
    VoiceEntry(
        voice_id="river-hd", display_name="River HD",
        engine="piper", voice_code="en_US-lessac-high",
        filename="en_US-lessac-high.onnx",
        hf_path="en/en_US/lessac/high/en_US-lessac-high.onnx",
        lang="en_US", accent="American", gender="female", quality="high",
        size_mb=108.6, description="River at full fidelity — richer, slightly slower.",
        preview_text="Hi, I'm River — your personal AI assistant. I'm ready when you are.",
    ),
    VoiceEntry(
        voice_id="aurora", display_name="Aurora",
        engine="piper", voice_code="en_US-amy-medium",
        filename="en_US-amy-medium.onnx",
        hf_path="en/en_US/amy/medium/en_US-amy-medium.onnx",
        lang="en_US", accent="American", gender="female", quality="balanced",
        size_mb=60.3, description="Bright, energetic American female.",
        preview_text="Hey there! I'm Aurora, and I can't wait to help you get things done.",
    ),
    VoiceEntry(
        voice_id="sage", display_name="Sage",
        engine="piper", voice_code="en_US-kristin-medium",
        filename="en_US-kristin-medium.onnx",
        hf_path="en/en_US/kristin/medium/en_US-kristin-medium.onnx",
        lang="en_US", accent="American", gender="female", quality="balanced",
        size_mb=60.6, description="Calm, measured American female.",
        preview_text="Hello. I'm Sage. Ask me anything — I'm here to help, at your pace.",
    ),
    VoiceEntry(
        voice_id="echo", display_name="Echo",
        engine="piper", voice_code="en_US-ljspeech-medium",
        filename="en_US-ljspeech-medium.onnx",
        hf_path="en/en_US/ljspeech/medium/en_US-ljspeech-medium.onnx",
        lang="en_US", accent="American", gender="female", quality="balanced",
        size_mb=60.6, description="Classic, crisp American female.",
        preview_text="Hello, I'm Echo. Clear, direct, and ready to assist you.",
    ),
    VoiceEntry(
        voice_id="echo-hd", display_name="Echo HD",
        engine="piper", voice_code="en_US-ljspeech-high",
        filename="en_US-ljspeech-high.onnx",
        hf_path="en/en_US/ljspeech/high/en_US-ljspeech-high.onnx",
        lang="en_US", accent="American", gender="female", quality="high",
        size_mb=108.9, description="Echo at full fidelity.",
        preview_text="Hello, I'm Echo. Clear, direct, and ready to assist you.",
    ),
    VoiceEntry(
        voice_id="nova", display_name="Nova",
        engine="piper", voice_code="en_US-hfc_female-medium",
        filename="en_US-hfc_female-medium.onnx",
        hf_path="en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx",
        lang="en_US", accent="American", gender="female", quality="balanced",
        size_mb=60.3, description="Smooth, modern American female.",
        preview_text="Hi, I'm Nova. Let's make things happen — what can I do for you?",
    ),

    # ── Piper · American Male ────────────────────────────────────────────────
    VoiceEntry(
        voice_id="atlas", display_name="Atlas",
        engine="piper", voice_code="en_US-ryan-medium",
        filename="en_US-ryan-medium.onnx",
        hf_path="en/en_US/ryan/medium/en_US-ryan-medium.onnx",
        lang="en_US", accent="American", gender="male", quality="balanced",
        size_mb=60.3, description="Natural, confident American male.",
        preview_text="Hey, I'm Atlas. Whatever you need, I've got you covered.",
    ),
    VoiceEntry(
        voice_id="atlas-hd", display_name="Atlas HD",
        engine="piper", voice_code="en_US-ryan-high",
        filename="en_US-ryan-high.onnx",
        hf_path="en/en_US/ryan/high/en_US-ryan-high.onnx",
        lang="en_US", accent="American", gender="male", quality="high",
        size_mb=115.2, description="Atlas at full fidelity — deep and rich.",
        preview_text="Hey, I'm Atlas. Whatever you need, I've got you covered.",
    ),
    VoiceEntry(
        voice_id="orion", display_name="Orion",
        engine="piper", voice_code="en_US-joe-medium",
        filename="en_US-joe-medium.onnx",
        hf_path="en/en_US/joe/medium/en_US-joe-medium.onnx",
        lang="en_US", accent="American", gender="male", quality="balanced",
        size_mb=60.3, description="Casual, friendly American male.",
        preview_text="Hey! Orion here. What are we working on today?",
    ),
    VoiceEntry(
        voice_id="sterling", display_name="Sterling",
        engine="piper", voice_code="en_US-john-medium",
        filename="en_US-john-medium.onnx",
        hf_path="en/en_US/john/medium/en_US-john-medium.onnx",
        lang="en_US", accent="American", gender="male", quality="balanced",
        size_mb=60.6, description="Authoritative American male.",
        preview_text="Good day. I'm Sterling, and I'm at your service.",
    ),
    VoiceEntry(
        voice_id="falcon", display_name="Falcon",
        engine="piper", voice_code="en_US-norman-medium",
        filename="en_US-norman-medium.onnx",
        hf_path="en/en_US/norman/medium/en_US-norman-medium.onnx",
        lang="en_US", accent="American", gender="male", quality="balanced",
        size_mb=60.6, description="Smooth, broadcast-style American male.",
        preview_text="Hello, I'm Falcon. Precise, professional, and ready to assist.",
    ),
    VoiceEntry(
        voice_id="ghost", display_name="Ghost",
        engine="piper", voice_code="en_US-ryan-low",
        filename="en_US-ryan-low.onnx",
        hf_path="en/en_US/ryan/low/en_US-ryan-low.onnx",
        lang="en_US", accent="American", gender="male", quality="fast",
        size_mb=60.2, description="Fast low-latency male — best for quick responses.",
        preview_text="Ghost here. Fast responses, no fuss — what do you need?",
    ),
    VoiceEntry(
        voice_id="vector", display_name="Vector",
        engine="piper", voice_code="en_US-hfc_male-medium",
        filename="en_US-hfc_male-medium.onnx",
        hf_path="en/en_US/hfc_male/medium/en_US-hfc_male-medium.onnx",
        lang="en_US", accent="American", gender="male", quality="balanced",
        size_mb=60.3, description="Clean, neutral American male.",
        preview_text="Hi, I'm Vector. Straightforward and ready to help.",
    ),

    # ── Piper · British Female ──────────────────────────────────────────────
    VoiceEntry(
        voice_id="aria", display_name="Aria",
        engine="piper", voice_code="en_GB-cori-medium",
        filename="en_GB-cori-medium.onnx",
        hf_path="en/en_GB/cori/medium/en_GB-cori-medium.onnx",
        lang="en_GB", accent="British", gender="female", quality="balanced",
        size_mb=60.6, description="Warm, refined British female.",
        preview_text="Hello, I'm Aria. Shall we get started? I'm here whenever you need me.",
    ),
    VoiceEntry(
        voice_id="aria-hd", display_name="Aria HD",
        engine="piper", voice_code="en_GB-cori-high",
        filename="en_GB-cori-high.onnx",
        hf_path="en/en_GB/cori/high/en_GB-cori-high.onnx",
        lang="en_GB", accent="British", gender="female", quality="high",
        size_mb=108.9, description="Aria at full fidelity.",
        preview_text="Hello, I'm Aria. Shall we get started? I'm here whenever you need me.",
    ),
    VoiceEntry(
        voice_id="luna", display_name="Luna",
        engine="piper", voice_code="en_GB-alba-medium",
        filename="en_GB-alba-medium.onnx",
        hf_path="en/en_GB/alba/medium/en_GB-alba-medium.onnx",
        lang="en_GB", accent="British", gender="female", quality="balanced",
        size_mb=60.3, description="Soft Scottish-accented female.",
        preview_text="Hello there. I'm Luna — soft-spoken but always listening.",
    ),
    VoiceEntry(
        voice_id="ember", display_name="Ember",
        engine="piper", voice_code="en_GB-jenny_dioco-medium",
        filename="en_GB-jenny_dioco-medium.onnx",
        hf_path="en/en_GB/jenny_dioco/medium/en_GB-jenny_dioco-medium.onnx",
        lang="en_GB", accent="British", gender="female", quality="balanced",
        size_mb=60.3, description="Clear, expressive British female.",
        preview_text="Hi, I'm Ember. I love a good conversation — what's on your mind?",
    ),

    # ── Piper · British Male ────────────────────────────────────────────────
    VoiceEntry(
        voice_id="rex", display_name="Rex",
        engine="piper", voice_code="en_GB-alan-medium",
        filename="en_GB-alan-medium.onnx",
        hf_path="en/en_GB/alan/medium/en_GB-alan-medium.onnx",
        lang="en_GB", accent="British", gender="male", quality="balanced",
        size_mb=60.3, description="Steady, authoritative British male.",
        preview_text="Good day. Rex speaking. How may I assist you?",
    ),
    VoiceEntry(
        voice_id="blaze", display_name="Blaze",
        engine="piper", voice_code="en_GB-northern_english_male-medium",
        filename="en_GB-northern_english_male-medium.onnx",
        hf_path="en/en_GB/northern_english_male/medium/en_GB-northern_english_male-medium.onnx",
        lang="en_GB", accent="British (Northern)", gender="male", quality="balanced",
        size_mb=60.3, description="Northern English male — grounded and direct.",
        preview_text="Alright, I'm Blaze. No nonsense — just tell me what you need.",
    ),

    # =========================================================================
    # KOKORO VOICES
    # =========================================================================

    # ── Kokoro · American Female ────────────────────────────────────────────
    VoiceEntry(
        voice_id="sky", display_name="Sky",
        engine="kokoro", voice_code="af_sky",
        lang="en_US", accent="American", gender="female", quality="balanced",
        size_mb=0, description="Airy, natural American female. Great all-rounder.",
        preview_text="Hi, I'm Sky — light, clear, and always here for you.",
    ),
    VoiceEntry(
        voice_id="bella", display_name="Bella",
        engine="kokoro", voice_code="af_bella",
        lang="en_US", accent="American", gender="female", quality="balanced",
        size_mb=0, description="Warm, expressive American female. Highly natural.",
        preview_text="Hello! I'm Bella. I love helping people — so let's get to it.",
    ),
    VoiceEntry(
        voice_id="celeste", display_name="Celeste",
        engine="kokoro", voice_code="af_river",
        lang="en_US", accent="American", gender="female", quality="balanced",
        size_mb=0, description="Flowing, melodic American female.",
        preview_text="Hello, I'm Celeste. I'm here to guide you through anything.",
    ),
    VoiceEntry(
        voice_id="scarlet", display_name="Scarlet",
        engine="kokoro", voice_code="af_heart",
        lang="en_US", accent="American", gender="female", quality="balanced",
        size_mb=0, description="Warm-hearted, emotive American female.",
        preview_text="Hi there. I'm Scarlet — I care about getting things right for you.",
    ),
    VoiceEntry(
        voice_id="jade", display_name="Jade",
        engine="kokoro", voice_code="af_nicole",
        lang="en_US", accent="American", gender="female", quality="balanced",
        size_mb=0, description="Smooth, refined American female.",
        preview_text="Hello, I'm Jade. Thoughtful and ready to assist.",
    ),
    VoiceEntry(
        voice_id="harper", display_name="Harper",
        engine="kokoro", voice_code="af_sarah",
        lang="en_US", accent="American", gender="female", quality="balanced",
        size_mb=0, description="Bright, conversational American female.",
        preview_text="Hey! I'm Harper. What are we chatting about today?",
    ),
    VoiceEntry(
        voice_id="vega", display_name="Vega",
        engine="kokoro", voice_code="af_jessica",
        lang="en_US", accent="American", gender="female", quality="balanced",
        size_mb=0, description="Clear, precise American female.",
        preview_text="Hello, I'm Vega. Accurate, dependable, and ready to help.",
    ),
    VoiceEntry(
        voice_id="kore", display_name="Kore",
        engine="kokoro", voice_code="af_kore",
        lang="en_US", accent="American", gender="female", quality="balanced",
        size_mb=0, description="Crisp, energetic American female.",
        preview_text="Hi, I'm Kore! Give me something interesting to work with.",
    ),
    VoiceEntry(
        voice_id="lyra", display_name="Lyra",
        engine="kokoro", voice_code="af_nova",
        lang="en_US", accent="American", gender="female", quality="balanced",
        size_mb=0, description="Modern, polished American female.",
        preview_text="Hello, I'm Lyra — your sleek, capable AI assistant.",
    ),
    VoiceEntry(
        voice_id="alloy", display_name="Alloy",
        engine="kokoro", voice_code="af_alloy",
        lang="en_US", accent="American", gender="female", quality="balanced",
        size_mb=0, description="Neutral, versatile American female.",
        preview_text="Hi, I'm Alloy. Flexible and ready for whatever you throw at me.",
    ),
    VoiceEntry(
        voice_id="siren", display_name="Siren",
        engine="kokoro", voice_code="af_aoede",
        lang="en_US", accent="American", gender="female", quality="balanced",
        size_mb=0, description="Musical, compelling American female.",
        preview_text="Hello. I'm Siren — and I have a feeling we'll work well together.",
    ),

    # ── Kokoro · American Male ──────────────────────────────────────────────
    VoiceEntry(
        voice_id="thor", display_name="Thor",
        engine="kokoro", voice_code="am_adam",
        lang="en_US", accent="American", gender="male", quality="balanced",
        size_mb=0, description="Strong, deep American male.",
        preview_text="I'm Thor. Strong, steady, and here to carry the load.",
    ),
    VoiceEntry(
        voice_id="cipher", display_name="Cipher",
        engine="kokoro", voice_code="am_echo",
        lang="en_US", accent="American", gender="male", quality="balanced",
        size_mb=0, description="Clear, resonant American male.",
        preview_text="Cipher here. Anything complex? That's my specialty.",
    ),
    VoiceEntry(
        voice_id="bolt", display_name="Bolt",
        engine="kokoro", voice_code="am_eric",
        lang="en_US", accent="American", gender="male", quality="balanced",
        size_mb=0, description="Energetic, direct American male.",
        preview_text="Hey, I'm Bolt — fast answers, no delays. What do you need?",
    ),
    VoiceEntry(
        voice_id="fenrir", display_name="Fenrir",
        engine="kokoro", voice_code="am_fenrir",
        lang="en_US", accent="American", gender="male", quality="balanced",
        size_mb=0, description="Commanding, powerful American male.",
        preview_text="I'm Fenrir. Powerful, focused, and ready for a challenge.",
    ),
    VoiceEntry(
        voice_id="hawk", display_name="Hawk",
        engine="kokoro", voice_code="am_liam",
        lang="en_US", accent="American", gender="male", quality="balanced",
        size_mb=0, description="Sharp, focused American male.",
        preview_text="Hawk here — sharp eyes on the details. What can I help with?",
    ),
    VoiceEntry(
        voice_id="axiom", display_name="Axiom",
        engine="kokoro", voice_code="am_michael",
        lang="en_US", accent="American", gender="male", quality="balanced",
        size_mb=0, description="Authoritative, broadcast American male.",
        preview_text="Good day. I'm Axiom — authoritative, clear, and at your service.",
    ),
    VoiceEntry(
        voice_id="onyx", display_name="Onyx",
        engine="kokoro", voice_code="am_onyx",
        lang="en_US", accent="American", gender="male", quality="balanced",
        size_mb=0, description="Deep, smooth American male.",
        preview_text="Hello, I'm Onyx. Deep, smooth, and ready to assist.",
    ),
    VoiceEntry(
        voice_id="puck", display_name="Puck",
        engine="kokoro", voice_code="am_puck",
        lang="en_US", accent="American", gender="male", quality="balanced",
        size_mb=0, description="Playful, quick-witted American male.",
        preview_text="Puck here! Quick, clever, and full of good ideas — what's up?",
    ),
    VoiceEntry(
        voice_id="jolly", display_name="Jolly",
        engine="kokoro", voice_code="am_santa",
        lang="en_US", accent="American", gender="male", quality="balanced",
        size_mb=0, description="Warm, jolly American male. Seasonal favourite.",
        preview_text="Ho ho! I'm Jolly, and helping you puts a smile on my face!",
    ),

    # ── Kokoro · British Female ─────────────────────────────────────────────
    VoiceEntry(
        voice_id="alice", display_name="Alice",
        engine="kokoro", voice_code="bf_alice",
        lang="en_GB", accent="British", gender="female", quality="balanced",
        size_mb=0, description="Crisp, classic British female.",
        preview_text="Hello, I'm Alice — crisp, proper, and entirely at your disposal.",
    ),
    VoiceEntry(
        voice_id="elara", display_name="Elara",
        engine="kokoro", voice_code="bf_emma",
        lang="en_GB", accent="British", gender="female", quality="balanced",
        size_mb=0, description="Refined, elegant British female.",
        preview_text="Good day. I'm Elara. Refined and ready to be of service.",
    ),
    VoiceEntry(
        voice_id="isadora", display_name="Isadora",
        engine="kokoro", voice_code="bf_isabella",
        lang="en_GB", accent="British", gender="female", quality="balanced",
        size_mb=0, description="Sophisticated, expressive British female.",
        preview_text="Hello, I'm Isadora. Sophisticated assistance — that's what I do.",
    ),
    VoiceEntry(
        voice_id="lily", display_name="Lily",
        engine="kokoro", voice_code="bf_lily",
        lang="en_GB", accent="British", gender="female", quality="balanced",
        size_mb=0, description="Soft, melodic British female.",
        preview_text="Hello there. I'm Lily — gentle, warm, and happy to help.",
    ),

    # ── Kokoro · British Male ───────────────────────────────────────────────
    VoiceEntry(
        voice_id="dagger", display_name="Dagger",
        engine="kokoro", voice_code="bm_daniel",
        lang="en_GB", accent="British", gender="male", quality="balanced",
        size_mb=0, description="Sharp, precise British male.",
        preview_text="Dagger here. Sharp, precise — tell me what needs doing.",
    ),
    VoiceEntry(
        voice_id="fable", display_name="Fable",
        engine="kokoro", voice_code="bm_fable",
        lang="en_GB", accent="British", gender="male", quality="balanced",
        size_mb=0, description="Storytelling, narrative British male.",
        preview_text="Hello, I'm Fable. Every question is a story worth exploring.",
    ),
    VoiceEntry(
        voice_id="baron", display_name="Baron",
        engine="kokoro", voice_code="bm_george",
        lang="en_GB", accent="British", gender="male", quality="balanced",
        size_mb=0, description="Distinguished, formal British male.",
        preview_text="Good day. Baron at your service — distinguished and dependable.",
    ),
    VoiceEntry(
        voice_id="rook", display_name="Rook",
        engine="kokoro", voice_code="bm_lewis",
        lang="en_GB", accent="British", gender="male", quality="balanced",
        size_mb=0, description="Grounded, steady British male.",
        preview_text="Rook here. Steady, reliable, and ready for whatever's next.",
    ),

    # =========================================================================
    # CHATTERBOX VOICES (VOICE CLONING)
    # =========================================================================
    VoiceEntry(
        voice_id="cloned", display_name="River (Cloned)",
        engine="chatterbox", voice_code="cloned",
        lang="en_GB", accent="British", gender="female", quality="high",
        size_mb=0, description="Your custom cloned voice. Requires voice_reference.wav.",
        preview_text="Hello, sweetie. I'm your custom cloned voice — just like the real River Song.",
    ),

    # =========================================================================
    # ELEVENLABS VOICES
    # =========================================================================
    VoiceEntry(
        voice_id="eleven-river", display_name="River (Eleven)",
        engine="elevenlabs", voice_code=get_settings().elevenlabs_voice_id,
        lang="en_GB", accent="British", gender="female", quality="high",
        size_mb=0, description="Sophisticated British female via ElevenLabs API.",
        preview_text="Hello, sweetie. I'm River Song. It's a pleasure to finally meet you properly.",
    ),
]


# =============================================================================
# Registry
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
    def list_by_engine(cls, engine: str) -> List[VoiceEntry]:
        return [v for v in _CATALOG if v.engine == engine]

    @classmethod
    def list_piper(cls) -> List[VoiceEntry]:
        return cls.list_by_engine("piper")

    @classmethod
    def list_kokoro(cls) -> List[VoiceEntry]:
        return cls.list_by_engine("kokoro")

    @classmethod
    def hf_url(cls, voice_id: str) -> Optional[str]:
        e = cls.get(voice_id)
        return f"{_HF_PIPER}/{e.hf_path}" if e and e.hf_path else None

    @classmethod
    def hf_json_url(cls, voice_id: str) -> Optional[str]:
        e = cls.get(voice_id)
        return f"{_HF_PIPER}/{e.hf_path}.json" if e and e.hf_path else None
