"""
providers/face_id/face_id_provider.py

Face enrollment and identification, built to sit beside voice match.

Same shape as `providers/voice_id/voice_id_provider.py` on purpose: a user
enrols a few samples from their own account, prints live on local disk under
`data/face_prints/<user_id>/`, identification is a cosine comparison against
those prints, and nothing ever leaves the machine.

MODELS
------
Detection is YuNet and recognition is SFace, both run through OpenCV's own
API. Neither ships with the OpenCV wheel, so both are fetched once:

    python scripts/fetch_face_models.py

Until they are present this provider reports `available: False` and every
identify call returns "cannot identify". That is the important failure mode —
a missing model must never read as "that isn't you", because the two would
lead a person to very different conclusions about their own house.

WHAT IS STORED
--------------
The 112x112 aligned crop and its 128-float embedding, per sample. Not the
frame it came from: enrolment needs a face, not a photograph of the room the
face was in. Deleting an enrolment removes the whole directory.

WHAT THIS IS FOR
----------------
A second factor, alongside a code typed on a touchscreen. It is not an
authorisation on its own, and no match at any confidence opens a lock, a
garage door or an alarm — that refusal lives in the intent router and does not
consult this.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import tempfile
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)

FACE_PRINTS_ROOT = "data/face_prints"
FACE_MODELS_ROOT = os.path.join("data", "models", "face")

DEFAULT_DETECTOR_MODEL = os.path.join(
    FACE_MODELS_ROOT, "face_detection_yunet_2023mar.onnx")
DEFAULT_RECOGNIZER_MODEL = os.path.join(
    FACE_MODELS_ROOT, "face_recognition_sface_2021dec.onnx")

# SFace's published operating point for cosine similarity. Above this, two
# crops are the same person. Kept as the default rather than tuned upward:
# raising it trades a locked-out household member for a marginal gain against
# an attacker who already has to be stood in the room.
SFACE_COSINE_THRESHOLD = 0.363

# Below this, a detection is too small or too uncertain to enrol from. A bad
# print is worse than no print — it makes every later comparison noisier.
MIN_FACE_SCORE = 0.9
MIN_FACE_PIXELS = 80


def _atomic_write_json(path: str, data: dict) -> None:
    """Write JSON atomically: tmp file + os.replace. Safe against partial writes."""
    dirname = os.path.dirname(path) or "."
    fd, tmp_path = tempfile.mkstemp(dir=dirname, suffix=".tmp", text=True)
    try:
        with os.fdopen(fd, "w") as handle:
            json.dump(data, handle, indent=2)
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


class FaceModelsUnavailable(RuntimeError):
    """OpenCV is missing, too old, or the model files have not been fetched."""


class FaceIDProvider:
    """
    Local face enrollment and identification.

    One instance per process. Models load lazily on first use and the print
    cache is read once from disk, mirroring VoiceIDProvider so the two behave
    the same way under the same conditions.
    """

    def __init__(self, *, detector_model: str = "", recognizer_model: str = "",
                 threshold: Optional[float] = None) -> None:
        self._detector = None
        self._recognizer = None
        self._models_checked = False
        self._unavailable_reason = ""

        self._detector_model = detector_model or self._configured("detector")
        self._recognizer_model = recognizer_model or self._configured("recognizer")
        self._threshold = (threshold if threshold is not None
                           else self._configured_threshold())

        self._executor = ThreadPoolExecutor(max_workers=1,
                                            thread_name_prefix="face-id")
        # user_id -> list of (128,) float32 embeddings
        self._cache: Dict[str, List[np.ndarray]] = {}
        self._cache_loaded = False
        self._user_locks: Dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    # -- configuration ----------------------------------------------------

    @staticmethod
    def _configured(which: str) -> str:
        try:
            from config.settings import get_settings
            settings = get_settings()
            value = getattr(settings, f"face_id_{which}_model", "") or ""
            return value.strip()
        except Exception:
            return ""

    @staticmethod
    def _configured_threshold() -> float:
        try:
            from config.settings import get_settings
            return float(getattr(get_settings(), "face_id_threshold",
                                 SFACE_COSINE_THRESHOLD))
        except Exception:
            return SFACE_COSINE_THRESHOLD

    # -- model loading ----------------------------------------------------

    def _ensure_models(self) -> Tuple[Any, Any]:
        """
        Load YuNet and SFace, or raise FaceModelsUnavailable with the reason.

        The reason is kept and reused so a deployment without models does not
        pay for a failed import on every request, and so the API can tell the
        user exactly what is missing.
        """
        if self._detector is not None and self._recognizer is not None:
            return self._detector, self._recognizer
        if self._models_checked and self._unavailable_reason:
            raise FaceModelsUnavailable(self._unavailable_reason)

        self._models_checked = True
        try:
            import cv2
        except ImportError:
            self._unavailable_reason = "OpenCV is not installed."
            raise FaceModelsUnavailable(self._unavailable_reason)

        if not hasattr(cv2, "FaceDetectorYN_create") or \
                not hasattr(cv2, "FaceRecognizerSF_create"):
            self._unavailable_reason = (
                f"OpenCV {cv2.__version__} has no YuNet/SFace support "
                "(needs 4.5.4 or newer)."
            )
            raise FaceModelsUnavailable(self._unavailable_reason)

        detector_path = self._detector_model or DEFAULT_DETECTOR_MODEL
        recognizer_path = self._recognizer_model or DEFAULT_RECOGNIZER_MODEL
        missing = [p for p in (detector_path, recognizer_path)
                   if not os.path.exists(p)]
        if missing:
            self._unavailable_reason = (
                f"Face model(s) not found: {', '.join(missing)}. "
                "Fetch them with: python scripts/fetch_face_models.py"
            )
            raise FaceModelsUnavailable(self._unavailable_reason)

        try:
            self._detector = cv2.FaceDetectorYN_create(  # type: ignore
                detector_path, "", (320, 320), score_threshold=0.8)
            self._recognizer = cv2.FaceRecognizerSF_create(recognizer_path, "")  # type: ignore
        except Exception as exc:
            self._unavailable_reason = f"Face models failed to load: {exc}"
            self._detector = self._recognizer = None
            raise FaceModelsUnavailable(self._unavailable_reason)

        self._unavailable_reason = ""
        logger.info("Face ID ready (YuNet + SFace, OpenCV %s, threshold %.3f).",
                    cv2.__version__, self._threshold)
        return self._detector, self._recognizer

    # -- image handling ---------------------------------------------------

    def _largest_face(self, image_bytes: bytes) -> Tuple[Any, Any]:
        """
        Decode an image and return (frame, detection row) for the biggest face.

        The biggest face is the one being offered: a person enrolling or
        authenticating is the one at the screen, not the one across the room.
        Raises ValueError when there is no usable face.
        """
        import cv2

        detector, _ = self._ensure_models()
        buffer = np.frombuffer(image_bytes, dtype=np.uint8)
        frame = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
        if frame is None:
            raise ValueError("That image could not be decoded.")

        height, width = frame.shape[:2]
        detector.setInputSize((width, height))
        _, faces = detector.detect(frame)
        if faces is None or len(faces) == 0:
            raise ValueError("No face found in that image.")

        # YuNet rows: x, y, w, h, 5 landmark pairs, score.
        best = max(faces, key=lambda row: float(row[2]) * float(row[3]))
        if float(best[-1]) < MIN_FACE_SCORE:
            raise ValueError("The face in that image is too indistinct.")
        if min(float(best[2]), float(best[3])) < MIN_FACE_PIXELS:
            raise ValueError("The face in that image is too small — move closer.")
        return frame, best

    def _embed(self, image_bytes: bytes) -> Tuple[np.ndarray, Any]:
        """Return (embedding, aligned crop) for the largest face in an image."""
        _, recognizer = self._ensure_models()
        frame, face = self._largest_face(image_bytes)
        aligned = recognizer.alignCrop(frame, face)
        feature = recognizer.feature(aligned)
        return np.asarray(feature, dtype=np.float32).reshape(-1), aligned

    def _match_score(self, a: np.ndarray, b: np.ndarray) -> float:
        """Cosine similarity between two SFace embeddings."""
        denominator = float(np.linalg.norm(a) * np.linalg.norm(b))
        if denominator == 0.0:
            return -1.0
        return float(np.dot(a, b) / denominator)

    # -- print cache ------------------------------------------------------

    def _load_cache(self) -> None:
        """Walk FACE_PRINTS_ROOT and load every stored embedding into memory."""
        self._cache = {}
        if os.path.isdir(FACE_PRINTS_ROOT):
            for user_id in os.listdir(FACE_PRINTS_ROOT):
                user_dir = os.path.join(FACE_PRINTS_ROOT, user_id)
                if not os.path.isdir(user_dir):
                    continue
                embeddings = []
                for name in sorted(os.listdir(user_dir)):
                    if name.endswith(".npy"):
                        try:
                            embeddings.append(
                                np.load(os.path.join(user_dir, name)))
                        except Exception as exc:
                            logger.warning("Unreadable face print %s: %s",
                                           name, exc)
                if embeddings:
                    self._cache[user_id] = embeddings
        self._cache_loaded = True
        logger.info("Face ID cache loaded: %d enrolled user(s).", len(self._cache))

    # -- public API -------------------------------------------------------

    async def availability(self) -> Dict[str, Any]:
        """
        Whether identification can run at all, and why not when it cannot.

        Surfaced to the account page so "face match is off" is a sentence with
        a cause, not a silently empty feature.
        """
        def _sync() -> Dict[str, Any]:
            try:
                self._ensure_models()
                return {"available": True, "reason": "",
                        "threshold": self._threshold}
            except FaceModelsUnavailable as exc:
                return {"available": False, "reason": str(exc),
                        "threshold": self._threshold}

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self._executor, _sync)

    async def enroll_sample(self, user_id: str, image_bytes: bytes) -> Dict[str, Any]:
        """
        Add one face sample for a user.

        Returns {sample_count, mean_self_similarity}. A low self-similarity
        means the samples disagree with each other — usually a second person
        in shot — and the account page should say so rather than quietly
        building a print that matches two people.
        """
        def _sync() -> Dict[str, Any]:
            import cv2

            embedding, aligned = self._embed(image_bytes)

            user_dir = os.path.join(FACE_PRINTS_ROOT, user_id)
            os.makedirs(user_dir, exist_ok=True, mode=0o700)

            existing = [f for f in os.listdir(user_dir) if f.endswith(".npy")]
            number = len(existing) + 1

            # The aligned 112x112 crop, not the frame it came from: enrolment
            # needs a face, not a photograph of the room around it.
            cv2.imwrite(os.path.join(user_dir, f"sample_{number}.jpg"), aligned)
            np.save(os.path.join(user_dir, f"sample_{number}.npy"), embedding)

            if not self._cache_loaded:
                self._load_cache()
            self._cache.setdefault(user_id, []).append(embedding)

            manifest_path = os.path.join(user_dir, "manifest.json")
            now = datetime.now(timezone.utc).isoformat()
            manifest: Dict[str, Any] = {"enrolled_at": now}
            if os.path.exists(manifest_path):
                try:
                    with open(manifest_path) as handle:
                        manifest["enrolled_at"] = json.load(handle).get(
                            "enrolled_at", now)
                except (OSError, json.JSONDecodeError) as exc:
                    logger.warning("face_id: manifest unreadable for %s: %s",
                                   user_id, exc)
            manifest["sample_count"] = number
            manifest["last_updated"] = now
            _atomic_write_json(manifest_path, manifest)

            samples = self._cache[user_id]
            if len(samples) > 1:
                scores = [self._match_score(samples[i], samples[j])
                          for i in range(len(samples))
                          for j in range(i + 1, len(samples))]
                mean_similarity = sum(scores) / len(scores)
            else:
                mean_similarity = 1.0

            return {"sample_count": number,
                    "mean_self_similarity": round(mean_similarity, 4)}

        async with self._user_locks[user_id]:
            loop = asyncio.get_running_loop()
            return await loop.run_in_executor(self._executor, _sync)

    async def identify(self, image_bytes: bytes,
                       threshold: Optional[float] = None) -> Dict[str, Any]:
        """
        Say who is in an image.

        Always returns a dict, never raises for the ordinary outcomes, so a
        caller can distinguish them:

            {"matched": True,  "user_id": ..., "confidence": ...}
            {"matched": False, "reason": "below_threshold" | "no_enrollments"
                                         | "no_face"}

        `matched` is this provider's own decision against a calibrated
        threshold. Callers should honour it rather than re-thresholding a
        cosine score whose scale they do not know.
        """
        effective = self._threshold if threshold is None else threshold

        def _sync() -> Dict[str, Any]:
            # Checked before the enrolment cache on purpose. "Nobody is
            # enrolled" is a true answer, but if the models are missing it is
            # not the *useful* one — the operator needs to know the feature
            # cannot run at all, and raising here says so.
            self._ensure_models()

            if not self._cache_loaded:
                self._load_cache()
            if not self._cache:
                return {"matched": False, "reason": "no_enrollments"}

            try:
                query, _ = self._embed(image_bytes)
            except ValueError as exc:
                return {"matched": False, "reason": "no_face",
                        "detail": str(exc)}

            best_user, best_score = None, -1.0
            runner_up, runner_up_score = None, -1.0
            for user_id, samples in self._cache.items():
                score = max(self._match_score(query, s) for s in samples)
                if score > best_score:
                    runner_up, runner_up_score = best_user, best_score
                    best_user, best_score = user_id, score
                elif score > runner_up_score:
                    runner_up, runner_up_score = user_id, score

            result: Dict[str, Any] = {
                "confidence": round(best_score, 4),
                "runner_up_user_id": runner_up,
                "runner_up_confidence": (round(runner_up_score, 4)
                                         if runner_up else None),
                "threshold": effective,
            }
            if best_user is None or best_score < effective:
                result.update({"matched": False, "reason": "below_threshold"})
                return result
            result.update({"matched": True, "user_id": best_user})
            return result

        # FaceModelsUnavailable propagates deliberately. A missing model means
        # this server could not look, which is a different answer to give a
        # person standing at a screen than "that isn't you".
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self._executor, _sync)

    async def delete_enrollment(self, user_id: str) -> None:
        """Remove a user's prints entirely. Their account, their data."""
        def _sync() -> None:
            user_dir = os.path.join(FACE_PRINTS_ROOT, user_id)
            if os.path.isdir(user_dir):
                shutil.rmtree(user_dir)
            self._cache.pop(user_id, None)

        loop = asyncio.get_running_loop()
        await loop.run_in_executor(self._executor, _sync)

    async def get_status(self, user_id: str) -> Dict[str, Any]:
        def _sync() -> Dict[str, Any]:
            manifest_path = os.path.join(FACE_PRINTS_ROOT, user_id,
                                         "manifest.json")
            if not os.path.exists(manifest_path):
                return {"enrolled": False, "sample_count": 0}
            try:
                with open(manifest_path) as handle:
                    return {"enrolled": True, **json.load(handle)}
            except Exception:
                return {"enrolled": False, "sample_count": 0}

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self._executor, _sync)

    def invalidate_cache(self) -> None:
        """Force the next identify to re-read prints from disk."""
        self._cache_loaded = False


_provider: Optional[FaceIDProvider] = None


def get_face_id_provider() -> FaceIDProvider:
    """Return the shared FaceIDProvider."""
    global _provider
    if _provider is None:
        _provider = FaceIDProvider()
    return _provider


async def match(image_bytes: bytes, owner_user_id: str) -> Optional[Dict[str, Any]]:
    """
    The `VORTEX_FACE_BACKEND` entry point.

    Vortex passes the frames a unit uploaded and expects {user_id, confidence}
    for a match, or None. `owner_user_id` scopes nothing here — prints are
    per-user across the whole install, exactly like voice prints, so a
    household member is recognised on any unit in the house.
    """
    result = await get_face_id_provider().identify(image_bytes)
    if not result.get("matched"):
        return None
    return {"user_id": result["user_id"],
            "confidence": result.get("confidence"),
            "matched": True}
