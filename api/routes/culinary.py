"""
api/routes/culinary.py — Project River Song: Culinary Module

Endpoints
---------
GET/PUT    /api/culinary/household
GET/POST   /api/culinary/recipes
GET/PUT/DELETE /api/culinary/recipes/{recipe_id}
POST       /api/culinary/recipes/ingest
POST       /api/culinary/recipes/{recipe_id}/scale
POST       /api/culinary/recipes/{recipe_id}/translate-equipment

GET/POST   /api/culinary/stockroom
GET/PUT/DELETE /api/culinary/stockroom/{item_id}
POST       /api/culinary/stockroom/scan
POST       /api/culinary/stockroom/deplete

GET/POST   /api/culinary/prep
POST       /api/culinary/prep/{session_id}/add-recipe
DELETE     /api/culinary/prep/{session_id}/recipes/{recipe_id}
GET        /api/culinary/prep/{session_id}/shopping-list
GET        /api/culinary/prep/{session_id}/staging
POST       /api/culinary/prep/{session_id}/complete

GET/POST/DELETE /api/culinary/walmart/mappings[/{mapping_id}]
POST       /api/culinary/walmart/export

WS         /api/culinary/ws
"""

from __future__ import annotations
from core.family import resolve_module_owner as _resolve_module_owner

# Business logic lives in providers/culinary/; this file is the HTTP layer.
# Imported under the original names so the route handlers below — and
# api/routes/culinary_sessions.py, which imports several of these — did not
# need editing as part of the move.
from providers.culinary.barcode import _lookup_barcode
from providers.culinary.ingredients import (
    _DEFAULT_BLACKLIST,
    _DEFAULT_SUBSTITUTIONS,
    _aggregate_ingredients,
    _collect_parsed,
    _flag_blacklist,
)
from providers.culinary.appliance_profile import (
    build_profile,
    confirm_panel,
    suggested_panel,
)
from providers.culinary.llm import (
    _EQUIPMENT_TRANSLATE_PROMPT,
    _RECIPE_SCHEMA_PROMPT,
    _SUBSTITUTE_RECOMMEND_PROMPT,
    _call_ollama,
    _call_ollama_vision,
    _identify_equipment,
)
from providers.culinary.serializers import (
    _banned_out,
    _equipment_out,
    _household_out,
    _proposal_out,
    _recipe_out,
    _session_out,
    _stock_out,
)
from providers.culinary.vault_sync import (
    _delete_recipe_from_vault,
    _sync_recipe_to_vault,
)

import base64
import html
import json
import logging
import os
import re
import sqlalchemy
from datetime import datetime, timezone
from fractions import Fraction
from typing import Any, Dict, Generator, List, Optional
from api.services.recipe_parser import *
# `import *` skips leading-underscore names, so every helper below was
# undefined at runtime — creating a recipe, scaling one, or reading one back
# all raised NameError. Imported explicitly.
from api.services.recipe_parser import (
    _IMPERIAL_TO_METRIC,
    _METRIC_TO_IMPERIAL,
    _detect_protein,
    _extract_json,
    _extract_jsonld_recipes,
    _extract_microdata_recipes,
    _extract_nextdata_recipes,
    _extract_og_image,
    _format_qty,
    _is_bot_challenge,
    _parse_qty,
    _parse_yield,
    _safe_json,
)

