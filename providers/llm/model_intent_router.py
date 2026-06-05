"""
providers/llm/model_intent_router.py

Model Intent Router for River Song AI.

Classifies an incoming user message into an intent category and returns the
best (provider, model_id) pair for that intent, respecting which providers
are currently enabled and keyed in settings.

Intent taxonomy:
  home_control  — device commands, lights, locks, thermostat
  quick_lookup  — weather, time, reminders, simple facts
  reasoning     — analysis, planning, explanation, comparison
  creative      — writing, stories, poems, brainstorming
  code          — programming, debugging, scripts
  commerce      — orders, inventory, Amazon, Shopify, sales
  research      — web search, news, who/what-is queries
  general       — catch-all when no strong signal

Routing logic:
  1. Score each intent by counting matched keyword patterns in the message.
  2. Winning intent needs score >= MIN_CONFIDENCE_HITS (default 2).
  3. Before dispatching, walk the provider preference list until one is available.
  4. Returns a RouterDecision dataclass with enough metadata for the UI chip.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import List, Tuple

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Minimum pattern hits required to commit to an intent (below this → general)
# ---------------------------------------------------------------------------
MIN_CONFIDENCE_HITS = 2

# ---------------------------------------------------------------------------
# Intent patterns — ordered from most specific to least
# Each tuple: (pattern_string, weight)
# Weight lets important signals count more (e.g. device names = 2 hits)
# ---------------------------------------------------------------------------
_INTENT_PATTERNS: dict[str, List[Tuple[str, int]]] = {
    "home_control": [
        (r"\b(turn on|turn off|switch on|switch off)\b", 3),
        (r"\b(lights?|lamp|bulb)\b", 2),
        (r"\b(thermostat|temperature|heating|cooling|ac|air con)\b", 2),
        (r"\b(lock|unlock|door|garage|gate)\b", 2),
        (r"\b(fan|blinds?|curtain|shutter)\b", 2),
        (
            r"\b(set|adjust|change|dim|brighten)\b.{0,20}\b(light|temp|volume)\b",
            2),
        (r"\b(home assistant|smart home|device)\b", 1),
    ],
    "quick_lookup": [
        (r"\b(weather|temperature|forecast|rain|sunny|cloudy)\b", 2),
        (r"\b(what('?s| is) the time|current time|time now)\b", 3),
        (r"\b(remind(er)?|set (a )?reminder|don'?t forget)\b", 2),
        (r"\b(today'?s|this week'?s|tonight'?s)\b", 1),
        (r"\b(how (far|long|much)|distance|duration)\b", 1),
        (r"\b(convert|translation|what does .{1,20} mean)\b", 1),
    ],
    "reasoning": [
        (r"\b(why|explain|analyse|analyze|reason|cause|because)\b", 2),
        (r"\b(compare|difference|pros and cons|versus|vs\.?)\b", 2),
        (r"\b(plan|strategy|approach|how should|what'?s the best way)\b", 2),
        (r"\b(think (through|about)|walk me through|break (it |this )?down)\b", 2),
        (r"\b(evaluate|assess|critique|review|opinion)\b", 1),
        (r"\b(step[- ]by[- ]step|in depth|detailed|thorough)\b", 1),
    ],
    "creative": [
        (
            r"\b(write|draft|compose|create)\b.{0,30}\b(story|poem|email|letter|post|caption|bio)\b",
            3),
        (r"\b(story|poem|fiction|creative|narrative|tale)\b", 2),
        (r"\b(imagine|pretend|roleplay|character|plot|scene)\b", 2),
        (r"\b(brainstorm|ideas? for|come up with|suggest)\b", 1),
        (r"\b(catchy|witty|funny|humorous|tone|style)\b", 1),
    ],
    "code": [
        (r"\b(code|function|method|class|script|program)\b", 2),
        (r"\b(debug|fix( the)?|error|exception|bug|crash)\b", 2),
        (r"\b(python|javascript|typescript|bash|sql|html|css|rust|go)\b", 2),
        (r"\b(implement|refactor|optimise|optimize|snippet)\b", 1),
        (r"(```|`[^`])", 2),
        (r"\b(api|endpoint|database|query|schema)\b", 1),
    ],
    "commerce": [
        (r"\b(order|orders?|sales?|revenue|profit|margin)\b", 2),
        (r"\b(inventory|stock|sku|listing|asin|fba|fulfilment)\b", 2),
        (r"\b(amazon|shopify|walmart|ebay|etsy|marketplace)\b", 2),
        (r"\b(refund|return|dispute|chargeback|claim)\b", 2),
        (r"\b(customer|buyer|seller|feedback|review score)\b", 1),
        (r"\b(shipping|courier|tracking|delivery)\b", 1),
    ],
    "research": [
        (r"\b(search|look up|find out|research)\b", 2),
        (r"\b(who is|what is|when did|where is|how does)\b", 1),
        (r"\b(latest|recent|current|news|update|2024|2025|2026)\b", 2),
        (r"\b(article|source|reference|study|report)\b", 1),
        (r"\b(wikipedia|google|internet|online)\b", 1),
    ],
}

# Compile all patterns once at import time
_COMPILED: dict[str, List[Tuple[re.Pattern, int]]] = {
    intent: [(re.compile(pat, re.IGNORECASE), weight)
             for pat, weight in patterns]
    for intent, patterns in _INTENT_PATTERNS.items()
}

# ---------------------------------------------------------------------------
# Provider preference chains per intent
# Each entry: (provider_key, model_id)
# First available provider wins.
# ---------------------------------------------------------------------------
_INTENT_ROUTES: dict[str, List[Tuple[str, str]]] = {
    "home_control": [
        ("ollama", "llama3.2:1b"),
        ("ollama", "llama3.2:3b"),
        ("ollama", "gemma3:1b"),
    ],
    "quick_lookup": [
        ("ollama", "llama3.2:3b"),
        ("ollama", "llama3.2:1b"),
        ("nvidia_nim", "moonshotai/kimi-k2"),
    ],
    "reasoning": [
        ("nvidia_nim", "nvidia/llama-3.1-nemotron-ultra-253b-v1"),
        ("nvidia_nim", "nvidia/llama-3.3-nemotron-super-49b-v1"),
        ("nvidia_nim", "deepseek-ai/deepseek-r1"),
        ("anthropic", "claude-sonnet-4-6"),
        ("ollama", "deepseek-r1:14b"),
    ],
    "creative": [
        ("nvidia_nim", "moonshotai/kimi-k2"),
        ("anthropic", "claude-sonnet-4-6"),
        ("nvidia_nim", "meta/llama-3.1-70b-instruct"),
        ("ollama", "llama3.1:8b"),
    ],
    "code": [
        ("ollama", "qwen2.5-coder:7b"),
        ("ollama", "qwen2.5-coder:14b"),
        ("anthropic", "claude-sonnet-4-6"),
        ("nvidia_nim", "meta/llama-3.1-70b-instruct"),
    ],
    "commerce": [
        ("anthropic", "claude-sonnet-4-6"),
        ("anthropic", "claude-haiku-4-5-20251001"),
        ("gemini", "gemini-2.0-flash"),
        ("nvidia_nim", "moonshotai/kimi-k2"),
    ],
    "research": [
        ("gemini", "gemini-2.0-flash"),
        ("gemini", "gemini-2.5-flash-preview-04-17"),
        ("nvidia_nim", "meta/llama-3.1-70b-instruct"),
        ("anthropic", "claude-haiku-4-5-20251001"),
    ],
    "general": [
        ("ollama", "llama3.2:3b"),
        ("nvidia_nim", "moonshotai/kimi-k2"),
        ("anthropic", "claude-haiku-4-5-20251001"),
        ("ollama", "llama3.2:1b"),
    ],
}


# ---------------------------------------------------------------------------
# RouterDecision — what the router returns
# ---------------------------------------------------------------------------
@dataclass
class RouterDecision:
    provider: str
    model_id: str
    intent: str
    confidence: int      # raw pattern hit score
    display_label: str   # e.g. "Nemotron · Reasoning" for the UI chip


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def classify_intent(message: str) -> Tuple[str, int]:
    """
    Score the message against all intent patterns.
    Returns (intent_name, confidence_score).
    Falls back to "general" when no intent clears MIN_CONFIDENCE_HITS.
    """
    scores: dict[str, int] = {intent: 0 for intent in _COMPILED}
    for intent, patterns in _COMPILED.items():
        for pattern, weight in patterns:
            if pattern.search(message):
                scores[intent] += weight

    best_intent = max(scores, key=lambda k: scores[k])
    best_score = scores[best_intent]

    if best_score < MIN_CONFIDENCE_HITS:
        return "general", best_score

    return best_intent, best_score


def route(message: str, enabled_providers: dict[str, bool]) -> RouterDecision:
    """
    Classify message intent and pick the first available provider/model.

    Args:
        message: The raw user message text.
        enabled_providers: Dict from _get_enabled_providers() — keys are
            provider strings, values are True when enabled + keyed.
            "ollama" is always True (local, no key needed).

    Returns:
        RouterDecision with the best available provider + model.
    """
    intent, confidence = classify_intent(message)
    preference_chain = _INTENT_ROUTES.get(intent, _INTENT_ROUTES["general"])

    for provider, model_id in preference_chain:
        if enabled_providers.get(provider, False):
            from providers.llm.registry import LLMRegistry
            entry = LLMRegistry.get(provider, model_id)
            display_name = entry.display_name if entry else model_id.split(
                "/")[-1]
            intent_label = intent.replace("_", " ").title()
            return RouterDecision(
                provider=provider,
                model_id=model_id,
                intent=intent,
                confidence=confidence,
                display_label=f"{display_name} · {intent_label}",
            )

    # Last resort — Ollama default model
    settings_model = _get_default_ollama_model()
    logger.warning(
        "Intent router exhausted all preferences for '%s', using Ollama default.", intent
    )
    return RouterDecision(
        provider="ollama",
        model_id=settings_model,
        intent=intent,
        confidence=confidence,
        display_label=f"Local · {intent.replace('_', ' ').title()}",
    )


def _get_default_ollama_model() -> str:
    try:
        from config.settings import get_settings
        return get_settings().llm_model or "llama3.2:3b"
    except Exception:
        return "llama3.2:3b"
