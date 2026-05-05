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

WS         /ws/culinary
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, Generator, List, Optional

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
from culinary.models import (
    Base,
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
_engine  = create_engine(
    _DB_URL,
    connect_args={"check_same_thread": False} if "sqlite" in _DB_URL else {},
)
_Session = sessionmaker(bind=_engine, autocommit=False, autoflush=False)
Base.metadata.create_all(_engine)


def get_db() -> Generator[Session, None, None]:
    db = _Session()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

def _get_user_id(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    payload = decode_token(auth.removeprefix("Bearer ").strip())
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    uid = str(payload.get("sub", ""))
    if not uid:
        raise HTTPException(status_code=401, detail="Token missing sub")
    return uid


_MAIN_DB_PATH = os.environ.get("MAIN_DB_PATH", "./data/river_song.db")

import sqlite3 as _sqlite3


def _resolve_culinary_owner(user_id: str) -> str:
    """
    Return the effective owner_id for the culinary household.
    If the user belongs to a family group with culinary sharing, all members
    resolve to 'family:<group_id>' so they share one household.
    """
    try:
        conn = _sqlite3.connect(_MAIN_DB_PATH)
        conn.row_factory = _sqlite3.Row
        row = conn.execute(
            """
            SELECT fg.id, fg.shared_modules
            FROM family_memberships fm
            JOIN family_groups fg ON fg.id = fm.family_group_id
            WHERE fm.profile_id = ?
            """,
            (user_id,),
        ).fetchone()
        conn.close()
        if row:
            import json as _json
            modules = _json.loads(row["shared_modules"] or "[]")
            if "culinary" in modules:
                return f"family:{row['id']}"
    except Exception:
        pass
    return user_id


def _get_household(db: Session, owner_id: str) -> Household:
    effective_id = _resolve_culinary_owner(owner_id)
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

BLACKLIST = {
    "bell pepper", "bell peppers",
    "pearl onion", "pearl onions",
    "quinoa",
    "radish", "radishes",
    "zucchini",
    "mushroom", "mushrooms",
}

SUBSTITUTIONS = {
    "bell pepper":  "poblano pepper",
    "bell peppers": "poblano peppers",
    "pearl onion":  "shallot",
    "pearl onions": "shallots",
    "quinoa":       "brown rice",
    "radish":       "turnip",
    "radishes":     "turnips",
    "zucchini":     "yellow squash",
    "mushroom":     "eggplant",
    "mushrooms":    "eggplant",
}


def _flag_blacklist(ingredients: list[dict]) -> list[dict]:
    flagged = []
    for ing in ingredients:
        name_lower = ing.get("name", "").lower().strip()
        if name_lower in BLACKLIST:
            flagged.append({
                "name":        ing["name"],
                "substitute":  SUBSTITUTIONS.get(name_lower, ""),
            })
    return flagged


# ---------------------------------------------------------------------------
# Ollama helpers
# ---------------------------------------------------------------------------

OLLAMA_BASE         = os.environ.get("OLLAMA_BASE_URL",       "http://localhost:11434")
OLLAMA_MODEL        = os.environ.get("CULINARY_LLM_MODEL",    "qwen2.5:14b")
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
            json={"model": OLLAMA_VISION_MODEL, "prompt": prompt, "images": [image_b64], "stream": False},
        )
        resp.raise_for_status()
        return resp.json().get("response", "")


def _chunk_text(text: str, size: int = 20000) -> List[str]:
    text = text.strip()
    return [text[i:i + size] for i in range(0, len(text), size)] if text else []


def _collect_parsed(raw: str) -> List[dict]:
    try:
        result = _extract_json(raw)
    except Exception:
        return []
    if isinstance(result, dict):
        result = [result]
    return [r for r in result if isinstance(r, dict)] if isinstance(result, list) else []


# ---------------------------------------------------------------------------
# JSON-LD / schema.org Recipe helpers (zero-AI structured extraction)
# ---------------------------------------------------------------------------

_UNITS = {
    "cup","cups","c","tablespoon","tablespoons","tbsp","tbsps","tbs",
    "teaspoon","teaspoons","tsp","tsps","pound","pounds","lb","lbs",
    "ounce","ounces","oz","gram","grams","g","kilogram","kilograms","kg",
    "liter","liters","l","ml","milliliter","milliliters","quart","quarts",
    "qt","pint","pints","pt","gallon","gallons","package","packages","pkg",
    "can","cans","jar","jars","slice","slices","piece","pieces","bunch",
    "bunches","clove","cloves","stalk","stalks","head","heads","pinch",
    "pinches","dash","dashes","handful","inch","inches","strip","strips",
    "sprig","sprigs","sheet","sheets","link","links","fillet","fillets",
}

_UNICODE_FRACS = {
    "½": "1/2", "⅓": "1/3", "⅔": "2/3", "¼": "1/4",
    "¾": "3/4", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8",
}

_MEAL_TYPE_MAP = {
    "breakfast": "Breakfast", "brunch": "Breakfast",
    "lunch": "Lunch",
    "dinner": "Dinner", "main course": "Dinner", "main dish": "Dinner", "entree": "Dinner",
    "snack": "Snack", "appetizer": "Snack", "starter": "Snack",
    "dessert": "Dessert", "sweet": "Dessert", "baking": "Dessert",
}

_NUM_PAT = re.compile(r"^([\d\s./]+)")


def _parse_ingredient(s: str) -> dict:
    for uc, asc in _UNICODE_FRACS.items():
        s = s.replace(uc, asc)
    s = s.strip()
    qty = unit = ""
    m = _NUM_PAT.match(s)
    if m:
        qty = m.group(1).strip()
        rest = s[m.end():].strip()
        words = rest.split()
        if words and words[0].lower().rstrip(".") in _UNITS:
            unit = words[0]
            name = " ".join(words[1:])
        else:
            name = rest
    else:
        name = s
    return {"name": name.strip() or s, "qty": qty, "unit": unit}


def _parse_yield(y: Any) -> int:
    if isinstance(y, list):
        y = y[0] if y else "4"
    m = re.search(r"\d+", str(y))
    return int(m.group()) if m else 4


def _parse_steps(instructions: Any) -> List[str]:
    if isinstance(instructions, str):
        return [s.strip() for s in re.split(r"\.\s+|\n", instructions) if s.strip()]
    if not isinstance(instructions, list):
        return []
    steps: List[str] = []
    for item in instructions:
        if isinstance(item, str):
            steps.append(item.strip())
        elif isinstance(item, dict):
            text = item.get("text") or item.get("name") or ""
            if text:
                steps.append(text.strip())
            for sub in item.get("itemListElement", []):
                if isinstance(sub, dict):
                    t = sub.get("text") or sub.get("name") or ""
                    if t:
                        steps.append(t.strip())
    return [s for s in steps if s]


def _extract_image_url(image: Any) -> Optional[str]:
    """Normalise schema.org image field — string, list, or ImageObject."""
    if not image:
        return None
    if isinstance(image, str):
        return image or None
    if isinstance(image, list):
        image = image[0] if image else None
        if not image:
            return None
    if isinstance(image, str):  # unwrapped from a list of plain URLs
        return image or None
    if isinstance(image, dict):
        return image.get("url") or image.get("contentUrl") or None
    return None


def _jsonld_to_recipe(node: dict) -> Optional[dict]:
    """Convert a schema.org Recipe node to our internal recipe dict."""
    t = node.get("@type", "")
    if "Recipe" not in (t if isinstance(t, str) else " ".join(t)):
        return None
    raw_category = node.get("recipeCategory", "") or ""
    if isinstance(raw_category, list):
        raw_category = " ".join(raw_category)
    meal_type = "Other"
    for key, val in _MEAL_TYPE_MAP.items():
        if key in raw_category.lower():
            meal_type = val
            break
    return {
        "title":            node.get("name", "Untitled Recipe"),
        "meal_type":        meal_type,
        "primary_protein":  None,
        "servings":         _parse_yield(node.get("recipeYield", 4)),
        "image_url":        _extract_image_url(node.get("image")),
        "ingredients":      [_parse_ingredient(i) for i in node.get("recipeIngredient", [])],
        "steps":            _parse_steps(node.get("recipeInstructions", [])),
        "equipment_needed": [],
    }


def _extract_jsonld_recipes(html: str) -> List[dict]:
    """Pull all schema.org Recipe objects from JSON-LD blocks in an HTML page."""
    blocks = re.findall(r'<script[^>]*ld\+json[^>]*>([\s\S]*?)</script>', html, re.I)
    found: List[dict] = []
    for block in blocks:
        try:
            data = json.loads(block.strip())
        except Exception:
            continue
        nodes = data if isinstance(data, list) else [data]
        for node in nodes:
            if not isinstance(node, dict):
                continue
            # Handle @graph wrapper (common on WordPress sites)
            for item in node.get("@graph", [node]):
                if not isinstance(item, dict):
                    continue
                recipe = _jsonld_to_recipe(item)
                if recipe:
                    found.append(recipe)
    return found


def _extract_json(text: str) -> Any:
    match = re.search(r"(\{[\s\S]*\}|\[[\s\S]*\])", text)
    if match:
        return json.loads(match.group(1))
    return json.loads(text)


def _extract_og_image(html: str) -> Optional[str]:
    """Pull the best available social/meta image from an HTML page."""
    patterns = [
        r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']',
        r'<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']twitter:image["\']',
    ]
    for pat in patterns:
        m = re.search(pat, html, re.I)
        if m:
            url = m.group(1).strip()
            if url.startswith("http"):
                return url
    return None


def _is_bot_challenge(html: str) -> bool:
    """Detect bot challenge / CAPTCHA gate pages (Walmart, Cloudflare, etc.)."""
    lower = html.lower()
    indicators = [
        "robot or human",
        "are you a robot",
        "verify you are human",
        "automated access",
        "bot detected",
        "checking your browser",
        "access denied",
        "enable javascript and cookies",
        "challenge-form",
        "cf-challenge",
    ]
    return any(phrase in lower for phrase in indicators) and len(html) < 60_000


def _extract_nextdata_recipes(html: str) -> List[dict]:
    """Extract recipes from Next.js __NEXT_DATA__ JSON (Walmart and similar SPA sites)."""
    m = re.search(r'<script[^>]+id=["\']__NEXT_DATA__["\'][^>]*>([\s\S]*?)</script>', html, re.I)
    if not m:
        return []
    try:
        data = json.loads(m.group(1))
    except Exception:
        return []

    def _find_recipe_nodes(obj: Any, depth: int = 0) -> List[dict]:
        if depth > 10 or not isinstance(obj, (dict, list)):
            return []
        found: List[dict] = []
        if isinstance(obj, dict):
            has_name = bool(obj.get("title") or obj.get("name"))
            has_ingredients = bool(obj.get("ingredients") or obj.get("recipeIngredients"))
            has_steps = bool(
                obj.get("instructions") or obj.get("steps") or obj.get("recipeInstructions")
            )
            if has_name and (has_ingredients or has_steps):
                found.append(obj)
            for v in obj.values():
                found.extend(_find_recipe_nodes(v, depth + 1))
        else:
            for item in obj:
                found.extend(_find_recipe_nodes(item, depth + 1))
        return found

    parsed: List[dict] = []
    for raw in _find_recipe_nodes(data):
        name = raw.get("title") or raw.get("name") or "Untitled Recipe"

        raw_ings = raw.get("ingredients") or raw.get("recipeIngredients") or []
        ingredients: List[dict] = []
        for ing in raw_ings if isinstance(raw_ings, list) else []:
            if isinstance(ing, str):
                ingredients.append(_parse_ingredient(ing))
            elif isinstance(ing, dict):
                text = ing.get("text") or ing.get("name") or ing.get("description") or ""
                if text:
                    ingredients.append(_parse_ingredient(str(text)))

        raw_steps = (
            raw.get("instructions") or raw.get("steps") or raw.get("recipeInstructions") or []
        )
        steps = _parse_steps(raw_steps)

        raw_yield = raw.get("recipeYield") or raw.get("servings") or raw.get("yield") or 4
        servings = _parse_yield(raw_yield)

        raw_image = (
            raw.get("image") or raw.get("images")
            or raw.get("imageUrl") or raw.get("imageURL")
        )
        image_url = _extract_image_url(raw_image)
        if not image_url and isinstance(raw_image, list) and raw_image:
            first = raw_image[0]
            if isinstance(first, dict):
                image_url = (
                    first.get("url") or first.get("src")
                    or first.get("uri") or first.get("contentUrl")
                )
            elif isinstance(first, str) and first.startswith("http"):
                image_url = first

        raw_category = raw.get("category") or raw.get("recipeCategory") or ""
        if isinstance(raw_category, list):
            raw_category = " ".join(raw_category)
        meal_type = "Other"
        for key, val in _MEAL_TYPE_MAP.items():
            if key in str(raw_category).lower():
                meal_type = val
                break

        parsed.append({
            "title":            name,
            "meal_type":        meal_type,
            "primary_protein":  None,
            "servings":         servings,
            "image_url":        image_url,
            "ingredients":      ingredients,
            "steps":            steps,
            "equipment_needed": [],
        })

    return parsed


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
                    "name":  product.get("product_name") or product.get("product_name_en") or upc,
                    "brand": product.get("brands", ""),
                }
        except Exception:
            pass
    return None


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class HouseholdUpdate(BaseModel):
    name:            Optional[str]  = None
    has_air_fryer:   Optional[bool] = None
    has_instant_pot: Optional[bool] = None
    has_dutch_oven:  Optional[bool] = None
    has_sous_vide:   Optional[bool] = None
    has_slow_cooker: Optional[bool] = None
    has_stand_mixer: Optional[bool] = None
    has_wok:         Optional[bool] = None
    has_grill:       Optional[bool] = None


