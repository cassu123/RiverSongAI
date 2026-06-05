"""
api/routes/voice_id.py

Voice enrollment + identification API.
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Header, Request
from pydantic import BaseModel
from core.auth import decode_token
from core.limiter import limiter
from config.settings import get_settings
from providers.voice_id.voice_id_provider import VoiceIDProvider

router = APIRouter(prefix="/api/voice-id", tags=["voice-id"])

_provider: Optional[VoiceIDProvider] = None


def _get_provider() -> VoiceIDProvider:
    global _provider
    if _provider is None:
        _provider = VoiceIDProvider()
    return _provider


class VoiceStatusResponse(BaseModel):
    enrolled: bool
    sample_count: int = 0
    enrolled_at: Optional[str] = None
    last_updated: Optional[str] = None


class EnrollResponse(BaseModel):
    sample_count: int
    mean_self_similarity: float


class IdentifyResponse(BaseModel):
    user_id: Optional[str] = None
    score: Optional[float] = None
    runner_up_user_id: Optional[str] = None
    runner_up_score: Optional[float] = None


async def _require_user(
        authorization: Optional[str] = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return payload["sub"]


async def _require_admin(
        authorization: Optional[str] = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload or payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin required")
    return payload["sub"]


@router.post("/enroll", response_model=EnrollResponse)
@limiter.limit(get_settings().rate_limit_voice_enroll)
async def enroll(
    request: Request,
    file: UploadFile = File(...),
    user_id: str = Depends(_require_user),
):
    wav_bytes = await file.read()
    if len(wav_bytes) < 1024:
        raise HTTPException(status_code=400, detail="Audio too short")
    result = await _get_provider().enroll_sample(user_id, wav_bytes)
    return result


@router.get("/me", response_model=VoiceStatusResponse)
async def get_my_status(user_id: str = Depends(_require_user)):
    return await _get_provider().get_status(user_id)


@router.delete("/me")
async def delete_my_enrollment(user_id: str = Depends(_require_user)):
    await _get_provider().delete_enrollment(user_id)
    return {"deleted": True}


# Admin-only: used by the conversation pipeline (via internal helper, not HTTP).
# Also exposed for debugging via curl.
@router.post("/identify", response_model=IdentifyResponse)
async def identify(
    file: UploadFile = File(...),
    _: str = Depends(_require_admin),
):
    wav_bytes = await file.read()
    threshold = get_settings().voice_id_threshold
    result = await _get_provider().identify(wav_bytes, threshold=threshold)
    return result or {"user_id": None}
