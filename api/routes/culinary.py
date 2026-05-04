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


def _get_household(db: Session, owner_id: str) -> Household:
    hh = db.query(Household).filter_by(owner_id=owner_id).first()
    if not hh:
        hh = Household(owner_id=owner_id)
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

OLLAMA_BASE = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("LLM_MODEL", "llama3.2")

_RECIPE_SCHEMA_PROMPT = """
You are a recipe parser. Extract structured data from the text below and return ONLY valid JSON
with exactly this schema (no markdown, no prose, just JSON):

{
  "title": "string",
  "meal_type": "Breakfast|Lunch|Dinner|Snack|Dessert|Other",
  "primary_protein": "string or null",
  "servings": integer,
  "ingredients": [{"name": "string", "qty": "string", "unit": "string"}],
  "steps": ["string"],
  "equipment_needed": ["string"]
}

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
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            f"{OLLAMA_BASE}/api/generate",
            json={"model": OLLAMA_MODEL, "prompt": prompt, "stream": False},
        )
        resp.raise_for_status()
        return resp.json().get("response", "")


def _extract_json(text: str) -> Any:
    match = re.search(r"(\{[\s\S]*\}|\[[\s\S]*\])", text)
    if match:
        return json.loads(match.group(1))
    return json.loads(text)


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
    ingredients:     List[Dict[str, Any]] = []
    steps:           List[str] = []
    equipment_needed: List[str] = []


class RecipeUpdate(BaseModel):
    title:           Optional[str] = None
    meal_type:       Optional[str] = None
    primary_protein: Optional[str] = None
    servings:        Optional[int] = None
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

    raw_text = ""
    src_type = SourceType.MANUAL
    actual_url = source_url

    if file and file.filename:
        # PDF ingestion via PyMuPDF
        try:
            import fitz  # PyMuPDF
        except ImportError:
            raise HTTPException(status_code=500, detail="PyMuPDF not installed. Run: pip install pymupdf")
        content = await file.read()
        doc = fitz.open(stream=content, filetype="pdf")
        raw_text = "\n".join(page.get_text() for page in doc)
        src_type = SourceType.PDF

    elif source_url:
        # URL ingestion via BeautifulSoup
        try:
            from bs4 import BeautifulSoup
        except ImportError:
            raise HTTPException(status_code=500, detail="BeautifulSoup not installed. Run: pip install beautifulsoup4")
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            resp = await client.get(source_url, headers={"User-Agent": "RiverSongAI/1.0"})
        soup = BeautifulSoup(resp.text, "html.parser")
        for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
            tag.decompose()
        raw_text = soup.get_text(separator="\n", strip=True)
        src_type = SourceType.URL

    else:
        raise HTTPException(status_code=422, detail="Provide either a PDF file or a source_url")

    # Cap text to avoid overwhelming the model
    raw_text = raw_text[:8000]

    try:
        ollama_response = await _call_ollama(_RECIPE_SCHEMA_PROMPT + raw_text)
        parsed = _extract_json(ollama_response)
    except Exception as exc:
        logger.warning("Ollama parse failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"Ollama parsing failed: {exc}")

    ingredients = parsed.get("ingredients", [])
    blacklisted = _flag_blacklist(ingredients)
    meal_type_raw = parsed.get("meal_type", "Other")
    try:
        meal = MealType(meal_type_raw)
    except ValueError:
        meal = MealType.OTHER

    r = Recipe(
        household_id=hh.id,
        title=parsed.get("title", "Untitled Recipe"),
        meal_type=meal,
        primary_protein=parsed.get("primary_protein"),
        servings=int(parsed.get("servings", 4)),
        source_url=actual_url,
        source_type=src_type,
        ingredients_json=json.dumps(ingredients),
        steps_json=json.dumps(parsed.get("steps", [])),
        equipment_needed_json=json.dumps(parsed.get("equipment_needed", [])),
        blacklisted_json=json.dumps(blacklisted),
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    await _ws_manager.broadcast(hh.id, "recipe_created", _recipe_out(r))
    return _recipe_out(r)


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
