"""
tests/test_cook_plan.py

The scheduler behind cooking several recipes as one meal.

Two things decide whether a cooking plan is any use, and both are asserted
here rather than eyeballed in the UI:

  * whether a step's time belongs to the cook or to an appliance. Get this
    wrong and the plan can only concatenate recipes, because there are no
    passive stretches to slot the other dishes into.
  * whether the dishes finish together. A plan that starts everything at once
    is not a plan; it is the stack of recipes you already had.

The step analysis is keyword-driven on purpose, so these are also the tests
that say what the keywords are expected to catch. They use the phrasing real
recipes use, not phrasing chosen to match the patterns.
"""

import pytest

from providers.culinary.cook_plan import (
    RecipeInPlan,
    analyse_step,
    analyse_steps,
    extract_minutes,
    plan_meal,
)


# ---------------------------------------------------------------------------
# Durations
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("text,expected", [
    ("Bake for 25 minutes", 25),
    ("Simmer 1 hour", 60),
    ("Rest for 90 seconds", 2),          # rounds to the nearest minute
    ("Saute 3-4 minutes", 4),            # a range takes its upper bound
    ("Roast 20 to 25 min", 25),
    ("Chop the onions", 0),
    ("Preheat oven to 425 degrees", 0),  # a temperature is not a duration
])
def test_extract_minutes(text, expected):
    assert extract_minutes(text) == expected


def test_a_range_takes_the_upper_bound():
    """Scheduling the lower bound puts the next dish out while this one cooks.

    Being late costs you the wait. Being early costs you the rest of the plan,
    because every step after it is now placed against a time that did not
    happen.
    """
    assert extract_minutes("Bake 20-25 minutes") == 25


# ---------------------------------------------------------------------------
# Whose time is it
# ---------------------------------------------------------------------------

def test_roasting_frees_the_cook():
    facts = analyse_step(0, "Roast in the oven for 40 minutes")
    assert facts.station == "oven"
    assert facts.passive_min == 40
    assert facts.active_min <= 3, "roasting should not book 40 minutes of hands"


def test_chopping_occupies_the_cook():
    facts = analyse_step(0, "Finely dice two onions")
    assert facts.station == "counter"
    assert facts.passive_min == 0
    assert facts.active_min > 0


def test_a_timed_hands_on_step_is_all_active():
    """"Knead for 10 minutes" is ten minutes of you, not ten minutes of a bowl."""
    facts = analyse_step(0, "Knead the dough for 10 minutes")
    assert facts.active_min == 10
    assert facts.passive_min == 0


def test_simmering_while_stirring_is_mostly_passive():
    """The commonest phrasing that could fool the split.

    "Stirring occasionally" names an active verb inside a passive step. The
    twenty minutes belong to the pot; the stirring is real but it is not
    twenty minutes of stirring.
    """
    facts = analyse_step(0, "Simmer for 20 minutes, stirring occasionally")
    assert facts.passive_min == 20
    assert facts.active_min < 20


def test_an_undated_step_still_costs_something():
    """Most recipes never say how long seasoning takes.

    Counting those as free is how a plan claims a meal takes twenty minutes
    when it takes fifty.
    """
    assert analyse_step(0, "Season the chicken all over").active_min > 0


# ---------------------------------------------------------------------------
# Which appliance
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("text,station", [
    ("Air fry at 200C for 12 minutes",            "air_fryer"),
    ("Pressure cook on manual high for 8 minutes", "instant_pot"),
    ("Transfer to the slow cooker for 6 hours",   "slow_cooker"),
    ("Bake at 180C",                              "oven"),
    ("Bring a large saucepan to the boil",        "stove"),
    ("Sear the steaks over high heat",            "stove"),
    ("Whisk the eggs in a bowl",                  "counter"),
])
def test_detect_station(text, station):
    assert analyse_step(0, text).station == station


def test_longer_appliance_names_win():
    """"slow cooker" contains "cook"; "air fry" contains "fry", which is stove.

    Ordering the patterns longest-first is the only thing stopping these from
    landing on the wrong station, so it is worth pinning.
    """
    assert analyse_step(0, "Slow cook for 4 hours").station == "slow_cooker"
    assert analyse_step(0, "Air fry the wings").station == "air_fryer"


# ---------------------------------------------------------------------------
# Phases -- the prep screen and the cook screen
# ---------------------------------------------------------------------------

def test_prep_and_cook_are_separated():
    steps = analyse_steps([
        "Dice the onion and mince the garlic",
        "Sear the beef over high heat for 5 minutes",
        "Garnish with parsley and serve",
    ])
    assert [s.phase for s in steps] == ["prep", "cook", "finish"]


def test_a_prep_verb_over_heat_is_not_prep():
    """"Sear the sliced beef" contains "slice" and is not prep.

    The station is what settles it: knife work happens on the counter.
    """
    facts = analyse_step(0, "Sear the sliced beef in a hot skillet")
    assert facts.phase == "cook"


# ---------------------------------------------------------------------------
# The plan
# ---------------------------------------------------------------------------

def _recipe(rid, title, steps):
    return RecipeInPlan(recipe_id=rid, title=title, steps=analyse_steps(steps))