class RecipeCreate(BaseModel):
    title:           str
    meal_type:       str  = "Other"
    primary_protein: Optional[str] = None
    servings:        int  = 4
    image_url:       Optional[str] = None
    ingredients:     List[Dict[str, Any]] = []
    steps:           List[str] = []
    equipment_needed: List[str] = []


class RecipeUpdate(BaseModel):
    title:           Optional[str] = None
    meal_type:       Optional[str] = None
    primary_protein: Optional[str] = None
    servings:        Optional[int] = None
    image_url:       Optional[str] = None
    ingredients:     Optional[List[Dict[str, Any]]] = None
    steps:           Optional[List[str]] = None
    equipment_needed: Optional[List[str]] = None


class ScaleRequest(BaseModel):
    target_containers: int
    container_oz:      int
    protein_oz:        Optional[int] = None
    side_oz:           Optional[int] = None


class EquipmentTranslateRequest(BaseModel):
    equipment: str  # e.g. "Air Fryer"


class StockroomItemCreate(BaseModel):
    name:    str
    barcode: Optional[str] = None
    brand:   Optional[str] = None
    state:   str = "Good"


class StockroomItemUpdate(BaseModel):
    name:   Optional[str] = None
    brand:  Optional[str] = None
    state:  Optional[str] = None


