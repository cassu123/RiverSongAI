"""
providers/llm/vision_provider.py

Ollama-based vision provider for River Song AI.
Handles local image analysis for structured data extraction.
"""

from __future__ import annotations

import base64
import json
import logging
import re
from typing import Any, Dict, Optional

import ollama
from config.settings import get_settings

logger = logging.getLogger(__name__)

class VisionProvider:
    """
    Handles local image analysis using Ollama vision models (e.g., moondream, llava).
    """

    def __init__(self):
        self._settings = get_settings()
        self._client = ollama.AsyncClient(host=self._settings.ollama_base_url)
        self._model = self._settings.vision_model
        self._enabled = self._settings.vision_enabled

    async def analyze_image(self, image_bytes: bytes, prompt: str) -> str:
        """
        Sends an image and a prompt to the local vision model.
        Returns the raw text response.
        """
        if not self._enabled:
            return ""

        try:
            image_b64 = base64.b64encode(image_bytes).decode("utf-8")
            
            response = await self._client.chat(
                model=self._model,
                messages=[{
                    "role": "user",
                    "content": prompt,
                    "images": [image_b64]
                }]
            )
            return response.get("message", {}).get("content", "")
        except Exception as exc:
            logger.error("Ollama vision analysis failed: %s", exc)
            return f"Error during image analysis: {str(exc)}"

    async def extract_recipe_data(self, image_bytes: bytes) -> Dict[str, Any]:
        """
        Extracts structured recipe details from an image.
        """
        prompt = (
            "Look at this recipe image. Extract: title, ingredient list, any visible instructions. "
            "Return as JSON with keys: title, ingredients (list of strings), notes."
        )
        raw = await self.analyze_image(image_bytes, prompt)
        return self._parse_json(raw, {"title": "", "ingredients": [], "notes": raw})

    async def extract_inventory_item(self, image_bytes: bytes) -> Dict[str, Any]:
        """
        Extracts structured inventory details from a product/item image.
        """
        prompt = (
            "Look at this product/item image. Extract: item name, estimated quantity if visible, "
            "category (food/electronics/clothing/household/other), brief description. "
            "Return as JSON with keys: name, category, description."
        )
        raw = await self.analyze_image(image_bytes, prompt)
        return self._parse_json(raw, {"name": "", "category": "other", "description": raw})

    async def suggest_listing_details(self, image_bytes: bytes) -> Dict[str, Any]:
        """
        Suggests details for an online commerce listing based on an image.
        """
        prompt = (
            "Look at this product image. Suggest: title for an online listing, description (2-3 sentences), "
            "5 relevant tags. Return as JSON with keys: title, description, tags (list)."
        )
        raw = await self.analyze_image(image_bytes, prompt)
        return self._parse_json(raw, {"title": "", "description": raw, "tags": []})

    def _parse_json(self, text: str, fallback: Dict[str, Any]) -> Dict[str, Any]:
        """Attempts to extract and parse a JSON block from the model's text response."""
        try:
            # Look for JSON code block or just any {} structure
            match = re.search(r"(\{[\s\S]*\})", text)
            if match:
                return json.loads(match.group(1))
            return json.loads(text)
        except Exception:
            return fallback
