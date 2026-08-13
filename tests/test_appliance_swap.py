"""
tests/test_appliance_swap.py

Cooking a staged recipe in something else.

This is the one place in the culinary module where a model is load-bearing:
there is no rule that turns a skillet method into a Dutch oven one. The times
are unrelated, a pressure cooker needs liquid the pan did not, an air fryer
wants a single layer and a shake halfway. Nothing deterministic gets you
there.

Which changes what these tests are for. Everywhere else the question is "does
the fallback hold when the model fails"; here there is no fallback, so the
question is "does a failure come back as a failure". A swap that quietly
returns the original method is the worst outcome available: the cook has been
told the appliance will work, and the recipe in front of them is for a
different one.
"""

import asyncio

import pytest

from providers.culinary.appliance_swap import (
    APPLIANCE_NAMES,
    SwapFailed,
    rewrite_for_appliance,
)

STEPS = [
    "Sear the beef in a hot skillet for 4 minutes per side",
    "Add stock and simmer for 40 minutes until tender",
]
INGREDIENTS = [
    {"qty": "500", "unit": "g", "name": "beef chuck"},
    {"qty": "1", "unit": "cup", "name": "beef stock"},
]


def swap(payload, *, target="dutch_oven", steps=STEPS):
    async def _call(_prompt):
        if isinstance(payload, Exception):
            raise payload
        return payload
    return asyncio.run(rewrite_for_appliance(
        title="Beef Stew", steps=steps, ingredients=INGREDIENTS,
        origin_station="stove", target_station=target, call_model=_call))


GOOD = ('{"steps": ["Brown the beef in the Dutch oven over medium-high heat.",'
        ' "Add stock, cover, and cook at 160C for 2 hours."],'
        ' "ingredients": ["500 g beef chuck", "2 cups beef stock"],'
        ' "note": "More liquid, and the oven does the work."}')


# ---------------------------------------------------------------------------
# The rewrite
# ---------------------------------------------------------------------------

def test_a_good_reply_becomes_a_swap():
    result = swap(GOOD)

    assert result["station"] == "dutch_oven"
    assert len(result["steps"]) == 2
    assert "Dutch oven" in result["steps"][0]
    assert result["ingredients_changed"] is True
    assert result["note"]


def test_a_swap_that_changes_nothing_but_the_method():
    """Plenty of swaps leave the ingredients alone.

    An empty list there means "as before", not "none" -- returning nothing
    would empty the mise en place screen for that dish.
    """
    result = swap('{"steps": ["Air fry at 200C for 18 minutes, shaking halfway."],'
                  ' "ingredients": [], "note": "No oil needed."}',
                  target="air_fryer")

    assert result["ingredients_changed"] is False
    assert len(result["ingredients"]) == len(INGREDIENTS)
    assert "beef chuck" in result["ingredients"][0]


def test_a_fenced_reply_is_still_read():
    result = swap("Sure:\n```json\n" + GOOD + "\n```")
    assert len(result["steps"]) == 2


# ---------------------------------------------------------------------------
# Failures, which must stay failures
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("payload,why", [
    (ConnectionError("connection refused"), "no model running"),
    ("", "an empty reply"),
    ("I'd be happy to help with that!", "prose and no JSON"),
    ('{"steps": [], "note": "cannot"}', "an empty method"),
    ('{"steps": "not a list"}', "steps that are not a list"),
    ('["just", "an", "array"]', "an array where an object was asked for"),
])
def test_a_failure_is_raised_not_absorbed(payload, why):
    """The property this whole module rests on.

    Returning the original steps here would be worse than an error: the cook
    would be told the Dutch oven works and handed the skillet method.
    """
    with pytest.raises(SwapFailed):
        swap(payload)


def test_an_unknown_appliance_is_refused_before_the_model():
    with pytest.raises(SwapFailed):
        swap(GOOD, target="tandoor")


def test_a_recipe_with_no_method_is_refused():
    with pytest.raises(SwapFailed):
        swap(GOOD, steps=[])


def test_an_enormous_reply_is_trimmed_rather_than_trusted():
    """A model retelling the recipe is not a conversion.

    Twenty-four steps is already more than anyone follows standing up; the
    cap keeps a runaway reply from becoming the method.
    """
    many = ", ".join(f'"Step number {i}"' for i in range(200))
    result = swap('{"steps": [' + many + '], "note": "long"}')
    assert 0 < len(result["steps"]) <= 24