class ScanRequest(BaseModel):
    barcode: str


class PrepSessionCreate(BaseModel):
    label:             Optional[str] = None
    target_containers: Optional[int] = None
    container_oz:      Optional[int] = None


class AddRecipeToPrep(BaseModel):
    recipe_id:      str
    servings_target: Optional[int] = None


class EquipmentItemCreate(BaseModel):
    equipment_type: str
    label:          str
    make:           Optional[str] = None
    model:          Optional[str] = None


class EquipmentItemUpdate(BaseModel):
    make:  Optional[str] = None
    model: Optional[str] = None


class WalmartMappingCreate(BaseModel):
    ingredient_name: str
    walmart_item_id: str


# ---------------------------------------------------------------------------
# Serializers
# ---------------------------------------------------------------------------

def _household_out(hh: Household) -> dict:
    return {
        "id":       hh.id,
        "name":     hh.name,
        "owner_id": hh.owner_id,
        "equipment": {
            "air_fryer":   hh.has_air_fryer,
            "instant_pot": hh.has_instant_pot,
            "dutch_oven":  hh.has_dutch_oven,
            "sous_vide":   hh.has_sous_vide,
            "slow_cooker": hh.has_slow_cooker,
            "stand_mixer": hh.has_stand_mixer,
            "wok":         hh.has_wok,
            "grill":       hh.has_grill,
        },
        "created_at": hh.created_at.isoformat() if hh.created_at else None,
        "updated_at": hh.updated_at.isoformat() if hh.updated_at else None,
    }


