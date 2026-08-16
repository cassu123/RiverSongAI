"""Unit tests for providers.llm.model_intent_router."""

from __future__ import annotations

import datetime

import pytest

from providers.llm.model_intent_router import (
    LONG_INPUT_CHARS,
    MIN_CONFIDENCE_HITS,
    _INTENT_ROUTES,
    _TIE_BREAK_ORDER,
    _recent_years_pattern,
    classify_intent,
    route,
)
from providers.llm.registry import LLMRegistry


ALL_ENABLED = {
    "ollama": True,
    "anthropic": True,
    "gemini": True,
    "openai": True,
    "mistral_ai": True,
    "bedrock": True,
    "nvidia_nim": True,
}

LOCAL_ONLY = {"ollama": True}


# ---------------------------------------------------------------------------
# classify_intent
# ---------------------------------------------------------------------------

def test_device_commands_still_win_outright():
    intent, score = classify_intent("turn off the kitchen lights")
    assert intent == "home_control"
    assert score >= MIN_CONFIDENCE_HITS


def test_explanation_about_a_device_is_reasoning_not_home_control():
    """The tie that used to resolve by dict order and send this to a 1B model."""
    intent, _ = classify_intent("why is the thermostat so expensive to run")
    assert intent == "reasoning"


def test_bare_temperature_question_is_not_home_control():
    """'temperature' belongs to quick_lookup only -- it reads as weather."""
    intent, _ = classify_intent("what's the temperature")
    assert intent == "quick_lookup"


def test_setting_a_temperature_is_still_home_control():
    intent, _ = classify_intent("set the temperature to 20 degrees")
    assert intent == "home_control"


def test_classification_is_deterministic_across_calls():
    message = "why is the thermostat so expensive to run"
    assert len({classify_intent(message)[0] for _ in range(25)}) == 1


def test_ties_resolve_by_documented_order_not_dict_order():
    """Every intent that can be scored must have a defined tie-break rank."""
    for intent in _INTENT_ROUTES:
        if intent == "general":
            continue
        assert intent in _TIE_BREAK_ORDER, f"{intent} missing from tie-break order"


def test_short_unremarkable_message_falls_back_to_general():
    intent, score = classify_intent("hello there")
    assert intent == "general"
    assert score < MIN_CONFIDENCE_HITS


def test_long_keywordless_message_escalates_to_reasoning():
    """A big paste with no trigger words should not land on the smallest model."""
    blob = "lorem ipsum dolor sit amet " * 100
    assert len(blob) >= LONG_INPUT_CHARS
    intent, score = classify_intent(blob)
    assert intent == "reasoning"
    assert score < MIN_CONFIDENCE_HITS


def test_long_message_with_keywords_keeps_its_real_intent():
    blob = "turn off the lights " * 100
    assert classify_intent(blob)[0] == "home_control"


# ---------------------------------------------------------------------------
# Recent-year pattern
# ---------------------------------------------------------------------------

def test_recent_years_pattern_tracks_the_current_year():
    this_year = datetime.date.today().year
    pattern = _recent_years_pattern()
    assert str(this_year) in pattern
    assert str(this_year - 1) in pattern
    assert str(this_year + 1) in pattern


def test_current_year_reads_as_research():
    this_year = datetime.date.today().year
    intent, _ = classify_intent(f"search for the latest news in {this_year}")
    assert intent == "research"


# ---------------------------------------------------------------------------
# route() — free-only filtering
# ---------------------------------------------------------------------------

def _is_free(decision) -> bool:
    return LLMRegistry.is_free(decision.provider, decision.model_id)


@pytest.mark.parametrize(
    "message",
    [
        "turn off the lights",
        "why is this happening, explain the cause",
        "write a python function to fix this bug",
        "what were my amazon orders and inventory levels",
        "search for the latest news article",
        "write me a story about a poem",
        "what's the temperature",
        "hello there",
    ],
)
def test_free_only_never_routes_to_a_paid_model(message):
    decision = route(message, ALL_ENABLED, free_only=True)
    assert _is_free(decision), (
        f"{message!r} routed to paid {decision.provider}/{decision.model_id}"
    )


