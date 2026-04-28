# =============================================================================
# providers/llm/registry.py
#
# File Purpose:
#   Central catalog of every LLM available to River Song -- local Ollama models
#   and cloud provider models. Describes VRAM requirements, context windows,
#   and per-token costs so the UI can display what a user will pay.
#
# Key Classes:
#   ModelEntry      -- metadata record for one model
#   LLMRegistry     -- the full catalog with lookup helpers
#
# Key Functions:
#   LLMRegistry.get(provider, model) -- ModelEntry or None
#   LLMRegistry.list_local()         -- all Ollama models
#   LLMRegistry.list_cloud()         -- all cloud models
#   LLMRegistry.providers()          -- unique provider names
#
# Dependencies:
#   Python standard library only (dataclasses, typing)
#
# Usage Example:
#   entry = LLMRegistry.get("ollama", "llama3.2:3b")
#   if entry.vram_gb and entry.vram_gb > available_vram:
#       print("Will run on CPU (slower)")
#   print(f"Input cost: ${entry.cost_per_1k_input_usd:.4f}/1K tokens")
# =============================================================================

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple


@dataclass(frozen=True)
class ModelEntry:
    """
    Purpose:
        Metadata for a single model available to River Song.

    Assumptions/Constraints:
        - vram_gb is None for cloud models (irrelevant)
        - vram_gb is the approximate minimum VRAM for GPU inference at Q4 quant
        - cost_per_1k_input_usd / cost_per_1k_output_usd are None for local models
        - context_window is in tokens
        - is_cloud=True models require an API key to be set in .env
        - priority: lower number = preferred; used to sort the model picker
    """
    provider: str
    model_id: str
    display_name: str
    context_window: int
    is_cloud: bool = False
    vram_gb: Optional[float] = None           # local models only
    cost_per_1k_input_usd: Optional[float] = None   # cloud models only
    cost_per_1k_output_usd: Optional[float] = None  # cloud models only
    notes: str = ""
    priority: int = 99


# =============================================================================
# Model catalog
# =============================================================================
#
# Local priority order (user's request):
#   DeepSeek → Llama → Phi → Gemma → Qwen → Mistral
#   Then larger CPU-only variants: Llama 3.1, Llama 3.2, Gemma 2
#
# Cloud order (user's request):
#   Anthropic → Google Gemini → OpenAI → Mistral AI
#
# VRAM estimates are for Q4_K_M quantisation (standard Ollama default).
# GTX 1050 Ti has 4GB VRAM; models >4GB fall back to CPU via RAM.
# =============================================================================

