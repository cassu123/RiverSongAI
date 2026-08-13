"""
tests/test_appliance_modes.py

Two Instant Pot pressure cookers, one with an air fry lid.

That is the case the module exists for, and it is a hard one for exactly one
reason: nothing in the *name* separates them. Both are Instant Pots, both are
pressure cookers, both are six quarts, and one is an air fryer while the other
is not. Any identification that starts from the product name is guessing which
of the two is on the counter.

What separates them is a button. So the tests below are mostly about one
claim: given the buttons, the stations follow with no judgement involved, the
same way in every kitchen. If that holds, the model never gets to decide what
an appliance can do -- it only ever proposes a checklist for somebody to look
at.
"""

import pytest

from providers.culinary.appliance_modes import (
    MODES,
    mode_labels,
    modes_from_panel,
    normalise_mode,
    stations_for_modes,
)
from providers.culinary.appliance_profile import (
    confirm_panel,
    suggested_panel,
    validate_profile,
)

DUO = ["Pressure Cook", "Sauté", "Slow Cook", "Steam", "Yogurt", "Keep Warm"]
DUO_CRISP = DUO + ["Air Crisp", "Roast", "Bake", "Dehydrate"]


# ---------------------------------------------------------------------------
# The case that prompted this
# ---------------------------------------------------------------------------

def test_two_pressure_cookers_differ_by_one_button():
    """Same make, same category, same capacity — and only one is an air fryer.

    No name-based identification can tell these apart. The panel does it on
    the first button.
    """
    plain = stations_for_modes(modes_from_panel(DUO))
    crisp = stations_for_modes(modes_from_panel(DUO_CRISP))

    assert "air_fryer" not in plain
    assert "air_fryer" in crisp
    # And the shared half is genuinely shared, so the two are not simply
    # different in every respect.
    assert set(plain) < set(crisp)


def test_the_same_two_appliances_stay_distinct_as_profiles():
    plain = validate_profile({"label": "Instant Pot Duo", "panel": DUO})
    crisp = validate_profile({"label": "Instant Pot Duo Crisp", "panel": DUO_CRISP})

    assert "air_fryer" not in plain["stations"]
    assert "air_fryer" in crisp["stations"]


def test_ticking_one_button_makes_the_appliance_schedulable_for_it():
    """The correction path, and the reason confirming is worth a person's time.

    A model that produced the Duo's panel for a Duo Crisp is wrong in a way
    that costs one tap to fix.
    """
    guessed = validate_profile({"label": "Instant Pot", "panel": DUO})
    assert "air_fryer" not in guessed["stations"]

    corrected = confirm_panel(guessed, DUO + ["Air Crisp"])

    assert "air_fryer" in corrected["stations"]
    assert corrected["panel_confirmed"] is True


def test_unticking_a_button_removes_the_station():
    """The direction that matters more.

    An appliance offered for a job it cannot do is worse than one never
    offered, so a station has to be able to go away again.
    """
    crisp = validate_profile({"panel": DUO_CRISP})
    assert "air_fryer" in crisp["stations"]

    plain = confirm_panel(crisp, DUO)
    assert "air_fryer" not in plain["stations"]


# ---------------------------------------------------------------------------
# Reading a panel
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("printed,expected", [
    ("Air Crisp", "air_fry"),            # Instant Pot, Ninja
    ("AIR FRY", "air_fry"),              # Cosori
    ("Crisp", "air_fry"),
    ("Sear/Sauté", "saute"),             # punctuation and an accent
    ("SEAR-SAUTE", "saute"),
    ("Slow Cook", "slow_cook"),
    ("Pressure Cook", "pressure_cook"),
    ("Bake/Roast", "bake"),
    ("Sous Vide", "sous_vide"),
])
def test_makers_disagree_about_names_for_the_same_button(printed, expected):
    assert normalise_mode(printed) == expected


