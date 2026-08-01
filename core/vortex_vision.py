"""
core/vortex_vision.py

Camera handling for River Vortex units: motion snapshots, their retention, and
face identification as a second factor.

The device layer for this landed first and was built privacy-first, which
constrains everything here:

  * A camera is not fitted unless the unit's profile says so.
  * Each use is consented separately — video_calls, motion_snapshots,
    presence, face_recognition — and all default off.
  * A capture request for a purpose the owner has not enabled is refused, and
    that refusal is a distinct outcome from hardware failure. Nothing in this
    module retries around one or looks for another way to get the frame.
  * The privacy LED is an interlock on the unit driven by the capture session
    itself. Frames are impossible without the light being on. There is no
    override and this server does not ask for one.

Identification happens here, never on the unit: the unit sends pixels and gets
back a decision (invariant 4). It never receives a roster of faces or an
embedding database.

RETENTION
---------
Snapshots live for SNAPSHOT_RETENTION_HOURS (24) and are then deleted from
disk and from the index. These are cameras in bedrooms; a motion snapshot
exists to tell someone what just happened, and past that window it is only a
liability. Uploaded identification frames are never written to disk at all —
they are matched in memory and dropped.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import logging
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

SNAPSHOT_RETENTION_HOURS = 24
_SNAPSHOT_DIR = os.path.join("data", "vortex_snapshots")
_MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024

# Face match confidence a unit-relayed identification must clear to count as a
# factor. Deliberately high: this sits alongside a typed code on medium-risk
# actions, and a weak match that still counts is worse than no match at all.
FACE_MATCH_THRESHOLD = 0.82

_JPEG_MAGIC = b"\xff\xd8\xff"
_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


# ---------------------------------------------------------------------------
# Snapshot storage
# ---------------------------------------------------------------------------

def _snapshot_secret() -> bytes:
    from config.settings import get_settings
    return (get_settings().jwt_secret_key or "vortex").encode("utf-8")


def _sign(snapshot_id: str, expires_at: int) -> str:
    return hmac.new(
        _snapshot_secret(),
        f"{snapshot_id}:{expires_at}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()[:32]


def snapshot_url(snapshot_id: str, expires_at: int) -> str:
    """
    Build a signed, expiring URL for a snapshot.

    Signed rather than token-authenticated because the unit renders this in an
    image element, which cannot attach a header. The signature expires with
    the snapshot itself, so a leaked URL outlives nothing.
    """
    return (f"/api/vortex/snapshots/{snapshot_id}"
            f"?exp={expires_at}&sig={_sign(snapshot_id, expires_at)}")


def _decode_image(encoded: str) -> Tuple[bytes, str]:
    """Decode a base64 image and identify its type, or raise ValueError."""
    if not encoded:
        raise ValueError("Empty image payload.")
    if "," in encoded[:64] and encoded.lstrip().startswith("data:"):
        encoded = encoded.split(",", 1)[1]
    try:
        raw = base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise ValueError(f"Image is not valid base64: {exc}")
    if len(raw) > _MAX_SNAPSHOT_BYTES:
        raise ValueError("Image exceeds the 4MB limit.")
    if raw.startswith(_JPEG_MAGIC):
        return raw, "image/jpeg"
    if raw.startswith(_PNG_MAGIC):
        return raw, "image/png"
    raise ValueError("Image must be JPEG or PNG.")


async def store_snapshot(unit_id: str, encoded_image: str) -> str:
    """
    Persist a motion snapshot and return a signed URL for it.

    Raises ValueError for anything that is not a decodable JPEG or PNG within
    the size limit.
    """
    raw, media_type = _decode_image(encoded_image)
    extension = "jpg" if media_type == "image/jpeg" else "png"
    snapshot_id = f"{unit_id}-{uuid.uuid4().hex[:12]}.{extension}"

    os.makedirs(_SNAPSHOT_DIR, exist_ok=True)
    path = os.path.join(_SNAPSHOT_DIR, snapshot_id)
    await asyncio.get_running_loop().run_in_executor(
        None, _write_file, path, raw)

    expires_at = int(time.time()) + SNAPSHOT_RETENTION_HOURS * 3600
    logger.info("Vortex snapshot %s stored from unit %s (%d bytes, expires %s).",
                snapshot_id, unit_id, len(raw),
                datetime.fromtimestamp(expires_at, timezone.utc).isoformat())
    return snapshot_url(snapshot_id, expires_at)


def _write_file(path: str, data: bytes) -> None:
    with open(path, "wb") as handle:
        handle.write(data)


def read_snapshot(snapshot_id: str, expires_at: int,
                  signature: str) -> Tuple[bytes, str]:
    """
    Read a snapshot given a valid, unexpired signature.

    Raises PermissionError on a bad or expired signature and FileNotFoundError
    when the snapshot has already aged out.
    """
    if ".." in snapshot_id or "/" in snapshot_id or "\\" in snapshot_id:
        raise PermissionError("Invalid snapshot id.")
    if expires_at < time.time():
        raise PermissionError("Snapshot link has expired.")
    if not hmac.compare_digest(signature or "", _sign(snapshot_id, expires_at)):
        raise PermissionError("Invalid snapshot signature.")

    path = os.path.join(_SNAPSHOT_DIR, snapshot_id)
    with open(path, "rb") as handle:
        data = handle.read()
    media_type = "image/png" if snapshot_id.endswith(".png") else "image/jpeg"
    return data, media_type


async def purge_expired_snapshots() -> int:
    """
    Delete snapshots older than the retention window.

    Called from the app's periodic sweep. Retention is enforced by deletion,
    not by an expiring link — a link that stops working over a file that is
    still on disk is not retention.
    """
    def _purge() -> int:
        if not os.path.isdir(_SNAPSHOT_DIR):
            return 0
        cutoff = time.time() - SNAPSHOT_RETENTION_HOURS * 3600
        removed = 0
        for name in os.listdir(_SNAPSHOT_DIR):
            path = os.path.join(_SNAPSHOT_DIR, name)
            try:
                if os.path.isfile(path) and os.path.getmtime(path) < cutoff:
                    os.unlink(path)
                    removed += 1
            except OSError as exc:
                logger.warning("Could not purge snapshot %s: %s", name, exc)
        return removed

    removed = await asyncio.get_running_loop().run_in_executor(None, _purge)
    if removed:
        logger.info("Purged %d Vortex snapshot(s) past the %dh retention window.",
                    removed, SNAPSHOT_RETENTION_HOURS)
    return removed


# ---------------------------------------------------------------------------
# Face identification
# ---------------------------------------------------------------------------

class FaceRecognitionUnavailable(RuntimeError):
    """No recognition backend is configured for this deployment."""


async def _detect_faces(image: bytes) -> int:
    """
    Count faces in an image using OpenCV's bundled frontal-face cascade.

    Detection only — this says a person is in frame, not who they are. That is
    enough for the `presence` purpose and is a precondition for the rest.
    Returns -1 when OpenCV is unavailable, so callers can tell "no faces" from
    "could not look".
    """
    def _run() -> int:
        try:
            import cv2
            import numpy as np
        except ImportError:
            return -1
        try:
            buffer = np.frombuffer(image, dtype=np.uint8)
            frame = cv2.imdecode(buffer, cv2.IMREAD_GRAYSCALE)
            if frame is None:
                return -1
            cascade_path = os.path.join(
                cv2.data.haarcascades, "haarcascade_frontalface_default.xml")
            cascade = cv2.CascadeClassifier(cascade_path)
            if cascade.empty():
                return -1
            faces = cascade.detectMultiScale(frame, scaleFactor=1.1,
                                             minNeighbors=5, minSize=(60, 60))
            return len(faces)
        except Exception as exc:
            logger.debug("Face detection failed: %s", exc)
            return -1

    return await asyncio.get_running_loop().run_in_executor(None, _run)


async def _match_face(image: bytes, owner_user_id: str) -> Optional[Dict[str, Any]]:
    """
    Match a face against the household's enrolled identities.

    Recognition is pluggable and, by default, absent: this deployment ships
    detection but no embedding model, and inventing a match from a general
    vision model would be a confident answer to a question it cannot answer.
    Configure a backend that exposes `match(image_bytes, owner_user_id)` at
    `settings.vortex_face_backend` to enable it.

    Raises FaceRecognitionUnavailable when no backend is configured, so the
    caller reports "cannot identify" rather than "not recognised" — those are
    very different answers to give a person standing at a screen.
    """
    from config.settings import get_settings

    dotted = (getattr(get_settings(), "vortex_face_backend", "") or "").strip()
    if not dotted:
        raise FaceRecognitionUnavailable(
            "No face recognition backend configured (VORTEX_FACE_BACKEND).")

    module_name, _, attribute = dotted.rpartition(".")
    if not module_name:
        raise FaceRecognitionUnavailable(f"Invalid backend path '{dotted}'.")

    import importlib

    backend = getattr(importlib.import_module(module_name), attribute)
    result = backend(image, owner_user_id)
    if asyncio.iscoroutine(result):
        result = await result
    return result


async def identify_from_frames(*, unit_id: str, owner_user_id: str,
                               purpose: str, frames: List[str],
                               challenge_id: Optional[str] = None
                               ) -> Dict[str, Any]:
    """
    Decide who is in a set of frames, and what that permits.

    Args:
        unit_id: The reporting unit. The caller has already confirmed the
            purpose is consented on it.
        owner_user_id: Household owner, used to scope the identity roster.
        purpose: `presence` or `face_recognition`.
        frames: base64 JPEG/PNG frames. Held in memory and dropped — never
            written to disk.
        challenge_id: When present, a successful high-confidence match counts
            as one factor against that pending confirmation. It is recorded on
            the challenge; the typed code is still required, because a face is
            a factor and not an authorisation.

    Returns a decision dict. It never contains a roster, an embedding, or any
    identity other than the one matched.
    """
    decoded: List[bytes] = []
    for frame in frames:
        try:
            raw, _ = _decode_image(frame)
            decoded.append(raw)
        except ValueError as exc:
            logger.debug("Discarding undecodable frame from %s: %s", unit_id, exc)
    if not decoded:
        return {"status": "error", "reason": "no_decodable_frames"}

    face_counts = [await _detect_faces(frame) for frame in decoded]
    best_count = max(face_counts)
    if best_count < 0:
        return {"status": "unavailable", "reason": "no_detector",
                "message": "Face detection is not available on this server."}

    if purpose == "presence":
        # Presence is a routing hint — which screen to wake, which room the
        # music follows. Never an authorisation signal.
        return {"status": "ok", "purpose": "presence",
                "occupied": best_count > 0, "faces": best_count}

    if best_count == 0:
        return {"status": "no_match", "reason": "no_face_in_frame",
                "message": "I couldn't see a face."}

    try:
        match = await _match_face(decoded[face_counts.index(best_count)],
                                  owner_user_id)
    except FaceRecognitionUnavailable as exc:
        logger.info("Face identification requested on %s but unavailable: %s",
                    unit_id, exc)
        return {"status": "unavailable", "reason": "no_recognition_backend",
                "message": "I can see someone, but I can't tell who yet."}
    except Exception as exc:
        logger.error("Face identification failed on %s: %s", unit_id, exc)
        return {"status": "error", "reason": "backend_error"}

    confidence = float((match or {}).get("confidence") or 0.0)
    identity = (match or {}).get("user_id") or ""

    if not identity or confidence < FACE_MATCH_THRESHOLD:
        return {"status": "no_match", "confidence": round(confidence, 3),
                "message": "I couldn't place that face."}

    logger.info("Vortex unit %s identified %s (confidence %.2f).",
                unit_id, identity, confidence)

    result: Dict[str, Any] = {
        "status": "ok",
        "purpose": "face_recognition",
        "user_id": identity,
        "confidence": round(confidence, 3),
    }

    if challenge_id:
        from core.vortex_security import confirmations

        pending = await confirmations.peek(challenge_id)
        if pending is not None and identity == pending.user_id:
            pending.payload["face_factor"] = {
                "user_id": identity, "confidence": confidence, "at": time.time(),
            }
            result["challenge_id"] = challenge_id
            result["factor_recorded"] = True
        # A face is one factor. The typed code is still required, and no
        # match at any confidence changes the hard deny on locks, garage
        # doors or alarm disarm.
        result["still_requires_code"] = True

    return result