_CATALOG: List[ModelEntry] = [

    # -------------------------------------------------------------------------
    # DeepSeek (priority 10-19)
    # -------------------------------------------------------------------------
    # DeepSeek R1 — Chinese AI reasoning/thinking models, great for complex questions
    ModelEntry(
        provider="ollama",
        model_id="deepseek-r1:1.5b",
        display_name="DeepSeek Thinker Lite",
        context_window=131072,
        vram_gb=1.1,
        notes="Fastest reasoning model, runs fully on GPU",
        priority=10,
    ),
    ModelEntry(
        provider="ollama",
        model_id="deepseek-r1:7b",
        display_name="DeepSeek Thinker Standard",
        context_window=131072,
        vram_gb=4.7,
        notes="Good reasoning, runs on RAM",
        priority=11,
    ),
    ModelEntry(
        provider="ollama",
        model_id="deepseek-r1:8b",
        display_name="DeepSeek Thinker Standard+",
        context_window=131072,
        vram_gb=5.2,
        notes="Strong reasoning, runs on RAM",
        priority=12,
    ),
    ModelEntry(
        provider="ollama",
        model_id="deepseek-r1:14b",
        display_name="DeepSeek Thinker Plus",
        context_window=131072,
        vram_gb=9.0,
        notes="Excellent reasoning, runs on RAM",
        priority=13,
    ),

    # -------------------------------------------------------------------------
    # Llama — Meta's general purpose models
    # -------------------------------------------------------------------------
    ModelEntry(
        provider="ollama",
        model_id="llama3.2:1b",
        display_name="Meta Llama Lite",
        context_window=131072,
        vram_gb=0.8,
        notes="Fastest general model, runs fully on GPU",
        priority=20,
    ),
    ModelEntry(
        provider="ollama",
        model_id="llama3.2:3b",
        display_name="Meta Llama Standard",
        context_window=131072,
        vram_gb=2.0,
        notes="Best speed/quality balance, runs on GPU",
        priority=21,
    ),
    ModelEntry(
        provider="ollama",
        model_id="llama3.1:8b",
        display_name="Meta Llama Plus",
        context_window=131072,
        vram_gb=5.0,
        notes="Strong general model, runs on RAM",
        priority=22,
    ),

    # -------------------------------------------------------------------------
    # Phi — Microsoft's efficient models, smart for their size
    # -------------------------------------------------------------------------
    ModelEntry(
        provider="ollama",
        model_id="phi3.5",
        display_name="Microsoft Phi Standard",
        context_window=131072,
        vram_gb=2.2,
        notes="Punches above its size, runs on GPU",
        priority=30,
    ),
    ModelEntry(
        provider="ollama",
        model_id="phi4-mini",
        display_name="Microsoft Phi Standard+",
        context_window=131072,
        vram_gb=2.5,
        notes="Improved reasoning, runs on GPU",
        priority=31,
    ),
    ModelEntry(
        provider="ollama",
        model_id="phi4",
        display_name="Microsoft Phi Plus",
        context_window=16384,
        vram_gb=8.9,
        notes="Excellent reasoning, runs on RAM",
        priority=32,
    ),

    # -------------------------------------------------------------------------
    # Gemma — Google's models
    # -------------------------------------------------------------------------
    ModelEntry(
        provider="ollama",
        model_id="gemma3:1b",
        display_name="Google Gemma Lite",
        context_window=32768,
        vram_gb=0.8,
        notes="Fastest Google model, runs on GPU",
        priority=40,
    ),
    ModelEntry(
        provider="ollama",
        model_id="gemma3:4b",
        display_name="Google Gemma Standard",
        context_window=131072,
        vram_gb=3.3,
        notes="Solid all-rounder, runs on GPU",
        priority=41,
    ),
    ModelEntry(
        provider="ollama",
        model_id="gemma3:12b",
        display_name="Google Gemma Plus",
        context_window=131072,
        vram_gb=8.1,
        notes="Very capable, runs on RAM",
        priority=42,
    ),
    ModelEntry(
        provider="ollama",
        model_id="gemma3:27b",
        display_name="Google Gemma Max",
        context_window=131072,
        vram_gb=17.0,
        notes="Best Google model, runs on RAM",
        priority=43,
    ),

    # -------------------------------------------------------------------------
    # Qwen — Alibaba's models, strong at math and multilingual
    # -------------------------------------------------------------------------
    ModelEntry(
        provider="ollama",
        model_id="qwen2.5:3b",
        display_name="Alibaba Qwen Standard",
        context_window=131072,
        vram_gb=2.0,
        notes="Fast, great multilingual, runs on GPU",
        priority=50,
    ),
    ModelEntry(
        provider="ollama",
        model_id="qwen2.5:7b",
        display_name="Alibaba Qwen Plus",
        context_window=131072,
        vram_gb=4.7,
        notes="Excellent quality, runs on RAM",
        priority=51,
    ),
    ModelEntry(
        provider="ollama",
        model_id="qwen2.5:14b",
        display_name="Alibaba Qwen Max",
        context_window=131072,
        vram_gb=9.0,
        notes="Top Qwen quality, runs on RAM",
        priority=52,
    ),

    # -------------------------------------------------------------------------
    # Mistral — French AI, fast and efficient, great English
    # -------------------------------------------------------------------------
    ModelEntry(
        provider="ollama",
        model_id="mistral:7b",
        display_name="Mistral Standard",
        context_window=32768,
        vram_gb=4.1,
        notes="Fast and efficient, runs on RAM",
        priority=60,
    ),
    ModelEntry(
        provider="ollama",
        model_id="mistral-nemo",
        display_name="Mistral Plus",
        context_window=131072,
        vram_gb=7.1,
        notes="Larger context, runs on RAM",
        priority=61,
    ),
    ModelEntry(
        provider="ollama",
        model_id="mixtral:8x7b",
        display_name="Mistral Max",
        context_window=32768,
        vram_gb=26.0,
        notes="Mixture of experts, highest quality Mistral, runs on RAM",
        priority=62,
    ),

    # -------------------------------------------------------------------------
    # Code models — specialized for programming
    # -------------------------------------------------------------------------
    ModelEntry(
        provider="ollama",
        model_id="codellama:7b",
        display_name="Meta Code Llama Standard",
        context_window=16384,
        vram_gb=4.7,
        notes="Meta's coding model, runs on RAM",
        priority=80,
    ),
    ModelEntry(
        provider="ollama",
        model_id="codellama:13b",
        display_name="Meta Code Llama Plus",
        context_window=16384,
        vram_gb=8.0,
        notes="Stronger code generation, runs on RAM",
        priority=81,
    ),
    ModelEntry(
        provider="ollama",
        model_id="qwen2.5-coder:7b",
        display_name="Alibaba Coder Standard",
        context_window=131072,
        vram_gb=4.7,
        notes="Excellent coding model, 128K context, runs on RAM",
        priority=82,
    ),
    ModelEntry(
        provider="ollama",
        model_id="qwen2.5-coder:14b",
        display_name="Alibaba Coder Plus",
        context_window=131072,
        vram_gb=9.0,
        notes="Top local coding model, runs on RAM",
        priority=83,
    ),

    # =========================================================================
    # Cloud providers
    # =========================================================================

    # -------------------------------------------------------------------------
    # Amazon Bedrock — Amazon Nova (priority 100-109)
    # -------------------------------------------------------------------------
    ModelEntry(
        provider="bedrock",
        model_id="amazon.nova-micro-v1:0",
        display_name="Nova Micro",
        context_window=128000,
        is_cloud=True,
        cost_per_1k_input_usd=0.000035,
        cost_per_1k_output_usd=0.000140,
        notes="Fastest Nova, text-only, ultra-low cost",
        priority=100,
    ),
    ModelEntry(
        provider="bedrock",
        model_id="amazon.nova-lite-v1:0",
        display_name="Nova Lite",
        context_window=300000,
        is_cloud=True,
        cost_per_1k_input_usd=0.000060,
        cost_per_1k_output_usd=0.000240,
        notes="Fast multimodal, 300K context, very low cost",
        priority=101,
    ),
    ModelEntry(
        provider="bedrock",
        model_id="amazon.nova-pro-v1:0",
        display_name="Nova Pro",
        context_window=300000,
        is_cloud=True,
        cost_per_1k_input_usd=0.000800,
        cost_per_1k_output_usd=0.003200,
        notes="Most capable Nova, balanced speed and intelligence",
        priority=102,
    ),

    # -------------------------------------------------------------------------
    # Amazon Bedrock — Claude via Bedrock (priority 103-106)
    # -------------------------------------------------------------------------
    ModelEntry(
        provider="bedrock",
        model_id="anthropic.claude-3-haiku-20240307-v1:0",
        display_name="Claude 3 Haiku (Bedrock)",
        context_window=200000,
        is_cloud=True,
        cost_per_1k_input_usd=0.000250,
        cost_per_1k_output_usd=0.001250,
        notes="Fastest Claude on Bedrock",
        priority=103,
    ),
    ModelEntry(
        provider="bedrock",
        model_id="anthropic.claude-3-5-sonnet-20241022-v2:0",
        display_name="Claude 3.5 Sonnet (Bedrock)",
        context_window=200000,
        is_cloud=True,
        cost_per_1k_input_usd=0.003000,
        cost_per_1k_output_usd=0.015000,
        notes="Best Claude available on Bedrock",
        priority=104,
    ),

    # -------------------------------------------------------------------------
    # Amazon Bedrock — Meta Llama (priority 105-107)
    # -------------------------------------------------------------------------
    ModelEntry(
        provider="bedrock",
        model_id="meta.llama3-3-70b-instruct-v1:0",
        display_name="Llama 3.3 70B (Bedrock)",
        context_window=128000,
        is_cloud=True,
        cost_per_1k_input_usd=0.000720,
        cost_per_1k_output_usd=0.000720,
        notes="Latest Llama 3.3, strong general performance",
        priority=105,
    ),
    ModelEntry(
        provider="bedrock",
        model_id="meta.llama3-1-8b-instruct-v1:0",
        display_name="Llama 3.1 8B (Bedrock)",
        context_window=128000,
        is_cloud=True,
        cost_per_1k_input_usd=0.000220,
        cost_per_1k_output_usd=0.000220,
        notes="Fast and cheap Llama on Bedrock",
        priority=106,
    ),

    # -------------------------------------------------------------------------
    # Amazon Bedrock — DeepSeek (priority 107)
    # -------------------------------------------------------------------------
    ModelEntry(
        provider="bedrock",
        model_id="deepseek.r1-v1:0",
        display_name="DeepSeek R1 (Bedrock)",
        context_window=64000,
        is_cloud=True,
        cost_per_1k_input_usd=0.001350,
        cost_per_1k_output_usd=0.005400,
        notes="DeepSeek R1 reasoning model via Bedrock",
        priority=107,
    ),

    # -------------------------------------------------------------------------
    # Amazon Bedrock — Mistral (priority 108)
    # -------------------------------------------------------------------------
    ModelEntry(
        provider="bedrock",
        model_id="mistral.mistral-large-2402-v1:0",
        display_name="Mistral Large (Bedrock)",
        context_window=32000,
        is_cloud=True,
        cost_per_1k_input_usd=0.004000,
        cost_per_1k_output_usd=0.012000,
        notes="Mistral Large via Bedrock",
        priority=108,
    ),

    # -------------------------------------------------------------------------
    # Anthropic Claude (priority 110-119)
    # -------------------------------------------------------------------------
    ModelEntry(
        provider="anthropic",
        model_id="claude-haiku-4-5-20251001",
        display_name="Claude Haiku 4.5",
        context_window=200000,
        is_cloud=True,
        cost_per_1k_input_usd=0.00080,
        cost_per_1k_output_usd=0.00400,
        notes="Fastest Claude, lowest cost",
        priority=110,
    ),
    ModelEntry(
        provider="anthropic",
        model_id="claude-sonnet-4-6",
        display_name="Claude Sonnet 4.6",
        context_window=200000,
        is_cloud=True,
        cost_per_1k_input_usd=0.00300,
        cost_per_1k_output_usd=0.01500,
        notes="Balanced intelligence and speed",
        priority=111,
    ),
    ModelEntry(
        provider="anthropic",
        model_id="claude-opus-4-7",
        display_name="Claude Opus 4.7",
        context_window=200000,
        is_cloud=True,
        cost_per_1k_input_usd=0.01500,
        cost_per_1k_output_usd=0.07500,
        notes="Most capable Claude model",
        priority=112,
    ),

    # -------------------------------------------------------------------------
    # Google Gemini (priority 120-129)
    # -------------------------------------------------------------------------
    ModelEntry(
        provider="gemini",
        model_id="gemini-2.0-flash",
        display_name="Gemini 2.0 Flash",
        context_window=1048576,
        is_cloud=True,
        cost_per_1k_input_usd=0.00010,
        cost_per_1k_output_usd=0.00040,
        notes="Extremely fast, 1M context, very low cost",
        priority=120,
    ),
    ModelEntry(
        provider="gemini",
        model_id="gemini-2.5-flash-preview-04-17",
        display_name="Gemini 2.5 Flash",
        context_window=1048576,
        is_cloud=True,
        cost_per_1k_input_usd=0.00015,
        cost_per_1k_output_usd=0.00060,
        notes="Latest Flash with thinking mode",
        priority=121,
    ),
    ModelEntry(
        provider="gemini",
        model_id="gemini-2.5-pro-preview-05-06",
        display_name="Gemini 2.5 Pro",
        context_window=1048576,
        is_cloud=True,
        cost_per_1k_input_usd=0.00125,
        cost_per_1k_output_usd=0.01000,
        notes="Most capable Gemini model",
        priority=122,
    ),

    # -------------------------------------------------------------------------
    # OpenAI (priority 130-139)
    # -------------------------------------------------------------------------
    ModelEntry(
        provider="openai",
        model_id="gpt-4o-mini",
        display_name="GPT-4o Mini",
        context_window=128000,
        is_cloud=True,
        cost_per_1k_input_usd=0.00015,
        cost_per_1k_output_usd=0.00060,
        notes="Cheapest GPT-4 class model",
        priority=130,
    ),
    ModelEntry(
        provider="openai",
        model_id="gpt-4o",
        display_name="GPT-4o",
        context_window=128000,
        is_cloud=True,
        cost_per_1k_input_usd=0.00250,
        cost_per_1k_output_usd=0.01000,
        notes="Standard GPT-4o",
        priority=131,
    ),
    ModelEntry(
        provider="openai",
        model_id="o4-mini",
        display_name="o4-mini (reasoning)",
        context_window=200000,
        is_cloud=True,
        cost_per_1k_input_usd=0.00110,
        cost_per_1k_output_usd=0.00440,
        notes="Reasoning model, good for complex tasks",
        priority=132,
    ),

    # -------------------------------------------------------------------------
    # Mistral AI cloud (priority 140-149)
    # -------------------------------------------------------------------------
    ModelEntry(
        provider="mistral_ai",
        model_id="mistral-small-latest",
        display_name="Mistral Small",
        context_window=32768,
        is_cloud=True,
        cost_per_1k_input_usd=0.00010,
        cost_per_1k_output_usd=0.00030,
        notes="Very affordable, good quality",
        priority=140,
    ),
    ModelEntry(
        provider="mistral_ai",
        model_id="mistral-large-latest",
        display_name="Mistral Large",
        context_window=131072,
        is_cloud=True,
        cost_per_1k_input_usd=0.00200,
        cost_per_1k_output_usd=0.00600,
        notes="Top-tier Mistral model",
        priority=141,
    ),
]


