"""
providers/culinary/ingredients.py

Ingredient handling that does not need a request: flagging banned ingredients,
aggregating a shopping list across recipes, and the default blacklist a fresh
household starts with.
"""

from __future__ import annotations

import json
import logging
from typing import Dict, List

from sqlalchemy.orm import Session

from api.services.recipe_parser import _extract_json, _format_qty, _parse_qty
from culinary.models import BannedIngredient, StockroomItem, StockState

logger = logging.getLogger(__name__)


_DEFAULT_BLACKLIST = {
    "bell pepper", "bell peppers",
    "pearl onion", "pearl onions",
    "quinoa",
    "radish", "radishes",
    "zucchini",
    "mushroom", "mushrooms",
}

_DEFAULT_SUBSTITUTIONS = {
    "bell pepper": "poblano pepper",
    "bell peppers": "poblano peppers",
    "pearl onion": "shallot",
    "pearl onions": "shallots",
    "quinoa": "brown rice",
    "radish": "turnip",
    "radishes": "turnips",
    "zucchini": "yellow squash",
    "mushroom": "eggplant",
    "mushrooms": "eggplant",
}


def _flag_blacklist(db: Session, household_id: str,
                    ingredients: list[dict]) -> list[dict]:
    banned = db.query(BannedIngredient).filter_by(
        household_id=household_id).all()
    banned_map = {b.name.lower(): b.substitute for b in banned}

    flagged = []
    for ing in ingredients:
        name_lower = ing.get("name", "").lower().strip()
        if name_lower in banned_map:
            flagged.append({
                "name": ing["name"],
                "substitute": banned_map[name_lower],
            })
    return flagged


def _aggregate_ingredients(db: Session, hh_id: str, recipes_data: List[dict]):
    good_stock = {
        s.name.lower().strip()
        for s in db.query(StockroomItem).filter_by(household_id=hh_id).all()
        if s.state == StockState.GOOD
    }

    aggregated: Dict[str, dict] = {}
    for data in recipes_data:
        ingredients_json = data.get("ingredients_json", "[]")
        try:
            ingredients = json.loads(ingredients_json)
        except (json.JSONDecodeError, TypeError):
            continue
        for ing in ingredients:
            name = ing.get("name", "")
            if not name:
                continue
            name_key = name.lower().strip()
            if name_key in good_stock:
                continue
            if name_key in aggregated:
                try:
                    aggregated[name_key]["qty"] = _format_qty(
                        _parse_qty(str(aggregated[name_key]["qty"]))
                        + _parse_qty(str(ing.get("qty", 0)))
                    )
                except (ValueError, TypeError):
                    pass
            else:
                aggregated[name_key] = {
                    "name": name,
                    "qty": ing.get("qty", ""),
                    "unit": ing.get("unit", ""),
                }
    return list(aggregated.values())


def _collect_parsed(raw: str) -> List[dict]:
    try:
        result = _extract_json(raw)
    except Exception:
        return []
    if isinstance(result, dict):
        result = [result]
    return [r for r in result if isinstance(
        r, dict)] if isinstance(result, list) else []
