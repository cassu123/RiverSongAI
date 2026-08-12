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