def test_a_longer_button_is_not_claimed_by_a_shorter_one_inside_it():
    """``Air Crisp`` contains ``crisp``; both mean air fry, so this is safe
    here — but the ordering that makes it safe is worth pinning, because a
    future two-word button whose tail means something else would break it."""
    assert normalise_mode("Air Crisp") == "air_fry"
    assert normalise_mode("Steam") == "steam"


def test_an_unknown_button_is_ignored_rather_than_guessed_at():
    assert normalise_mode("Nutri-Boost") is None
    assert modes_from_panel(["Nutri-Boost", "Sauté"]) == ["saute"]


@pytest.mark.parametrize("ambiguous", ["Soup", "Stew", "Rice", "Cake", "Manual"])
def test_a_preset_name_that_could_mean_anything_claims_nothing(ambiguous):
    """An Instant Ace Nova is a cooking blender with a SOUP button.

    Instant Pots print SOUP too, and reading it as pressure cooking would give
    a blender a pressure vessel — then let the swap check clear a pressure
    instruction against a machine that cannot pressurise anything. A missed
    button costs one tap. An invented one costs the safety check.
    """
    assert normalise_mode(ambiguous) is None


def test_a_cooking_blender_is_not_a_pressure_cooker():
    """The whole panel, as the Ace Nova actually prints it."""
    modes = modes_from_panel(["Soup", "Smoothie", "Nut Milk", "Puree", "Crush"])

    assert modes == ["blend"]
    assert stations_for_modes(modes) == []


def test_pressure_wording_that_cannot_mean_anything_else_still_reads():
    assert normalise_mode("Pressure Cook") == "pressure_cook"
    assert normalise_mode("High Pressure") == "pressure_cook"


def test_buttons_come_back_in_catalogue_order_not_typing_order():
    """So two people entering the same machine get the same primary station."""
    one = modes_from_panel(["Air Crisp", "Sauté", "Pressure Cook"])
    two = modes_from_panel(["Pressure Cook", "Air Crisp", "Sauté"])

    assert one == two
    assert one[0] == "pressure_cook"


def test_a_repeated_button_is_recorded_once():
    assert modes_from_panel(["Sauté", "SAUTE", "Sear"]) == ["saute"]


# ---------------------------------------------------------------------------
# Buttons that are not stations
# ---------------------------------------------------------------------------

def test_a_real_button_the_planner_cannot_use_is_kept_but_not_a_station():
    """DEHYDRATE and KEEP WARM are on the machine and mean nothing to a
    schedule. Recording them honestly is not the same as inventing capacity."""
    modes = modes_from_panel(["Dehydrate", "Keep Warm", "Sauté"])

    assert set(modes) == {"dehydrate", "keep_warm", "saute"}
    assert stations_for_modes(modes) == ["stove"]


def test_a_panel_of_nothing_schedulable_yields_no_stations():
    assert stations_for_modes(modes_from_panel(["Keep Warm", "Reheat"])) == []


# ---------------------------------------------------------------------------
# The checklist a person confirms against
# ---------------------------------------------------------------------------

def test_the_checklist_offers_every_button_not_only_the_guessed_ones():
    """Otherwise the air fry button the model missed could never be added,
    which is the entire failure this is meant to fix."""
    checklist = suggested_panel(validate_profile({"panel": DUO}))

    assert len(checklist) == len(MODES)
    on = {row["label"] for row in checklist if row["on"]}
    assert "Air Fry" not in on
    assert "Air Fry" in {row["label"] for row in checklist}


def test_the_checklist_says_which_buttons_earn_a_station():
    """Shown so it is clear why ticking DEHYDRATE changes nothing."""
    rows = {row["key"]: row for row in suggested_panel(None)}

    assert rows["air_fry"]["station"] == "air_fryer"
    assert rows["dehydrate"]["station"] is None


def test_labels_are_printed_wording_not_internal_keys():
    assert mode_labels(["saute", "air_fry"]) == ["Sauté", "Air Fry"]
