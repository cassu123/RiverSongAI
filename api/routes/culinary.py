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
from providers.vault.vault_provider import VaultProvider, VROOT_HOUSEHOLD, VROOT_PERSONAL
from core.family import resolve_module_owner as _resolve_module_owner

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
from pydantic import BaseModel
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
    MealType,
    PrepSession,
    PrepSessionRecipe,
    Recipe,
    SourceType,
    StockroomItem,
    StockState,
    WalmartMapping,
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


_migrate_culinary_schema()


# ---------------------------------------------------------------------------
# Hardcoded Defaults (to be migrated)
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Ollama helpers
# ---------------------------------------------------------------------------

OLLAMA_BASE = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("CULINARY_LLM_MODEL", "qwen2.5:14b")
OLLAMA_VISION_MODEL = os.environ.get("CULINARY_VISION_MODEL", "gemma3:12b")

_RECIPE_SCHEMA_PROMPT = """
You are a recipe parser. Extract ALL recipes found in the text below.
Return ONLY a valid JSON array — even if there is just one recipe. No markdown, no prose.
Each element must follow this exact schema:

[
  {
    "title": "string",
    "meal_type": "Breakfast|Lunch|Dinner|Snack|Dessert|Other",
    "primary_protein": "string or null",
    "servings": integer,
    "ingredients": [{"name": "string", "qty": "string", "unit": "string"}],
    "steps": ["string"],
    "equipment_needed": ["string"]
  }
]

Recipe text:
"""

_EQUIPMENT_TRANSLATE_PROMPT = """
You are a cooking assistant. Rewrite these recipe steps to use {equipment} instead of the
original cooking method. Adjust times and temperatures appropriately.
Return ONLY a JSON array of strings — one string per step. No markdown, no explanation.

Original steps:
{steps}
"""

_KNOWN_EQUIPMENT_TYPES = [
    "air_fryer", "instant_pot", "dutch_oven", "sous_vide",
    "slow_cooker", "stand_mixer", "wok", "grill",
]

_EQUIPMENT_IDENTIFY_PROMPT = """
You are a kitchen appliance classifier. Given a brand and model, identify which categories apply.

Valid categories: air_fryer, instant_pot, dutch_oven, sous_vide, slow_cooker, stand_mixer, wok, grill

Rules:
- A device can match multiple categories (e.g. Instant Pot Duo is both instant_pot and slow_cooker)
- Only include categories the device genuinely supports
- "label" should be a short, clean product name

Return ONLY valid JSON (no markdown, no explanation):
{{"label": "Brand Model Name", "types": ["type1", "type2"]}}

Brand: {make}
Model: {model}
"""

_SUBSTITUTE_RECOMMEND_PROMPT = """
You are a culinary expert. Recommend 3-5 approved substitutes for the ingredient: {ingredient}.
For each substitute, provide a short reason why it works well.
Return ONLY a JSON array of objects. No markdown, no prose.
Each element must follow this exact schema:
[
  {{"name": "string", "reason": "string"}}
]
"""


async def _call_ollama(prompt: str) -> str:
    async with httpx.AsyncClient(timeout=180) as client:
        resp = await client.post(
            f"{OLLAMA_BASE}/api/generate",
            json={"model": OLLAMA_MODEL, "prompt": prompt, "stream": False},
        )
        resp.raise_for_status()
        return resp.json().get("response", "")


async def _call_ollama_vision(prompt: str, image_b64: str) -> str:
    async with httpx.AsyncClient(timeout=180) as client:
        resp = await client.post(
            f"{OLLAMA_BASE}/api/generate",
            json={
                "model": OLLAMA_VISION_MODEL,
                "prompt": prompt,
                "images": [image_b64],
                "stream": False},
        )
        resp.raise_for_status()
        return resp.json().get("response", "")


async def _identify_equipment(make: str, model: str) -> dict:
    """Ask Ollama to classify a kitchen device; returns {label, types}."""
    prompt = _EQUIPMENT_IDENTIFY_PROMPT.format(make=make, model=model)
    try:
        raw = await _call_ollama(prompt)
        data = _extract_json(raw)
        if isinstance(data, dict):
            types = [
                t for t in data.get(
                    "types",
                    []) if t in _KNOWN_EQUIPMENT_TYPES]
            label = data.get("label") or f"{make} {model}".strip()
            return {"label": label, "types": types}
    except Exception:
        pass
    return {"label": f"{make} {model}".strip(), "types": []}


def _chunk_text(text: str, size: int = 20000) -> List[str]:
    text = text.strip()
    return [text[i:i + size]
            for i in range(0, len(text), size)] if text else []


def _collect_parsed(raw: str) -> List[dict]:
    try:
        result = _extract_json(raw)
    except Exception:
        return []
    if isinstance(result, dict):
        result = [result]
    return [r for r in result if isinstance(
        r, dict)] if isinstance(result, list) else []