def _recipe_out(r: Recipe) -> dict:
    return {
        "id":               r.id,
        "household_id":     r.household_id,
        "title":            r.title,
        "meal_type":        r.meal_type.value if r.meal_type else "Other",
        "primary_protein":  r.primary_protein,
        "servings":         r.servings,
        "image_url":        r.image_url,
        "source_url":       r.source_url,
        "source_type":      r.source_type.value if r.source_type else "manual",
        "ingredients":      json.loads(r.ingredients_json or "[]"),
        "steps":            json.loads(r.steps_json or "[]"),
        "equipment_needed": json.loads(r.equipment_needed_json or "[]"),
        "blacklisted":      json.loads(r.blacklisted_json or "[]"),
        "created_at":       r.created_at.isoformat() if r.created_at else None,
        "updated_at":       r.updated_at.isoformat() if r.updated_at else None,
    }


def _stock_out(s: StockroomItem) -> dict:
    return {
        "id":           s.id,
        "household_id": s.household_id,
        "name":         s.name,
        "barcode":      s.barcode,
        "brand":        s.brand,
        "state":        s.state.value if s.state else "Good",
        "created_at":   s.created_at.isoformat() if s.created_at else None,
        "updated_at":   s.updated_at.isoformat() if s.updated_at else None,
    }


def _equipment_out(eq: KitchenEquipment) -> dict:
    return {
        "id":             eq.id,
        "equipment_type": eq.equipment_type,
        "label":          eq.label,
        "make":           eq.make,
        "model":          eq.model,
    }


