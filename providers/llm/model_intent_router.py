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
  3. Ties are broken by _TIE_BREAK_ORDER, never by dict insertion order.
  4. Long messages with no keyword signal escalate to "reasoning" instead of
     falling through to "general" and its smallest local model.
  5. When free_only is set, models that cost money are stripped from the
     preference chain before dispatch.
  6. Before dispatching, walk the provider preference list until one is available.
  7. Returns a RouterDecision dataclass with enough metadata for the UI chip.
"""

from __future__ import annotations

import datetime
import logging
import re
from dataclasses import dataclass
from typing import List, Optional, Tuple

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Minimum pattern hits required to commit to an intent (below this → general)
# ---------------------------------------------------------------------------
MIN_CONFIDENCE_HITS = 2

# ---------------------------------------------------------------------------
# Messages at or above this length carry enough material that the smallest
# local models handle them badly, even when no intent keyword fires. A pasted
# log, document, or stack trace is the usual case: lots of text, no verbs the
# patterns below recognise.
# ---------------------------------------------------------------------------
LONG_INPUT_CHARS = 1500

# ---------------------------------------------------------------------------
# Deterministic tie-break order, most specific first.
#
# Scores tie more often than you would expect. "why is the thermostat so
# expensive to run" scores home_control=2 (thermostat) and reasoning=2 (why);
# before this existed, the winner was whichever intent happened to be declared
# first in _INTENT_PATTERNS -- home_control -- so an explanation request went
# to llama3.2:1b.
#
# Ranking reasoning above home_control fixes that without hurting real device
# commands: those carry action verbs worth 3, so they win outright rather than
# tying.
# ---------------------------------------------------------------------------
_TIE_BREAK_ORDER: Tuple[str, ...] = (
    "code",
    "commerce",
    "creative",
    "research",
    "reasoning",
    "home_control",
    "quick_lookup",
)

# ---------------------------------------------------------------------------
# "Recent year" signal for the research intent, built at import time.
#
# This was a hardcoded 2024|2025|2026, which silently stopped matching the
# current year the moment the calendar rolled past it. Spanning last year
# through next year keeps "what happened in <year>" reading as research
# without another dated literal to remember to update.
# ---------------------------------------------------------------------------
def _recent_years_pattern(span: int = 1) -> str:
    """Alternation of the years within `span` of today, e.g. '2025|2026|2027'."""
    this_year = datetime.date.today().year
    return "|".join(
        str(y) for y in range(this_year - span, this_year + span + 1)
    )


_RECENT_YEARS = _recent_years_pattern()

# ---------------------------------------------------------------------------
# Intent patterns — ordered from most specific to least
# Each tuple: (pattern_string, weight)
# Weight lets important signals count more (e.g. device names = 2 hits)
# ---------------------------------------------------------------------------
_INTENT_PATTERNS: dict[str, List[Tuple[str, int]]] = {
    "home_control": [
        (r"\b(turn on|turn off|switch on|switch off)\b", 3),
        (r"\b(lights?|lamp|bulb)\b", 2),
        # "temperature" deliberately lives in quick_lookup only. Bare
        # "what's the temperature" is a weather question far more often than a
        # thermostat command, and having it in both intents guaranteed a tie
        # on one of the phrases a house assistant hears most. The set/adjust
        # pattern below still catches "set the temperature to 20".
        (r"\b(thermostat|heating|cooling|air con)\b", 2),
        (r"\b(lock|unlock|door|garage|gate)\b", 2),
        (r"\b(fan|blinds?|curtain|shutter)\b", 2),
        # `temp\w*` rather than `temp`: the old \btemp\b never matched
        # "temperature" at all, so "set the temperature to 20" scored nothing
        # here and fell through to quick_lookup.
        (
            r"\b(set|adjust|change|dim|brighten)\b.{0,20}\b(light|temp\w*|volume|thermostat)\b",
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
        (rf"\b(latest|recent|current|news|update|{_RECENT_YEARS})\b", 2),
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
        ("nvidia_nim", "zhipuai/glm-5.1"),
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
        # GLM 5.1 is free on NIM and built for agentic coding + tool use, so
        # it sits ahead of the paid options: a free-only user still gets a
        # capable model here rather than dropping to the local default.
        ("nvidia_nim", "zhipuai/glm-5.1"),
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

    Ties are resolved by _TIE_BREAK_ORDER rather than by whichever intent
    happens to be declared first in _INTENT_PATTERNS, so the same message
    always classifies the same way regardless of dict ordering.

    Falls back to "general" when no intent clears MIN_CONFIDENCE_HITS -- except
    for long messages, which escalate to "reasoning" instead. A 2,000-character
    paste with no trigger words is not a job for the smallest local model.
    """
    scores: dict[str, int] = {intent: 0 for intent in _COMPILED}
    for intent, patterns in _COMPILED.items():
        for pattern, weight in patterns:
            if pattern.search(message):
                scores[intent] += weight

    def _rank(intent: str) -> int:
        try:
            return _TIE_BREAK_ORDER.index(intent)
        except ValueError:      # intent added to patterns but not to the order
            return len(_TIE_BREAK_ORDER)

    # Highest score wins; equal scores fall back to tie-break rank.
    best_intent = min(scores, key=lambda k: (-scores[k], _rank(k)))
    best_score = scores[best_intent]

    if best_score < MIN_CONFIDENCE_HITS:
        if len(message) >= LONG_INPUT_CHARS:
            return "reasoning", best_score
        return "general", best_score

    return best_intent, best_score