import httpx
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from pydantic import BaseModel, Field
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from core.auth import decode_token
from core.errors import api_error, bad_request, conflict, not_found, unauthorized
from culinary.models import (
    Base,
    BannedIngredient,
    DinnerProposal,
    Household,
    KitchenEquipment,
    ListSource,
    MealType,
    PrepSession,
    PrepSessionRecipe,
    Recipe,
    ShoppingListItem,
    SourceType,
    StockroomItem,
    StockState,
    WalmartMapping,
    StoreMapping,
    MealPlanEntry,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/culinary", tags=["culinary"])

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

_DB_URL = os.environ.get("CULINARY_DB_URL", "sqlite:///./data/culinary.db")
_engine = create_engine(
    _DB_URL,
    connect_args={"check_same_thread": False} if "sqlite" in _DB_URL else {},
)
_Session = sessionmaker(bind=_engine, autocommit=False, autoflush=False)
Base.metadata.create_all(_engine)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _add_column(conn, table: str, column: str, decl: str) -> None:
    """Add a column if it is not already there, and say so when it fails.

    `create_all` makes new tables and never new columns, so an existing
    database needs this. The expected outcome is a duplicate-column error on
    every boot after the first, which is why it is swallowed -- but swallowing
    it silently also hid a genuinely failed migration until something read the
    missing column hours later.

    Each statement gets its own transaction. On Postgres a failed DDL poisons
    the surrounding one, so without the rollback the first duplicate column
    would take every migration after it down with it.
    """
    try:
        conn.execute(sqlalchemy.text(
            f"ALTER TABLE {table} ADD COLUMN {column} {decl}"))
        conn.commit()
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        message = str(exc).lower()
        if "duplicate" in message or "already exists" in message:
            return                      # the normal path on every later boot
        logger.warning("Migration: could not add %s.%s — %s",
                       table, column, exc)


def _migrate_culinary_schema() -> None:
    import sqlalchemy
    with _engine.connect() as conn:
        try:
            conn.execute(sqlalchemy.text(
                "ALTER TABLE cul_kitchen_equipment ADD COLUMN capabilities_json TEXT"
            ))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(sqlalchemy.text(
                "ALTER TABLE cul_recipes ADD COLUMN rating INTEGER"
            ))
            conn.commit()
        except Exception:
            pass
        # image_url + blacklisted_json shipped alongside rating (76609f8) but
        # never got their own ALTER — older DBs 500 on any recipe SELECT
        # ("no such column"). Backfill both here.
        try:
            conn.execute(sqlalchemy.text(
                "ALTER TABLE cul_recipes ADD COLUMN image_url TEXT"
            ))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(sqlalchemy.text(
                "ALTER TABLE cul_recipes ADD COLUMN blacklisted_json TEXT NOT NULL DEFAULT '[]'"
            ))
            conn.commit()
        except Exception:
            pass
        # Per-appliance facts and observed behaviour.
        for col, decl in (
            ("profile_json", "TEXT"),
            ("history_json", "TEXT"),
        ):
            _add_column(conn, "cul_kitchen_equipment", col, decl)

        # Per-session appliance swaps, added after the table existed.
        _add_column(conn, "cul_prep_session_recipes",
                    "appliance_swap_json", "TEXT")
        try:
            conn.execute(sqlalchemy.text(
                "ALTER TABLE cul_banned_ingredients ADD COLUMN substitute TEXT"
            ))
            conn.commit()
        except Exception:
            pass

        # Migrate shadow shopping_list rows to cul_shopping_list
        try:
            res = conn.execute(sqlalchemy.text("SELECT * FROM shopping_list")).fetchall()
            if res:
                # Get the first household as fallback
                hh_id = None
                hh_res = conn.execute(sqlalchemy.text("SELECT id FROM cul_households LIMIT 1")).fetchone()
                if hh_res:
                    hh_id = hh_res[0]
                
                if hh_id:
                    from datetime import datetime, timezone
                    import uuid
                    for row in res:
                        # row: (id, user_id, item, quantity, added_at)
                        uid = row[1]
                        # try to get actual household for user
                        uhh_res = conn.execute(sqlalchemy.text("SELECT id FROM cul_households WHERE owner_id = :uid"), {"uid": uid}).fetchone()
                        target_hh = uhh_res[0] if uhh_res else hh_id
                        conn.execute(sqlalchemy.text("""
                            INSERT INTO cul_shopping_list (id, household_id, name, qty, category, source, added_by, created_at)
                            VALUES (:id, :hh, :nm, :qty, 'grocery', 'chat', :uid, :dt)
                        """), {
                            "id": str(uuid.uuid4()),
                            "hh": target_hh,
                            "nm": row[2],
                            "qty": str(row[3]) if row[3] else None,
                            "uid": uid,
                            "dt": datetime.now(timezone.utc).isoformat()
                        })
                # Drop the shadow table
                conn.execute(sqlalchemy.text("DROP TABLE shopping_list"))
                conn.commit()
        except Exception:
            pass
        try:
            conn.execute(sqlalchemy.text(
                "ALTER TABLE cul_stockroom ADD COLUMN quantity FLOAT NOT NULL DEFAULT 1.0"
            ))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(sqlalchemy.text(
                "ALTER TABLE cul_stockroom ADD COLUMN min_quantity FLOAT NOT NULL DEFAULT 0.25"
            ))
            conn.commit()
        except Exception:
            pass

        # Multi-store shopping list columns
        _add_column(conn, "cul_shopping_list", "store", "TEXT")
        _add_column(conn, "cul_shopping_list", "store_item_id", "TEXT")

        # Multi-store item mappings table
        try:
            conn.execute(sqlalchemy.text("""
                CREATE TABLE IF NOT EXISTS cul_store_mappings (
                    id TEXT PRIMARY KEY,
                    household_id TEXT,
                    ingredient_name TEXT NOT NULL,
                    store TEXT NOT NULL DEFAULT 'walmart',
                    store_item_id TEXT NOT NULL,
                    notes TEXT,
                    created_at DATETIME
                )
            """))
            conn.commit()
            # Copy over legacy walmart mappings if they exist
            try:
                conn.execute(sqlalchemy.text("""
                    INSERT OR IGNORE INTO cul_store_mappings (id, household_id, ingredient_name, store, store_item_id, created_at)
                    SELECT id, household_id, ingredient_name, 'walmart', walmart_item_id, created_at
                    FROM cul_walmart_mappings
                """))
                conn.commit()
            except Exception:
                pass
        except Exception:
            pass


_migrate_culinary_schema()


# ---------------------------------------------------------------------------
# Hardcoded Defaults (to be migrated)
# ---------------------------------------------------------------------------


def _seed_banned_ingredients() -> None:
    """One-time migration: seed existing households with the old hardcoded blacklist."""
    with _Session() as session:
        households = session.query(Household).all()
        for hh in households:
            # Only seed if they have NO banned ingredients yet
            existing = session.query(BannedIngredient).filter_by(
                household_id=hh.id).count()
            if existing == 0:
                for name in _DEFAULT_BLACKLIST:
                    bi = BannedIngredient(
                        household_id=hh.id,
                        name=name,
                        substitute=_DEFAULT_SUBSTITUTIONS.get(name)
                    )
                    session.add(bi)
        session.commit()


_seed_banned_ingredients()


def get_db() -> Generator[Session, None, None]:
    db = _Session()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

async def _get_user_id(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise unauthorized("Missing Bearer token")
    payload = await decode_token(auth.removeprefix("Bearer ").strip())
    if not payload:
        raise unauthorized("Invalid or expired token")
    uid = str(payload.get("sub", ""))
    if not uid:
        raise unauthorized("Token missing sub")
    return uid


def _get_household(db: Session, owner_id: str) -> Household:
    effective_id = _resolve_module_owner(owner_id, "culinary")
    hh = db.query(Household).filter_by(owner_id=effective_id).first()
    if not hh:
        hh = Household(owner_id=effective_id)
        db.add(hh)
        db.commit()
        db.refresh(hh)
    return hh


# ---------------------------------------------------------------------------
# Ingredient blacklist
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Ollama helpers
# ---------------------------------------------------------------------------


def _chunk_text(text: str, size: int = 20000) -> List[str]:
    text = text.strip()
    return [text[i:i + size]
            for i in range(0, len(text), size)] if text else []


# ---------------------------------------------------------------------------
# Open Food Facts helpers
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class HouseholdUpdate(BaseModel):
    name: Optional[str] = None
    has_air_fryer: Optional[bool] = None
    has_instant_pot: Optional[bool] = None
    has_dutch_oven: Optional[bool] = None
    has_sous_vide: Optional[bool] = None
    has_slow_cooker: Optional[bool] = None
    has_stand_mixer: Optional[bool] = None
    has_wok: Optional[bool] = None
    has_grill: Optional[bool] = None


class RecipeCreate(BaseModel):
    title: str
    meal_type: MealType = MealType.OTHER
    primary_protein: Optional[str] = None
    servings: int = 4
    image_url: Optional[str] = None
    ingredients: List[Dict[str, Any]] = []
    steps: List[str] = []
    equipment_needed: List[str] = []


class RecipeUpdate(BaseModel):
    title: Optional[str] = None
    meal_type: Optional[MealType] = None
    primary_protein: Optional[str] = None
    servings: Optional[int] = None
    image_url: Optional[str] = None
    ingredients: Optional[List[Dict[str, Any]]] = None
    steps: Optional[List[str]] = None
    equipment_needed: Optional[List[str]] = None


class ScaleRequest(BaseModel):
    target_servings: int
    prefer_system: Optional[str] = None  # "metric" or "imperial"


class EquipmentTranslateRequest(BaseModel):
    equipment: str  # e.g. "Air Fryer"


class EquipmentPanelConfirm(BaseModel):
    """The buttons somebody has read off the front of the appliance.

    Sent whole rather than as a diff: the panel replaces what was there, so
    unticking is expressed by absence and the stored profile can never drift
    out of step with what was last confirmed.
    """
    panel: List[str] = Field(default_factory=list)


class StockroomItemCreate(BaseModel):
    name: str
    barcode: Optional[str] = None
    brand: Optional[str] = None
    state: str = "Good"


class StockroomItemUpdate(BaseModel):
    name: Optional[str] = None
    brand: Optional[str] = None
    state: Optional[str] = None
    quantity: Optional[float] = None
    min_quantity: Optional[float] = None


class ScanRequest(BaseModel):
    barcode: str
    quantity: float = 1.0


class PrepSessionCreate(BaseModel):
    label: Optional[str] = None
    target_containers: Optional[int] = None
    container_oz: Optional[int] = None


class AddRecipeToPrep(BaseModel):
    recipe_id: str
    servings_target: Optional[int] = None


class PrepRecipeScaleUpdate(BaseModel):
    target_servings: int
    scaled_ingredients: List[Dict[str, Any]]


class EquipmentItemCreate(BaseModel):
    make: str
    model: str


class EquipmentItemUpdate(BaseModel):
    make: Optional[str] = None
    model: Optional[str] = None


class EquipmentIdentifyRequest(BaseModel):
    make: str
    model: str


class WalmartMappingCreate(BaseModel):
    ingredient_name: str
    walmart_item_id: str


class BannedIngredientCreate(BaseModel):
    name: str
    substitute: Optional[str] = None


class BannedIngredientUpdate(BaseModel):
    name: Optional[str] = None
    substitute: Optional[str] = None


class SubstituteRecommendRequest(BaseModel):
    ingredient: str


class RateRecipeRequest(BaseModel):
    rating: int  # 1-5


class SuggestDinnerRequest(BaseModel):
    recipe_id: str


class VoteRequest(BaseModel):
    vote: str  # "yes" | "no"


# ---------------------------------------------------------------------------
# Serializers
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# CHRONOS vault sync — every recipe becomes a markdown note.
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# WebSocket connection manager
# ---------------------------------------------------------------------------

class _WSManager:
    def __init__(self):
        self._connections: Dict[str, list[WebSocket]] = {}

    async def connect(self, household_id: str, ws: WebSocket):
        await ws.accept()
        self._connections.setdefault(household_id, []).append(ws)

    def disconnect(self, household_id: str, ws: WebSocket):
        bucket = self._connections.get(household_id, [])
        if ws in bucket:
            bucket.remove(ws)

    async def broadcast(self, household_id: str, event: str, data: Any):
        bucket = self._connections.get(household_id, [])
        dead = []
        for ws in bucket:
            try:
                await ws.send_json({"event": event, "data": data})
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(household_id, ws)


_ws_manager = _WSManager()


@router.websocket("/ws")
async def culinary_ws(websocket: WebSocket, token: str = ""):
    payload = await decode_token(token) if token else None
    if not payload:
        await websocket.close(code=4001)
        return
    owner_id = str(payload.get("sub", ""))
    db = _Session()
    try:
        hh = _get_household(db, owner_id)
        await _ws_manager.connect(hh.id, websocket)
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            _ws_manager.disconnect(hh.id, websocket)
    finally:
        db.rollback()
        db.close()


# ---------------------------------------------------------------------------
# Household
# ---------------------------------------------------------------------------

@router.get("/household")
async def get_household(request: Request, db: Session = Depends(get_db)):
    uid = await _get_user_id(request)
    return _household_out(_get_household(db, uid))


@router.put("/household")
async def update_household(
    body: HouseholdUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    for field, value in body.model_dump(exclude_none=True).items():
        # Equipment fields are prefixed has_ in the model
        if field.startswith("has_"):
            setattr(hh, field, value)
        elif field == "name":
            hh.name = value
    db.commit()
    db.refresh(hh)
    await _ws_manager.broadcast(hh.id, "household_updated", _household_out(hh))
    return _household_out(hh)


# ---------------------------------------------------------------------------
# Banned Ingredients
# ---------------------------------------------------------------------------

@router.get("/household/banned")
async def list_banned_ingredients(
        request: Request, db: Session = Depends(get_db)):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    return [_banned_out(bi) for bi in hh.banned_ingredients]


@router.post("/household/banned", status_code=status.HTTP_201_CREATED)
async def add_banned_ingredient(
    body: BannedIngredientCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    bi = BannedIngredient(
        household_id=hh.id,
        name=body.name.strip().lower(),
        substitute=body.substitute.strip() if body.substitute else None,
    )
    db.add(bi)
    db.commit()
    db.refresh(bi)
    await _ws_manager.broadcast(hh.id, "banned_updated", _banned_out(bi))
    return _banned_out(bi)


@router.put("/household/banned/{bi_id}")
async def update_banned_ingredient(
    bi_id: str,
    body: BannedIngredientUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    bi = db.query(BannedIngredient).filter_by(
        id=bi_id, household_id=hh.id).first()
    if not bi:
        raise not_found("Banned ingredient not found")

    if body.name is not None:
        bi.name = body.name.strip().lower()
    if body.substitute is not None:
        bi.substitute = body.substitute.strip() if body.substitute else None

    db.commit()
    db.refresh(bi)
    await _ws_manager.broadcast(hh.id, "banned_updated", _banned_out(bi))
    return _banned_out(bi)


@router.delete("/household/banned/{bi_id}",
               status_code=status.HTTP_204_NO_CONTENT)
async def delete_banned_ingredient(
    bi_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    bi = db.query(BannedIngredient).filter_by(
        id=bi_id, household_id=hh.id).first()
    if not bi:
        raise not_found("Banned ingredient not found")
    db.delete(bi)
    db.commit()
    await _ws_manager.broadcast(hh.id, "banned_deleted", {"id": bi_id})


@router.post("/household/banned/recommend")
async def recommend_substitutes(
        body: SubstituteRecommendRequest, request: Request):
    """Ask AI for substitute recommendations for a given ingredient."""
    await _get_user_id(request)  # auth check
    prompt = _SUBSTITUTE_RECOMMEND_PROMPT.format(ingredient=body.ingredient)
    try:
        raw = await _call_ollama(prompt)
        recommendations = _extract_json(raw)
        if not isinstance(recommendations, list):
            return []
        return recommendations
    except Exception as exc:
        logger.error("Substitute recommendation failed: %s", exc)
        return []


# ---------------------------------------------------------------------------
# Kitchen Equipment (make / model)
# ---------------------------------------------------------------------------

@router.get("/household/equipment")
async def list_equipment(request: Request, db: Session = Depends(get_db)):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    return [_equipment_out(e) for e in hh.equipment_items]


@router.post("/household/equipment/identify")
async def identify_equipment(body: EquipmentIdentifyRequest, request: Request):
    """Classify a device by brand + model without saving — returns {label, types}."""
    await _get_user_id(request)  # auth check
    result = await _identify_equipment(body.make.strip(), body.model.strip())
    return result


@router.post("/household/equipment", status_code=status.HTTP_201_CREATED)
async def add_equipment(
    body: EquipmentItemCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    make, model = body.make.strip(), body.model.strip()

    # A full profile rather than a category. "Instant Dutch Oven" is four
    # stations, a ceiling, and a set of mode names printed on its panel, and
    # none of that survives being filed as one equipment_type. Falls back to
    # the older classifier when no profile can be built, so adding an
    # appliance never depends on the model being up.
    profile = await build_profile(make, model)
    if profile:
        types = profile["stations"]
        label = profile["label"]
    else:
        identified = await _identify_equipment(make, model)
        types = identified["types"]
        label = identified["label"]

    primary_type = types[0] if types else "other"
    eq = KitchenEquipment(
        household_id=hh.id,
        equipment_type=primary_type,
        label=label,
        make=make,
        model=model,
        capabilities_json=json.dumps(types),
        profile_json=json.dumps(profile) if profile else None,
    )
    db.add(eq)
    for t in types:
        flag = f"has_{t}"
        if hasattr(hh, flag):
            setattr(hh, flag, True)
    db.commit()
    db.refresh(eq)
    await _ws_manager.broadcast(hh.id, "equipment_updated", _equipment_out(eq))
    return _equipment_out(eq)


def _apply_station_flags(db: Session, hh, eq_id: str,
                         old_types: List[str], new_types: List[str]) -> None:
    """Move the household's has_* flags to match a changed set of stations.

    A flag is only cleared once no *other* appliance still provides it, so
    unticking AIR CRISP on one machine does not tell the household it has no
    air fryer when a second one is sitting next to it.
    """
    siblings = db.query(KitchenEquipment).filter(
        KitchenEquipment.household_id == hh.id,
        KitchenEquipment.id != eq_id,
    ).all()
    sibling_caps: set = set()
    for s_eq in siblings:
        try:
            sibling_caps.update(json.loads(s_eq.capabilities_json or "[]"))
        except Exception:
            if s_eq.equipment_type:
                sibling_caps.add(s_eq.equipment_type)

    for t in old_types:
        if t not in new_types and t not in sibling_caps:
            flag = f"has_{t}"
            if hasattr(hh, flag):
                setattr(hh, flag, False)
    for t in new_types:
        flag = f"has_{t}"
        if hasattr(hh, flag):
            setattr(hh, flag, True)


@router.get("/household/equipment/{eq_id}/panel")
async def get_equipment_panel(
    eq_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """The checklist to hold up against the front of the appliance.

    Every button the catalogue knows, ticked where this profile claims it —
    the whole list rather than only the guessed ones, because the correction
    that matters most is *adding* the button the model missed.
    """
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    eq = db.query(KitchenEquipment).filter(
        KitchenEquipment.id == eq_id,
        KitchenEquipment.household_id == hh.id,
    ).first()
    if not eq:
        raise HTTPException(status_code=404, detail="Equipment not found")

    try:
        profile = json.loads(eq.profile_json) if eq.profile_json else None
    except Exception:
        profile = None
    return {
        "equipment_id": eq.id,
        "label": eq.label,
        "confirmed": bool((profile or {}).get("panel_confirmed")),
        "buttons": suggested_panel(profile),
    }


@router.post("/household/equipment/{eq_id}/panel")
async def confirm_equipment_panel(
    eq_id: str,
    body: EquipmentPanelConfirm,
    request: Request,
    db: Session = Depends(get_db),
):
    """Record the buttons somebody has actually read off the machine.

    This is the only path that produces a profile which is not a guess. Two
    Instant Pots that answer to the same name stop being ambiguous here: the
    one with AIR CRISP ticked becomes schedulable as an air fryer and the
    other does not.

    Stations are re-derived from the panel rather than edited, so the buttons
    stay the single source of what the appliance can do.
    """
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    eq = db.query(KitchenEquipment).filter(
        KitchenEquipment.id == eq_id,
        KitchenEquipment.household_id == hh.id,
    ).first()
    if not eq:
        raise HTTPException(status_code=404, detail="Equipment not found")

    try:
        profile = json.loads(eq.profile_json) if eq.profile_json else None
    except Exception:
        profile = None
    profile = dict(profile or {})
    profile.setdefault("make", eq.make or "")
    profile.setdefault("model", eq.model or "")
    profile.setdefault("label", eq.label or "")

    old_types: List[str] = []
    try:
        old_types = json.loads(eq.capabilities_json or "[]")
    except Exception:
        old_types = [eq.equipment_type] if eq.equipment_type else []

    confirmed = confirm_panel(profile, list(body.panel or []))
    new_types = confirmed["stations"]

    eq.profile_json = json.dumps(confirmed)
    eq.capabilities_json = json.dumps(new_types)
    eq.equipment_type = new_types[0] if new_types else "other"
    _apply_station_flags(db, hh, eq_id, old_types, new_types)

    db.commit()
    db.refresh(eq)
    await _ws_manager.broadcast(hh.id, "equipment_updated", _equipment_out(eq))
    return _equipment_out(eq)


@router.put("/household/equipment/{eq_id}")
async def update_equipment(
    eq_id: str,
    body: EquipmentItemUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    eq = db.query(KitchenEquipment).filter_by(
        id=eq_id, household_id=hh.id).first()
    if not eq:
        raise not_found("Equipment not found")

    make_changed = body.make is not None
    model_changed = body.model is not None
    if make_changed:
        eq.make = body.make
    if model_changed:
        eq.model = body.model

    if make_changed or model_changed:
        old_caps: set = set()
        try:
            old_caps.update(json.loads(eq.capabilities_json or "[]"))
        except Exception:
            if eq.equipment_type:
                old_caps.add(eq.equipment_type)

        # The profile describes the machine that *was* named here. Correcting
        # a Duo to a Duo Crisp and keeping the old profile would leave the
        # pressure cooker's stations and ceilings attached to an air fryer,
        # and a confirmed panel would still read as confirmed. Rebuild it, or
        # clear it and fall back to the class limits.
        profile = await build_profile(eq.make or "", eq.model or "")
        eq.profile_json = json.dumps(profile) if profile else None

        if profile:
            new_types = profile["stations"]
            eq.label = profile["label"]
        else:
            identified = await _identify_equipment(eq.make or "", eq.model or "")
            new_types = identified["types"]
            eq.label = identified["label"]
        eq.equipment_type = new_types[0] if new_types else "other"
        eq.capabilities_json = json.dumps(new_types)

        # Capabilities on sibling equipment — needed to safely clear old flags
        siblings = db.query(KitchenEquipment).filter(
            KitchenEquipment.household_id == hh.id,
            KitchenEquipment.id != eq_id,
        ).all()
        sibling_caps: set = set()
        for s_eq in siblings:
            try:
                sibling_caps.update(json.loads(s_eq.capabilities_json or "[]"))
            except Exception:
                if s_eq.equipment_type:
                    sibling_caps.add(s_eq.equipment_type)

        for t in old_caps:
            if t not in new_types and t not in sibling_caps:
                flag = f"has_{t}"
                if hasattr(hh, flag):
                    setattr(hh, flag, False)
        for t in new_types:
            flag = f"has_{t}"
            if hasattr(hh, flag):
                setattr(hh, flag, True)

    db.commit()
    db.refresh(eq)
    await _ws_manager.broadcast(hh.id, "equipment_updated", _equipment_out(eq))
    return _equipment_out(eq)


@router.delete("/household/equipment/{eq_id}",
               status_code=status.HTTP_204_NO_CONTENT)
async def delete_equipment(
    eq_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    eq = db.query(KitchenEquipment).filter_by(
        id=eq_id, household_id=hh.id).first()
    if not eq:
        raise not_found("Equipment not found")
    try:
        caps = json.loads(eq.capabilities_json or "[]")
    except Exception:
        caps = [eq.equipment_type] if eq.equipment_type else []

    # Determine which capabilities remain on other equipment before clearing
    # flags
    remaining = db.query(KitchenEquipment).filter(
        KitchenEquipment.household_id == hh.id,
        KitchenEquipment.id != eq_id,
    ).all()
    remaining_caps: set = set()
    for r_eq in remaining:
        try:
            remaining_caps.update(json.loads(r_eq.capabilities_json or "[]"))
        except Exception:
            if r_eq.equipment_type:
                remaining_caps.add(r_eq.equipment_type)

    db.delete(eq)
    for t in caps:
        flag = f"has_{t}"
        if hasattr(hh, flag) and t not in remaining_caps:
            setattr(hh, flag, False)
    db.commit()
    await _ws_manager.broadcast(hh.id, "equipment_deleted", {"id": eq_id})


# ---------------------------------------------------------------------------
# Recipe Library
# ---------------------------------------------------------------------------

@router.get("/recipes")
async def list_recipes(request: Request, db: Session = Depends(get_db)):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    return [_recipe_out(r) for r in hh.recipes]


@router.get("/recipes/duplicates")
async def list_duplicate_recipes(
        request: Request, db: Session = Depends(get_db)):
    """Group recipes by normalized title and return groups with >1 item."""
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)

    from collections import defaultdict
    groups = defaultdict(list)
    for r in hh.recipes:
        key = (r.title or "Untitled").strip().lower()
        groups[key].append(_recipe_out(r))

    return [g for g in groups.values() if len(g) > 1]


@router.post("/recipes", status_code=status.HTTP_201_CREATED)
async def create_recipe(
    body: RecipeCreate,
    request: Request,
    db: Session = Depends(get_db),
    force: bool = False,
):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)

    # Duplicate check
    title_norm = body.title.strip().lower()
    if not force:
        existing = db.query(Recipe).filter(
            Recipe.household_id == hh.id,
            sqlalchemy.func.lower(Recipe.title) == title_norm
        ).first()
        if existing:
            raise conflict(
                f"A recipe with title '{body.title}' already exists.")

    blacklisted = _flag_blacklist(db, hh.id, body.ingredients)
    meal = body.meal_type
    r = Recipe(
        household_id=hh.id,
        title=body.title,
        meal_type=meal,
        primary_protein=body.primary_protein or _detect_protein(
            body.title, body.ingredients),
        servings=body.servings,
        image_url=body.image_url,
        source_type=SourceType.MANUAL,
        ingredients_json=json.dumps(body.ingredients),
        steps_json=json.dumps(body.steps),
        equipment_needed_json=json.dumps(body.equipment_needed),
        blacklisted_json=json.dumps(blacklisted),
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    await _sync_recipe_to_vault(uid, r)
    await _ws_manager.broadcast(hh.id, "recipe_created", _recipe_out(r))
    return _recipe_out(r)


@router.get("/recipes/{recipe_id}")
async def get_recipe(recipe_id: str, request: Request,
                     db: Session = Depends(get_db)):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    r = db.query(Recipe).filter_by(id=recipe_id, household_id=hh.id).first()
    if not r:
        raise not_found("Recipe not found")
    return _recipe_out(r)


@router.put("/recipes/{recipe_id}")
async def update_recipe(
    recipe_id: str,
    body: RecipeUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    r = db.query(Recipe).filter_by(id=recipe_id, household_id=hh.id).first()
    if not r:
        raise not_found("Recipe not found")
    old_title = r.title
    if body.title is not None:
        r.title = body.title
    if body.meal_type is not None:
        r.meal_type = body.meal_type
    if body.primary_protein is not None:
        r.primary_protein = body.primary_protein
    if body.servings is not None:
        r.servings = body.servings
    if body.ingredients is not None:
        r.ingredients_json = json.dumps(body.ingredients)
        r.blacklisted_json = json.dumps(
            _flag_blacklist(db, hh.id, body.ingredients))
    if body.steps is not None:
        r.steps_json = json.dumps(body.steps)
    if body.equipment_needed is not None:
        r.equipment_needed_json = json.dumps(body.equipment_needed)
    if body.image_url is not None:
        r.image_url = body.image_url
    db.commit()
    db.refresh(r)
    await _sync_recipe_to_vault(uid, r, old_title=old_title)
    await _ws_manager.broadcast(hh.id, "recipe_updated", _recipe_out(r))
    return _recipe_out(r)


@router.delete("/recipes/{recipe_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_recipe(recipe_id: str, request: Request,
                        db: Session = Depends(get_db)):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    r = db.query(Recipe).filter_by(id=recipe_id, household_id=hh.id).first()
    if not r:
        raise not_found("Recipe not found")
    await _delete_recipe_from_vault(uid, r)
    db.delete(r)
    db.commit()
    await _ws_manager.broadcast(hh.id, "recipe_deleted", {"id": recipe_id})


@router.patch("/recipes/{recipe_id}/rate")
async def rate_recipe(
    recipe_id: str,
    body: RateRecipeRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    r = db.query(Recipe).filter_by(id=recipe_id, household_id=hh.id).first()
    if not r:
        raise not_found("Recipe not found")
    if not (1 <= body.rating <= 5):
        raise bad_request("Rating must be 1–5")
    r.rating = body.rating
    db.commit()
    db.refresh(r)
    await _sync_recipe_to_vault(uid, r)
    await _ws_manager.broadcast(hh.id, "recipe_updated", _recipe_out(r))
    return _recipe_out(r)


# ---------------------------------------------------------------------------
# "What's for Dinner" — proposal queue & voting
# ---------------------------------------------------------------------------

def _active_proposals(db: Session, household_id: str) -> list[DinnerProposal]:
    return (
        db.query(DinnerProposal)
        .filter(
            DinnerProposal.household_id == household_id,
            DinnerProposal.status.in_(["pending", "approved"]),
        )
        .order_by(DinnerProposal.created_at.desc())
        .all()
    )


@router.get("/dinner")
async def get_dinner_proposals(
        request: Request, db: Session = Depends(get_db)):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    return [_proposal_out(p) for p in _active_proposals(db, hh.id)]


@router.post("/dinner/suggest", status_code=status.HTTP_201_CREATED)
async def suggest_dinner(
    body: SuggestDinnerRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    recipe = db.query(Recipe).filter_by(
        id=body.recipe_id, household_id=hh.id).first()
    if not recipe:
        raise not_found("Recipe not found")
    p = DinnerProposal(
        household_id=hh.id,
        recipe_id=recipe.id,
        proposed_by=uid)
    db.add(p)
    db.commit()
    db.refresh(p)
    proposals = [_proposal_out(x) for x in _active_proposals(db, hh.id)]
    await _ws_manager.broadcast(hh.id, "dinner_updated", {"proposals": proposals})
    return _proposal_out(p)


@router.post("/dinner/{proposal_id}/vote")
async def vote_dinner(
    proposal_id: str,
    body: VoteRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    p = db.query(DinnerProposal).filter_by(
        id=proposal_id, household_id=hh.id).first()
    if not p:
        raise not_found("Proposal not found")

    yes_list = json.loads(p.votes_yes or "[]")
    no_list = json.loads(p.votes_no or "[]")
    yes_list = [u for u in yes_list if u != uid]
    no_list = [u for u in no_list if u != uid]

    if body.vote == "yes":
        yes_list.append(uid)
        p.status = "approved"
        # Create MealPlanEntry for tonight
        today = _now().replace(hour=0, minute=0, second=0, microsecond=0)
        existing_plan = db.query(MealPlanEntry).filter_by(
            household_id=hh.id, plan_date=today, slot=MealType.DINNER
        ).first()
        if not existing_plan:
            plan = MealPlanEntry(
                household_id=hh.id,
                plan_date=today,
                slot=MealType.DINNER,
                recipe_id=p.recipe_id,
                status="planned",
                created_by=uid
            )
            db.add(plan)
    elif body.vote == "no":
        no_list.append(uid)
    else:
        raise bad_request("vote must be 'yes' or 'no'")

    p.votes_yes = json.dumps(yes_list)
    p.votes_no = json.dumps(no_list)
    db.commit()
    db.refresh(p)
    proposals = [_proposal_out(x) for x in _active_proposals(db, hh.id)]
    await _ws_manager.broadcast(hh.id, "dinner_updated", {"proposals": proposals})
    return _proposal_out(p)


@router.delete("/dinner/{proposal_id}", status_code=status.HTTP_204_NO_CONTENT)
async def dismiss_dinner(
    proposal_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    p = db.query(DinnerProposal).filter_by(
        id=proposal_id, household_id=hh.id).first()
    if not p:
        raise not_found("Proposal not found")
    db.delete(p)
    db.commit()
    proposals = [_proposal_out(x) for x in _active_proposals(db, hh.id)]
    await _ws_manager.broadcast(hh.id, "dinner_updated", {"proposals": proposals})


@router.post("/dinner/{proposal_id}/cook-now")
async def cook_now(
    proposal_id: str,
    request: Request,
    target_servings: int = 4,
    db: Session = Depends(get_db),
):
    """Scale the proposed recipe and return a single-use shopping list."""
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    p = db.query(DinnerProposal).filter_by(
        id=proposal_id, household_id=hh.id).first()
    if not p:
        raise not_found("Proposal not found")
    recipe = p.recipe
    if not recipe:
        raise not_found("Recipe not found")

    original_servings = recipe.servings or 4
    factor = target_servings / original_servings

    scaled = []
    for ing in _safe_json(recipe.ingredients_json, []):
        raw_qty = _parse_qty(str(ing.get("qty", ""))) * factor
        qty_out = _format_qty(raw_qty) if raw_qty > 0 else ing.get("qty", "")
        scaled.append({"name": ing.get("name", ""),
                      "qty": qty_out, "unit": ing.get("unit", "")})

    # Dismiss the proposal — it's been acted on
    db.delete(p)
    
    # Create MealPlanEntry for tonight
    today = _now().replace(hour=0, minute=0, second=0, microsecond=0)
    existing_plan = db.query(MealPlanEntry).filter_by(
        household_id=hh.id, plan_date=today, slot=MealType.DINNER
    ).first()
    if not existing_plan:
        plan = MealPlanEntry(
            household_id=hh.id,
            plan_date=today,
            slot=MealType.DINNER,
            recipe_id=recipe.id,
            status="cooked",
            created_by=uid
        )
        db.add(plan)
    else:
        existing_plan.status = "cooked"

    db.commit()
    proposals = [_proposal_out(x) for x in _active_proposals(db, hh.id)]
    await _ws_manager.broadcast(hh.id, "dinner_updated", {"proposals": proposals})

    return {
        "recipe_id": recipe.id,
        "title": recipe.title,
        "servings": target_servings,
        "shopping_list": scaled,
        "steps": _safe_json(recipe.steps_json, []),
    }


# ---------------------------------------------------------------------------
# Ingest Engine (PDF / URL → Ollama)
# ---------------------------------------------------------------------------

#: Ceiling on a single pasted-recipe submission. Each 20,000-char chunk is one
#: sequential call to the local model, so this bounds the endpoint to ~4 of
#: them. A long recipe with notes is well under 10,000 characters.
_MAX_PASTED_RECIPE_CHARS = 80_000


@router.post("/recipes/ingest", status_code=status.HTTP_201_CREATED)
async def ingest_recipe(
    request: Request,
    db: Session = Depends(get_db),
    source_url: Optional[str] = Form(default=None),
    raw_text: Optional[str] = Form(default=None),
    file: Optional[UploadFile] = File(default=None),
    force: bool = False,
):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)

    src_type = SourceType.MANUAL
    actual_url = source_url
    all_parsed: List[dict] = []

    if file and file.filename:
        try:
            import fitz  # PyMuPDF
        except ImportError:
            raise HTTPException(
                status_code=500,
                detail="PyMuPDF not installed. Run: pip install pymupdf")

        content = await file.read()
        try:
            doc = fitz.open(stream=content, filetype="pdf")
        except Exception as exc:
            logger.error("Failed to parse uploaded PDF: %s", exc)
            raise bad_request(
                "The uploaded file is not a valid PDF or is corrupted. Ensure you are uploading a direct PDF file.")
        src_type = SourceType.PDF

        text_pages: List[str] = []
        image_pages: List[str] = []  # base64 PNG per scanned page

        for page in doc:
            text = page.get_text().strip()
            if len(text) > 100:
                text_pages.append(text)
            else:
                # Scanned page — render at 150 DPI and send to vision model
                pix = page.get_pixmap(dpi=150)
                image_pages.append(
                    base64.b64encode(
                        pix.tobytes("png")).decode())

        # ── text track: chunk and send to qwen2.5:14b ──────────────────────
        if text_pages:
            full_text = "\n\n".join(text_pages)
            for chunk in _chunk_text(full_text, 20000):
                try:
                    raw = await _call_ollama(_RECIPE_SCHEMA_PROMPT + chunk)
                    all_parsed.extend(_collect_parsed(raw))
                except Exception as exc:
                    logger.warning("Text chunk parse failed: %s", exc)

        # ── image track: each page → gemma3:12b vision ──────────────────────
        for b64 in image_pages:
            try:
                raw = await _call_ollama_vision(_RECIPE_SCHEMA_PROMPT, b64)
                all_parsed.extend(_collect_parsed(raw))
            except Exception as exc:
                logger.warning("Image page parse failed: %s", exc)

    elif source_url:
        try:
            from bs4 import BeautifulSoup
        except ImportError:
            raise HTTPException(
                status_code=500,
                detail="BeautifulSoup not installed. Run: pip install beautifulsoup4")

        _fetch_headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
        }
        try:
            async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
                resp = await client.get(source_url, headers=_fetch_headers)
                resp.raise_for_status()
        except httpx.TimeoutException:
            raise HTTPException(status_code=504,
                                detail="Request to recipe site timed out.")
        except httpx.HTTPStatusError as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Recipe site returned an error: {exc.response.status_code} {exc.response.reason_phrase}"
            )
        except Exception as exc:
            logger.error("Failed to fetch recipe URL %s: %s", source_url, exc)
            raise HTTPException(
                status_code=502,
                detail=f"Could not reach the recipe site: {exc}")

        page_html = resp.text
        src_type = SourceType.URL

        if _is_bot_challenge(page_html):
            raise bad_request((
                "This site uses bot protection and blocked the request. "
                "Try copying the recipe text and using the Manual Entry form instead."
            ))

        # ── Track 1a: JSON-LD structured extraction (instant, no AI) ────────
        jsonld_recipes = _extract_jsonld_recipes(page_html)
        if jsonld_recipes:
            logger.info("JSON-LD found: %d recipe(s)", len(jsonld_recipes))
            all_parsed.extend(jsonld_recipes)

        # ── Track 1b: Microdata (itemprop="recipeIngredient" etc.) ──────────
        if not all_parsed:
            microdata_recipes = _extract_microdata_recipes(page_html)
            if microdata_recipes:
                logger.info(
                    "Microdata found: %d recipe(s)",
                    len(microdata_recipes))
                all_parsed.extend(microdata_recipes)

        # ── Track 1c: Next.js __NEXT_DATA__ (other SPA sites) ───────────────
        if not all_parsed:
            nextdata_recipes = _extract_nextdata_recipes(page_html)
            if nextdata_recipes:
                logger.info(
                    "__NEXT_DATA__ found: %d recipe(s)",
                    len(nextdata_recipes))
                all_parsed.extend(nextdata_recipes)

        if not all_parsed:
            # ── Track 2: Fallback — scrape text → qwen2.5:14b ───────────────
            logger.info(
                "No structured data found — falling back to AI text parse")
            soup = BeautifulSoup(page_html, "html.parser")
            for tag in soup(["script", "style", "nav",
                            "footer", "header", "aside"]):
                tag.decompose()
            raw_text = soup.get_text(separator="\n", strip=True)

            for chunk in _chunk_text(raw_text, 20000):
                try:
                    raw = await _call_ollama(_RECIPE_SCHEMA_PROMPT + chunk)
                    all_parsed.extend(_collect_parsed(raw))
                except Exception as exc:
                    logger.warning("URL chunk parse failed: %s", exc)

        # ── Image fallback: og:image for any recipe missing an image ─────────
        og_image = _extract_og_image(page_html)
        if og_image:
            for recipe_dict in all_parsed:
                if not recipe_dict.get("image_url"):
                    recipe_dict["image_url"] = og_image

    elif raw_text and raw_text.strip():
        # Cap the work before starting it. Each chunk is one sequential model
        # request against a single local Ollama, so an unbounded paste is an
        # unbounded queue — one permitted user pasting a book keeps the model
        # busy and every other room's turn waiting behind it. A recipe is a
        # few thousand characters; the cap is generous against that and still
        # bounds the loop to a handful of calls.
        if len(raw_text) > _MAX_PASTED_RECIPE_CHARS:
            raise bad_request(
                f"That text is {len(raw_text):,} characters; the limit is "
                f"{_MAX_PASTED_RECIPE_CHARS:,}. Paste one recipe at a time, "
                f"or use Manual Entry."
            )
        # Pasted text. The third source, and the one that rescues the other
        # two: a site behind bot protection, or a PDF that will not parse,
        # both end with "copy the text and paste it here". Without this the
        # advice in those error messages had nowhere to go.
        #
        # Same AI parse as the PDF and URL text tracks — no structured data
        # to mine, so it goes straight to the model.
        src_type = SourceType.MANUAL
        for chunk in _chunk_text(raw_text, 20000):
            try:
                raw = await _call_ollama(_RECIPE_SCHEMA_PROMPT + chunk)
                all_parsed.extend(_collect_parsed(raw))
            except Exception as exc:
                logger.warning("Pasted-text chunk parse failed: %s", exc)
        if not all_parsed:
            # Distinct from the generic "no recipes found" below: with pasted
            # text the likely cause is the local model being unreachable, and
            # sending someone to check their paste instead of their Ollama
            # daemon wastes their time.
            raise HTTPException(
                status_code=502,
                detail=(
                    "Could not read a recipe from that text. If the local AI "
                    "model is not running, use Manual Entry instead — it needs "
                    "no model."
                ),
            )

    else:
        raise bad_request(
            "Provide a PDF file, a source_url, or raw_text to parse.")

    if not all_parsed:
        raise HTTPException(
            status_code=502,
            detail="No recipes found in source")

    # Deduplicate by normalised title across all chunks
    seen: set = set()
    unique_parsed: List[dict] = []
    for item in all_parsed:
        key = item.get("title", "").lower().strip()
        if key and key not in seen:
            seen.add(key)
            unique_parsed.append(item)

    # Duplicate check against DB
    if not force:
        titles = [item.get("title", "").strip().lower()
                  for item in unique_parsed if item.get("title")]
        if titles:
            existing = db.query(Recipe).filter(
                Recipe.household_id == hh.id,
                sqlalchemy.func.lower(Recipe.title).in_(titles)
            ).first()
            if existing:
                raise conflict(
                    f"Recipe '{existing.title}' already exists in your library.")

    saved: List[Recipe] = []
    try:
        for item in unique_parsed:
            ingredients = item.get("ingredients", [])
            blacklisted = _flag_blacklist(db, hh.id, ingredients)
            try:
                meal = MealType(item.get("meal_type", "Other"))
            except ValueError:
                meal = MealType.OTHER

            title = item.get("title", "Untitled Recipe")
            protein = item.get("primary_protein") or _detect_protein(
                title, ingredients)
            r = Recipe(
                household_id=hh.id,
                title=title,
                meal_type=meal,
                primary_protein=protein,
                servings=_parse_yield(item.get("servings", 4)),
                image_url=item.get("image_url"),
                source_url=actual_url,
                source_type=src_type,
                ingredients_json=json.dumps(ingredients),
                steps_json=json.dumps(item.get("steps", [])),
                equipment_needed_json=json.dumps(
                    item.get("equipment_needed", [])),
                blacklisted_json=json.dumps(blacklisted),
            )
            db.add(r)
            db.flush()
            saved.append(r)

        db.commit()
    except Exception as exc:
        db.rollback()
        logger.error("Failed to save ingested recipes: %s", exc, exc_info=True)
        raise api_error(
            f"Database error while saving recipes: {exc}",
            exc,
            logger)
    for r in saved:
        db.refresh(r)
        await _sync_recipe_to_vault(uid, r)
        await _ws_manager.broadcast(hh.id, "recipe_created", _recipe_out(r))

    return {"count": len(saved), "recipes": [_recipe_out(r) for r in saved]}


# ---------------------------------------------------------------------------
# The Adjuster — Yield Scaling
# ---------------------------------------------------------------------------

@router.post("/recipes/{recipe_id}/scale")
async def scale_recipe(
    recipe_id: str,
    body: ScaleRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    r = db.query(Recipe).filter_by(id=recipe_id, household_id=hh.id).first()
    if not r:
        raise not_found("Recipe not found")

    orig_servings = r.servings or 1
    scale_factor = body.target_servings / orig_servings

    ingredients = json.loads(r.ingredients_json or "[]")
    scaled = []
    for ing in ingredients:
        raw_qty_str = str(ing.get("qty", "")).strip()
        unit = str(ing.get("unit", "")).strip()

        # 1. Parse and Scale
        f_qty = _parse_qty(raw_qty_str)
        if f_qty > 0:
            new_qty = f_qty * scale_factor
            new_unit = unit

            # 2. Convert if system preference set
            u_lower = unit.lower()
            if body.prefer_system == "imperial" and u_lower in _METRIC_TO_IMPERIAL:
                new_unit, ratio = _METRIC_TO_IMPERIAL[u_lower]
                new_qty *= ratio
            elif body.prefer_system == "metric" and u_lower in _IMPERIAL_TO_METRIC:
                new_unit, ratio = _IMPERIAL_TO_METRIC[u_lower]
                new_qty *= ratio

            formatted_qty = _format_qty(new_qty)
            scaled.append({**ing, "qty": formatted_qty, "unit": new_unit})
        else:
            # Non-numeric qty (e.g. "a pinch")
            scaled.append({**ing})

    return {
        "recipe_id": recipe_id,
        "original_servings": orig_servings,
        "target_servings": body.target_servings,
        "scale_factor": round(scale_factor, 3),
        "prefer_system": body.prefer_system,
        "scaled_ingredients": scaled,
    }


# ---------------------------------------------------------------------------
# Equipment Translator
# ---------------------------------------------------------------------------

@router.post("/recipes/{recipe_id}/translate-equipment")
async def translate_equipment(
    recipe_id: str,
    body: EquipmentTranslateRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    r = db.query(Recipe).filter_by(id=recipe_id, household_id=hh.id).first()
    if not r:
        raise not_found("Recipe not found")

    steps = json.loads(r.steps_json or "[]")
    prompt = _EQUIPMENT_TRANSLATE_PROMPT.format(
        equipment=body.equipment,
        steps=json.dumps(steps, indent=2),
    )
    try:
        ollama_response = await _call_ollama(prompt)
        new_steps = _extract_json(ollama_response)
        if not isinstance(new_steps, list):
            new_steps = steps
    except Exception as exc:
        logger.error("Equipment translation failed: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=502,
            detail="Equipment translation failed. Please try again.")

    return {
        "recipe_id": recipe_id,
        "equipment": body.equipment,
        "rewritten_steps": new_steps,
    }


# ---------------------------------------------------------------------------
# Stockroom
# ---------------------------------------------------------------------------

@router.get("/stockroom")
async def list_stockroom(request: Request, db: Session = Depends(get_db)):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    items = db.query(StockroomItem).filter_by(household_id=hh.id).all()
    return [_stock_out(i) for i in items]


@router.post("/stockroom", status_code=status.HTTP_201_CREATED)
async def add_stockroom_item(
    body: StockroomItemCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    try:
        state = StockState(body.state)
    except ValueError:
        state = StockState.GOOD
    item = StockroomItem(
        household_id=hh.id,
        name=body.name,
        barcode=body.barcode,
        brand=body.brand,
        state=state,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    await _ws_manager.broadcast(hh.id, "stockroom_updated", _stock_out(item))
    return _stock_out(item)


@router.get("/stockroom/{item_id}")
async def get_stockroom_item(
        item_id: str, request: Request, db: Session = Depends(get_db)):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    item = db.query(StockroomItem).filter_by(
        id=item_id, household_id=hh.id).first()
    if not item:
        raise not_found("Item not found")
    return _stock_out(item)


@router.put("/stockroom/{item_id}")
async def update_stockroom_item(
    item_id: str,
    body: StockroomItemUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    item = db.query(StockroomItem).filter_by(
        id=item_id, household_id=hh.id).first()
    if not item:
        raise not_found("Item not found")
    if body.name is not None:
        item.name = body.name
    if body.brand is not None:
        item.brand = body.brand
    if body.state is not None:
        try:
            item.state = StockState(body.state)
        except ValueError:
            pass
    if body.quantity is not None:
        item.quantity = body.quantity
    if body.min_quantity is not None:
        item.min_quantity = body.min_quantity

    # Auto-inject into grocery list if LOW
    if item.state == StockState.LOW or item.quantity <= item.min_quantity:
        existing_list_item = db.query(ShoppingListItem).filter_by(
            household_id=hh.id, name=item.name, checked_at=None
        ).first()
        if not existing_list_item:
            sl_item = ShoppingListItem(
                household_id=hh.id,
                name=item.name,
                category="grocery",
                source=ListSource.STOCKROOM_AUTO,
                added_by=uid
            )
            db.add(sl_item)

    db.commit()
    db.refresh(item)
    await _ws_manager.broadcast(hh.id, "stockroom_updated", _stock_out(item))
    await _ws_manager.broadcast(hh.id, "grocery_updated", {})
    return _stock_out(item)


@router.delete("/stockroom/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_stockroom_item(
        item_id: str, request: Request, db: Session = Depends(get_db)):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    item = db.query(StockroomItem).filter_by(
        id=item_id, household_id=hh.id).first()
    if not item:
        raise not_found("Item not found")
    db.delete(item)
    db.commit()
    await _ws_manager.broadcast(hh.id, "stockroom_updated", {"deleted_id": item_id})


@router.post("/stockroom/scan")
async def scan_barcode(
    body: ScanRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Scan a barcode: look up Open Food Facts, set state to Good, upsert."""
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)

    product = await _lookup_barcode(body.barcode)
    if not product:
        product = {"name": body.barcode, "brand": ""}

    existing = db.query(StockroomItem).filter_by(
        household_id=hh.id, barcode=body.barcode
    ).first()

    if existing:
        existing.quantity += body.quantity
        existing.state = StockState.GOOD if existing.quantity > 0.25 else StockState.LOW
        existing.name = product["name"] if product["name"] != body.barcode else existing.name
        existing.brand = product["brand"] or existing.brand
        db.commit()
        db.refresh(existing)
        out = _stock_out(existing)
    else:
        item = StockroomItem(
            household_id=hh.id,
            name=product["name"],
            brand=product.get("brand", ""),
            barcode=body.barcode,
            quantity=body.quantity,
            state=StockState.GOOD if body.quantity > 0.25 else StockState.LOW,
        )
        db.add(item)
        db.commit()
        db.refresh(item)
        out = _stock_out(item)
        existing = item

    if existing.state == StockState.LOW or existing.quantity <= existing.min_quantity:
        existing_list_item = db.query(ShoppingListItem).filter_by(
            household_id=hh.id, name=existing.name, checked_at=None
        ).first()
        if not existing_list_item:
            sl_item = ShoppingListItem(
                household_id=hh.id,
                name=existing.name,
                category="grocery",
                source=ListSource.STOCKROOM_AUTO,
                added_by=uid
            )
            db.add(sl_item)
            db.commit()

    await _ws_manager.broadcast(hh.id, "stockroom_updated", out)
    await _ws_manager.broadcast(hh.id, "grocery_updated", {})
    return out


@router.post("/stockroom/deplete")
async def deplete_item(
    body: ScanRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Trash-can scan: mark item Low → auto-injects into grocery list."""
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)

    item = db.query(StockroomItem).filter_by(
        household_id=hh.id, barcode=body.barcode
    ).first()
    if not item:
        product = await _lookup_barcode(body.barcode)
        if not product:
            product = {"name": f"UPC: {body.barcode}", "brand": ""}
        item = StockroomItem(
            household_id=hh.id,
            name=product["name"],
            brand=product.get("brand", ""),
            barcode=body.barcode,
            quantity=0,
            state=StockState.LOW,
        )
        db.add(item)
    else:
        item.quantity = max(0, item.quantity - body.quantity)
        item.state = StockState.GOOD if item.quantity > 0.25 else StockState.LOW

    # Auto-inject into grocery list if LOW
    if item.state == StockState.LOW or item.quantity <= item.min_quantity:
        existing_list_item = db.query(ShoppingListItem).filter_by(
            household_id=hh.id, name=item.name, checked_at=None
        ).first()
        if not existing_list_item:
            sl_item = ShoppingListItem(
                household_id=hh.id,
                name=item.name,
                category="grocery",
                source=ListSource.STOCKROOM_AUTO,
                added_by=uid
            )
            db.add(sl_item)
            # We don't await here directly but we commit at the end

    db.commit()

    db.refresh(item)
    out = _stock_out(item)
    await _ws_manager.broadcast(hh.id, "stockroom_updated", out)
    await _ws_manager.broadcast(hh.id, "grocery_updated", {})
    return out


# ---------------------------------------------------------------------------
# Prep Deck
# ---------------------------------------------------------------------------

@router.get("/prep")
async def get_active_prep(request: Request, db: Session = Depends(get_db)):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    session = db.query(PrepSession).filter_by(
        household_id=hh.id, is_active=True).first()
    if not session:
        raise not_found("No active prep session")
    return _session_out(session)


@router.post("/prep", status_code=status.HTTP_201_CREATED)
async def create_prep_session(
    body: PrepSessionCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    # Deactivate any existing active session
    old = db.query(PrepSession).filter_by(
        household_id=hh.id, is_active=True).first()
    if old:
        old.is_active = False
    session = PrepSession(
        household_id=hh.id,
        label=body.label,
        target_containers=body.target_containers,
        container_oz=body.container_oz,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    out = _session_out(session)
    await _ws_manager.broadcast(hh.id, "prep_updated", out)
    return out


@router.post("/prep/{session_id}/add-recipe")
async def add_recipe_to_prep(
    session_id: str,
    body: AddRecipeToPrep,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    session = db.query(PrepSession).filter_by(
        id=session_id, household_id=hh.id).first()
    if not session:
        raise not_found("Prep session not found")
    recipe = db.query(Recipe).filter_by(
        id=body.recipe_id, household_id=hh.id).first()
    if not recipe:
        raise not_found("Recipe not found")
    entry = PrepSessionRecipe(
        session_id=session_id,
        recipe_id=body.recipe_id,
        servings_target=body.servings_target,
    )
    db.add(entry)
    db.commit()
    db.refresh(session)
    out = _session_out(session)
    await _ws_manager.broadcast(hh.id, "prep_updated", out)
    return out


@router.put("/prep/{session_id}/recipes/{entry_id}/scale")
async def update_prep_recipe_scale(
    session_id: str,
    entry_id: str,
    body: PrepRecipeScaleUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    session = db.query(PrepSession).filter_by(
        id=session_id, household_id=hh.id).first()
    if not session:
        raise not_found("Prep session not found")

    entry = db.query(PrepSessionRecipe).filter_by(
        id=entry_id, session_id=session_id).first()
    if not entry:
        raise not_found("Recipe entry not found in session")

    entry.servings_target = body.target_servings
    entry.scaled_ingredients_json = json.dumps(body.scaled_ingredients)

    db.commit()
    db.refresh(session)
    out = _session_out(session)
    await _ws_manager.broadcast(hh.id, "prep_updated", out)
    return out


@router.delete("/prep/{session_id}/recipes/{entry_id}",
               status_code=status.HTTP_204_NO_CONTENT)
async def remove_recipe_from_prep(
    session_id: str,
    entry_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    entry = db.query(PrepSessionRecipe).filter_by(
        id=entry_id, session_id=session_id).first()
    if not entry:
        raise not_found("Entry not found")
    db.delete(entry)
    db.commit()
    session = db.query(PrepSession).filter_by(
        id=session_id, household_id=hh.id).first()
    if session:
        await _ws_manager.broadcast(hh.id, "prep_updated", _session_out(session))


def _aggregate_prep_list(db: Session, hh: Household, session) -> List[dict]:
    """Deduplicated ingredients for one prep session, minus what is in stock.

    Split out of the route because pushing the same list onto the household's
    standing shopping list has to agree with what the prep screen showed --
    two copies of this arithmetic would drift.
    """
    # Build set of Good stockroom items (normalized lowercase)
    good_stock = {
        s.name.lower().strip()
        for s in db.query(StockroomItem).filter_by(household_id=hh.id).all()
        if s.state == StockState.GOOD
    }

    # Aggregate ingredients across all recipes
    # Key is (name, unit) to keep incompatible units separate
    aggregated: Dict[tuple, dict] = {}
    for entry in session.recipes:
        ingredients_json = entry.scaled_ingredients_json or (
            entry.recipe.ingredients_json if entry.recipe else "[]"
        )
        try:
            ingredients = json.loads(ingredients_json)
        except (json.JSONDecodeError, TypeError):
            continue
        for ing in ingredients:
            name_key = ing.get("name", "").lower().strip()
            if name_key in good_stock:
                continue
            unit = str(ing.get("unit", "")).lower().strip()
            agg_key = (name_key, unit)
            if agg_key in aggregated:
                try:
                    aggregated[agg_key]["qty"] = _format_qty(
                        _parse_qty(str(aggregated[agg_key]["qty"]))
                        + _parse_qty(str(ing.get("qty", 0)))
                    )
                except (ValueError, TypeError):
                    pass
            else:
                aggregated[agg_key] = {
                    "name": ing.get("name", ""),
                    "qty": ing.get("qty", ""),
                    "unit": ing.get("unit", ""),
                }

    # Inject any Low stockroom items
    low_items = db.query(StockroomItem).filter_by(household_id=hh.id).all()
    for item in low_items:
        if item.state == StockState.LOW:
            name_key = item.name.lower().strip()
            unit = ""
            agg_key = (name_key, unit)
            if agg_key not in aggregated:
                aggregated[agg_key] = {
                    "name": item.name,
                    "qty": "",
                    "unit": "",
                    "_from_stockroom": True}

    return list(aggregated.values())


@router.get("/prep/{session_id}/shopping-list")
async def get_shopping_list(
        session_id: str, request: Request, db: Session = Depends(get_db)):
    """
    Aggregate + deduplicate all ingredients across the session's staged
    recipes. Cross-reference Stockroom — anything marked Good is omitted.

    This is the list for one prep session, not the household's standing
    shopping list; that one lives at /grocery. POST .../shopping-list/push
    copies this onto it.
    """
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    session = db.query(PrepSession).filter_by(
        id=session_id, household_id=hh.id).first()
    if not session:
        raise not_found("Prep session not found")

    return {"session_id": session_id,
            "shopping_list": _aggregate_prep_list(db, hh, session)}


@router.post("/prep/{session_id}/shopping-list/push")
async def push_prep_list_to_grocery(
        session_id: str, request: Request, db: Session = Depends(get_db)):
    """Copy a prep session's ingredients onto the household shopping list.

    Names already sitting unchecked on the list are skipped rather than
    duplicated -- someone else may have added them by voice, and the point of
    a shared list is that it reads as one list.
    """
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    session = db.query(PrepSession).filter_by(
        id=session_id, household_id=hh.id).first()
    if not session:
        raise not_found("Prep session not found")

    # Build set of existing unchecked items (normalized name+unit)
    existing = {
        (i.name.lower().strip(), (i.unit or "").lower().strip())
        for i in db.query(ShoppingListItem).filter(
            ShoppingListItem.household_id == hh.id,
            ShoppingListItem.checked_at.is_(None),
        ).all()
    }

    added = 0
    for ing in _aggregate_prep_list(db, hh, session):
        name = (ing.get("name") or "").strip()
        unit = str(ing.get("unit") or "").strip()
        if not name:
            continue

        # Check if this name+unit combo already exists unchecked
        norm_key = (name.lower(), unit.lower())
        if norm_key in existing:
            continue

        # Atomic insert - if concurrent request adds the same item, skip via unique constraint
        try:
            db.add(ShoppingListItem(
                household_id=hh.id,
                name=name,
                qty=str(ing.get("qty") or "") or None,
                unit=unit or None,
                category="grocery",
                source=ListSource.PREP,
                source_ref=session_id,
                added_by=uid,
            ))
            db.flush()  # Force constraint check before commit
            existing.add(norm_key)
            added += 1
        except Exception:
            # Concurrent insert won - skip this item
            db.rollback()
            continue

    if added:
        db.commit()
        await _ws_manager.broadcast(hh.id, "grocery_updated", {})
    return {"status": "ok", "added": added, "skipped_existing": True}


@router.get("/prep/{session_id}/staging")
async def get_staging_area(
        session_id: str, request: Request, db: Session = Depends(get_db)):
    """Shopping list split back into per-recipe piles.

    No longer used by the web UI: the same split is in the cook plan, where
    each pile can be ticked off as it reaches the counter, and having it in
    two places meant two screens showing the same ingredients. Kept because it
    is the only version that marks what is already in the stockroom, and other
    clients read it.
    """
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    session = db.query(PrepSession).filter_by(
        id=session_id, household_id=hh.id).first()
    if not session:
        raise not_found("Prep session not found")

    good_stock = {
        s.name.lower().strip()
        for s in db.query(StockroomItem).filter_by(household_id=hh.id).all()
        if s.state == StockState.GOOD
    }

    piles = []
    for entry in session.recipes:
        if not entry.recipe:
            continue
        ings_json = entry.scaled_ingredients_json or entry.recipe.ingredients_json or "[]"
        ingredients = [
            ing for ing in json.loads(ings_json)
            if ing.get("name", "").lower().strip() not in good_stock
        ]
        piles.append({
            "recipe_id": entry.recipe_id,
            "recipe_title": entry.recipe.title,
            "ingredients": ingredients,
        })

    return {"session_id": session_id, "piles": piles}


@router.post("/prep/{session_id}/complete", status_code=status.HTTP_200_OK)
async def complete_prep_session(
    session_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    session = db.query(PrepSession).filter_by(
        id=session_id, household_id=hh.id).first()
    if not session:
        raise not_found("Prep session not found")
    session.is_active = False

    # Mark corresponding meal plan entries as cooked
    recipe_ids = [r.recipe_id for r in session.recipes if r.recipe_id]
    if recipe_ids:
        today = _now().replace(hour=0, minute=0, second=0, microsecond=0)
        entries = db.query(MealPlanEntry).filter(
            MealPlanEntry.household_id == hh.id,
            MealPlanEntry.plan_date >= today,
            MealPlanEntry.status == "planned",
            MealPlanEntry.recipe_id.in_(recipe_ids)
        ).all()
        for entry in entries:
            entry.status = "cooked"

    await _ws_manager.broadcast(hh.id, "meal_plan_updated", {})
    session.completed_at = datetime.now(timezone.utc)
    db.commit()
    await _ws_manager.broadcast(hh.id, "prep_completed", {"session_id": session_id})
    return {"session_id": session_id, "completed": True}


# ---------------------------------------------------------------------------
# Multi-Store Item Mappings & Cart Export
# ---------------------------------------------------------------------------

def _normalize_store_name(store: Optional[str]) -> str:
    if not store:
        return "walmart"
    s = store.strip().lower()
    if "walmart" in s:
        return "walmart"
    if "amazon" in s:
        return "amazon"
    if "target" in s:
        return "target"
    if "costco" in s:
        return "costco"
    if "kroger" in s:
        return "kroger"
    if "trader" in s:
        return "trader_joes"
    if "aldi" in s:
        return "aldi"
    if "home depot" in s or "homedepot" in s:
        return "homedepot"
    return s.replace(" ", "_")


def _extract_store_item_id(store: str, raw_id_or_url: str) -> str:
    norm_store = _normalize_store_name(store)
    val = raw_id_or_url.strip()
    if norm_store == "walmart":
        if "walmart.com" in val:
            match = re.search(r"/(\d+)(\?|$)", val)
            if match:
                return match.group(1)
        if re.match(r"^\d+$", val):
            return val
    elif norm_store == "amazon":
        if "amazon.com" in val:
            match = re.search(r"/(?:dp|gp/product)/([A-Z0-9]{10})", val, re.IGNORECASE)
            if match:
                return match.group(1).upper()
        if re.match(r"^[A-Z0-9]{10}$", val, re.IGNORECASE):
            return val.upper()
    elif norm_store == "target":
        if "target.com" in val:
            match = re.search(r"/A-(\d+)", val)
            if match:
                return match.group(1)
    return val


class StoreMappingCreate(BaseModel):
    ingredient_name: str
    store: Optional[str] = "walmart"
    store_item_id: str
    notes: Optional[str] = None


@router.get("/store/mappings")
async def list_store_mappings(
    request: Request,
    store: Optional[str] = None,
    db: Session = Depends(get_db)
):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    q = db.query(StoreMapping).filter_by(household_id=hh.id)
    if store and store.lower() not in ("all", ""):
        q = q.filter_by(store=_normalize_store_name(store))
    mappings = q.all()
    return [
        {
            "id": m.id,
            "ingredient_name": m.ingredient_name,
            "store": m.store,
            "store_item_id": m.store_item_id,
            "notes": m.notes,
            "created_at": m.created_at.isoformat() if m.created_at else None
        }
        for m in mappings
    ]


@router.post("/store/mappings", status_code=status.HTTP_201_CREATED)
async def create_store_mapping(
    body: StoreMappingCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    name_norm = body.ingredient_name.lower().strip()
    norm_store = _normalize_store_name(body.store)
    clean_item_id = _extract_store_item_id(norm_store, body.store_item_id)
    if not clean_item_id:
        raise bad_request("Invalid Store Item ID or URL.")

    existing = db.query(StoreMapping).filter_by(
        household_id=hh.id, ingredient_name=name_norm, store=norm_store).first()
    if existing:
        existing.store_item_id = clean_item_id
        if body.notes is not None:
            existing.notes = body.notes
        db.commit()
        if norm_store == "walmart":
            w_existing = db.query(WalmartMapping).filter_by(household_id=hh.id, ingredient_name=name_norm).first()
            if w_existing:
                w_existing.walmart_item_id = clean_item_id
                db.commit()
        return {"id": existing.id, "ingredient_name": existing.ingredient_name,
                "store": existing.store, "store_item_id": existing.store_item_id, "notes": existing.notes}

    m = StoreMapping(
        household_id=hh.id,
        ingredient_name=name_norm,
        store=norm_store,
        store_item_id=clean_item_id,
        notes=body.notes,
    )
    db.add(m)
    if norm_store == "walmart":
        w_existing = db.query(WalmartMapping).filter_by(household_id=hh.id, ingredient_name=name_norm).first()
        if not w_existing:
            db.add(WalmartMapping(household_id=hh.id, ingredient_name=name_norm, walmart_item_id=clean_item_id))
    db.commit()
    db.refresh(m)
    return {"id": m.id, "ingredient_name": m.ingredient_name,
            "store": m.store, "store_item_id": m.store_item_id, "notes": m.notes}


@router.delete("/store/mappings/{mapping_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_store_mapping(
    mapping_id: str, request: Request, db: Session = Depends(get_db)
):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    m = db.query(StoreMapping).filter_by(id=mapping_id, household_id=hh.id).first()
    if not m:
        raise not_found("Mapping not found")
    db.delete(m)
    db.commit()


@router.post("/store/export")
async def store_export(
    request: Request,
    db: Session = Depends(get_db),
    store: Optional[str] = "walmart",
    session_id: Optional[str] = None,
    source: str = "list",
):
    import urllib.parse
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    norm_store = _normalize_store_name(store)

    all_ingredients: List[dict] = []
    if source == "list":
        q = db.query(ShoppingListItem).filter(
            ShoppingListItem.household_id == hh.id,
            ShoppingListItem.checked_at.is_(None),
        )
        if store and store.lower() != "all":
            for item in q.all():
                item_store = _normalize_store_name(item.store) if item.store else None
                if item_store is None or item_store == norm_store:
                    all_ingredients.append({"name": item.name, "qty": item.qty or 1, "unit": item.unit, "store": item.store, "store_item_id": item.store_item_id})
        else:
            for item in q.all():
                all_ingredients.append({"name": item.name, "qty": item.qty or 1, "unit": item.unit, "store": item.store, "store_item_id": item.store_item_id})
    else:
        if session_id:
            session = db.query(PrepSession).filter_by(id=session_id, household_id=hh.id).first()
        else:
            session = db.query(PrepSession).filter_by(household_id=hh.id, is_active=True).first()
        if not session:
            raise not_found("No prep session found")

        good_stock = {
            s.name.lower().strip()
            for s in db.query(StockroomItem).filter_by(household_id=hh.id).all()
            if s.state == StockState.GOOD
        }
        for entry in session.recipes:
            ings_json = entry.scaled_ingredients_json or (
                entry.recipe.ingredients_json if entry.recipe else "[]"
            )
            for ing in json.loads(ings_json):
                if ing.get("name", "").lower().strip() not in good_stock:
                    all_ingredients.append(ing)

    # Load store mappings
    mappings = {
        m.ingredient_name: m.store_item_id
        for m in db.query(StoreMapping).filter_by(household_id=hh.id, store=norm_store).all()
    }
    if norm_store == "walmart":
        for wm in db.query(WalmartMapping).filter_by(household_id=hh.id).all():
            if wm.ingredient_name not in mappings:
                mappings[wm.ingredient_name] = wm.walmart_item_id

    mapped_items = []
    unmapped = []
    search_links = []
    seen = set()

    for ing in all_ingredients:
        name_key = ing.get("name", "").lower().strip()
        if name_key in seen:
            continue
        seen.add(name_key)
        item_id = ing.get("store_item_id") or mappings.get(name_key)
        try:
            qty = max(1, int(_parse_qty(str(ing.get("qty", 1)))))
        except (ValueError, TypeError):
            qty = 1

        if item_id:
            mapped_items.append({"name": ing.get("name", name_key), "id": item_id, "qty": qty})
        else:
            unmapped.append(ing.get("name", name_key))

        encoded_name = urllib.parse.quote_plus(ing.get("name", name_key))
        if norm_store == "walmart":
            search_url = f"https://www.walmart.com/search?q={encoded_name}"
        elif norm_store == "amazon":
            search_url = f"https://www.amazon.com/s?k={encoded_name}"
        elif norm_store == "target":
            search_url = f"https://www.target.com/s?searchTerm={encoded_name}"
        elif norm_store == "costco":
            search_url = f"https://www.costco.com/CatalogSearch?dept=All&keyword={encoded_name}"
        elif norm_store == "kroger":
            search_url = f"https://www.kroger.com/search?query={encoded_name}"
        elif norm_store == "trader_joes":
            search_url = f"https://www.traderjoes.com/home/search?q={encoded_name}"
        elif norm_store == "aldi":
            search_url = f"https://www.aldi.us/results/?q={encoded_name}"
        elif norm_store == "homedepot":
            search_url = f"https://www.homedepot.com/s/{encoded_name}"
        else:
            search_url = f"https://www.google.com/search?q={encoded_name}+{norm_store}"

        search_links.append({"name": ing.get("name", name_key), "url": search_url, "mapped": bool(item_id)})

    cart_url = None
    if mapped_items:
        if norm_store == "walmart":
            cart_url = "https://www.walmart.com/sc/cart/addToCart?items=" + ",".join([f"{it['id']}_{it['qty']}" for it in mapped_items])
        elif norm_store == "amazon":
            params = [f"ASIN.{idx}={it['id']}&Quantity.{idx}={it['qty']}" for idx, it in enumerate(mapped_items, start=1)]
            cart_url = "https://www.amazon.com/gp/aws/cart/add.html?" + "&".join(params)

    return {
        "store": norm_store,
        "cart_url": cart_url,
        "mapped_count": len(mapped_items),
        "unmapped": unmapped,
        "search_links": search_links,
    }


# Backwards-compatible Walmart endpoints
@router.get("/walmart/mappings")
async def list_walmart_mappings(request: Request, db: Session = Depends(get_db)):
    return await list_store_mappings(request=request, store="walmart", db=db)

@router.post("/walmart/mappings", status_code=status.HTTP_201_CREATED)
async def create_walmart_mapping(body: WalmartMappingCreate, request: Request, db: Session = Depends(get_db)):
    return await create_store_mapping(body=StoreMappingCreate(ingredient_name=body.ingredient_name, store="walmart", store_item_id=body.walmart_item_id), request=request, db=db)

@router.delete("/walmart/mappings/{mapping_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_walmart_mapping(mapping_id: str, request: Request, db: Session = Depends(get_db)):
    return await delete_store_mapping(mapping_id=mapping_id, request=request, db=db)

@router.post("/walmart/export")
async def walmart_export(request: Request, db: Session = Depends(get_db), session_id: Optional[str] = None, source: str = "prep"):
    return await store_export(request=request, db=db, store="walmart", session_id=session_id, source=source)


# ---------------------------------------------------------------------------
# Grocery Shopping List Endpoints
# ---------------------------------------------------------------------------

from pydantic import BaseModel
from typing import List, Optional

class ShoppingItemCreate(BaseModel):
    name: str
    qty: Optional[str] = None
    unit: Optional[str] = None
    category: Optional[str] = "grocery"
    store: Optional[str] = None
    store_item_id: Optional[str] = None

class ShoppingItemUpdate(BaseModel):
    name: Optional[str] = None
    qty: Optional[str] = None
    unit: Optional[str] = None
    category: Optional[str] = None
    checked: Optional[bool] = None
    store: Optional[str] = None
    store_item_id: Optional[str] = None


async def _display_names(request: Request, user_ids) -> Dict[str, str]:
    wanted = {u for u in user_ids if u}
    if not wanted:
        return {}
    try:
        store = request.app.state.memory_manager._store
    except AttributeError:
        return {}
    names: Dict[str, str] = {}
    for uid in wanted:
        try:
            user = await store.get_user_by_id(uid)
        except Exception:
            continue
        if user and user.get("display_name"):
            names[uid] = user["display_name"]
    return names


@router.get("/grocery/stores")
async def get_grocery_stores(request: Request, db: Session = Depends(get_db)):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)

    rows = db.query(ShoppingListItem.store).filter(
        ShoppingListItem.household_id == hh.id,
        ShoppingListItem.store.isnot(None),
        ShoppingListItem.store != ""
    ).distinct().all()
    used_stores = [r[0] for r in rows if r[0]]
    defaults = ["Walmart", "Target", "Costco", "Amazon", "Trader Joe's", "Kroger", "Aldi", "Home Depot"]
    combined = list(dict.fromkeys(used_stores + defaults))
    return combined


@router.get("/grocery")
async def get_grocery_list(
    request: Request,
    store: Optional[str] = None,
    db: Session = Depends(get_db)
):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)

    q = db.query(ShoppingListItem).filter(
        ShoppingListItem.household_id == hh.id
    )
    if store and store.lower() not in ("all", ""):
        q = q.filter(ShoppingListItem.store.ilike(f"%{store.strip()}%"))

    items = q.order_by(
        ShoppingListItem.checked_at.is_(None).desc(),
        ShoppingListItem.created_at.desc()
    ).all()

    names = await _display_names(request, (i.added_by for i in items))

    return [
        {
            "id": i.id,
            "name": i.name,
            "qty": i.qty,
            "unit": i.unit,
            "category": i.category,
            "store": i.store,
            "store_item_id": i.store_item_id,
            "source": i.source.value if i.source else "manual",
            "added_by": i.added_by,
            "added_by_name": names.get(i.added_by),
            "is_mine": i.added_by == uid,
            "created_at": i.created_at.isoformat() if i.created_at else None,
            "checked": bool(i.checked_at)
        }
        for i in items
    ]


@router.post("/grocery")
async def add_shopping_item(
    body: ShoppingItemCreate,
    request: Request,
    db: Session = Depends(get_db)
):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)

    resolved_store = body.store.strip() if body.store else None
    resolved_store_item_id = body.store_item_id.strip() if body.store_item_id else None

    # Auto-resolve store and store_item_id if omitted
    if not resolved_store or not resolved_store_item_id:
        mapping = db.query(StoreMapping).filter_by(
            household_id=hh.id,
            ingredient_name=body.name.lower().strip()
        ).first()
        if mapping:
            if not resolved_store and mapping.store:
                resolved_store = mapping.store.title()
            if not resolved_store_item_id and mapping.store_item_id:
                resolved_store_item_id = mapping.store_item_id

    item = ShoppingListItem(
        household_id=hh.id,
        name=body.name,
        qty=body.qty,
        unit=body.unit,
        category=body.category or "grocery",
        store=resolved_store,
        store_item_id=resolved_store_item_id,
        source=ListSource.MANUAL,
        added_by=uid
    )
    db.add(item)
    db.commit()

    await _ws_manager.broadcast(hh.id, "grocery_updated", {})
    return {"status": "ok", "id": item.id, "store": item.store}


@router.patch("/grocery/{item_id}")
async def update_shopping_item(
    item_id: str,
    body: ShoppingItemUpdate,
    request: Request,
    db: Session = Depends(get_db)
):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)

    item = db.query(ShoppingListItem).filter_by(id=item_id, household_id=hh.id).first()
    if not item:
        raise not_found("Item not found")

    if body.name is not None:
        item.name = body.name
    if body.qty is not None:
        item.qty = body.qty
    if body.unit is not None:
        item.unit = body.unit
    if body.category is not None:
        item.category = body.category
    if body.store is not None:
        item.store = body.store.strip() if body.store else None
    if body.store_item_id is not None:
        item.store_item_id = body.store_item_id.strip() if body.store_item_id else None
    if body.checked is not None:
        if body.checked and not item.checked_at:
            item.checked_at = _now()
        elif not body.checked and item.checked_at:
            item.checked_at = None

    db.commit()
    await _ws_manager.broadcast(hh.id, "grocery_updated", {})
    return {"status": "ok"}


@router.delete("/grocery/{item_id}")
async def delete_shopping_item(
    item_id: str,
    request: Request,
    db: Session = Depends(get_db)
):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)

    item = db.query(ShoppingListItem).filter_by(id=item_id, household_id=hh.id).first()
    if item:
        db.delete(item)
        db.commit()
        await _ws_manager.broadcast(hh.id, "grocery_updated", {})
    return {"status": "ok"}


@router.post("/grocery/clear")
async def clear_checked_items(
    request: Request,
    db: Session = Depends(get_db)
):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)

    items = db.query(ShoppingListItem).filter(
        ShoppingListItem.household_id == hh.id,
        ShoppingListItem.checked_at.isnot(None)
    ).all()

    for item in items:
        db.delete(item)

    db.commit()
    await _ws_manager.broadcast(hh.id, "grocery_updated", {})
    return {"status": "ok", "cleared": len(items)}

class MealPlanEntryCreate(BaseModel):
    plan_date: str
    slot: str
    recipe_id: Optional[str] = None
    label: Optional[str] = None
    status: Optional[str] = "planned"

@router.get("/meal-plan")
async def get_meal_plan(start: str, request: Request, db: Session = Depends(get_db)):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    
    start_dt = datetime.fromisoformat(start).replace(hour=0, minute=0, second=0, microsecond=0)
    items = db.query(MealPlanEntry).filter(
        MealPlanEntry.household_id == hh.id,
        MealPlanEntry.plan_date >= start_dt
    ).all()
    
    return [
        {
            "id": i.id,
            "plan_date": i.plan_date.isoformat(),
            "slot": i.slot.value,
            "recipe_id": i.recipe_id,
            "recipe_title": i.recipe.title if i.recipe else None,
            "label": i.label,
            "status": i.status
        }
        for i in items
    ]

@router.post("/meal-plan")
async def create_meal_plan(body: MealPlanEntryCreate, request: Request, db: Session = Depends(get_db)):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    
    plan_dt = datetime.fromisoformat(body.plan_date).replace(hour=0, minute=0, second=0, microsecond=0)
    
    entry = MealPlanEntry(
        household_id=hh.id,
        plan_date=plan_dt,
        slot=MealType(body.slot),
        recipe_id=body.recipe_id,
        label=body.label,
        status=body.status or "planned",
        created_by=uid
    )
    db.add(entry)
    db.commit()
    await _ws_manager.broadcast(hh.id, "meal_plan_updated", {})
    return {"status": "ok", "id": entry.id}

@router.patch("/meal-plan/{entry_id}")
async def update_meal_plan(entry_id: str, body: dict, request: Request, db: Session = Depends(get_db)):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    
    entry = db.query(MealPlanEntry).filter_by(id=entry_id, household_id=hh.id).first()
    if not entry:
        raise not_found("Entry not found")
        
    if "status" in body:
        entry.status = body["status"]
    if "label" in body:
        entry.label = body["label"]
        
    db.commit()
    await _ws_manager.broadcast(hh.id, "meal_plan_updated", {})
    return {"status": "ok"}

@router.delete("/meal-plan/{entry_id}")
async def delete_meal_plan(entry_id: str, request: Request, db: Session = Depends(get_db)):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    
    entry = db.query(MealPlanEntry).filter_by(id=entry_id, household_id=hh.id).first()
    if entry:
        db.delete(entry)
        db.commit()
        await _ws_manager.broadcast(hh.id, "meal_plan_updated", {})
    return {"status": "ok"}


@router.post("/meal-plan/shop-this-week")
async def shop_this_week(request: Request, db: Session = Depends(get_db)):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    
    today = _now().replace(hour=0, minute=0, second=0, microsecond=0)
    entries = db.query(MealPlanEntry).filter(
        MealPlanEntry.household_id == hh.id,
        MealPlanEntry.plan_date >= today,
        MealPlanEntry.status == "planned"
    ).all()
    
    recipes_data = []
    for entry in entries:
        if entry.recipe:
            recipes_data.append({
                "ingredients_json": entry.recipe.ingredients_json
            })
            
    items_to_buy = _aggregate_ingredients(db, hh.id, recipes_data)
    
    for it in items_to_buy:
        sl_item = ShoppingListItem(
            household_id=hh.id,
            name=it["name"],
            qty=str(it.get("qty", "")),
            unit=it.get("unit", ""),
            category="grocery",
            source=ListSource.MEAL_PLAN,
            added_by=uid
        )
        db.add(sl_item)
    
    db.commit()
    await _ws_manager.broadcast(hh.id, "grocery_updated", {})
    return {"status": "ok", "items_added": len(items_to_buy)}

@router.post("/prep/{session_id}/send-to-list")
async def prep_send_to_list(session_id: str, request: Request, db: Session = Depends(get_db)):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    session = db.query(PrepSession).filter_by(id=session_id, household_id=hh.id).first()
    if not session:
        raise not_found("Prep session not found")
        
    recipes_data = []
    for entry in session.recipes:
        recipes_data.append({
            "ingredients_json": entry.scaled_ingredients_json or (entry.recipe.ingredients_json if entry.recipe else "[]")
        })
        
    items_to_buy = _aggregate_ingredients(db, hh.id, recipes_data)
    for it in items_to_buy:
        sl_item = ShoppingListItem(
            household_id=hh.id,
            name=it["name"],
            qty=str(it.get("qty", "")),
            unit=it.get("unit", ""),
            category="grocery",
            source=ListSource.PREP,
            source_ref=session_id,
            added_by=uid
        )
        db.add(sl_item)
        
    db.commit()
    await _ws_manager.broadcast(hh.id, "grocery_updated", {})
    return {"status": "ok", "items_added": len(items_to_buy)}


class MealPlanPrepRequest(BaseModel):
    entry_ids: List[str]

@router.post("/meal-plan/create-prep-session")
async def create_prep_from_plan(body: MealPlanPrepRequest, request: Request, db: Session = Depends(get_db)):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    
    entries = db.query(MealPlanEntry).filter(
        MealPlanEntry.household_id == hh.id,
        MealPlanEntry.id.in_(body.entry_ids)
    ).all()
    
    if not entries:
        raise not_found("No valid plan entries found")
        
    session = PrepSession(
        household_id=hh.id,
        created_by=uid,
        is_active=True
    )
    db.add(session)
    db.flush()
    
    # Disable any previously active session
    old_sessions = db.query(PrepSession).filter(
        PrepSession.household_id == hh.id,
        PrepSession.is_active == True,
        PrepSession.id != session.id
    ).all()
    for os in old_sessions:
        os.is_active = False
        
    for entry in entries:
        if not entry.recipe_id:
            continue
        recipe = db.query(Recipe).filter_by(id=entry.recipe_id, household_id=hh.id).first()
        if not recipe:
            continue
            
        target_servings = hh.family_size or 4
        original_servings = recipe.servings or 4
        factor = target_servings / original_servings
        
        scaled = []
        for ing in _safe_json(recipe.ingredients_json, []):
            raw_qty = _parse_qty(str(ing.get("qty", ""))) * factor
            qty_out = _format_qty(raw_qty) if raw_qty > 0 else ing.get("qty", "")
            scaled.append({"name": ing.get("name", ""), "qty": qty_out, "unit": ing.get("unit", "")})
            
        pr = PrepSessionRecipe(
            session_id=session.id,
            recipe_id=recipe.id,
            servings_target=target_servings,
            scaled_ingredients_json=json.dumps(scaled),
        )
        db.add(pr)
        
    db.commit()
    db.refresh(session)
    return {"status": "ok", "session_id": session.id}
