"""
providers/culinary/serializers.py

Model -> dict for the culinary API.

Pure functions with no database and no request in sight: given a row, return
the shape the client renders. Kept out of the route file so a change to what a
recipe looks like on the wire does not mean opening 2,900 lines of HTTP.
"""

from __future__ import annotations

import json

from api.services.recipe_parser import _safe_json
from culinary.models import (
    BannedIngredient,
    DinnerProposal,
    Household,
    KitchenEquipment,
    PrepSession,
    Recipe,
    StockroomItem,
)


def _household_out(hh: Household) -> dict:
    return {
        "id": hh.id,
        "name": hh.name,
        "owner_id": hh.owner_id,
        "equipment": {
            "air_fryer": hh.has_air_fryer,
            "instant_pot": hh.has_instant_pot,
            "dutch_oven": hh.has_dutch_oven,
            "sous_vide": hh.has_sous_vide,
            "slow_cooker": hh.has_slow_cooker,
            "stand_mixer": hh.has_stand_mixer,
            "wok": hh.has_wok,
            "grill": hh.has_grill,
        },
        "created_at": hh.created_at.isoformat() if hh.created_at else None,
        "updated_at": hh.updated_at.isoformat() if hh.updated_at else None,
    }


def _recipe_out(r: Recipe) -> dict:
    return {
        "id": r.id,
        "household_id": r.household_id,
        "title": r.title,
        "meal_type": r.meal_type.value if r.meal_type else "Other",
        "primary_protein": r.primary_protein,
        "servings": r.servings,
        "image_url": r.image_url,
        "source_url": r.source_url,
        "source_type": r.source_type.value if r.source_type else "manual",
        "rating": r.rating,
        "ingredients": _safe_json(r.ingredients_json, []),
        "steps": _safe_json(r.steps_json, []),
        "equipment_needed": _safe_json(r.equipment_needed_json, []),
        "blacklisted": _safe_json(r.blacklisted_json, []),
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


def _banned_out(bi: BannedIngredient) -> dict:
    return {
        "id": bi.id,
        "household_id": bi.household_id,
        "name": bi.name,
        "substitute": bi.substitute,
        "created_at": bi.created_at.isoformat() if bi.created_at else None,
        "updated_at": bi.updated_at.isoformat() if bi.updated_at else None,
    }


def _stock_out(s: StockroomItem) -> dict:
    return {
        "id": s.id,
        "household_id": s.household_id,
        "name": s.name,
        "barcode": s.barcode,
        "brand": s.brand,
        "state": s.state.value if s.state else "Good",
        "quantity": getattr(s, "quantity", 1.0),
        "min_quantity": getattr(s, "min_quantity", 0.25),
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


def _equipment_out(eq: KitchenEquipment) -> dict:
    raw_caps = eq.capabilities_json
    if raw_caps:
        try:
            capabilities = json.loads(raw_caps)
        except Exception:
            capabilities = [eq.equipment_type] if eq.equipment_type else []
    else:
        capabilities = [eq.equipment_type] if eq.equipment_type else []
    return {
        "id": eq.id,
        "equipment_type": eq.equipment_type,
        "label": eq.label,
        "make": eq.make,
        "model": eq.model,
        "capabilities": capabilities,
    }


def _proposal_out(p: DinnerProposal) -> dict:
    return {
        "id": p.id,
        "household_id": p.household_id,
        "recipe_id": p.recipe_id,
        "recipe": _recipe_out(p.recipe) if p.recipe else None,
        "proposed_by": p.proposed_by,
        "votes_yes": _safe_json(p.votes_yes, []),
        "votes_no": _safe_json(p.votes_no, []),
        "status": p.status,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


def _session_out(ps: PrepSession) -> dict:
    return {
        "id": ps.id,
        "household_id": ps.household_id,
        "label": ps.label,
        "is_active": ps.is_active,
        "target_containers": ps.target_containers,
        "container_oz": ps.container_oz,
        "recipes": [
            {
                "entry_id": pr.id,
                "recipe_id": pr.recipe_id,
                "session_id": pr.session_id,
                "recipe_title": pr.recipe.title if pr.recipe else "",
                "servings_target": pr.servings_target,
                "scaled_ingredients": json.loads(pr.scaled_ingredients_json) if pr.scaled_ingredients_json else None,
            }
            for pr in ps.recipes
        ],
        "created_at": ps.created_at.isoformat() if ps.created_at else None,
        "completed_at": ps.completed_at.isoformat() if ps.completed_at else None,
    }