@pytest.mark.parametrize(
    "message",
    [
        "turn off the lights",
        "why is this happening, explain the cause",
        "write a python function to fix this bug",
        "what were my amazon orders and inventory levels",
    ],
)
def test_free_only_still_returns_a_usable_model(message):
    decision = route(message, ALL_ENABLED, free_only=True)
    assert decision.provider
    assert decision.model_id
    assert decision.display_label


def test_commerce_uses_a_paid_model_when_free_only_is_off():
    """Guards the test above: without the flag this chain does pick paid."""
    decision = route(
        "what were my amazon orders and inventory levels", ALL_ENABLED)
    assert not _is_free(decision)


def test_free_only_falls_back_to_local_when_chain_is_all_paid():
    decision = route(
        "what were my amazon orders and inventory levels",
        LOCAL_ONLY,
        free_only=True,
    )
    assert decision.provider == "ollama"


def test_free_only_defaults_to_off():
    """An unrestricted user must keep the existing behaviour."""
    paid = route("what were my amazon orders and inventory levels", ALL_ENABLED)
    explicit = route(
        "what were my amazon orders and inventory levels",
        ALL_ENABLED,
        free_only=False,
    )
    assert (paid.provider, paid.model_id) == (explicit.provider, explicit.model_id)


# ---------------------------------------------------------------------------
# Route table integrity
# ---------------------------------------------------------------------------

def test_every_routed_model_exists_in_the_registry():
    for intent, chain in _INTENT_ROUTES.items():
        for provider, model_id in chain:
            assert LLMRegistry.get(provider, model_id) is not None, (
                f"{intent} routes to unknown model {provider}/{model_id}"
            )


def test_every_intent_chain_contains_at_least_one_free_model():
    """Otherwise a free-only user silently drops to the default on that intent."""
    for intent, chain in _INTENT_ROUTES.items():
        assert any(LLMRegistry.is_free(p, m) for p, m in chain), (
            f"{intent} has no free option"
        )


def test_cad_routes_to_local_model_first():
    """CAD design queries must route to a local model (Ollama) when available."""
    decision = route("Design a 3d printable parametric bracket in openscad", ALL_ENABLED)
    assert decision.intent == "cad"
    assert (decision.provider, decision.model_id) == ("ollama", "qwen2.5-coder:7b")


def test_cad_stays_local_when_every_cloud_provider_is_on():
    """Local-first means local-first, not 'local unless something better exists'."""
    decision = route("model an enclosure for the pi in scad", ALL_ENABLED)
    assert decision.provider == "ollama"


@pytest.mark.parametrize("text", [
    # Generic build verbs plus a generic noun are not CAD. Each of these
    # scored as 'cad' when the pattern accepted design|make|create within
    # 25 characters of part|gear|mount, and cad leads the tie-break order.
    "create a shopping list part for dinner",
    "make a gear change plan for the mower",
    "my engine has a bad cylinder what do I do",
    "can you model the gear ratios on my bike",
])
def test_everyday_phrasing_is_not_mistaken_for_cad(text):
    intent, _ = classify_intent(text)
    assert intent != "cad"


@pytest.mark.parametrize("text", [
    # Call syntax the trailing \b used to make unmatchable.
    "difference() { cube(10); cylinder(r=3); }",
    "rotate([0,0,90]) translate([1,2,3]) cube(5);",
    "union() of two shapes",
])
def test_openscad_call_syntax_is_recognised(text):
    intent, score = classify_intent(text)
    assert intent == "cad", f"{text!r} scored {score}"


def test_code_prefers_local_coder_then_free_cloud():
    """Programming goes to the local coder first, and never past the free
    cloud tier into a paid provider while a free one is available."""
    decision = route("Write a python script with a function to parse json", ALL_ENABLED)
    assert decision.intent == "code"
    assert (decision.provider, decision.model_id) == ("ollama", "qwen2.5-coder:7b")

    no_local = {k: v for k, v in ALL_ENABLED.items() if k != "ollama"}
    cloud = route("Write a python script with a function to parse json", no_local)
    assert LLMRegistry.is_free(cloud.provider, cloud.model_id), (
        f"code fell through to paid {cloud.provider}/{cloud.model_id} "
        "while a free option was enabled"
    )
