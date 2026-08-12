"""
providers/culinary/cook_plan.py — cooking several recipes as one meal

`cook_now` handles one recipe: a list of steps and a pointer into it. A meal is
not several of those side by side. Three recipes have one oven between them,
one pair of hands, and one moment when everything is supposed to be hot at the
same time, and none of that is visible while each recipe is its own list.

The organising idea is that **serve time is the anchor and the plan is built
backwards from it**. "When do I start the potatoes" is not a question anyone
can answer forwards; it is `serve_at` minus how long potatoes take. Every
screen the cook asked for -- when to prep, what order to cook in, which
appliance is busy -- is a view of that one timeline rather than a separate
calculation, so they cannot disagree with each other.

The second idea is that a step occupies **two different resources**. Chopping
occupies the cook. Roasting occupies the oven and frees the cook. Splitting
every step into active and passive minutes is what turns a stack of recipes
into an interleaved plan: passive stretches are exactly where the other dishes
get made, and a scheduler that does not model the difference can only
concatenate.

Nothing here does I/O. The step analysis is keyword-driven and works offline
with no model available; an LLM pass can refine `StepFacts` afterwards, but is
never required for a plan to exist. That ordering is deliberate -- a kitchen
timeline that stops working when Ollama is down is worse than a rough one.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Stations
#
# cul_kitchen_equipment records what the household *owns* -- an air fryer is
# worth recording, a stove is not -- so the everyday stations are implicit and
# have to be supplied here or every plan would think it had no oven.
#
# The number is how many things can use it at once. Four burners is the one
# that matters: it is the difference between "three pans is fine" and a
# conflict the cook needs warning about.
# ---------------------------------------------------------------------------

IMPLICIT_STATIONS: Dict[str, int] = {
    "counter": 99,     # unbounded: chopping does not contend with anything
    "stove": 4,
    # Two shelves. A chicken and a tray of potatoes in one oven is the most
    # common meal there is, and reporting it as a clash would have been the
    # warning that teaches people to ignore the warnings. What an oven cannot
    # do is two temperatures, which is a different check and not modelled yet.
    "oven": 2,
    "microwave": 1,
}

#: Owned equipment is single-capacity unless the household records two.
DEFAULT_EQUIPMENT_CAPACITY = 1

# ---------------------------------------------------------------------------
# Step analysis
#
# Longest phrase first within each station: "slow cooker" must be tested before
# "cooker", and "air fry" before "fry", or the shorter key wins on a string
# that the longer one describes better.
# ---------------------------------------------------------------------------

_STATION_PATTERNS: List[Tuple[str, Tuple[str, ...]]] = [
    ("instant_pot", ("instant pot", "pressure cook", "pressure-cook", "manual high pressure")),
    ("slow_cooker", ("slow cooker", "slow-cook", "slow cook", "crock pot", "crockpot")),
    ("air_fryer",   ("air fryer", "air-fry", "air fry")),
    ("sous_vide",   ("sous vide", "sous-vide", "immersion circulator")),
    ("stand_mixer", ("stand mixer", "paddle attachment", "dough hook")),
    ("grill",       ("grill", "barbecue", "bbq", "char")),
    ("dutch_oven",  ("dutch oven",)),
    ("wok",         ("wok", "stir-fry", "stir fry")),
    ("oven",        ("oven", "bake", "roast", "broil", "preheat to", "425", "375", "350")),
    ("microwave",   ("microwave", "nuke")),
    ("stove",       ("saucepan", "skillet", "frying pan", "stockpot", "sauté", "saute",
                     "simmer", "boil", "sear", "fry", "reduce", "poach", "steam",
                     "medium heat", "high heat", "low heat", "burner")),
]

#: Verbs whose time runs without the cook. This list is the whole reason a
#: plan can interleave, so it is worth more than the station map.
_PASSIVE_VERBS = (
    "bake", "roast", "braise", "simmer", "marinate", "rest", "chill",
    # Boiling and steaming are waiting, not doing. Left out of the first pass
    # and it showed immediately: a Sunday roast booked eight minutes of hands
    # for parboiling potatoes and six more for steaming beans, which is most
    # of the window the plan was meant to be filling with something else.
    # "boil" also covers parboil and hard-boil.
    "boil", "blanch", "steam", "poach",
    "refrigerate", "freeze", "proof", "rise", "slow cook", "pressure cook",
    "air fry", "sous vide", "preheat", "soak", "brine", "cool", "set aside",
    "let stand", "steep", "reduce", "smoke", "cure", "ferment", "thaw",
)

#: Verbs that need hands. Anything unmatched is treated as active, because
#: over-booking the cook produces a plan that runs late, while under-booking
#: produces one that is wrong about whether they had time -- and late is the
#: failure people can recover from.
_ACTIVE_VERBS = (
    "chop", "dice", "mince", "slice", "julienne", "peel", "trim", "grate",
    "stir", "whisk", "mix", "fold", "knead", "toss", "season", "salt",
    "drain", "strain", "plate", "garnish", "assemble", "arrange", "serve",
    "transfer", "combine", "add", "pour", "spread", "flip", "turn", "baste",
)

#: Steps that clearly happen before any heat. Used to split the plan into the
#: prep screen and the cook screen.
_PREP_VERBS = (
    "chop", "dice", "mince", "slice", "julienne", "peel", "trim", "grate",
    "marinate", "brine", "measure", "gather", "wash", "rinse", "pat dry",
    "bring to room temperature", "thaw", "soften",
)

#: Prep no matter which station they name. The station test below is what
#: stops "sear the sliced beef" reading as knife work, but it also catches
#: preheating, which happens at the oven and is still setup.
_ALWAYS_PREP_VERBS = ("preheat", "get out", "line the", "grease")

_FINISH_VERBS = ("plate", "garnish", "serve", "slice to serve", "rest before")

_DURATION = re.compile(
    r"(\d+(?:\.\d+)?)\s*(?:to|-|–)?\s*(\d+(?:\.\d+)?)?\s*"
    r"(second|sec|minute|min|hour|hr)s?\b",
    re.IGNORECASE,
)

_UNIT_MINUTES = {
    "second": 1 / 60, "sec": 1 / 60,
    "minute": 1, "min": 1,
    "hour": 60, "hr": 60,
}


def extract_minutes(text: str) -> int:
    """Longest duration named in a step, in whole minutes.

    A range takes its upper bound. "Bake 20-25 minutes" scheduled at 20 puts
    the next dish on the counter while this one is still in the oven, and the
    cost of the two spare minutes is that you wait; the cost of being early is
    that the plan is wrong from there on.

    Compound durations like "1 hour 30 minutes" are recognized and summed.
    Adjacent matches are considered part of the same phrase when they appear
    within a few characters of each other.
    """
    matches = list(_DURATION.finditer(text))
    if not matches:
        return 0

    best = 0.0
    compound = 0.0
    last_end = -1

    for match in matches:
        lo, hi, unit = match.groups()
        factor = _UNIT_MINUTES.get(unit.lower(), 0)
        value = float(hi or lo) * factor

        # Check if this match is adjacent to the previous one (compound duration)
        if last_end >= 0 and match.start() - last_end <= 5:
            # Part of a compound duration - accumulate
            compound += value
        else:
            # New phrase - save the previous compound and start fresh
            if compound > 0:
                best = max(best, compound)
            compound = value

        last_end = match.end()

    # Don't forget the final compound
    if compound > 0:
        best = max(best, compound)

    return int(round(best))


def _first_match(text: str, verbs: Iterable[str]) -> Optional[str]:
    for verb in verbs:
        if verb in text:
            return verb
    return None


def detect_station(text: str) -> str:
    """Which appliance a step ties up. Defaults to the counter."""
    lowered = text.lower()
    for station, patterns in _STATION_PATTERNS:
        for pattern in patterns:
            if pattern in lowered:
                return station
    return "counter"


@dataclass
class StepFacts:
    """One step, with the facts a schedule needs rather than only its words."""
    index: int
    text: str
    station: str = "counter"
    phase: str = "cook"          # prep | cook | finish
    active_min: int = 0          # occupies the cook
    passive_min: int = 0         # occupies the station, frees the cook

    @property
    def total_min(self) -> int:
        return self.active_min + self.passive_min

    @property
    def blocks_the_cook(self) -> bool:
        """Whether this step holds the cook rather than merely starting.

        Same distinction PlannedStep draws, defined here too so the two cannot
        drift apart and callers need not know which one they are holding.
        """
        return self.active_min > 0 and self.passive_min == 0


#: What an unnamed hands-on step costs. Most recipes write "season the chicken"
#: without a duration, and treating those as instant produces a plan that
#: claims a meal takes twenty minutes when it takes fifty.
DEFAULT_ACTIVE_MIN = 3


def analyse_step(index: int, text: str) -> StepFacts:
    """Turn one instruction into schedulable facts, using words alone.

    Deliberately not an LLM call. This runs on every step of every recipe in a
    plan, has to work when the model is down, and is the layer a model would
    only be correcting -- so it needs to be right often enough to stand alone.
    """
    lowered = text.lower()
    minutes = extract_minutes(text)
    station = detect_station(text)

    passive_verb = _first_match(lowered, _PASSIVE_VERBS)
    active_verb = _first_match(lowered, _ACTIVE_VERBS)

    if passive_verb and minutes:
        # "Simmer for 20 minutes, stirring occasionally" -- the twenty minutes
        # belong to the pot. The stirring is real but it is not twenty minutes
        # of stirring, so it costs the fixed hands-on minimum.
        active = DEFAULT_ACTIVE_MIN if active_verb else 1
        passive = minutes
    elif passive_verb:
        # Named a passive verb but no duration: "let rest". Short, and better
        # counted somewhere than dropped.
        active, passive = 1, 5
    elif minutes:
        # A duration on a hands-on step means that long with your hands on it.
        active, passive = minutes, 0
    else:
        active, passive = DEFAULT_ACTIVE_MIN, 0

    if _first_match(lowered, _FINISH_VERBS):
        phase = "finish"
    elif _first_match(lowered, _ALWAYS_PREP_VERBS):
        phase = "prep"
    elif _first_match(lowered, _PREP_VERBS) and station == "counter":
        # Station matters: "slice the onions" is prep, "sear the sliced beef"
        # is not, and both contain a prep verb.
        phase = "prep"
    else:
        phase = "cook"

    return StepFacts(index=index, text=text, station=station, phase=phase,
                     active_min=active, passive_min=passive)


def analyse_steps(steps: Iterable[str]) -> List[StepFacts]:
    return [analyse_step(i, str(s)) for i, s in enumerate(steps) if str(s).strip()]


# ---------------------------------------------------------------------------
# Scheduling
# ---------------------------------------------------------------------------

@dataclass
class PlannedStep:
    """A step placed on the clock.

    Offsets are minutes relative to the start of the plan, not wall-clock
    times. The plan is anchored to serve time, so a cook who starts late wants
    the whole thing to slide with them rather than to be told they are behind
    on every row at once.
    """
    recipe_id: str
    recipe_title: str
    step_index: int
    text: str
    station: str
    phase: str
    start_min: int
    end_min: int
    active_min: int
    passive_min: int

    @property
    def hands_on(self) -> bool:
        """Whether the cook does anything here. Used for display."""
        return self.active_min > 0

    @property
    def blocks_the_cook(self) -> bool:
        """Whether this step holds the cook, as opposed to merely starting.

        Not the same question as `hands_on`, and conflating them was worth a
        bug: every passive step carries a minute or so for putting the thing
        in the oven, so under `hands_on` two dishes going into two appliances
        at the same time read as the cook being in two places. They are not --
        you load one and then the other. What actually holds someone is a step
        with no passive time to walk away into.
        """
        return self.active_min > 0 and self.passive_min == 0


@dataclass
class Conflict:
    """Two things wanting one resource. Reported, never silently resolved."""
    kind: str             # "station" | "cook"
    resource: str
    start_min: int
    detail: str


@dataclass
class CookPlan:
    serve_offset_min: int                       # length of the whole plan
    steps: List[PlannedStep] = field(default_factory=list)
    conflicts: List[Conflict] = field(default_factory=list)
    #: When the first course lands. Equal to serve_offset_min unless the
    #: dishes are staggered, in which case it is the only honest anchor for
    #: "start by" -- the end of the plan is when the last course goes out.
    first_course_min: int = 0

    def phase(self, name: str) -> List[PlannedStep]:
        return [s for s in self.steps if s.phase == name]

    @property
    def stations_used(self) -> List[str]:
        seen = []
        for s in self.steps:
            if s.station != "counter" and s.station not in seen:
                seen.append(s.station)
        return seen


@dataclass
class RecipeInPlan:
    recipe_id: str
    title: str
    steps: List[StepFacts]
    #: Minutes after the first course that this dish is wanted. 0 means it
    #: lands with everything else, which is the default and the common case.
    #:
    #: Courses are the reason this is not simply "everything finishes
    #: together". A starter at seven and a main at half past are one cooking
    #: session with two deadlines, and so is a bulk cook where tonight's
    #: dinner is wanted now and tomorrow's can come out whenever. Modelling
    #: that as separate plans would be wrong: the dishes still share one oven
    #: and one cook, and it is precisely the contention between courses that
    #: nobody can hold in their head.
    course_offset_min: int = 0

    @property
    def total_min(self) -> int:
        return sum(s.total_min for s in self.steps)


def _station_capacity(station: str, owned: Optional[Dict[str, int]]) -> int:
    if station in IMPLICIT_STATIONS:
        return IMPLICIT_STATIONS[station]
    if owned and station in owned:
        return max(1, owned[station])
    # An appliance the household does not own still gets scheduled: the recipe
    # asked for it, and refusing to plan is less useful than planning and
    # saying so. Capacity of one keeps it from being double-booked on top.
    return DEFAULT_EQUIPMENT_CAPACITY


def plan_meal(
    recipes: List[RecipeInPlan],
    owned_stations: Optional[Dict[str, int]] = None,
) -> CookPlan:
    """Lay several recipes on one timeline, ending together.

    Each recipe is placed backwards from the shared finish: its last step ends
    at serve time, and every earlier step ends when the next one begins. That
    is what makes the dishes land together instead of in the order somebody
    happened to start them.

    Contention is then detected, not resolved. Two roasts and one oven has no
    good automatic answer -- one of them has to move, and which one depends on
    what tolerates sitting, which the recipe does not say. Reporting the clash
    at the minute it happens lets the cook decide; quietly shifting a dish
    would produce a plan that looks fine and is wrong.
    """
    if not recipes:
        return CookPlan(serve_offset_min=0)

    # Normalize course offsets so the minimum is zero - if the earliest course
    # is offset by 30 minutes, treat that as time zero rather than letting
    # negative offsets put steps before the plan begins.
    min_course_offset = min(r.course_offset_min for r in recipes)
    normalized_recipes = [
        RecipeInPlan(
            recipe_id=r.recipe_id,
            title=r.title,
            steps=r.steps,
            course_offset_min=r.course_offset_min - min_course_offset,
        )
        for r in recipes
    ]

    # When the first course is served. Each dish has to have started early
    # enough to be ready for its own course, so the earliest possible first
    # course is set by whichever dish is most behind relative to when it is
    # wanted -- a two-hour main wanted thirty minutes after the starter still
    # pins the whole evening.
    base = max(r.total_min - r.course_offset_min for r in normalized_recipes)
    last_course = max(r.course_offset_min for r in normalized_recipes)
    placed: List[PlannedStep] = []

    for recipe in normalized_recipes:
        # Finish exactly when this dish is wanted, not when the meal ends.
        cursor = base + recipe.course_offset_min - recipe.total_min
        for step in recipe.steps:
            placed.append(PlannedStep(
                recipe_id=recipe.recipe_id,
                recipe_title=recipe.title,
                step_index=step.index,
                text=step.text,
                station=step.station,
                phase=step.phase,
                start_min=cursor,
                end_min=cursor + step.total_min,
                active_min=step.active_min,
                passive_min=step.passive_min,
            ))
            cursor += step.total_min

    placed.sort(key=lambda s: (s.start_min, s.recipe_title, s.step_index))
    conflicts = _find_conflicts(placed, owned_stations)
    return CookPlan(serve_offset_min=base + last_course, steps=placed,
                    conflicts=conflicts,
                    first_course_min=base)


def _find_conflicts(steps: List[PlannedStep],
                    owned: Optional[Dict[str, int]]) -> List[Conflict]:
    """Overlaps a cook would walk into.

    Checked at the minute a step starts rather than by sweeping every minute:
    an overlap that exists at all necessarily exists at some step's start, so
    this finds the same clashes and reports them where the cook would meet
    them.
    """
    conflicts: List[Conflict] = []

    for probe in steps:
        at = probe.start_min
        live = [s for s in steps if s.start_min <= at < s.end_min]

        # A station holding more than it can. The counter is unbounded and
        # never reports.
        by_station: Dict[str, List[PlannedStep]] = {}
        for s in live:
            by_station.setdefault(s.station, []).append(s)
        for station, users in by_station.items():
            capacity = _station_capacity(station, owned)
            if len(users) > capacity:
                titles = sorted({u.recipe_title for u in users})
                if len(titles) < 2:
                    continue          # one recipe using its own station twice
                conflicts.append(Conflict(
                    kind="station",
                    resource=station,
                    start_min=at,
                    detail=(f"{station.replace('_', ' ')} wanted by "
                            f"{' and '.join(titles)} at the same time"),
                ))

        # The cook is one pair of hands. Only steps that hold them count: a
        # simmering pot is not competing for the cook, and neither is the
        # minute spent sliding a tray into the oven.
        hands = [s for s in live if s.blocks_the_cook and s.start_min == at]
        if len(hands) > 1:
            titles = sorted({h.recipe_title for h in hands})
            if len(titles) > 1:
                conflicts.append(Conflict(
                    kind="cook",
                    resource="you",
                    start_min=at,
                    detail=(f"hands-on work for {' and '.join(titles)} "
                            f"starts at the same moment"),
                ))

    # One row per resource and minute; the probe loop can reach the same clash
    # from either side of it.
    seen = set()
    unique = []
    for c in conflicts:
        key = (c.kind, c.resource, c.start_min)
        if key not in seen:
            seen.add(key)
            unique.append(c)
    return unique