def test_dishes_finish_together():
    """The whole point. A long dish starts first; a short one starts later.

    Without this the plan is just the recipes in the order they were staged,
    and the fast dish is cold by the time the slow one is done.
    """
    plan = plan_meal([
        _recipe("r1", "Roast Chicken", ["Roast in the oven for 60 minutes"]),
        _recipe("r2", "Green Beans", ["Steam for 6 minutes"]),
    ])

    ends = {s.recipe_title: s.end_min for s in plan.steps}
    assert ends["Roast Chicken"] == ends["Green Beans"] == plan.serve_offset_min

    starts = {s.recipe_title: s.start_min for s in plan.steps}
    assert starts["Roast Chicken"] == 0
    assert starts["Green Beans"] > starts["Roast Chicken"]


def test_steps_within_a_recipe_stay_in_order():
    plan = plan_meal([
        _recipe("r1", "Stew", [
            "Dice the carrots",
            "Brown the meat for 8 minutes",
            "Simmer for 45 minutes",
        ]),
    ])
    stew = sorted([s for s in plan.steps if s.recipe_id == "r1"],
                  key=lambda s: s.step_index)
    for earlier, later in zip(stew, stew[1:]):
        assert earlier.end_min == later.start_min


def test_four_pans_on_the_stove_is_fine():
    """Four burners. Three pans is a normal Tuesday, not a conflict."""
    plan = plan_meal([
        _recipe(f"r{i}", f"Pan {i}", ["Simmer for 20 minutes"])
        for i in range(3)
    ])
    assert not [c for c in plan.conflicts if c.resource == "stove"]


def test_a_fifth_pan_is_not():
    plan = plan_meal([
        _recipe(f"r{i}", f"Pan {i}", ["Simmer for 20 minutes"])
        for i in range(5)
    ])
    assert [c for c in plan.conflicts if c.resource == "stove"]


def test_passive_time_does_not_book_the_cook():
    """Two dishes roasting at once contend for the oven, never for you."""
    plan = plan_meal([
        _recipe("r1", "A", ["Bake for 30 minutes"]),
        _recipe("r2", "B", ["Air fry for 30 minutes"]),
    ])
    assert not [c for c in plan.conflicts if c.kind == "cook"]


def test_two_hands_on_steps_at_once_is_reported():
    plan = plan_meal([
        _recipe("r1", "A", ["Knead the dough for 10 minutes"]),
        _recipe("r2", "B", ["Whisk the eggs for 10 minutes"]),
    ])
    assert [c for c in plan.conflicts if c.kind == "cook"]


def test_a_household_appliance_it_owns_two_of():
    plan = plan_meal(
        [
            _recipe("r1", "A", ["Air fry for 20 minutes"]),
            _recipe("r2", "B", ["Air fry for 20 minutes"]),
        ],
        owned_stations={"air_fryer": 2},
    )
    assert not [c for c in plan.conflicts if c.resource == "air_fryer"]


def test_an_empty_meal_is_an_empty_plan():
    plan = plan_meal([])
    assert plan.serve_offset_min == 0
    assert plan.steps == []
    assert plan.conflicts == []


def test_stations_used_lists_the_appliances_to_get_out():
    """The "what are we cooking with" screen, in one property."""
    plan = plan_meal([
        _recipe("r1", "A", ["Dice the onion", "Bake for 20 minutes"]),
        _recipe("r2", "B", ["Air fry for 10 minutes"]),
    ])
    assert set(plan.stations_used) == {"oven", "air_fryer"}
    assert "counter" not in plan.stations_used


# ---------------------------------------------------------------------------
# Regressions from running the scheduler on a real Sunday roast
#
# The first version of this module produced a plausible-looking plan for
# chicken, roast potatoes and green beans, and three things in it were wrong.
# All three were invisible in the unit tests above and obvious the moment a
# whole meal was printed out, which is why they get their own section.
# ---------------------------------------------------------------------------

def test_boiling_and_steaming_are_waiting():
    """Parboiling is not eight minutes of holding a pan.

    These were missing from the passive verbs, so a roast dinner booked
    fourteen minutes of hands for standing over water -- most of the window
    the plan exists to fill with something else.
    """
    parboil = analyse_step(0, "Parboil the potatoes for 8 minutes")
    assert parboil.passive_min == 8
    assert not parboil.blocks_the_cook

    steam = analyse_step(0, "Steam for 6 minutes")
    assert steam.passive_min == 6
    assert not steam.blocks_the_cook


def test_one_oven_fits_a_roast_and_the_potatoes():
    """The commonest meal there is must not be reported as a clash.

    An oven has shelves. Warning about this would be the false alarm that
    teaches people to ignore the real ones -- and the real one an oven has is
    two temperatures, which is a different check.
    """
    plan = plan_meal([
        _recipe("r1", "Roast Chicken", ["Roast for 50 minutes"]),
        _recipe("r2", "Roast Potatoes", ["Roast for 35 minutes"]),
    ])
    assert not [c for c in plan.conflicts if c.resource == "oven"]


def test_a_third_tray_still_reports():
    plan = plan_meal([
        _recipe(f"r{i}", f"Tray {i}", ["Roast for 30 minutes"]) for i in range(3)
    ])
    assert [c for c in plan.conflicts if c.resource == "oven"]


def test_preheating_is_prep():
    """It happens before the cooking and needs no attention while it does."""
    assert analyse_step(0, "Preheat the oven to 220C").phase == "prep"
