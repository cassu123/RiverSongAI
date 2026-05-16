"""
providers/voice_id/voice_id_provider.py

Speaker-identification provider using Resemblyzer.
Local-only, no network calls, biometric data never leaves disk.
"""
from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Optional

import numpy as np
import soundfile as sf

logger = logging.getLogger(__name__)

VOICE_PRINTS_ROOT = "data/voice_prints"


class VoiceIDProvider:
    def __init__(self):
        self._encoder = None  # lazy-loaded Resemblyzer encoder
        self._executor = ThreadPoolExecutor(max_workers=1)
        # In-memory cache: user_id -> list[np.ndarray] of embeddings
        self._cache: dict[str, list[np.ndarray]] = {}
        self._cache_loaded = False

    def _ensure_encoder(self):
        if self._encoder is None:
            from resemblyzer import VoiceEncoder
            self._encoder = VoiceEncoder(device="cpu")
            logger.info("Resemblyzer VoiceEncoder loaded on CPU.")
        return self._encoder

    def _load_cache(self) -> None:
        """Walk VOICE_PRINTS_ROOT and load all .npy embeddings into RAM."""
        if not os.path.isdir(VOICE_PRINTS_ROOT):
            self._cache_loaded = True
            return
        for user_id in os.listdir(VOICE_PRINTS_ROOT):
            user_dir = os.path.join(VOICE_PRINTS_ROOT, user_id)
            if not os.path.isdir(user_dir):
                continue
            embeddings = []
            for fname in sorted(os.listdir(user_dir)):
                if fname.endswith(".npy"):
                    embeddings.append(np.load(os.path.join(user_dir, fname)))
            if embeddings:
                self._cache[user_id] = embeddings
        self._cache_loaded = True
        logger.info(f"Voice ID cache loaded: {len(self._cache)} enrolled users.")

    def _wav_to_array(self, wav_bytes: bytes) -> np.ndarray:
        """Decode WAV bytes to a float32 numpy array at 16kHz mono."""
        from resemblyzer import preprocess_wav
        # preprocess_wav accepts bytes or path; using BytesIO so we don't write to disk
        data, sr = sf.read(io.BytesIO(wav_bytes), dtype="float32")
        if data.ndim > 1:
            data = data.mean(axis=1)  # downmix to mono
        # preprocess_wav handles the resample + trim
        return preprocess_wav(data, source_sr=sr)

    async def enroll_sample(self, user_id: str, wav_bytes: bytes) -> dict:
        """Persist one voice sample for this user. Returns {sample_count, mean_self_similarity}."""
        def _sync():
            enc = self._ensure_encoder()
            wav = self._wav_to_array(wav_bytes)
            embedding = enc.embed_utterance(wav)  # shape (256,)

            user_dir = os.path.join(VOICE_PRINTS_ROOT, user_id)
            os.makedirs(user_dir, exist_ok=True, mode=0o700)

            # Find next sample number
            existing = [f for f in os.listdir(user_dir) if f.startswith("sample_") and f.endswith(".wav")]
            n = len(existing) + 1
            wav_path = os.path.join(user_dir, f"sample_{n}.wav")
            npy_path = os.path.join(user_dir, f"sample_{n}.npy")

            with open(wav_path, "wb") as f:
                f.write(wav_bytes)
            np.save(npy_path, embedding)

            # Update cache
            self._cache.setdefault(user_id, []).append(embedding)

            # Update manifest
            manifest_path = os.path.join(user_dir, "manifest.json")
            now_iso = datetime.now(timezone.utc).isoformat()
            if os.path.exists(manifest_path):
                manifest = json.load(open(manifest_path))
            else:
                manifest = {"enrolled_at": now_iso}
            manifest["sample_count"] = n
            manifest["last_updated"] = now_iso
            with open(manifest_path, "w") as f:
                json.dump(manifest, f, indent=2)

            # Compute mean self-similarity for the response
            embs = self._cache[user_id]
            if len(embs) > 1:
                sims = []
                for i in range(len(embs)):
                    for j in range(i+1, len(embs)):
                        sims.append(float(np.dot(embs[i], embs[j]) /
                                          (np.linalg.norm(embs[i]) * np.linalg.norm(embs[j]))))
                mean_sim = sum(sims) / len(sims)
            else:
                mean_sim = 1.0

            return {"sample_count": n, "mean_self_similarity": mean_sim}

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(self._executor, _sync)

    async def identify(self, wav_bytes: bytes, threshold: float = 0.75) -> Optional[dict]:
        """Return {user_id, score, runner_up_user_id, runner_up_score} or None below threshold."""
        if not self._cache_loaded:
            await asyncio.get_event_loop().run_in_executor(self._executor, self._load_cache)
        if not self._cache:
            return None

        def _sync():
            enc = self._ensure_encoder()
            wav = self._wav_to_array(wav_bytes)
            query_emb = enc.embed_utterance(wav)
            qn = np.linalg.norm(query_emb)

            best_user, best_score = None, -1.0
            second_user, second_score = None, -1.0
            for user_id, embs in self._cache.items():
                # Max cosine across this user's samples
                user_max = max(
                    float(np.dot(query_emb, e) / (qn * np.linalg.norm(e)))
                    for e in embs
                )
                if user_max > best_score:
                    second_user, second_score = best_user, best_score
                    best_user, best_score = user_id, user_max
                elif user_max > second_score:
                    second_user, second_score = user_id, user_max

            if best_user is None or best_score < threshold:
                return {
                    "user_id": None,
                    "score": best_score if best_user else None,
                    "runner_up_user_id": second_user,
                    "runner_up_score": second_score if second_user else None,
                }
            return {
                "user_id": best_user,
                "score": best_score,
                "runner_up_user_id": second_user,
                "runner_up_score": second_score if second_user else None,
            }

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(self._executor, _sync)

    async def delete_enrollment(self, user_id: str) -> None:
        def _sync():
            user_dir = os.path.join(VOICE_PRINTS_ROOT, user_id)
            if not os.path.isdir(user_dir):
                return
            import shutil
            shutil.rmtree(user_dir)
            self._cache.pop(user_id, None)
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(self._executor, _sync)

    async def get_status(self, user_id: str) -> dict:
        def _sync():
            user_dir = os.path.join(VOICE_PRINTS_ROOT, user_id)
            manifest_path = os.path.join(user_dir, "manifest.json")
            if not os.path.exists(manifest_path):
                return {"enrolled": False, "sample_count": 0}
            try:
                with open(manifest_path) as f:
                    manifest = json.load(f)
                return {"enrolled": True, **manifest}
            except Exception:
                return {"enrolled": False, "sample_count": 0}
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(self._executor, _sync)
