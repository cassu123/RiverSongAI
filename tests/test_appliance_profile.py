"""
tests/test_appliance_profile.py

Building a profile from a product name.

The model is guessing from "Instant Dutch Oven" and the guess is treated as
one. What matters here is not whether it recognises the product -- that will
vary with the model and is not something a test can pin -- but whether a wrong
answer can do damage. Two ways it could:

  * by claiming a station the planner cannot schedule, producing an appliance
    that silently does nothing;
  * by claiming a temperature that widens the bound the swap check relies on,
    which is precisely the check that exists to catch a confident wrong
    number.

The asymmetry those tests defend: a profile may make a check stricter freely,
and may only make one looser up to a hard physical ceiling.
"""

import asyncio

import pytest

from providers.culinary.appliance_limits import check_method, effective_limits
from providers.culinary.appliance_profile import (
    build_profile,
    profile_summary,
    validate_profile,
)


def built(payload, make="Instant", model="Dutch Oven", results=None, seen=None):
    async def _call(prompt):
        if seen is not None:
            seen.append(prompt)
        if isinstance(payload, Exception):
            raise payload
        return payload

    async def _search(query, count=5):
        if isinstance(results, Exception):
            raise results
        return results or ""

    return asyncio.run(
        build_profile(make, model, call_model=_call, search=_search))


PAGE = ("Search results for 'Instant Ace Nova': The Instant Ace Nova is a "
        "cooking blender with a 1.7 L glass jug and eight one-touch programs "
        "including Soup, Smoothie and Nut Milk. It heats while it blends and "
        "is not a pressure cooker.")


MULTI = ('{"label": "Instant Dutch Oven", '
         '"panel": ["Sear/Sauté", "Slow Cook", "Air Fry", "Bake"], '
         '"station_max_c": {"air_fryer": 230, "oven": 230}, '
         '"watts": 1500, "capacity": "5.7 L", '
         '"notes": "Electric, so the base heats rather than the whole pot.", '
         '"confident": true}')


# ---------------------------------------------------------------------------
# The case that prompted this
# ---------------------------------------------------------------------------

def test_one_appliance_can_be_several_stations():
    """An Instant Dutch Oven sears, slow cooks, air fries and bakes.

    Filing it under a single station is what would make three of those
    invisible: a swap only offers a machine for the stations it claims. Each
    one here traces back to a button rather than to the words "Dutch Oven".
    """
    profile = built(MULTI)

    assert set(profile["stations"]) == {
        "stove", "slow_cooker", "air_fryer", "oven"}
    assert profile["mode_labels"][:2] == ["Sauté", "Slow Cook"]
    assert profile["capacity"] == "5.7 L"


def test_an_indoor_grill_is_not_an_outdoor_one():
    """Its own class, because the ceilings differ by ninety degrees.

    Checked against outdoor-grill limits, 300°C would pass; against the
    indoor ones it does not, which is the answer that matches the appliance.
    """
    profile = built('{"label": "Instant Indoor Grill", "stations": ["indoor_grill"],'
                    ' "max_c": 260, "modes": ["Grill", "Griddle"], "confident": true}',
                    make="Instant", model="Indoor Smokeless Grill")

    assert profile["stations"] == ["indoor_grill"]
    assert not check_method("indoor_grill", ["Grill at 300C"], profile).ok
    assert check_method("indoor_grill", ["Grill at 230C for 8 minutes"], profile).ok


# ---------------------------------------------------------------------------
# A guess must not widen a wall
# ---------------------------------------------------------------------------

def test_a_claimed_maximum_is_capped_at_what_the_class_can_do():
    """The one direction that must not be trusted.

    Narrower is a household knowing its own machine. Wider is a model filling
    in a blank, and widening is exactly how a dangerous instruction would get
    past the check built to stop it.
    """
    profile = built('{"stations": ["air_fryer"], "max_c": 500, "confident": true}')

    assert profile["max_c"] <= 250, "an air fryer does not reach 500C"
    assert not check_method("air_fryer", ["Air fry at 400C"], profile).ok


def test_a_lower_claimed_maximum_is_believed_and_tightens_the_check():
    """Stricter is always safe, so it is taken at face value."""
    profile = {"max_c": 190}

    assert check_method("air_fryer", ["Air fry at 210C"]).ok
    assert not check_method("air_fryer", ["Air fry at 210C"], profile).ok


def test_an_unconfident_answer_keeps_its_stations_and_loses_its_numbers():
    """Stations can be sanity-checked against the name; a temperature cannot.

    So an admitted guess still makes the appliance usable, without lending its
    numbers to a safety check.
    """
    profile = built('{"stations": ["air_fryer"], "max_c": 240, "watts": 1800,'
                    ' "confident": false}')

    assert profile["stations"] == ["air_fryer"]
    assert profile["max_c"] is None
    assert effective_limits("air_fryer", profile).max_c == 230   # the class default


def test_stations_the_planner_cannot_schedule_are_dropped():
    profile = validate_profile({"stations": ["air_fryer", "tandoor", "deep_fryer"]})
    assert profile["stations"] == ["air_fryer"]