# ---------------------------------------------------------------------------
# Open Food Facts helpers
# ---------------------------------------------------------------------------

async def _lookup_barcode(upc: str) -> Optional[dict]:
    url = f"https://world.openfoodfacts.org/api/v0/product/{upc}.json"
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.get(url)
            data = resp.json()
            if data.get("status") == 1:
                product = data.get("product", {})
                return {
                    "name": product.get("product_name") or product.get("product_name_en") or upc,
                    "brand": product.get("brands", ""),
                }
        except Exception:
            pass
    return None


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
    meal_type: str = "Other"
    primary_protein: Optional[str] = None
    servings: int = 4
    image_url: Optional[str] = None
    ingredients: List[Dict[str, Any]] = []
    steps: List[str] = []
    equipment_needed: List[str] = []


class RecipeUpdate(BaseModel):
    title: Optional[str] = None
    meal_type: Optional[str] = None
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


# ---------------------------------------------------------------------------
# CHRONOS vault sync — every recipe becomes a markdown note.
# ---------------------------------------------------------------------------

def _safe_filename(title: str) -> str:
    """Strip path separators and clamp length so the title makes a safe filename."""
    cleaned = re.sub(r'[\\/]+', '-', title or "Untitled Recipe").strip()
    cleaned = re.sub(r'[\x00-\x1f]', '', cleaned)
    cleaned = cleaned.strip('. ')
    if not cleaned:
        cleaned = "Untitled Recipe"
    return cleaned[:100]


def _recipe_vault_path_for(r: Recipe, root: str = VROOT_HOUSEHOLD) -> str:
    return f"{root}/Recipes/{_safe_filename(r.title)}.md"


def _recipe_to_markdown(r: Recipe) -> str:
    """Serialize a Recipe to markdown with YAML frontmatter."""
    ingredients = _safe_json(r.ingredients_json, [])
    steps = _safe_json(r.steps_json, [])
    equipment = _safe_json(r.equipment_needed_json, [])

    def _yaml_str(v) -> str:
        if v is None:
            return '""'
        s = str(v).replace('"', '\\"')
        return f'"{s}"'

    frontmatter = [
        "---",
        "kind: recipe",
        f"recipe_id: {_yaml_str(r.id)}",
        f"title: {_yaml_str(r.title)}",
        f"meal_type: {
            _yaml_str(
                r.meal_type.value if r.meal_type else 'Other')}",
        f"primary_protein: {_yaml_str(r.primary_protein or '')}",
        f"servings: {r.servings or 0}",
        f"rating: {r.rating if r.rating is not None else 'null'}",
        f"source_url: {_yaml_str(r.source_url or '')}",
        "---",
        "",
        f"# {r.title}",
        "",
    ]
    body: list[str] = list(frontmatter)
    if r.image_url:
        body.append(f"![cover]({r.image_url})")
        body.append("")
    body.append("## Ingredients")
    body.append("")
    if ingredients:
        for ing in ingredients:
            if isinstance(ing, dict):
                qty = ing.get("quantity") or ing.get("amount") or ""
                unit = ing.get("unit", "")
                name = ing.get("name") or ing.get("item") or ""
                line = " ".join(
                    p for p in [
                        str(qty).strip(),
                        unit.strip(),
                        name.strip()] if p)
                body.append(f"- {line}")
            else:
                body.append(f"- {ing}")
    else:
        body.append("_(none listed)_")
    body.append("")
    body.append("## Steps")
    body.append("")
    if steps:
        for i, step in enumerate(steps, 1):
            text = step if isinstance(
                step, str) else (
                step.get("text") or step.get("instruction") or str(step))
            body.append(f"{i}. {text}")
    else:
        body.append("_(no steps recorded)_")
    body.append("")
    if equipment:
        body.append("## Equipment")
        body.append("")
        for eq in equipment:
            label = eq if isinstance(eq, str) else (eq.get("name") or str(eq))
            body.append(f"- {label}")
        body.append("")
    return "\n".join(body)


async def _sync_recipe_to_vault(
        uid: str, r: Recipe, old_title: Optional[str] = None) -> None:
    """
    Write the recipe to the user's vault as a markdown note. Best-effort:
    a vault failure must never break the recipe save itself.
    """
    try:
        provider = VaultProvider(store=None)
        content = _recipe_to_markdown(r)
        # Prefer household root when the user has one; otherwise fall back to
        # personal.
        owner_id = _resolve_module_owner(uid, "vault")
        root = VROOT_HOUSEHOLD if owner_id.startswith(
            "family:") else VROOT_PERSONAL
        new_path = _recipe_vault_path_for(r, root=root)
        # If the title changed, retire the old file by renaming
        # (delete-on-fail).
        if old_title and _safe_filename(old_title) != _safe_filename(r.title):
            old_path = f"{root}/Recipes/{_safe_filename(old_title)}.md"
            try:
                await provider.rename_note(uid, old_path, new_path)
            except (FileNotFoundError, ValueError):
                pass
            except Exception as exc:
                logger.debug("Recipe note rename skipped: %s", exc)
        await provider.write_note(uid, new_path, content)
    except Exception as exc:
        logger.debug(
            "Recipe vault sync skipped (recipe=%s): %s",
            getattr(
                r,
                "id",
                "?"),
            exc)


