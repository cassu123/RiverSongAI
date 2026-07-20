"""
api/routes/vision.py

Endpoints for local image analysis using Ollama vision models.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from core.auth import decode_token
from config.settings import get_settings
from providers.llm.vision_provider import VisionProvider

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/vision", tags=["vision"])
_bearer = HTTPBearer(auto_error=False)


async def _require_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> str:
    if not creds:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = await decode_token(creds.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token.")
    return payload["sub"]

_vision_provider = VisionProvider()


def _check_vision_enabled():
    if not get_settings().vision_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Vision model is not enabled in settings."
        )


@router.post("/analyze")
async def analyze_image(
    file: UploadFile = File(...),
    prompt: Optional[str] = Form("Describe this image."),
    user_id: str = Depends(_require_user)
):
    _check_vision_enabled()

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail="File too large (max 10MB).")

    # type: ignore
    description = await _vision_provider.analyze_image(content, prompt)  # type: ignore
    return {
        "description": description,
        "model_used": get_settings().vision_model
    }


@router.post("/recipe")
async def extract_recipe(
    file: UploadFile = File(...),
    user_id: str = Depends(_require_user)
):
    _check_vision_enabled()

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail="File too large (max 10MB).")

    return await _vision_provider.extract_recipe_data(content)


@router.post("/inventory-item")
async def extract_inventory(
    file: UploadFile = File(...),
    user_id: str = Depends(_require_user)
):
    _check_vision_enabled()

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail="File too large (max 10MB).")

    return await _vision_provider.extract_inventory_item(content)


@router.post("/serial-plate")
async def extract_serial_plate(
    file: UploadFile = File(...),
    user_id: str = Depends(_require_user)
):
    _check_vision_enabled()
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 10MB).")
    return await _vision_provider.extract_serial_plate(content)

@router.post("/receipt")
async def extract_receipt(
    file: UploadFile = File(...),
    user_id: str = Depends(_require_user)
):
    _check_vision_enabled()
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 10MB).")
    return await _vision_provider.extract_receipt(content)

@router.post("/listing")
async def suggest_listing(
    file: UploadFile = File(...),
    user_id: str = Depends(_require_user)
):
    _check_vision_enabled()

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail="File too large (max 10MB).")

    return await _vision_provider.suggest_listing_details(content)
