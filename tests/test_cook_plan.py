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


# ---------------------------------------------------------------------------
# Courses
#
# Not every meal lands at once. A starter at seven and a main at half past is
# one cooking session with two deadlines, and so is a bulk cook where tonight's
# dinner is wanted now and tomorrow's can come out whenever. Splitting those
# into separate plans would be wrong -- the dishes still share one oven and one
# cook, and the contention between courses is exactly the part nobody can hold
# in their head.
# ---------------------------------------------------------------------------

def _course(rid, title, steps, after=0):
    return RecipeInPlan(recipe_id=rid, title=title,
                        steps=analyse_steps(steps), course_offset_min=after)


def test_a_later_course_finishes_later():
    plan = plan_meal([
        _course("r1", "Soup", ["Simmer for 20 minutes"]),
        _course("r2", "Main", ["Roast for 40 minutes"], after=30),
    ])
    ends = {s.recipe_title: s.end_min for s in plan.steps}
    assert ends["Main"] - ends["Soup"] == 30


def test_the_first_course_is_not_the_end_of_the_plan():
    """Two anchors, and they are different numbers.

    "Start by" has to count back from the first course; the length of the
    plan runs to the last one. Conflating them would have the cook starting
    half an hour late for a staggered meal.
    """
    plan = plan_meal([
        _course("r1", "Soup", ["Simmer for 20 minutes"]),
        _course("r2", "Main", ["Roast for 40 minutes"], after=30),
    ])
    # Written as the gap rather than as two numbers: a step's cost includes
    # the minute that starts it, so "simmer 20" is 21 minutes of timeline and
    # pinning the literal would be asserting that constant by accident.
    assert plan.serve_offset_min - plan.first_course_min == 30


def test_a_long_later_course_still_pins_the_start():
    """A two-hour main wanted thirty minutes after the starter starts first.

    The naive reading -- first course sets the clock, later ones follow -- gets
    this backwards and has the main going in half an hour after it needed to.
    """
    plan = plan_meal([
        _course("r1", "Salad", ["Toss for 2 minutes"]),
        _course("r2", "Brisket", ["Braise for 120 minutes"], after=30),
    ])
    brisket = [s for s in plan.steps if s.recipe_id == "r2"][0]
    assert brisket.start_min == 0, "the long dish has to begin at the top"

    # The starter waits for the brisket rather than the other way round: the
    # first course lands a full thirty minutes before the main it is ahead of.
    assert plan.first_course_min == brisket.end_min - 30


def test_no_offsets_still_means_everything_together():
    """The default has to be the old behaviour, or every existing plan moves."""
    plan = plan_meal([
        _course("r1", "A", ["Roast for 40 minutes"]),
        _course("r2", "B", ["Steam for 6 minutes"]),
    ])
    ends = {s.end_min for s in plan.steps}
    assert len(ends) == 1
    assert plan.first_course_min == plan.serve_offset_min


def test_courses_still_contend_for_the_oven():
    """The reason this is one plan and not two.

    Staggering the courses does not give you a second oven, and a starter that
    overlaps the main is exactly the clash you cannot see by reading two
    recipes side by side.
    """
    plan = plan_meal([
        _course("r1", "Tart", ["Bake for 40 minutes"]),
        _course("r2", "Gratin", ["Bake for 40 minutes"], after=10),
        _course("r3", "Bread", ["Bake for 40 minutes"], after=20),
    ])
    assert [c for c in plan.conflicts if c.resource == "oven"]


def test_compound_durations_sum_but_alternatives_do_not():
    """"1 hour 30 minutes" is ninety. "25 minutes or 30 minutes" is thirty.

    Two durations are one quantity only when what sits between them joins.
    Judging that by the length of the gap -- the first attempt at this --
    reads " or " as a join because it is short, and turns a choice into a
    sum. Recipes really do write "bake 25 minutes or 30 if frozen".
    """
    assert extract_minutes("Bake for 1 hour 30 minutes") == 90
    assert extract_minutes("Cook 2 hours 15 min") == 135
    assert extract_minutes("Simmer 1 hour and 30 minutes") == 90
    assert extract_minutes("Marinate 2 hours, 30 minutes minimum") == 150

    assert extract_minutes("Bake 25 minutes or 30 minutes") == 30
    assert extract_minutes("Rest 5 minutes, then bake 40 minutes") == 40
    assert extract_minutes("Chill 1 hour. Bake 20 minutes.") == 60


def test_equal_offsets_are_not_a_stagger():
    """Every dish wanted "+30" is one meal, later -- not a staggered one.

    Offsets are relative to the first course, so a set of identical ones has
    no first course to be relative to. Normalising them to zero is what keeps
    "start by" pointing at the meal rather than half an hour before it.
    """
    plan = plan_meal([
        _course("r1", "A", ["Roast for 40 minutes"], after=30),
        _course("r2", "B", ["Steam for 6 minutes"], after=30),
    ])
    assert plan.first_course_min == plan.serve_offset_min
    assert len({s.end_min for s in plan.steps}) == 1