async def _delete_recipe_from_vault(uid: str, r: Recipe) -> None:
    try:
        provider = VaultProvider(store=None)
        owner_id = _resolve_module_owner(uid, "vault")
        root = VROOT_HOUSEHOLD if owner_id.startswith(
            "family:") else VROOT_PERSONAL
        path = _recipe_vault_path_for(r, root=root)
        await provider.delete_note(uid, path)
    except Exception as exc:
        logger.debug(
            "Recipe vault delete skipped (recipe=%s): %s",
            getattr(
                r,
                "id",
                "?"),
            exc)


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


def _banned_out(bi: BannedIngredient) -> dict:
    return {
        "id": bi.id,
        "household_id": bi.household_id,
        "name": bi.name,
        "substitute": bi.substitute,
        "created_at": bi.created_at.isoformat() if bi.created_at else None,
        "updated_at": bi.updated_at.isoformat() if bi.updated_at else None,
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
    identified = await _identify_equipment(body.make.strip(), body.model.strip())
    types = identified["types"]
    primary_type = types[0] if types else "other"
    eq = KitchenEquipment(
        household_id=hh.id,
        equipment_type=primary_type,
        label=identified["label"],
        make=body.make.strip(),
        model=body.model.strip(),
        capabilities_json=json.dumps(types),
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

        identified = await _identify_equipment(eq.make or "", eq.model or "")
        new_types = identified["types"]
        eq.equipment_type = new_types[0] if new_types else "other"
        eq.label = identified["label"]
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
                f"A recipe with title '{
                    body.title}' already exists.")

    blacklisted = _flag_blacklist(db, hh.id, body.ingredients)
    meal = MealType(body.meal_type) if body.meal_type in [
        m.value for m in MealType] else MealType.OTHER
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
        r.meal_type = MealType(body.meal_type) if body.meal_type in [
            m.value for m in MealType] else MealType.OTHER
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
    db: Session = Depends(get_db),
):
    """Scale the proposed recipe to 4 servings and return a single-use shopping list."""
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
    target_servings = 4
    factor = target_servings / original_servings

    scaled = []
    for ing in _safe_json(recipe.ingredients_json, []):
        raw_qty = _parse_qty(str(ing.get("qty", ""))) * factor
        qty_out = _format_qty(raw_qty) if raw_qty > 0 else ing.get("qty", "")
        scaled.append({"name": ing.get("name", ""),
                      "qty": qty_out, "unit": ing.get("unit", "")})

    # Dismiss the proposal — it's been acted on
    db.delete(p)
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

@router.post("/recipes/ingest", status_code=status.HTTP_201_CREATED)
async def ingest_recipe(
    request: Request,
    db: Session = Depends(get_db),
    source_url: Optional[str] = Form(default=None),
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
                detail=f"Recipe site returned an error: {
                    exc.response.status_code} {
                    exc.response.reason_phrase}"
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

    else:
        raise bad_request("Provide either a PDF file or a source_url")

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
                    f"Recipe '{
                        existing.title}' already exists in your library.")

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
    db.commit()
    db.refresh(item)
    await _ws_manager.broadcast(hh.id, "stockroom_updated", _stock_out(item))
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

    await _ws_manager.broadcast(hh.id, "stockroom_updated", out)
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

    db.commit()

    db.refresh(item)
    out = _stock_out(item)
    await _ws_manager.broadcast(hh.id, "stockroom_updated", out)
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


@router.get("/prep/{session_id}/shopping-list")
async def get_shopping_list(
        session_id: str, request: Request, db: Session = Depends(get_db)):
    """
    Master Shopping List: aggregate + deduplicate all ingredients across staged recipes.
    Cross-reference Stockroom — anything marked Good is omitted.
    """
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    session = db.query(PrepSession).filter_by(
        id=session_id, household_id=hh.id).first()
    if not session:
        raise not_found("Prep session not found")

    # Build set of Good stockroom items (normalized lowercase)
    good_stock = {
        s.name.lower().strip()
        for s in db.query(StockroomItem).filter_by(household_id=hh.id).all()
        if s.state == StockState.GOOD
    }

    # Aggregate ingredients across all recipes
    aggregated: Dict[str, dict] = {}
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
                    "name": ing.get("name", ""),
                    "qty": ing.get("qty", ""),
                    "unit": ing.get("unit", ""),
                }

    # Inject any Low stockroom items
    low_items = db.query(StockroomItem).filter_by(household_id=hh.id).all()
    for item in low_items:
        if item.state == StockState.LOW:
            key = item.name.lower().strip()
            if key not in aggregated:
                aggregated[key] = {
                    "name": item.name,
                    "qty": "",
                    "unit": "",
                    "_from_stockroom": True}

    return {"session_id": session_id,
            "shopping_list": list(aggregated.values())}