def _session_out(ps: PrepSession) -> dict:
    return {
        "id":                ps.id,
        "household_id":      ps.household_id,
        "label":             ps.label,
        "is_active":         ps.is_active,
        "target_containers": ps.target_containers,
        "container_oz":      ps.container_oz,
        "recipes": [
            {
                "entry_id":          pr.id,
                "recipe_id":         pr.recipe_id,
                "recipe_title":      pr.recipe.title if pr.recipe else "",
                "servings_target":   pr.servings_target,
                "scaled_ingredients": json.loads(pr.scaled_ingredients_json or "[]"),
            }
            for pr in ps.recipes
        ],
        "created_at":   ps.created_at.isoformat() if ps.created_at else None,
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
    payload = decode_token(token) if token else None
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
        db.close()


# ---------------------------------------------------------------------------
# Household
# ---------------------------------------------------------------------------

@router.get("/household")
def get_household(request: Request, db: Session = Depends(get_db)):
    uid = _get_user_id(request)
    return _household_out(_get_household(db, uid))


@router.put("/household")
async def update_household(
    body: HouseholdUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = _get_user_id(request)
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
# Kitchen Equipment (make / model)
# ---------------------------------------------------------------------------

@router.get("/household/equipment")
def list_equipment(request: Request, db: Session = Depends(get_db)):
    uid = _get_user_id(request)
    hh = _get_household(db, uid)
    return [_equipment_out(e) for e in hh.equipment_items]


@router.post("/household/equipment", status_code=status.HTTP_201_CREATED)
async def add_equipment(
    body: EquipmentItemCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = _get_user_id(request)
    hh = _get_household(db, uid)
    eq = KitchenEquipment(
        household_id=hh.id,
        equipment_type=body.equipment_type,
        label=body.label,
        make=body.make,
        model=body.model,
    )
    db.add(eq)
    flag = f"has_{body.equipment_type}"
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
    uid = _get_user_id(request)
    hh = _get_household(db, uid)
    eq = db.query(KitchenEquipment).filter_by(id=eq_id, household_id=hh.id).first()
    if not eq:
        raise HTTPException(status_code=404, detail="Equipment not found")
    if body.make is not None:
        eq.make = body.make
    if body.model is not None:
        eq.model = body.model
    db.commit()
    db.refresh(eq)
    await _ws_manager.broadcast(hh.id, "equipment_updated", _equipment_out(eq))
    return _equipment_out(eq)


@router.delete("/household/equipment/{eq_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_equipment(
    eq_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = _get_user_id(request)
    hh = _get_household(db, uid)
    eq = db.query(KitchenEquipment).filter_by(id=eq_id, household_id=hh.id).first()
    if not eq:
        raise HTTPException(status_code=404, detail="Equipment not found")
    flag = f"has_{eq.equipment_type}"
    if hasattr(hh, flag):
        setattr(hh, flag, False)
    db.delete(eq)
    db.commit()
    await _ws_manager.broadcast(hh.id, "equipment_deleted", {"id": eq_id})


# ---------------------------------------------------------------------------
# Recipe Library
# ---------------------------------------------------------------------------

@router.get("/recipes")
def list_recipes(request: Request, db: Session = Depends(get_db)):
    uid = _get_user_id(request)
    hh = _get_household(db, uid)
    return [_recipe_out(r) for r in hh.recipes]


@router.post("/recipes", status_code=status.HTTP_201_CREATED)
async def create_recipe(
    body: RecipeCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = _get_user_id(request)
    hh = _get_household(db, uid)
    blacklisted = _flag_blacklist(body.ingredients)
    meal = MealType(body.meal_type) if body.meal_type in [m.value for m in MealType] else MealType.OTHER
    r = Recipe(
        household_id=hh.id,
        title=body.title,
        meal_type=meal,
        primary_protein=body.primary_protein,
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
    await _ws_manager.broadcast(hh.id, "recipe_created", _recipe_out(r))
    return _recipe_out(r)


@router.get("/recipes/{recipe_id}")
def get_recipe(recipe_id: str, request: Request, db: Session = Depends(get_db)):
    uid = _get_user_id(request)
    hh = _get_household(db, uid)
    r = db.query(Recipe).filter_by(id=recipe_id, household_id=hh.id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return _recipe_out(r)


@router.put("/recipes/{recipe_id}")
async def update_recipe(
    recipe_id: str,
    body: RecipeUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = _get_user_id(request)
    hh = _get_household(db, uid)
    r = db.query(Recipe).filter_by(id=recipe_id, household_id=hh.id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Recipe not found")
    if body.title is not None:
        r.title = body.title
    if body.meal_type is not None:
        r.meal_type = MealType(body.meal_type) if body.meal_type in [m.value for m in MealType] else MealType.OTHER
    if body.primary_protein is not None:
        r.primary_protein = body.primary_protein
    if body.servings is not None:
        r.servings = body.servings
    if body.ingredients is not None:
        r.ingredients_json = json.dumps(body.ingredients)
        r.blacklisted_json = json.dumps(_flag_blacklist(body.ingredients))
    if body.steps is not None:
        r.steps_json = json.dumps(body.steps)
    if body.equipment_needed is not None:
        r.equipment_needed_json = json.dumps(body.equipment_needed)
    if body.image_url is not None:
        r.image_url = body.image_url
    db.commit()
    db.refresh(r)
    await _ws_manager.broadcast(hh.id, "recipe_updated", _recipe_out(r))
    return _recipe_out(r)


@router.delete("/recipes/{recipe_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_recipe(recipe_id: str, request: Request, db: Session = Depends(get_db)):
    uid = _get_user_id(request)
    hh = _get_household(db, uid)
    r = db.query(Recipe).filter_by(id=recipe_id, household_id=hh.id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Recipe not found")
    db.delete(r)
    db.commit()
    await _ws_manager.broadcast(hh.id, "recipe_deleted", {"id": recipe_id})


# ---------------------------------------------------------------------------
# Ingest Engine (PDF / URL → Ollama)
# ---------------------------------------------------------------------------

@router.post("/recipes/ingest", status_code=status.HTTP_201_CREATED)
async def ingest_recipe(
    request: Request,
    db: Session = Depends(get_db),
    source_url: Optional[str] = Form(default=None),
    file: Optional[UploadFile] = File(default=None),
):
    uid = _get_user_id(request)
    hh = _get_household(db, uid)

    src_type   = SourceType.MANUAL
    actual_url = source_url
    all_parsed: List[dict] = []

    if file and file.filename:
        try:
            import fitz  # PyMuPDF
        except ImportError:
            raise HTTPException(status_code=500, detail="PyMuPDF not installed. Run: pip install pymupdf")

        content = await file.read()
        doc     = fitz.open(stream=content, filetype="pdf")
        src_type = SourceType.PDF

        text_pages:  List[str] = []
        image_pages: List[str] = []  # base64 PNG per scanned page

        for page in doc:
            text = page.get_text().strip()
            if len(text) > 100:
                text_pages.append(text)
            else:
                # Scanned page — render at 150 DPI and send to vision model
                pix = page.get_pixmap(dpi=150)
                image_pages.append(base64.b64encode(pix.tobytes("png")).decode())

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
            raise HTTPException(status_code=500, detail="BeautifulSoup not installed. Run: pip install beautifulsoup4")

        _fetch_headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
        }
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            resp = await client.get(source_url, headers=_fetch_headers)
        html     = resp.text
        src_type = SourceType.URL

        if _is_bot_challenge(html):
            raise HTTPException(
                status_code=422,
                detail=(
                    "This site uses bot protection and blocked the request. "
                    "Try copying the recipe text and using the Manual Entry form instead."
                ),
            )

        # ── Track 1a: JSON-LD structured extraction (instant, no AI) ────────
        jsonld_recipes = _extract_jsonld_recipes(html)
        if jsonld_recipes:
            logger.info("JSON-LD found: %d recipe(s)", len(jsonld_recipes))
            all_parsed.extend(jsonld_recipes)

        # ── Track 1b: Next.js __NEXT_DATA__ (other SPA sites) ───────────────
        if not all_parsed:
            nextdata_recipes = _extract_nextdata_recipes(html)
            if nextdata_recipes:
                logger.info("__NEXT_DATA__ found: %d recipe(s)", len(nextdata_recipes))
                all_parsed.extend(nextdata_recipes)

        if not all_parsed:
            # ── Track 2: Fallback — scrape text → qwen2.5:14b ───────────────
            logger.info("No structured data found — falling back to AI text parse")
            soup = BeautifulSoup(html, "html.parser")
            for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
                tag.decompose()
            raw_text = soup.get_text(separator="\n", strip=True)

            for chunk in _chunk_text(raw_text, 20000):
                try:
                    raw = await _call_ollama(_RECIPE_SCHEMA_PROMPT + chunk)
                    all_parsed.extend(_collect_parsed(raw))
                except Exception as exc:
                    logger.warning("URL chunk parse failed: %s", exc)

        # ── Image fallback: og:image for any recipe missing an image ─────────
        og_image = _extract_og_image(html)
        if og_image:
            for recipe_dict in all_parsed:
                if not recipe_dict.get("image_url"):
                    recipe_dict["image_url"] = og_image

    else:
        raise HTTPException(status_code=422, detail="Provide either a PDF file or a source_url")

    if not all_parsed:
        raise HTTPException(status_code=502, detail="No recipes found in source")

    # Deduplicate by normalised title across all chunks
    seen:          set  = set()
    unique_parsed: List[dict] = []
    for item in all_parsed:
        key = item.get("title", "").lower().strip()
        if key and key not in seen:
            seen.add(key)
            unique_parsed.append(item)

    saved: List[Recipe] = []
    for item in unique_parsed:
        ingredients = item.get("ingredients", [])
        blacklisted = _flag_blacklist(ingredients)
        try:
            meal = MealType(item.get("meal_type", "Other"))
        except ValueError:
            meal = MealType.OTHER

        r = Recipe(
            household_id=hh.id,
            title=item.get("title", "Untitled Recipe"),
            meal_type=meal,
            primary_protein=item.get("primary_protein"),
            servings=int(item.get("servings", 4) or 4),
            image_url=item.get("image_url"),
            source_url=actual_url,
            source_type=src_type,
            ingredients_json=json.dumps(ingredients),
            steps_json=json.dumps(item.get("steps", [])),
            equipment_needed_json=json.dumps(item.get("equipment_needed", [])),
            blacklisted_json=json.dumps(blacklisted),
        )
        db.add(r)
        db.flush()
        saved.append(r)

    db.commit()
    for r in saved:
        db.refresh(r)
        await _ws_manager.broadcast(hh.id, "recipe_created", _recipe_out(r))

    return {"count": len(saved), "recipes": [_recipe_out(r) for r in saved]}


# ---------------------------------------------------------------------------
# The Adjuster — Yield Scaling
# ---------------------------------------------------------------------------

@router.post("/recipes/{recipe_id}/scale")
def scale_recipe(
    recipe_id: str,
    body: ScaleRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = _get_user_id(request)
    hh = _get_household(db, uid)
    r = db.query(Recipe).filter_by(id=recipe_id, household_id=hh.id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Recipe not found")

    total_oz = body.target_containers * body.container_oz
    orig_servings = r.servings or 1
    scale_factor = body.target_containers / orig_servings

    ingredients = json.loads(r.ingredients_json or "[]")
    scaled = []
    for ing in ingredients:
        try:
            orig_qty = float(ing.get("qty", 1))
            new_qty = round(orig_qty * scale_factor, 2)
        except (ValueError, TypeError):
            new_qty = ing.get("qty", "")
        scaled.append({**ing, "qty": str(new_qty)})

    grocery_list = scaled.copy()
    if body.protein_oz and body.side_oz:
        protein_ratio = body.protein_oz / body.container_oz
        side_ratio = body.side_oz / body.container_oz
        grocery_list = [
            {
                **ing,
                "qty": str(round(float(ing.get("qty", 0)) * protein_ratio, 2)),
                "_component": "protein",
            }
            if i < len(scaled) // 2
            else {
                **ing,
                "qty": str(round(float(ing.get("qty", 0)) * side_ratio, 2)),
                "_component": "side",
            }
            for i, ing in enumerate(scaled)
        ]

    return {
        "recipe_id":        recipe_id,
        "target_containers": body.target_containers,
        "container_oz":     body.container_oz,
        "total_oz":         total_oz,
        "scale_factor":     round(scale_factor, 3),
        "scaled_ingredients": grocery_list,
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
    uid = _get_user_id(request)
    hh = _get_household(db, uid)
    r = db.query(Recipe).filter_by(id=recipe_id, household_id=hh.id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Recipe not found")

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
        logger.warning("Equipment translation failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"Ollama translation failed: {exc}")

    return {
        "recipe_id":    recipe_id,
        "equipment":    body.equipment,
        "rewritten_steps": new_steps,
    }


# ---------------------------------------------------------------------------
# Stockroom
# ---------------------------------------------------------------------------

@router.get("/stockroom")
def list_stockroom(request: Request, db: Session = Depends(get_db)):
    uid = _get_user_id(request)
    hh = _get_household(db, uid)
    items = db.query(StockroomItem).filter_by(household_id=hh.id).all()
    return [_stock_out(i) for i in items]


@router.post("/stockroom", status_code=status.HTTP_201_CREATED)
async def add_stockroom_item(
    body: StockroomItemCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = _get_user_id(request)
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
def get_stockroom_item(item_id: str, request: Request, db: Session = Depends(get_db)):
    uid = _get_user_id(request)
    hh = _get_household(db, uid)
    item = db.query(StockroomItem).filter_by(id=item_id, household_id=hh.id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return _stock_out(item)


@router.put("/stockroom/{item_id}")
async def update_stockroom_item(
    item_id: str,
    body: StockroomItemUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = _get_user_id(request)
    hh = _get_household(db, uid)
    item = db.query(StockroomItem).filter_by(id=item_id, household_id=hh.id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if body.name is not None:
        item.name = body.name
    if body.brand is not None:
        item.brand = body.brand
    if body.state is not None:
        try:
            item.state = StockState(body.state)
        except ValueError:
            pass
    db.commit()
    db.refresh(item)
    await _ws_manager.broadcast(hh.id, "stockroom_updated", _stock_out(item))
    return _stock_out(item)


@router.delete("/stockroom/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_stockroom_item(item_id: str, request: Request, db: Session = Depends(get_db)):
    uid = _get_user_id(request)
    hh = _get_household(db, uid)
    item = db.query(StockroomItem).filter_by(id=item_id, household_id=hh.id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
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
    uid = _get_user_id(request)
    hh = _get_household(db, uid)

    product = await _lookup_barcode(body.barcode)
    if not product:
        product = {"name": body.barcode, "brand": ""}

    existing = db.query(StockroomItem).filter_by(
        household_id=hh.id, barcode=body.barcode
    ).first()

    if existing:
        existing.state = StockState.GOOD
        existing.name  = product["name"] or existing.name
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
            state=StockState.GOOD,
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
    uid = _get_user_id(request)
    hh = _get_household(db, uid)

    item = db.query(StockroomItem).filter_by(
        household_id=hh.id, barcode=body.barcode
    ).first()
    if not item:
        product = await _lookup_barcode(body.barcode)
        if not product:
            product = {"name": body.barcode, "brand": ""}
        item = StockroomItem(
            household_id=hh.id,
            name=product["name"],
            brand=product.get("brand", ""),
            barcode=body.barcode,
            state=StockState.LOW,
        )
        db.add(item)
    else:
        item.state = StockState.LOW

    db.commit()
    db.refresh(item)
    out = _stock_out(item)
    await _ws_manager.broadcast(hh.id, "stockroom_updated", out)
    return out


# ---------------------------------------------------------------------------
# Prep Deck
# ---------------------------------------------------------------------------

@router.get("/prep")
def get_active_prep(request: Request, db: Session = Depends(get_db)):
    uid = _get_user_id(request)
    hh = _get_household(db, uid)
    session = db.query(PrepSession).filter_by(household_id=hh.id, is_active=True).first()
    if not session:
        raise HTTPException(status_code=404, detail="No active prep session")
    return _session_out(session)


@router.post("/prep", status_code=status.HTTP_201_CREATED)
async def create_prep_session(
    body: PrepSessionCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = _get_user_id(request)
    hh = _get_household(db, uid)
    # Deactivate any existing active session
    old = db.query(PrepSession).filter_by(household_id=hh.id, is_active=True).first()
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
    uid = _get_user_id(request)
    hh = _get_household(db, uid)
    session = db.query(PrepSession).filter_by(id=session_id, household_id=hh.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Prep session not found")
    recipe = db.query(Recipe).filter_by(id=body.recipe_id, household_id=hh.id).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
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


@router.delete("/prep/{session_id}/recipes/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_recipe_from_prep(
    session_id: str,
    entry_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = _get_user_id(request)
    hh = _get_household(db, uid)
    entry = db.query(PrepSessionRecipe).filter_by(id=entry_id, session_id=session_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    db.delete(entry)
    db.commit()
    session = db.query(PrepSession).filter_by(id=session_id, household_id=hh.id).first()
    if session:
        await _ws_manager.broadcast(hh.id, "prep_updated", _session_out(session))


@router.get("/prep/{session_id}/shopping-list")
def get_shopping_list(session_id: str, request: Request, db: Session = Depends(get_db)):
    """
    Master Shopping List: aggregate + deduplicate all ingredients across staged recipes.
    Cross-reference Stockroom — anything marked Good is omitted.
    """
    uid = _get_user_id(request)
    hh = _get_household(db, uid)
    session = db.query(PrepSession).filter_by(id=session_id, household_id=hh.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Prep session not found")

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
        ingredients = json.loads(ingredients_json)
        for ing in ingredients:
            name_key = ing.get("name", "").lower().strip()
            if name_key in good_stock:
                continue
            if name_key in aggregated:
                try:
                    aggregated[name_key]["qty"] = str(
                        round(float(aggregated[name_key]["qty"]) + float(ing.get("qty", 0)), 2)
                    )
                except (ValueError, TypeError):
                    pass
            else:
                aggregated[name_key] = {
                    "name": ing.get("name", ""),
                    "qty":  ing.get("qty", ""),
                    "unit": ing.get("unit", ""),
                }

    # Inject any Low stockroom items
    low_items = db.query(StockroomItem).filter_by(household_id=hh.id).all()
    for item in low_items:
        if item.state == StockState.LOW:
            key = item.name.lower().strip()
            if key not in aggregated:
                aggregated[key] = {"name": item.name, "qty": "", "unit": "", "_from_stockroom": True}

    return {"session_id": session_id, "shopping_list": list(aggregated.values())}


@router.get("/prep/{session_id}/staging")
def get_staging_area(session_id: str, request: Request, db: Session = Depends(get_db)):
    """Staging Area: shopping list split back into per-recipe piles."""
    uid = _get_user_id(request)
    hh = _get_household(db, uid)
    session = db.query(PrepSession).filter_by(id=session_id, household_id=hh.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Prep session not found")

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
            "recipe_id":    entry.recipe_id,
            "recipe_title": entry.recipe.title,
            "ingredients":  ingredients,
        })

    return {"session_id": session_id, "piles": piles}


@router.post("/prep/{session_id}/complete", status_code=status.HTTP_200_OK)
async def complete_prep_session(
    session_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = _get_user_id(request)
    hh = _get_household(db, uid)
    session = db.query(PrepSession).filter_by(id=session_id, household_id=hh.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Prep session not found")
    session.is_active = False
    session.completed_at = datetime.now(timezone.utc)
    db.commit()
    await _ws_manager.broadcast(hh.id, "prep_completed", {"session_id": session_id})
    return {"session_id": session_id, "completed": True}


# ---------------------------------------------------------------------------
# Walmart Cart Export
# ---------------------------------------------------------------------------

@router.get("/walmart/mappings")
def list_walmart_mappings(request: Request, db: Session = Depends(get_db)):
    uid = _get_user_id(request)
    hh = _get_household(db, uid)
    mappings = db.query(WalmartMapping).filter_by(household_id=hh.id).all()
    return [
        {"id": m.id, "ingredient_name": m.ingredient_name, "walmart_item_id": m.walmart_item_id}
        for m in mappings
    ]


@router.post("/walmart/mappings", status_code=status.HTTP_201_CREATED)
def create_walmart_mapping(
    body: WalmartMappingCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = _get_user_id(request)
    hh = _get_household(db, uid)
    name_norm = body.ingredient_name.lower().strip()
    existing = db.query(WalmartMapping).filter_by(household_id=hh.id, ingredient_name=name_norm).first()
    if existing:
        existing.walmart_item_id = body.walmart_item_id
        db.commit()
        return {"id": existing.id, "ingredient_name": existing.ingredient_name, "walmart_item_id": existing.walmart_item_id}
    m = WalmartMapping(
        household_id=hh.id,
        ingredient_name=name_norm,
        walmart_item_id=body.walmart_item_id,
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    return {"id": m.id, "ingredient_name": m.ingredient_name, "walmart_item_id": m.walmart_item_id}


@router.delete("/walmart/mappings/{mapping_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_walmart_mapping(mapping_id: str, request: Request, db: Session = Depends(get_db)):
    uid = _get_user_id(request)
    hh = _get_household(db, uid)
    m = db.query(WalmartMapping).filter_by(id=mapping_id, household_id=hh.id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Mapping not found")
    db.delete(m)
    db.commit()


@router.post("/walmart/export")
def walmart_export(
    request: Request,
    db: Session = Depends(get_db),
    session_id: Optional[str] = None,
):
    """
    Generate a Walmart Add-To-Cart URL from the active (or specified) prep session's shopping list.
    Returns mapped items as a URL and unmapped items as an alert list.
    """
    uid = _get_user_id(request)
    hh = _get_household(db, uid)

    if session_id:
        session = db.query(PrepSession).filter_by(id=session_id, household_id=hh.id).first()
    else:
        session = db.query(PrepSession).filter_by(household_id=hh.id, is_active=True).first()

    if not session:
        raise HTTPException(status_code=404, detail="No prep session found")

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
                qty = max(1, int(float(ing.get("qty", 1))))
            except (ValueError, TypeError):
                qty = 1
            cart_items.append(f"{item_id}_{qty}")
        else:
            unmapped.append(ing.get("name", name_key))

    if cart_items:
        cart_url = "https://www.walmart.com/sc/cart/addToCart?items=" + ",".join(cart_items)
    else:
        cart_url = None

    return {
        "cart_url":    cart_url,
        "mapped_count": len(cart_items),
        "unmapped":    unmapped,
    }
