"""
providers/culinary/appliance_modes.py — the buttons are the specification

Two Instant Pot pressure cookers, one with an air fry lid. Same brand, near
enough the same name, and one of them is an air fryer while the other is not.
No amount of asking a model "what is an Instant Pot" separates them, because
the thing that separates them is not in the name.

It is on the front panel. A Duo Crisp has an AIR CRISP button and a Duo does
not, and that one button is the entire difference in what the two machines can
be asked to do. So the panel is what gets recorded, and everything else is
derived from it:

    AIR CRISP  ->  air_fryer
    SAUTE      ->  stove
    SLOW COOK  ->  slow_cooker
    PRESSURE   ->  instant_pot

That mapping is a table, not a judgement. Once the buttons are known the
stations follow with no model in the loop, which matters because stations are
what the planner schedules against -- a wrong one produces an appliance that
silently never gets used, or worse, one that gets offered for a job it cannot
do.

This inverts where the model sits. It no longer decides what the appliance is
capable of; it proposes a checklist of buttons it thinks are on the panel, and
a person confirms it by looking. A wrong guess costs one tap. A guess nobody
checks used to cost a wrong profile that looked authoritative.

Manufacturers do not agree on names for the same function -- Instant Pot says
AIR CRISP, Ninja says AIR CRISP, Cosori says AIR FRY, and a few say CRISP --
so incoming text is normalised through an alias table before it is matched.

Some buttons map to no station at all. DEHYDRATE and KEEP WARM are real
controls that the planner has nothing to do with, and they are kept as labels
rather than invented into stations, so a panel can be recorded honestly
without conjuring capacity that does not exist.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

__all__ = [
    "Mode", "MODES", "normalise_mode", "modes_from_panel",
    "stations_for_modes", "mode_labels", "panel_summary",
]


@dataclass(frozen=True)
class Mode:
    """One control on the panel, and what it makes the appliance.

    ``station`` is None for controls the planner cannot schedule against.
    Those are still worth recording -- they are really on the machine -- but
    they must not become stations, because a station is a promise that the
    planner can put a dish there.
    """
    key: str
    label: str
    station: Optional[str]
    aliases: Tuple[str, ...] = ()


#: Ordered, because the first station a panel yields becomes the appliance's
#: primary one and that should be stable between saves.
MODES: Tuple[Mode, ...] = (
    Mode("pressure_cook", "Pressure Cook", "instant_pot", (
        "pressure", "manual", "high pressure", "low pressure", "pressure cooking",
        "soup", "broth", "stew", "meat", "poultry", "bean", "chili", "rice",
        "multigrain", "porridge", "egg", "cake", "canning", "sterilize",
    )),
    Mode("saute", "Sauté", "stove", (
        "saute", "sear", "brown", "sear saute", "saute sear", "browning",
    )),
    Mode("slow_cook", "Slow Cook", "slow_cooker", (
        "slowcook", "slow cooking", "crock", "crock pot",
    )),
    Mode("air_fry", "Air Fry", "air_fryer", (
        "air crisp", "crisp", "airfry", "air fryer", "air crisping", "crisp lid",
        "super crisp",
    )),
    Mode("bake", "Bake", "oven", ("bake roast", "baking", "bake pan")),
    Mode("roast", "Roast", "oven", ("roasting",)),
    Mode("broil", "Broil", "oven", ("broiling", "top brown")),
    Mode("toast", "Toast", "oven", ("toasting", "bagel")),
    Mode("grill", "Grill", "indoor_grill", (
        "griddle", "grilling", "panini", "sear plate",
    )),
    Mode("steam", "Steam", "stove", ("steaming", "steam bake")),
    Mode("sous_vide", "Sous Vide", "sous_vide", ("sousvide", "sous", "immersion")),
    Mode("wok", "Stir Fry", "wok", ("stirfry", "stir fry", "wok mode")),
    Mode("microwave", "Microwave", "microwave", ("micro",)),
    Mode("mix", "Mix", "stand_mixer", ("knead", "whip", "beat", "dough")),
    # Real buttons, nothing for the planner to do with them. Recorded so the
    # panel is a true record, deliberately without a station.
    Mode("dehydrate", "Dehydrate", None, ("dehydrating", "dry")),
    Mode("proof", "Proof", None, ("ferment", "yogurt", "rise", "dough proof")),
    Mode("keep_warm", "Keep Warm", None, ("warm", "hold", "keep hot")),
    Mode("reheat", "Reheat", None, ("re heat",)),
    Mode("defrost", "Defrost", None, ("thaw",)),
)

_BY_KEY: Dict[str, Mode] = {m.key: m for m in MODES}

_SQUASH = re.compile(r"[^a-z0-9]+")


def _flatten(text: str) -> str:
    """Panel text down to something comparable.

    ``Sear/Sauté``, ``SEAR-SAUTE`` and ``sear saute`` are one button written
    three ways, and the difference is punctuation and case.
    """
    lowered = str(text or "").lower()
    lowered = (lowered.replace("é", "e").replace("è", "e")
                      .replace("ô", "o").replace("û", "u"))
    return _SQUASH.sub(" ", lowered).strip()


#: Built once. Longest alias first so ``air crisp`` is tried before ``crisp``
#: and a two-word button is never claimed by the one-word mode inside it.
_ALIASES: Tuple[Tuple[str, str], ...] = tuple(sorted(
    ((_flatten(alias), mode.key)
     for mode in MODES
     for alias in (mode.key, mode.label, *mode.aliases)),
    key=lambda pair: -len(pair[0]),
))


def normalise_mode(text: str) -> Optional[str]:
    """One piece of panel text to a canonical mode key, or None.

    Exact match first, so a button that is precisely ``Steam`` cannot be
    swallowed by a longer alias that happens to contain it. Only then the
    substring pass, which is what catches ``Sear/Sauté`` and ``Air Crisp
    (Lid)``.
    """
    flat = _flatten(text)
    if not flat:
        return None
    for alias, key in _ALIASES:
        if flat == alias:
            return key
    for alias, key in _ALIASES:
        if len(alias) >= 4 and alias in flat:
            return key
    return None


def modes_from_panel(panel: List[str]) -> List[str]:
    """Everything readable on the panel, in catalogue order.

    Catalogue order rather than the order they were typed, so that two people
    entering the same machine's buttons get the same primary station.
    """
    found = {key for key in (normalise_mode(item) for item in (panel or []))
             if key}
    return [m.key for m in MODES if m.key in found]


def stations_for_modes(modes: List[str]) -> List[str]:
    """The stations a set of buttons actually amounts to.

    This is the whole point of the module: no model runs here. Given the
    panel, the stations are a lookup, and a lookup is the same answer every
    time for every household.
    """
    seen: List[str] = []
    for key in (modes or []):
        mode = _BY_KEY.get(key)
        if mode and mode.station and mode.station not in seen:
            seen.append(mode.station)
    return seen


def mode_labels(modes: List[str]) -> List[str]:
    return [_BY_KEY[k].label for k in (modes or []) if k in _BY_KEY]


def panel_summary(modes: List[str]) -> str:
    """What the panel says, for the cook to check against the machine."""
    labels = mode_labels(modes)
    return " · ".join(labels)