def test_an_appliance_with_no_usable_station_still_gets_a_profile():
    """A cooking blender is a real machine that a meal plan cannot schedule.

    Both halves of that are true and the profile says both. Discarding it
    would answer "what is this thing" with silence, when what was actually
    wanted was its capacity, its buttons and the fact that nothing gets
    scheduled onto it.
    """
    profile = built('{"label": "Instant Ace Nova", '
                    '"panel": ["Soup", "Smoothie", "Nut Milk"], '
                    '"capacity": "1.7 L"}',
                    make="Instant", model="Ace Nova")

    assert profile is not None
    assert profile["stations"] == []
    assert profile["schedulable"] is False
    assert profile["capacity"] == "1.7 L"
    assert profile["mode_labels"] == ["Blend"]


def test_a_backwards_range_is_discarded():
    profile = validate_profile({"stations": ["oven"], "max_c": 100, "min_c": 200})
    assert profile["min_c"] is None


# ---------------------------------------------------------------------------
# Failing mildly
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("payload", [
    ConnectionError("connection refused"),
    "",
    "I'm not sure what that is!",
    "```json\n{oops\n```",
    "[]",
])
def test_a_failure_leaves_the_appliance_without_a_profile(payload):
    """Mild by design: no profile means the generic class limits apply and
    the swap still works, slightly less specific and exactly as correct."""
    assert built(payload) is None


def test_nothing_typed_asks_nothing():
    assert built(MULTI, make="", model="") is None


def test_duplicate_stations_collapse_without_reordering():
    """The first station becomes the primary one, so the order has to be stable."""
    profile = validate_profile(
        {"stations": ["air_fryer", "oven", "air_fryer", "oven"]})
    assert profile["stations"] == ["air_fryer", "oven"]


# ---------------------------------------------------------------------------
# What the cook sees
# ---------------------------------------------------------------------------

def test_the_summary_is_checkable_at_a_glance():
    """Shown precisely because the profile is a guess.

    The cook is the only one who can read "up to 230°C, Sear/Sauté, Slow
    Cook" and know whether that is the machine on their counter.
    """
    summary = profile_summary(built(MULTI))

    assert "230°C" in summary
    assert "5.7 L" in summary
    assert "Sauté" in summary


def test_no_profile_summarises_to_nothing():
    assert profile_summary(None) == ""


# ---------------------------------------------------------------------------
# Looking it up rather than recalling it
# ---------------------------------------------------------------------------

def test_what_the_web_says_is_put_in_front_of_the_model():
    """The point of searching at all.

    "Instant" is a pressure cooker brand and the Ace Nova is a blender, so a
    model working from the name alone has every reason to get it wrong. A
    page about the actual product is what settles it.
    """
    seen = []
    built(MULTI, make="Instant", model="Ace Nova", results=PAGE, seen=seen)

    assert "cooking blender" in seen[0]
    assert "1.7 L" in seen[0]
    # And it is told which of the two sources wins.
    assert "believe them" in seen[0]


def test_a_profile_records_whether_it_was_looked_up():
    grounded = built(MULTI, results=PAGE)
    recalled = built(MULTI, results="")

    assert grounded["sourced"] is True
    assert recalled["sourced"] is False


def test_search_being_down_still_produces_a_profile():
    """Degrades to what it did before rather than to nothing."""
    profile = built(MULTI, results=ConnectionError("no route to host"))

    assert profile is not None
    assert profile["sourced"] is False


@pytest.mark.parametrize("useless", [
    "",
    "no results",
    ("I wasn't able to search the web right now — all search services are "
     "currently unavailable. Try asking me something I can answer from "
     "memory, or check your .env to configure a search provider."),
])
def test_a_non_answer_from_search_is_not_passed_off_as_research(useless):
    """The provider chain reports its own failure in prose.

    Pasting that under "here is what the web says" would be handing the model
    a paragraph about search outages and calling it evidence.
    """
    seen = []
    built(MULTI, results=useless, seen=seen)

    assert "SEARCH RESULTS" not in seen[0]


# ---------------------------------------------------------------------------
# Ways a reply can get past validation
#
# Found by review. Each of these is a model answer that looked well-formed and
# defeated the check built to catch it, which is the only failure mode here
# that matters -- a malformed reply is rejected and harmless.
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("number", ["Infinity", "-Infinity", "NaN"])
def test_a_non_finite_number_is_rejected_rather_than_crashing(number):
    """json.loads accepts these, float() accepts them, round() does not.

    OverflowError is neither TypeError nor ValueError, so it went straight
    through the guard and took the whole profile build down with it.
    """
    profile = validate_profile(
        {"stations": ["oven"], "max_c": float(number.replace("Infinity", "inf"))})

    assert profile["max_c"] is None


def test_confident_must_be_a_real_boolean():
    """`bool("false")` is True.

    A model hedging in the one field built to catch a hedge kept exactly the
    numbers it was disclaiming.
    """
    hedged = validate_profile(
        {"stations": ["air_fryer"], "max_c": 240, "confident": "false"})

    assert hedged["confident"] is False
    assert hedged["max_c"] is None


def test_a_missing_confident_field_still_defaults_to_trusting_the_reply():
    """The strictness above must not turn every ordinary answer into a hedge."""
    plain = validate_profile({"stations": ["air_fryer"], "max_c": 210})

    assert plain["confident"] is True
    assert plain["max_c"] == 210