# =============================================================================
# Registry class
# =============================================================================

class LLMRegistry:
    """
    Purpose:
        Read-only catalog lookup for all available models.
        The UI uses this to build model pickers and display cost information.

    Assumptions/Constraints:
        - All entries are loaded at import time from _CATALOG above.
        - provider strings match the keys used in config (e.g., "ollama", "anthropic").
    """

    _index: Dict[Tuple[str, str], ModelEntry] = {
        (e.provider, e.model_id): e for e in _CATALOG
    }

    @classmethod
    def get(cls, provider: str, model_id: str) -> Optional[ModelEntry]:
        """Return the ModelEntry for (provider, model_id), or None if unknown."""
        return cls._index.get((provider, model_id))

    @classmethod
    def list_local(cls) -> List[ModelEntry]:
        """All Ollama (local) models sorted by priority."""
        return sorted(
            [e for e in _CATALOG if not e.is_cloud],
            key=lambda e: e.priority,
        )

    @classmethod
    def list_cloud(cls) -> List[ModelEntry]:
        """All cloud models sorted by priority."""
        return sorted(
            [e for e in _CATALOG if e.is_cloud],
            key=lambda e: e.priority,
        )

    @classmethod
    def list_by_provider(cls, provider: str) -> List[ModelEntry]:
        """All models for a specific provider, sorted by priority."""
        return sorted(
            [e for e in _CATALOG if e.provider == provider],
            key=lambda e: e.priority,
        )

    @classmethod
    def providers(cls) -> List[str]:
        """Unique provider names present in the catalog."""
        seen = []
        for e in _CATALOG:
            if e.provider not in seen:
                seen.append(e.provider)
        return seen

    @classmethod
    def all_models(cls) -> List[ModelEntry]:
        """Full catalog sorted by priority."""
        return sorted(_CATALOG, key=lambda e: e.priority)
