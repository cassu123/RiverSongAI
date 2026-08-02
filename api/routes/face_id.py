"""
api/routes/face_id.py

Face enrollment + identification API.

Deliberately the same shape as `/api/voice-id`: a user enrols from their own
account, sees their own status, and can delete their own prints. The account
page can render the two side by side without special-casing either.

    POST   /api/face-id/enroll     one image, adds a sample
    GET    /api/face-id/me         enrolment status
    DELETE /api/face-id/me         remove every print
    GET    /api/face-id/status     whether the feature can run at all
    POST   /api/face-id/identify   admin only, for debugging

Face match is a *second factor*. A match never opens a lock, a garage door or
an alarm from a room hub — that refusal lives in the intent router and does
not consult this.
"""

from typing import Optional

from fastapi import (
    APIRouter, Depends, File, Header, HTTPException, Request, UploadFile,
)
from pydantic import BaseModel

from config.settings import get_settings
from core.auth import decode_token
from core.limiter import limiter
from providers.face_id.face_id_provider import (
    FaceModelsUnavailable,
    get_face_id_provider,
)

router = APIRouter(prefix="/api/face-id", tags=["face-id"])

# A face is a few tens of KB as a JPEG; anything much larger is a full-frame
# upload that enrolment does not need.
_MAX_IMAGE_BYTES = 8 * 1024 * 1024
_MIN_IMAGE_BYTES = 512


class FaceStatusResponse(BaseModel):
    enrolled: bool
    sample_count: int = 0
    enrolled_at: Optional[str] = None
    last_updated: Optional[str] = None


class EnrollResponse(BaseModel):
    sample_count: int
    mean_self_similarity: float


class AvailabilityResponse(BaseModel):
    available: bool
    reason: str = ""
    threshold: float = 0.0


class IdentifyResponse(BaseModel):
    matched: bool = False
    user_id: Optional[str] = None
    confidence: Optional[float] = None
    reason: Optional[str] = None
    runner_up_user_id: Optional[str] = None
    runner_up_confidence: Optional[float] = None


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


@router.get("/status", response_model=AvailabilityResponse)
async def availability(_: str = Depends(_require_user)):
    """
    Whether face match can run, and why not when it cannot.

    The account page needs this before it offers enrolment: "face match is
    unavailable because the models have not been fetched" is a sentence
    someone can act on. A disabled button with no explanation is not.
    """
    return await get_face_id_provider().availability()


@router.post("/enroll", response_model=EnrollResponse)
@limiter.limit(get_settings().rate_limit_voice_enroll)
async def enroll(
    request: Request,
    file: UploadFile = File(...),
    user_id: str = Depends(_require_user),
):
    """
    Add one face sample to the calling user's enrolment.

    Three or four samples in different light is the useful range. Each one is
    stored as an aligned crop plus its embedding, under this user's directory
    and nowhere else.
    """
    image = await file.read()
    if len(image) < _MIN_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="That image is too small.")
    if len(image) > _MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="That image is too large.")

    try:
        return await get_face_id_provider().enroll_sample(user_id, image)
    except FaceModelsUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except ValueError as exc:
        # "No face found", "too small", "too indistinct" — all things the
        # person can fix by taking another photo, so say which.
        raise HTTPException(status_code=422, detail=str(exc))


@router.get("/me", response_model=FaceStatusResponse)
async def get_my_status(user_id: str = Depends(_require_user)):
    return await get_face_id_provider().get_status(user_id)


@router.delete("/me")
async def delete_my_enrollment(user_id: str = Depends(_require_user)):
    """Remove every face print for the calling user. Their account, their data."""
    await get_face_id_provider().delete_enrollment(user_id)
    return {"deleted": True}


@router.post("/identify", response_model=IdentifyResponse)
async def identify(
    file: UploadFile = File(...),
    _: str = Depends(_require_admin),
):
    """
    Identify a face. Admin only — the live path is the Vortex camera route,
    which resolves identity server-side and hands the unit a decision.
    """
    image = await file.read()
    try:
        return await get_face_id_provider().identify(image)
    except FaceModelsUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc))
