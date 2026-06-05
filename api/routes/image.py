"""
api/routes/image.py

API endpoints for local image generation via Stable Diffusion.
"""

from typing import Optional
from fastapi import APIRouter, HTTPException, Response, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from providers.image.sd_provider import SDProvider
from config.settings import get_settings
from core.limiter import limiter
from core.auth import decode_token

router = APIRouter(prefix="/api/image", tags=["image"])
_bearer = HTTPBearer(auto_error=False)


class ImageGenerateBody(BaseModel):
    prompt: str
    negative_prompt: str = ""
    width: int = 512
    height: int = 512
    steps: int = 20


async def _require_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> str:
    """Validate Bearer token and return the user's sub claim."""
    if not creds:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = await decode_token(creds.credentials)
    if not payload:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token.")
    return payload["sub"]


@router.post("/generate")
@limiter.limit(get_settings().rate_limit_image_gen)
async def generate_image(
    request: Request,
    body: ImageGenerateBody,
    user_id: str = Depends(_require_user)
):
    """
    Generate an image using the local Stable Diffusion provider.
    Returns the raw PNG image bytes.
    """
    settings = get_settings()
    if not settings.image_generation_enabled:
        raise HTTPException(
            status_code=403,
            detail="Image generation is disabled in settings. Enable IMAGE_GENERATION_ENABLED in .env."
        )

    provider = SDProvider()
    try:
        img_bytes = await provider.generate(
            prompt=body.prompt,
            negative_prompt=body.negative_prompt,
            width=body.width,
            height=body.height,
            steps=body.steps
        )
        return Response(content=img_bytes, media_type="image/png")
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Image generation failed: {
                str(exc)}")
