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


def built(payload, make="Instant", model="Dutch Oven"):
    async def _call(_prompt):
        if isinstance(payload, Exception):
            raise payload
        return payload
    return asyncio.run(build_profile(make, model, call_model=_call))


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


def test_an_appliance_with_no_usable_station_is_no_profile_at_all():
    """Better none than one the planner will silently ignore."""
    assert built('{"label": "Mystery Box", "stations": ["tandoor"]}') is None


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
