"""
tests/test_step_analysis.py

The model pass over recipe steps.

What is worth testing here is not whether a model reads a recipe well -- that
is the model's problem and it will change under us. It is whether this layer
can hurt anything when the model is wrong, absent, slow, or creative, because
that is the property the whole design rests on: the keyword pass is always a
usable answer, and this can only improve it.

So every test below is a way the model fails. The happy path gets one test;
the failure modes get the rest.
"""

import asyncio

import pytest

from providers.culinary.cook_plan import analyse_steps
from providers.culinary.step_analysis import (
    _merge,
    analyse_steps_smart,
    steps_fingerprint,
)

STEPS = [
    "Dice the onion",
    "Sear the beef 3-5 minutes per side",
    "Simmer for 40 minutes",
]


def _base():
    return analyse_steps(STEPS)


def analysed(payload):
    """Run the pass against a canned model reply.

    The caller is injected rather than patched, so these run with no model
    and without httpx installed -- which is the same reason the injection
    point exists in the first place.
    """
    async def _call(_prompt):
        if isinstance(payload, Exception):
            raise payload
        return payload
    return asyncio.run(analyse_steps_smart(STEPS, call_model=_call))


# ---------------------------------------------------------------------------
# Caching identity
# ---------------------------------------------------------------------------

def test_fingerprint_follows_the_steps():
    """Editing a recipe re-analyses it; leaving it alone never does."""
    assert steps_fingerprint(STEPS) == steps_fingerprint(list(STEPS))
    assert steps_fingerprint(STEPS) != steps_fingerprint(STEPS + ["Serve"])
    assert steps_fingerprint(["Dice the onion"]) != steps_fingerprint(["Dice the shallot"])


def test_fingerprint_ignores_incidental_whitespace():
    assert steps_fingerprint(["  Dice the onion "]) == steps_fingerprint(["Dice the onion"])


# ---------------------------------------------------------------------------
# The happy path
# ---------------------------------------------------------------------------

def test_a_good_reply_refines_the_keyword_answer():
    facts = analysed(
        '[{"i":0,"active":4,"passive":0,"station":"counter","phase":"prep"},'
        ' {"i":1,"active":10,"passive":0,"station":"stove","phase":"cook"},'
        ' {"i":2,"active":1,"passive":40,"station":"stove","phase":"cook"}]')

    assert [f.active_min for f in facts] == [4, 10, 1]
    assert [f.passive_min for f in facts] == [0, 0, 40]
    assert [f.station for f in facts] == ["counter", "stove", "stove"]


# ---------------------------------------------------------------------------
# Every way it can fail
# ---------------------------------------------------------------------------

def test_no_model_changes_nothing():
    """The property the design rests on: Ollama down costs you nothing."""
    assert analysed(ConnectionError("connection refused")) == _base()


@pytest.mark.parametrize("payload", [
    "",                                  # nothing at all
    "Sure! Here is the analysis:",       # prose, no array
    "```json\n{not json at all}\n```",   # a fence with rubbish in it
    "[]",                                # a well-formed array of nothing
    "{\"i\": 0}",                        # an object where an array was asked for
])
def test_unusable_replies_change_nothing(payload):
    assert analysed(payload) == _base()


def test_a_fenced_array_is_still_read():
    """Models wrap JSON in markdown however firmly you ask them not to."""
    facts = analysed('Here you go:\n```json\n[{"i":0,"active":7,"passive":0,'
                     '"station":"counter","phase":"prep"}]\n```\nHope that helps!')
    assert facts[0].active_min == 7
    assert facts[1:] == _base()[1:], "steps it did not mention must be untouched"


def test_rows_for_steps_that_do_not_exist_are_dropped():
    assert analysed('[{"i":99,"active":5,"passive":0,"station":"oven","phase":"cook"},'
                    ' {"i":-1,"active":5,"passive":0,"station":"oven","phase":"cook"}]') == _base()


def test_implausible_durations_are_refused():
    """A step is not two days long. The recipe is likelier right than the model."""
    facts = analysed('[{"i":0,"active":100000,"passive":-30,"station":"counter","phase":"prep"}]')
    assert facts[0].active_min == _base()[0].active_min
    assert facts[0].passive_min == _base()[0].passive_min


def test_an_unknown_station_is_dropped_but_the_rest_is_kept():
    """A station the scheduler cannot reserve would be a resource nothing
    contends for -- worse than the keyword guess, because it looks specific."""
    facts = analysed('[{"i":1,"active":9,"passive":0,"station":"tandoor","phase":"cook"}]')
    assert facts[1].station == _base()[1].station     # dropped
    assert facts[1].active_min == 9                   # kept


def test_a_partly_wrong_row_still_contributes():
    """Merging per field, not per step.

    A row with the station right and the minutes nonsense should hand over
    the station. Replacing the whole row would let one bad number throw away
    three good values.
    """
    facts = analysed('[{"i":2,"active":"soon","passive":null,"station":"instant_pot","phase":"cook"}]')
    assert facts[2].station == "instant_pot"
    assert facts[2].active_min == _base()[2].active_min
    assert facts[2].passive_min == _base()[2].passive_min


def test_a_step_cannot_be_made_free():
    """Zero on both counts is not an answer, it is a missing one.

    A model that says a step takes no time at all shortens the whole plan by
    however long that step really takes, and does it invisibly.
    """
    facts = analysed('[{"i":1,"active":0,"passive":0,"station":"stove","phase":"cook"}]')
    assert facts[1].total_min == _base()[1].total_min


def test_merge_keeps_the_step_it_was_given():
    """Index and text are the caller's, never the model's."""
    base = _base()[0]
    merged = _merge(base, {"i": 5, "text": "something else", "active": 6})
    assert merged.index == base.index
    assert merged.text == base.text