class NoModelAvailable(RuntimeError):
    """Raised when every provider is disabled, so auto-routing has nothing.

    A distinct type because the caller has to tell this apart from a provider
    that failed mid-request: this one is a configuration state an admin can
    fix, and the message says so rather than surfacing as a generic error.
    """


def route(
    message: str,
    enabled_providers: dict[str, bool],
    free_only: bool = False,
    hidden_models: Optional[set] = None,
) -> RouterDecision:
    """
    Classify message intent and pick the first available provider/model.

    Args:
        message: The raw user message text.
        enabled_providers: Dict from _get_enabled_providers() — keys are
            provider strings, values are True when enabled + keyed.
            "ollama" is always True (local, no key needed).
        free_only: When True, models that cost money per token are removed
            from the preference chain before dispatch. Set per-user by an
            admin via the free_models_only flag. The final Ollama fallback is
            always local, so a free-only user can never be left without a
            model even if every entry in the chain is paid.

    Returns:
        RouterDecision with the best available provider + model.
    """
    from providers.llm.registry import LLMRegistry

    intent, confidence = classify_intent(message)
    preference_chain = _INTENT_ROUTES.get(intent, _INTENT_ROUTES["general"])
    hidden_models = hidden_models or set()

    # Per-model visibility. The provider switch is coarse — an admin who hid
    # one specific model expects auto to stop reaching for that model, not
    # just to stop when the whole provider is off. Without this the chains
    # below walk straight past `hidden_llms`, which is enforced everywhere a
    # human picks a model but was invisible to the automatic pick.
    if hidden_models:
        preference_chain = [
            (p, m) for p, m in preference_chain if m not in hidden_models
        ]

    if free_only:
        filtered = [
            (p, m) for p, m in preference_chain if LLMRegistry.is_free(p, m)
        ]
        if not filtered:
            logger.info(
                "Free-only routing: every model in the '%s' chain costs money, "
                "falling through to the local default.", intent,
            )
        preference_chain = filtered

    for provider, model_id in preference_chain:
        if enabled_providers.get(provider, False):
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

    # Last resort.
    #
    # This used to return Ollama unconditionally, without consulting
    # enabled_providers — so "River Decides" walked straight past a disabled
    # local provider and kept using it. That made the local switch
    # decorative for every auto-routed message, which is the one path most
    # messages take. It is checked now.
    if enabled_providers.get("ollama", False):
        settings_model = _get_default_ollama_model()
        logger.warning(
            "Intent router exhausted all preferences for '%s', using Ollama default.",
            intent,
        )
        return RouterDecision(
            provider="ollama",
            model_id=settings_model,
            intent=intent,
            confidence=confidence,
            display_label=f"Local · {intent.replace('_', ' ').title()}",
        )

    # Ollama is off too. Take the cheapest model from whatever the admin has
    # left enabled rather than failing the turn — but still honour free_only,
    # which is a restriction on the user and not a preference to trade away.
    candidates = [
        e for e in LLMRegistry.all_models()
        if enabled_providers.get(e.provider, False)
        and e.model_id not in hidden_models
        and (not free_only or LLMRegistry.is_free(e.provider, e.model_id))
    ]
    if candidates:
        pick = min(
            candidates,
            key=lambda e: (
                (e.cost_per_1k_input_usd or 0.0) + (e.cost_per_1k_output_usd or 0.0),
                e.priority,
            ),
        )
        logger.warning(
            "Intent router: local provider disabled; falling back to %s/%s for '%s'.",
            pick.provider, pick.model_id, intent,
        )
        return RouterDecision(
            provider=pick.provider,
            model_id=pick.model_id,
            intent=intent,
            confidence=confidence,
            display_label=f"{pick.display_name} · {intent.replace('_', ' ').title()}",
        )

    raise NoModelAvailable(
        "Every model provider is disabled"
        + (" for free-only accounts" if free_only else "")
        + ". Ask an administrator to enable at least one."
    )


def _get_default_ollama_model() -> str:
    try:
        from config.settings import get_settings
        return get_settings().llm_model or "llama3.2:3b"
    except Exception:
        return "llama3.2:3b"
