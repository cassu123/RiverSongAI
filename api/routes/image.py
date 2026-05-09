"""
api/routes/image.py

API endpoints for local image generation via Stable Diffusion.
"""

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel
from providers.image.sd_provider import SDProvider
from config.settings import get_settings

router = APIRouter(prefix="/api/image", tags=["image"])

class ImageGenerateBody(BaseModel):
    prompt: str
    negative_prompt: str = ""
    width: int = 512
    height: int = 512
    steps: int = 20

@router.post("/generate")
async def generate_image(body: ImageGenerateBody):
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
        raise HTTPException(status_code=500, detail=f"Image generation failed: {str(exc)}")
