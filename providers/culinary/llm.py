"""
providers/culinary/llm.py

The culinary module's prompts and its calls to Ollama.

Recipe parsing, equipment translation, equipment identification from a photo
and substitute recommendation all go through here. The prompts live beside the
calls that use them rather than at the top of a route file, because a prompt
is the behaviour — editing one changes what the feature does.
"""

from __future__ import annotations

import logging
import os

import httpx

from api.services.recipe_parser import _extract_json

logger = logging.getLogger(__name__)

OLLAMA_TIMEOUT_SECONDS = 180


OLLAMA_BASE = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")

OLLAMA_MODEL = os.environ.get("CULINARY_LLM_MODEL", "qwen2.5:14b")

OLLAMA_VISION_MODEL = os.environ.get("CULINARY_VISION_MODEL", "gemma3:12b")

_KNOWN_EQUIPMENT_TYPES = [
    "air_fryer", "instant_pot", "dutch_oven", "sous_vide",
    "slow_cooker", "stand_mixer", "wok", "grill",
]

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