@router.get("/prep/{session_id}/staging")
async def get_staging_area(
        session_id: str, request: Request, db: Session = Depends(get_db)):
    """Staging Area: shopping list split back into per-recipe piles."""
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
    session.completed_at = datetime.now(timezone.utc)
    db.commit()
    await _ws_manager.broadcast(hh.id, "prep_completed", {"session_id": session_id})
    return {"session_id": session_id, "completed": True}


# ---------------------------------------------------------------------------
# Walmart Cart Export
# ---------------------------------------------------------------------------

@router.get("/walmart/mappings")
async def list_walmart_mappings(
        request: Request, db: Session = Depends(get_db)):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    mappings = db.query(WalmartMapping).filter_by(household_id=hh.id).all()
    return [
        {"id": m.id, "ingredient_name": m.ingredient_name,
            "walmart_item_id": m.walmart_item_id}
        for m in mappings
    ]


@router.post("/walmart/mappings", status_code=status.HTTP_201_CREATED)
async def create_walmart_mapping(
    body: WalmartMappingCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    name_norm = body.ingredient_name.lower().strip()
    item_id = body.walmart_item_id.strip()

    # 1. Backend URL Extraction
    if "walmart.com" in item_id:
        match = re.search(r"/(\d+)(\?|$)", item_id)
        if match:
            item_id = match.group(1)
        else:
            raise bad_request("Invalid Walmart URL. Could not find Item ID.")

    # 2. Validation: Must be numeric
    if not item_id.isdigit():
        raise bad_request("Invalid Walmart Item ID. Must be a number.")

    existing = db.query(WalmartMapping).filter_by(
        household_id=hh.id, ingredient_name=name_norm).first()
    if existing:
        existing.walmart_item_id = item_id
        db.commit()
        return {"id": existing.id, "ingredient_name": existing.ingredient_name,
                "walmart_item_id": existing.walmart_item_id}
    m = WalmartMapping(
        household_id=hh.id,
        ingredient_name=name_norm,
        walmart_item_id=item_id,
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    return {"id": m.id, "ingredient_name": m.ingredient_name,
            "walmart_item_id": m.walmart_item_id}


@router.delete("/walmart/mappings/{mapping_id}",
               status_code=status.HTTP_204_NO_CONTENT)
async def delete_walmart_mapping(
        mapping_id: str, request: Request, db: Session = Depends(get_db)):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    m = db.query(WalmartMapping).filter_by(
        id=mapping_id, household_id=hh.id).first()
    if not m:
        raise not_found("Mapping not found")
    db.delete(m)
    db.commit()


@router.post("/walmart/export")
async def walmart_export(
    request: Request,
    db: Session = Depends(get_db),
    session_id: Optional[str] = None,
):
    """
    Generate a Walmart Add-To-Cart URL from the active (or specified) prep session's shopping list.
    Returns mapped items as a URL and unmapped items as an alert list.
    """
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)

    if session_id:
        session = db.query(PrepSession).filter_by(
            id=session_id, household_id=hh.id).first()
    else:
        session = db.query(PrepSession).filter_by(
            household_id=hh.id, is_active=True).first()

    if not session:
        raise not_found("No prep session found")

    # Gather all ingredients from session
    all_ingredients: List[dict] = []
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

    # Load mappings
    mappings = {
        m.ingredient_name: m.walmart_item_id
        for m in db.query(WalmartMapping).filter_by(household_id=hh.id).all()
    }

    cart_items = []
    unmapped = []
    seen = set()

    for ing in all_ingredients:
        name_key = ing.get("name", "").lower().strip()
        if name_key in seen:
            continue
        seen.add(name_key)
        item_id = mappings.get(name_key)
        if item_id:
            try:
                qty = max(1, int(_parse_qty(str(ing.get("qty", 1)))))
            except (ValueError, TypeError):
                qty = 1
            cart_items.append(f"{item_id}_{qty}")
        else:
            unmapped.append(ing.get("name", name_key))

    if cart_items:
        cart_url = "https://www.walmart.com/sc/cart/addToCart?items=" + \
            ",".join(cart_items)
    else:
        cart_url = None

    return {
        "cart_url": cart_url,
        "mapped_count": len(cart_items),
        "unmapped": unmapped,
    }