def test_a_single_absurdly_long_step_is_dropped():
    result = swap('{"steps": ["' + "x" * 5000 + '", "A sensible step."],'
                  ' "note": "one is junk"}')
    assert result["steps"] == ["A sensible step."]


# ---------------------------------------------------------------------------
# Naming
# ---------------------------------------------------------------------------

def test_every_station_the_scheduler_knows_can_be_named():
    """A swap target the prompt cannot name would be refused at the door.

    Checked against the scheduler's own station list so adding an appliance
    there and forgetting it here shows up now rather than as a 400 later.
    """
    from providers.culinary.cook_plan import IMPLICIT_STATIONS

    schedulable = set(IMPLICIT_STATIONS) - {"counter"}
    assert schedulable <= set(APPLIANCE_NAMES)


# ---------------------------------------------------------------------------
# What the machine can actually do
#
# The honest answer to "how do we know the rewrite is right" is that for the
# hard part we do not. What can be checked without a model is whether the
# instruction is physically possible, and that catches the class of wrong
# answer that reads perfectly well: an air fryer at 250C, a slow cooker asked
# to work in forty minutes.
# ---------------------------------------------------------------------------

from providers.culinary.appliance_limits import (  # noqa: E402
    LIMITS, check_method, describe_for_prompt)


@pytest.mark.parametrize("station,step,why", [
    ("air_fryer", "Air fry at 250C for 20 minutes", "domestic air fryers stop near 230"),
    ("air_fryer", "Air fry at 480F for 20 minutes", "the same in Fahrenheit"),
    ("slow_cooker", "Slow cook for 40 minutes", "not what the appliance is for"),
    ("instant_pot", "Pressure cook for 8 hours", "far past any pressure cycle"),
    ("sous_vide", "Set the bath to 130C", "water does not go there"),
    ("microwave", "Microwave for 3 hours", "not a three-hour appliance"),
])
def test_an_impossible_instruction_is_caught(station, step, why):
    verdict = check_method(station, [step])
    assert not verdict.ok, why
    assert verdict.impossible


@pytest.mark.parametrize("station,step", [
    ("air_fryer", "Air fry at 200C for 18 minutes, shaking halfway"),
    ("slow_cooker", "Cook on low for 8 hours"),
    ("instant_pot", "Pressure cook on high for 15 minutes"),
    ("oven", "Bake at 180C for 40 minutes"),
    ("sous_vide", "Hold at 56C for 2 hours"),
])
def test_a_reasonable_instruction_passes(station, step):
    assert check_method(station, [step]).ok


def test_a_swap_that_breaks_the_appliance_is_refused():
    """The check runs on the rewrite, not just in a test.

    A wrong number is not improved by a warning next to it -- the cook is
    going to follow the step -- so this refuses rather than annotating.
    """
    with pytest.raises(SwapFailed, match="cannot do"):
        swap('{"steps": ["Air fry at 260C for 15 minutes."], "note": "hot"}',
             target="air_fryer")


def test_unusual_but_possible_is_carried_not_blocked():
    """Real recipes sit at the edges, and a program that argues with all of
    them stops being read."""
    result = swap('{"steps": ["Pressure cook on high for 100 minutes."],'
                  ' "note": "a big joint"}', target="instant_pot")
    assert result["unusual"]


def test_the_safety_note_rides_along_where_time_is_not_the_test():
    """Pressure, sous vide, slow cookers and grills: the clock is not the
    instrument, and the program should say so rather than imply it settled it."""
    result = swap('{"steps": ["Pressure cook on high for 15 minutes."], "note": "ok"}',
                  target="instant_pot")
    assert "thermometer" in result["safety"].lower()


def test_a_step_naming_no_temperature_is_not_assumed_to_have_one():
    """Inventing a number in order to reject it would fail good instructions."""
    assert check_method("air_fryer", ["Shake the basket and carry on"]).ok


def test_the_prompt_describes_the_actual_machine_when_one_is_known():
    """"A 1700W Cosori Pro Gen 2, maximum 230C" gets a rewrite with real
    numbers on it. "An air fryer" gets a generic one."""
    generic = describe_for_prompt("air_fryer")
    specific = describe_for_prompt("air_fryer", {
        "make": "Cosori", "model": "Pro Gen 2", "watts": 1700, "max_c": 230,
    })
    assert "Cosori" in specific and "1700W" in specific
    assert "Cosori" not in generic


def test_every_appliance_the_swap_offers_has_limits():
    """A target with no limits would be swapped with nothing checking it."""
    from providers.culinary.appliance_swap import APPLIANCE_NAMES

    assert set(APPLIANCE_NAMES) <= set(LIMITS)
