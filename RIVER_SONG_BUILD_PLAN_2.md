# River Song AI — Phase 2 Build Plan (ultra-detailed)

**Audience:** Gemini (or any model with shell + file access in the repo root).
**Mode:** Feature build. Run *after* `RIVER_SONG_BUILD_PLAN.md` (CHRONOS UI + MCP + Pulse) has shipped and committed. The CHRONOS *backend* (`api/routes/vault.py` + `providers/vault/vault_provider.py`) is already present at the time of writing — do not re-create it.

This document is intentionally exhaustive. The Round 3 disaster (18 corrupted route files) happened because a session inferred too much. **Do not infer. If a line doesn't match what this document says, stop and ask.** Every file path, line number, function name, response shape, and SQL column listed below was verified against the working tree on 2026-05-15 at HEAD `e93a322`.

---

## 0. Verification standards (read this first, apply everywhere)

### 0.1 Python syntax checking

`ast.parse` does NOT catch `await` outside `async def`. Use `py_compile`:

```bash
python3 -c "import py_compile; py_compile.compile('<path>', doraise=True)"
```

After any non-trivial change, also confirm the app actually imports:

```bash
source venv/bin/activate
python3 -c "import sys; sys.path.insert(0,'.'); from main import app; print('routes:', len(app.routes))"
```

Expected: prints `routes: <N>` with N ≥ 300 (the baseline as of HEAD `e93a322`). Any traceback means stop, fix, retry.

### 0.2 Route auth pattern (settled — reuse, do not reinvent)

Every route file follows this exact pattern. Copy it verbatim:

```python
from typing import Optional
from fastapi import APIRouter, Header, HTTPException, Depends, Request
from core.auth import decode_token

router = APIRouter(prefix="/api/<name>", tags=["<name>"])

async def _require_user(authorization: Optional[str] = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return payload["sub"]
```

Variants for admin-gated, kiosk-permitted, and credentials-based (`HTTPBearer`) helpers exist elsewhere in `api/routes/`. **Look at an existing route file in the same module before copy-pasting.** Examples:

- Standard user helper: `api/routes/memory.py:37`
- Admin helper: `api/routes/auth.py:222` (with Request + db lookup)
- Kiosk-permitted helper: `api/routes/rover.py:23` (`Header(default=None)` default)
- HTTPBearer credentials helper: `api/routes/image.py:26`, `api/routes/vision.py:24`, `api/routes/routines.py:29`

### 0.3 Browser-test UI before claiming done

Type-checks verify compilation, not behavior. Start the dev stack:

```bash
# terminal 1
source venv/bin/activate && python3 main.py
# terminal 2
cd frontend && npm run dev
```

Open `http://localhost:5173`, log in, click through the new feature in the browser. If you can't reach a browser, *say so explicitly* — do not claim a UI works without seeing it render.

### 0.4 Do NOT touch these files except where this brief explicitly authorizes it

The Round 3 audit work that landed in `81abfa8` and `461ce79` is settled. Hands off:

- `core/auth.py`
- `core/family.py` (read-only for resolve_module_owner; do not modify)
- `config/settings.py` *except* explicit additions named in this brief (Section A.2.1 voice_id settings, Section D.1 walmart_api_key)
- `providers/memory/sqlite_store.py` *except* the new tables this brief authorizes (Section A.3 `voice_id_events`, Section D.4 `walmart_price_history`)
- `main.py` *except* router registrations and daemon startup wiring this brief authorizes
- Any file in `api/routes/` *except* the specific files this brief touches (`conversation.py`, `inventory.py`, `culinary.py`, plus the new `voice_id.py`)
- All `providers/llm/*.py`, `providers/tts/*.py`, `providers/stt/*.py`
- `.env`, `.env.example`

If a change to any of the above looks necessary, **stop and ask**.

### 0.5 Do NOT commit, do NOT push, do NOT create extra .md files

The user runs commits. The user runs pushes. Don't create new design docs, decision logs, or "summary of work" markdown files. Report inline at the end of each section.

---

## Section A — Voice ID (speaker recognition)

### A.0 What and why

Today every kiosk speaker is "anonymous household." River Song can't:
- Greet by name from a kiosk
- Gate role-restricted intents by voice (the existing `core/family.py::is_feature_enabled_for` cascade for child/teen roles is unreachable when nobody knows who's talking)
- Personalize responses

Adding **local speaker-recognition** turns *who is talking* into a signal the conversation pipeline uses. This section's scope is **enrolled family members only**, on the **existing voice WebSocket path**. Out of scope: visitor enrollment, voice cloning detection, anti-replay liveness, emotion analysis, per-utterance speaker change inside one session, continuous re-ID. Those are real features but separate.

### A.1 Model choice and dependencies

Use **Resemblyzer** (Apache-2.0, ~50MB model, CPU-friendly, fully local, no API key). It returns 256-dim speaker embeddings comparable via cosine similarity. Maintained, widely deployed.

**Add to `requirements.txt`** at the bottom in a new block. Find the existing structure with `grep -n "^# " requirements.txt | tail -10` and insert before any final "End of file" marker:

```
# -----------------------------------------------------------------------------
# Voice ID (speaker recognition, local)
# -----------------------------------------------------------------------------
resemblyzer>=0.1.4
```

**Do NOT add librosa**. Whisper already pulls a compatible audio stack (numpy, scipy, soundfile per `requirements.txt`). Resemblyzer's wav preprocessing accepts 16kHz mono float32 numpy arrays directly — we'll feed it that without librosa.

Install:

```bash
source venv/bin/activate
pip install "resemblyzer>=0.1.4"
```

If pip resolves dependencies that conflict with existing packages (likely `numba` requirements), stop and report — don't auto-resolve. Resemblyzer is generally clean on Python 3.11+, but the user is on 3.14 per `HANDOFF.md`, which is bleeding edge.

### A.2 Settings additions

Add to `config/settings.py`. Find the existing `Settings` class (it inherits from `BaseSettings`). After the last existing field, add:

```python
    # Voice ID
    voice_id_enabled: bool = True
    voice_id_threshold: float = 0.75
    voice_id_min_audio_seconds: float = 1.0
    voice_id_max_audio_seconds: float = 30.0
```

Threshold is the cosine-similarity cutoff. `0.75` is a sensible default for Resemblyzer; the user tunes via the settings UI (out of scope this section) or by editing `.env`. Min/max audio are guards: utterances under 1s have too little signal; over 30s eats memory unnecessarily.

### A.3 SQLite table — voice_id_events

Add to `providers/memory/sqlite_store.py`. The file has a clear schema-creation function and per-entity migration pattern. Look at the existing `revoked_tokens` table (added in Round 3 commit `81abfa8`) for the exact pattern.

**Schema:**

```sql
CREATE TABLE IF NOT EXISTS voice_id_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts REAL NOT NULL,
    identified_user_id TEXT,
    score REAL,
    runner_up_user_id TEXT,
    runner_up_score REAL,
    audio_duration_ms INTEGER,
    session_kind TEXT NOT NULL  -- 'kiosk' or 'authenticated'
);
CREATE INDEX IF NOT EXISTS ix_voice_id_events_ts ON voice_id_events(ts DESC);
```

**Methods to add to `SQLiteStore`** (mirror the async pattern at the top of the file — every public method is `async def`, runs the sync sqlite call via `loop.run_in_executor(self._executor, ...)`):

```python
async def log_voice_id_event(
    self,
    ts: float,
    identified_user_id: Optional[str],
    score: Optional[float],
    runner_up_user_id: Optional[str],
    runner_up_score: Optional[float],
    audio_duration_ms: int,
    session_kind: str,
) -> None: ...

async def get_recent_voice_id_events(self, limit: int = 50) -> List[dict]: ...
```

The `get_recent_voice_id_events` is for admin debugging; no route exposes it yet (the user can `sqlite3 data/db/river_song.db "SELECT * FROM voice_id_events ORDER BY ts DESC LIMIT 20;"`).

**Do not delete from `voice_id_events`** in normal operation. The user may want to retain it for ML model retraining later. A future feature can add a retention policy.

### A.4 Storage layout

Per-user voice prints live at `data/voice_prints/{user_id}/`. Each user enrolls **3–7 samples** (the cosine score against several embeddings is more robust than one). Layout per user:

```
data/voice_prints/<user_id>/
├── sample_1.wav         # raw audio, 16kHz mono PCM
├── sample_1.npy         # 256-dim float32 numpy array (the embedding)
├── sample_2.wav
├── sample_2.npy
├── ...
└── manifest.json        # {enrolled_at: <iso>, sample_count: <n>, last_updated: <iso>}
```

**Gitignore.** Add to `.gitignore` *before* the final newline:

```
# Voice biometric data — local only, never sync
data/voice_prints/
```

Verify with `grep -n "voice_prints" .gitignore` after — should show one line.

**Filesystem permissions:** the `data/voice_prints/` directory should be created mode 700 (owner-only). On first use the provider creates the user's subdirectory mode 700. This is a defense-in-depth measure; the primary protection is filesystem-level access control on the server.

### A.5 Provider — `providers/voice_id/voice_id_provider.py` (new file)

Create directory `providers/voice_id/` with an empty `__init__.py` (mirror `providers/vault/__init__.py` which already exists).

The provider file:

```python
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
            self._encoder = VoiceEncoder()
            logger.info("Resemblyzer VoiceEncoder loaded.")
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
            manifest = json.load(open(manifest_path))
            return {"enrolled": True, **manifest}
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(self._executor, _sync)
```

**Notes on this code:**

- `preprocess_wav` is Resemblyzer's built-in helper. It handles resampling and silence trimming. We feed it a numpy array of arbitrary sample rate; it returns 16kHz mono float32.
- The `ThreadPoolExecutor(max_workers=1)` is intentional. Resemblyzer's encoder isn't async; we wrap calls to keep the event loop responsive. Single worker prevents two enrollments racing on the same disk dir.
- The encoder loads on first use (lazy). First identification or enrollment takes ~3–5 seconds; subsequent calls are sub-second on CPU.
- Cache is loaded once on first `identify` call. New enrollments invalidate cache *for that user only*.

### A.6 Routes — `api/routes/voice_id.py` (new file)

```python
"""
api/routes/voice_id.py

Voice enrollment + identification API.
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Header, Request
from core.auth import decode_token
from providers.voice_id.voice_id_provider import VoiceIDProvider

router = APIRouter(prefix="/api/voice-id", tags=["voice-id"])

_provider: Optional[VoiceIDProvider] = None

def _get_provider() -> VoiceIDProvider:
    global _provider
    if _provider is None:
        _provider = VoiceIDProvider()
    return _provider


async def _require_user(authorization: Optional[str] = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return payload["sub"]


async def _require_admin(authorization: Optional[str] = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload or payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin required")
    return payload["sub"]


@router.post("/enroll")
async def enroll(
    file: UploadFile = File(...),
    user_id: str = Depends(_require_user),
):
    wav_bytes = await file.read()
    if len(wav_bytes) < 1024:
        raise HTTPException(status_code=400, detail="Audio too short")
    result = await _get_provider().enroll_sample(user_id, wav_bytes)
    return result


@router.get("/me")
async def get_my_status(user_id: str = Depends(_require_user)):
    return await _get_provider().get_status(user_id)


@router.delete("/me")
async def delete_my_enrollment(user_id: str = Depends(_require_user)):
    await _get_provider().delete_enrollment(user_id)
    return {"deleted": True}


# Admin-only: used by the conversation pipeline (via internal helper, not HTTP).
# Also exposed for debugging via curl.
@router.post("/identify")
async def identify(
    file: UploadFile = File(...),
    _: str = Depends(_require_admin),
):
    from config.settings import get_settings
    wav_bytes = await file.read()
    threshold = get_settings().voice_id_threshold
    result = await _get_provider().identify(wav_bytes, threshold=threshold)
    return result or {"user_id": None}
```

### A.7 Register the router

Two edits, exact locations:

**`api/routes/__init__.py`** — current state ends with the existing imports plus `__all__`. Add this import in the same block as the others:

```python
from .voice_id import router as voice_id_router
```

And add `"voice_id_router"` to the `__all__` list.

**`main.py`** — the `create_app()` function has a block of `app.include_router(...)` calls around lines 274-310. Add at the end of that block (just before the static files mount):

```python
    from api.routes import voice_id_router
    app.include_router(voice_id_router)
```

Or import it with the other routers at the top of the include block — match the style.

### A.8 Wire into the conversation pipeline

Two integration points. The conversation flow lands raw audio bytes, transcribes via Whisper, then runs intent routing. We insert identification between "audio received" and "intent routing".

**Site 1 — `api/routes/conversation.py:263`** is currently:

```python
audio_bytes = base64.b64decode(raw_data)
```

After this line, audio_bytes is in scope but identification hasn't been called yet. We will NOT call identification here directly — instead, pass `audio_bytes` plus `is_kiosk` (already in scope as a local boolean) down to the `ConversationLoop.run_once(...)` call, and do the identification inside the loop where the user_id is already mutable.

**Site 2 — `core/conversation_loop.py:540`** is:

```python
transcript = await self._stt.transcribe(audio_bytes)
```

Right after this line, but before the intent routing call, insert (read the surrounding code first — `run_once` is the function around line 471):

```python
# Voice ID — only override when session is anonymous kiosk
if self._is_kiosk and audio_bytes:
    from providers.voice_id.voice_id_provider import VoiceIDProvider
    from config.settings import get_settings
    if get_settings().voice_id_enabled:
        try:
            from providers.voice_id import _SINGLETON  # see note below
            vid = _SINGLETON
        except ImportError:
            vid = VoiceIDProvider()
        try:
            ident = await vid.identify(audio_bytes, threshold=get_settings().voice_id_threshold)
            if ident and ident.get("user_id"):
                # Override anonymous kiosk identity with identified user
                self._user_id = ident["user_id"]
                logger.info(f"Voice ID: identified as {ident['user_id']} score={ident['score']:.3f}")
                # Log event
                if hasattr(self, "_store") and self._store:
                    import time
                    await self._store.log_voice_id_event(
                        ts=time.time(),
                        identified_user_id=ident["user_id"],
                        score=ident["score"],
                        runner_up_user_id=ident.get("runner_up_user_id"),
                        runner_up_score=ident.get("runner_up_score"),
                        audio_duration_ms=int(len(audio_bytes) * 1000 / 32000),  # rough estimate
                        session_kind="kiosk",
                    )
            else:
                logger.debug("Voice ID: no enrolled speaker matched")
        except Exception as e:
            logger.warning(f"Voice ID failed (non-fatal): {e}")
```

**Critical:** the override **only** runs when `self._is_kiosk` is True. A logged-in user must never have their identity overridden by voice. Read `core/conversation_loop.py` to confirm the attribute name — it might be `self._kiosk` or `self.is_kiosk`. Match what's there.

**Singleton note:** the `_SINGLETON` import-guard pattern lets the same `VoiceIDProvider` instance be reused across conversation turns (preserving the in-memory cache + encoder). Add to `providers/voice_id/__init__.py`:

```python
from providers.voice_id.voice_id_provider import VoiceIDProvider
_SINGLETON: VoiceIDProvider = VoiceIDProvider()
```

This eager-loads the provider class but not the encoder (encoder is still lazy on first call).

### A.9 Frontend — Settings page enrollment section

The Settings page is at `frontend/src/pages/SettingsPage.jsx`. It uses a `<Section title="X">` wrapper component (defined at the top of the file, around line 38). The current sections are AI MODEL / VOICE / MEMORY. Add a new `<Section title="VOICE ID">` between VOICE and MEMORY.

The component must:

1. On mount, fetch `GET /api/voice-id/me` and render status:
   - If `enrolled === false`: "River Song doesn't recognize your voice yet. Record 3–5 samples to enable speaker recognition on kiosks."
   - If `enrolled === true`: "✓ Enrolled — {sample_count} samples, last updated {last_updated}. Recommended: at least 3 samples."
2. Provide a **Record button** with these states:
   - Idle: shows "Record sample"
   - Recording: shows a 5-second countdown ("3… 2… 1…") with a red dot indicator
   - Uploading: shows "Uploading…"
   - Success: brief toast "Sample added. You now have N samples." then refresh status
   - Failure: error message
3. Provide a **Delete button** (only visible when `sample_count > 0`) that opens a confirmation:
   > "Delete your voice prints from this server? River Song will no longer recognize your voice. You can re-enroll any time."

Use `MediaRecorder` (already in use elsewhere in this codebase — see `frontend/src/hooks/useAudioRecorder.js`). Record as `audio/webm` then convert server-side, OR record as `audio/wav` via a workaround. Easiest: post the webm directly and have the backend transcode via the existing Whisper preprocessing pipeline. Resemblyzer's `preprocess_wav` accepts any sample rate — but it expects a numpy array, not webm bytes.

**Decision:** convert webm to wav in the *browser* using the existing `useAudioRecorder` pattern. That hook (see `frontend/src/hooks/useAudioRecorder.js:150`) already records audio for the conversation flow. Reuse it; it returns WAV bytes ready to POST.

```jsx
// Inside the VOICE ID section, replicating the pattern from useAudioRecorder
import { useAudioRecorder } from '../hooks/useAudioRecorder'

function VoiceIDSection() {
  const { token } = useAuth()
  const [status, setStatus] = useState(null)
  const [recording, setRecording] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [error, setError] = useState('')

  const refreshStatus = useCallback(async () => {
    const res = await fetch('/api/voice-id/me', { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) setStatus(await res.json())
  }, [token])

  useEffect(() => { refreshStatus() }, [refreshStatus])

  const recorder = useAudioRecorder()  // exact API: see the hook file

  const enroll = async () => {
    setError('')
    setRecording(true)
    setCountdown(5)
    // tick down 5..0 over 5 real seconds
    for (let i = 5; i > 0; i--) {
      setCountdown(i)
      await new Promise(r => setTimeout(r, 1000))
    }
    setCountdown(0)
    const wavBytes = await recorder.stopAndGetWav()  // confirm exact method name in the hook
    setRecording(false)

    const formData = new FormData()
    formData.append('file', new Blob([wavBytes], { type: 'audio/wav' }), 'sample.wav')
    const res = await fetch('/api/voice-id/enroll', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    })
    if (!res.ok) {
      setError('Enrollment failed: ' + (await res.text()))
      return
    }
    await refreshStatus()
  }

  const deleteEnrollment = async () => {
    if (!confirm('Delete your voice prints from this server? River Song will no longer recognize your voice. You can re-enroll any time.')) return
    await fetch('/api/voice-id/me', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    await refreshStatus()
  }

  return (
    <Section title="VOICE ID">
      {/* render status, record button, delete button */}
      {/* exact styling: match the existing TTL or memory section visual style */}
    </Section>
  )
}
```

**Read `frontend/src/hooks/useAudioRecorder.js` before writing the component** — the exact method names may differ (`stopAndGetWav` is illustrative; the actual API may be `stop()` returning a Blob). Match what's there.

### A.10 Acceptance checks — Section A

Run all of these. Each must pass before claiming A is done.

**A.10.1 — Python compile:**
```bash
python3 -c "import py_compile; py_compile.compile('api/routes/voice_id.py', doraise=True); py_compile.compile('providers/voice_id/voice_id_provider.py', doraise=True); py_compile.compile('providers/voice_id/__init__.py', doraise=True)"
```
Expected: no output, exit 0.

**A.10.2 — App imports:**
```bash
python3 -c "import sys; sys.path.insert(0,'.'); from main import app; print('routes:', len(app.routes))"
```
Expected: prints `routes: N` where N ≥ 304 (was 300 at HEAD `e93a322`, +4 new voice-id routes).

**A.10.3 — Enrollment via curl (substitute a real token):**
```bash
# Record a 5-second sample any way you can (e.g. arecord on Linux, system recorder on Mac)
# Then:
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -F "file=@/tmp/sample.wav" \
  http://localhost:8000/api/voice-id/enroll
```
Expected response:
```json
{"sample_count": 1, "mean_self_similarity": 1.0}
```

**A.10.4 — Disk state:**
```bash
ls -la data/voice_prints/<your_user_id>/
```
Expected: directory exists mode 700, contains `sample_1.wav`, `sample_1.npy`, `manifest.json`.

**A.10.5 — Status:**
```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/voice-id/me
```
Expected: `{"enrolled": true, "enrolled_at": "...", "sample_count": 1, "last_updated": "..."}`.

**A.10.6 — Identification:**
```bash
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -F "file=@/tmp/sample.wav" \
  http://localhost:8000/api/voice-id/identify
```
Expected: `{"user_id": "<your_user_id>", "score": <number>, "runner_up_user_id": null, "runner_up_score": null}` with score > 0.95 (you're identifying against your own sample).

**A.10.7 — Kiosk pipeline test:**
- Open a kiosk WebSocket connection (use the existing kiosk page or a synthetic test).
- Speak into the kiosk; transcript flows through.
- Inspect: `sqlite3 data/db/river_song.db "SELECT * FROM voice_id_events ORDER BY ts DESC LIMIT 5;"`
- Latest row should show `identified_user_id = <your_user_id>` with score above threshold.

**A.10.8 — Auth override safety:**
- Open the Speak page logged in as user A. Voice-record a WAV of user B (must be enrolled).
- The conversation response must be addressed to user A. Voice ID does NOT override.
- Check `voice_id_events`: no new row should be added when `session_kind != 'kiosk'`, OR if added, the `session_kind` should be `'authenticated'` and the pipeline should not have used the identification.

### A.11 What Section A is NOT doing

- No emotion detection
- No liveness check / anti-replay (a future feature; currently a recorded WAV can spoof)
- No anti-cloning
- No continuous re-ID inside one long conversation
- No per-utterance speaker change detection
- No visitor enrollment
- No voice-print sync between machines

If you find yourself reaching for any of these, stop and flag.

---

## Section B — Camera-based barcode scanning (browser)

### B.0 What and why

Today the user types or pastes a UPC into:
- `frontend/src/pages/CulinaryPage.jsx:1416` (the `<input ref={barcodeRef} value={barcode}>` in StockroomTab)
- `frontend/src/pages/InventoryPage.jsx:480` (the EIN `<input value={ein}>` in the scan bar)

The phone or Hub camera should *be* the scanner. Backend already accepts a barcode string at `POST /api/culinary/stockroom/scan` (body `{barcode: str}`). This section adds **one reusable component** that captures via camera and auto-fills the existing input.

Future Android app (per `HANDOFF.md` reference to a separate `riversong_android_app` repo) will use ML Kit / ZXing native and hit the same APIs — this section makes the *browser* path real now.

### B.1 Library

**Use `@zxing/browser` + `@zxing/library`** (Apache-2.0). Maintained successor of zxing-js, reads UPC-A / UPC-E / EAN-13 / EAN-8 / Code 128 / QR.

**Add to `frontend/package.json`** in the `dependencies` block (find with `grep -n dependencies frontend/package.json`):

```json
"@zxing/browser": "^0.1.5",
"@zxing/library": "^0.21.3"
```

Install:
```bash
cd frontend && npm install --legacy-peer-deps
```

(`--legacy-peer-deps` per `HANDOFF.md` — the repo uses it everywhere.)

### B.2 Reusable component — `frontend/src/components/BarcodeScanner.jsx` (new file)

Exact component contract:

```jsx
/**
 * BarcodeScanner — full-screen modal that uses the device camera to scan barcodes.
 *
 * Props:
 *   onDetected: (value: string, format: string) => void
 *     Fires once per detected code. In continuous mode it fires per scan.
 *   onClose: () => void
 *     Fires when the user dismisses the modal (back button or Cancel).
 *   formats?: string[]
 *     Override the default scanned formats. Default:
 *     ['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'QR_CODE']
 *   continuous?: boolean
 *     If true, modal stays open after each detection (for bulk scanning).
 *     If false (default), modal closes on first detection.
 *
 * Behavior:
 *   - Rear camera preferred (facingMode: 'environment').
 *   - Vibrates 80ms on each detection (navigator.vibrate).
 *   - On permission denied, shows a "Camera access required" message with Cancel.
 *   - On unmount, fully stops the MediaStream (no track leaks).
 */
import React, { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'

const DEFAULT_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.QR_CODE,
]

export default function BarcodeScanner({ onDetected, onClose, formats, continuous = false }) {
  const videoRef = useRef(null)
  const readerRef = useRef(null)
  const [error, setError] = useState('')
  const [lastValue, setLastValue] = useState('')
  const [lastSeen, setLastSeen] = useState(0)

  useEffect(() => {
    const hints = new Map()
    hints.set(DecodeHintType.POSSIBLE_FORMATS, formats || DEFAULT_FORMATS)

    const reader = new BrowserMultiFormatReader(hints)
    readerRef.current = reader

    const start = async () => {
      try {
        await reader.decodeFromVideoDevice(undefined, videoRef.current, (result, err) => {
          if (result) {
            const value = result.getText()
            const format = result.getBarcodeFormat()
            const now = Date.now()
            // Dedupe — ignore identical scan within 1500ms
            if (value === lastValue && now - lastSeen < 1500) return
            setLastValue(value)
            setLastSeen(now)
            try { navigator.vibrate?.(80) } catch {}
            onDetected(value, format)
            if (!continuous) onClose()
          }
        })
      } catch (e) {
        if (e.name === 'NotAllowedError') {
          setError('Camera access denied. Enable it in browser settings.')
        } else if (e.name === 'NotFoundError') {
          setError('No camera found on this device.')
        } else {
          setError('Camera error: ' + e.message)
        }
      }
    }

    start()

    return () => {
      // Fully release the stream
      try {
        reader.reset()
        const stream = videoRef.current?.srcObject
        if (stream) {
          stream.getTracks().forEach(t => t.stop())
        }
      } catch {}
    }
  }, [continuous, formats, onDetected, onClose, lastValue, lastSeen])

  return (
    <div className="barcode-scanner-modal" role="dialog" aria-modal="true" aria-label="Barcode Scanner">
      <div className="barcode-scanner-overlay">
        <video ref={videoRef} className="barcode-scanner-video" playsInline muted />
        <div className="barcode-scanner-frame" />
        <div className="barcode-scanner-formats">UPC-A · EAN-13 · QR</div>
        <button className="barcode-scanner-cancel" onClick={onClose}>Cancel</button>
        {error && <div className="barcode-scanner-error">{error}</div>}
      </div>
    </div>
  )
}
```

### B.3 Styles — `frontend/src/components/BarcodeScanner.css` (new file)

```css
.barcode-scanner-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.95);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
}
.barcode-scanner-overlay {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.barcode-scanner-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.barcode-scanner-frame {
  position: absolute;
  width: 70vmin;
  height: 30vmin;
  border: 3px solid rgba(255, 255, 255, 0.9);
  border-radius: 12px;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.6);
  pointer-events: none;
}
.barcode-scanner-formats {
  position: absolute;
  bottom: 24px;
  left: 24px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.85rem;
}
.barcode-scanner-cancel {
  position: absolute;
  bottom: 24px;
  right: 24px;
  padding: 12px 24px;
  background: rgba(255, 255, 255, 0.15);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 8px;
  font-size: 1rem;
  cursor: pointer;
}
.barcode-scanner-error {
  position: absolute;
  top: 40%;
  background: rgba(255, 50, 50, 0.95);
  color: white;
  padding: 16px 24px;
  border-radius: 8px;
}
```

Import this CSS from `BarcodeScanner.jsx` at the top: `import './BarcodeScanner.css'`.

### B.4 Wire into culinary stockroom

**Target file:** `frontend/src/pages/CulinaryPage.jsx`.

**Target lines:** the `StockroomTab` function starts around line 1364. The barcode input + buttons are at lines 1411-1428. The exact existing block:

```jsx
{/* Barcode scanner */}
<div className="cul-card">
  <div className="cul-card-title"><Icon name="qr_code_scanner" size={18} /> Barcode Scanner</div>
  <div className="cul-scan-row">
    <input
      ref={barcodeRef}
      className="cul-input"
      placeholder="Barcode (UPC/EAN)"
      value={barcode}
      onChange={e => setBarcode(e.target.value)}
      onKeyDown={e => e.key === 'Enter' && scan(false)}
    />
    <button className="cul-btn cul-btn-primary" onClick={() => scan(false)}>...</button>
    <button className="cul-btn cul-btn-danger" onClick={() => scan(true)}>...</button>
  </div>
</div>
```

**Modification:** add a "📷 Scan" button after the danger button and import + state for the modal.

At the top of `CulinaryPage.jsx` (find the existing import block, around line 1):

```jsx
import BarcodeScanner from '../components/BarcodeScanner'
```

In `StockroomTab` (line 1364), after the existing `useState` calls for `barcode`, add:

```jsx
const [scannerOpen, setScannerOpen] = useState(false)
```

Then modify the `.cul-scan-row` div to add the camera button. **Exact insertion** — append this button after the danger button:

```jsx
<button className="cul-btn" onClick={() => setScannerOpen(true)} title="Scan with camera">
  <Icon name="photo_camera" size={18} />
</button>
```

And at the end of the StockroomTab JSX, just before the closing `</div>` of the outer component (find it; it's the matching close of the function's return statement), add:

```jsx
{scannerOpen && (
  <BarcodeScanner
    onDetected={(value) => {
      setBarcode(value)
      setScannerOpen(false)
      // Auto-trigger the scan flow on detection
      setTimeout(() => scan(false), 50)
    }}
    onClose={() => setScannerOpen(false)}
  />
)}
```

The `setTimeout(50)` gives React one tick to update the input state before the existing `scan` function reads `barcode.trim()`.

**Do NOT remove the manual entry input.** Both paths coexist.

### B.5 Wire into inventory EIN scan bar

**Target file:** `frontend/src/pages/InventoryPage.jsx`.

**Target lines:** the EIN scan bar is at lines 448-489. The existing structure:

```jsx
// ─── EIN scan bar ───
function ScanBar() {
  const [ein, setEin] = useState('')
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState('')
  const scan = async (e) => {
    e.preventDefault()
    if (!ein.trim()) return
    setScanning(true)
    try {
      const res = await safeFetch(`/api/inventory/scan/${encodeURIComponent(ein.trim())}`, {...})
      // ...
    } finally {
      setScanning(false)
    }
  }
  return (
    <form className="inv-scan-bar" onSubmit={scan}>
      <input className="inv-input inv-scan-input" value={ein} ... />
      <button className="inv-btn" type="submit" disabled={scanning}>
        {scanning ? '…' : <IconScan />}
      </button>
      {error && <span className="inv-scan-error">{error}</span>}
    </form>
  )
}
```

**Modification:** Add camera scan as a sibling button + modal. Same pattern as B.4. Import `BarcodeScanner` at the top:

```jsx
import BarcodeScanner from '../components/BarcodeScanner'
```

Inside `ScanBar`:

```jsx
const [scannerOpen, setScannerOpen] = useState(false)
```

Add the camera button inside the form:

```jsx
<button type="button" className="inv-btn" onClick={() => setScannerOpen(true)} title="Scan with camera">
  📷
</button>
```

And after the form's closing tag:

```jsx
{scannerOpen && (
  <BarcodeScanner
    onDetected={(value) => {
      setEin(value)
      setScannerOpen(false)
      // The form's onSubmit handler will trigger when the user presses enter or the scan button.
      // For EIN scanning, do NOT auto-submit — the user may want to verify the value first.
    }}
    onClose={() => setScannerOpen(false)}
  />
)}
```

Note: EIN scanning uses the existing `/api/inventory/scan/{ein}` endpoint, which is **not** UPC-based. Section C below adds a separate UPC-scan endpoint. For now, in the EIN scan bar, the camera fills the input but the user submits to look up the EIN. Section C wires the UPC flow into a new bulk-scan page.

### B.6 Acceptance checks — Section B

**B.6.1 — Lint + build:**
```bash
cd frontend && npm run build
```
Expected: no errors. Output mentions the new BarcodeScanner chunk.

**B.6.2 — Culinary stockroom scan, browser:**
1. Open `http://localhost:5173/`, log in, navigate to Culinary → Stockroom tab.
2. Click the new 📷 button. Camera permission prompt appears.
3. Grant. The full-screen modal shows a live camera feed with a scanning frame overlay.
4. Point at any barcoded product (a soup can, cereal box). Within 1–2 seconds the modal closes, the barcode input is populated, and the existing scan flow runs.
5. The stockroom list refreshes with the new/updated item.

**B.6.3 — Inventory EIN scan, browser:**
1. Navigate to Inventory page.
2. In the scan bar, click 📷. Modal opens.
3. Point at a QR code or Code 128 (you can print one of the existing EIN labels from the app).
4. Modal closes, input populated. User can verify and press submit.

**B.6.4 — Camera permission denial:**
1. In browser settings, block camera permission for `localhost:5173`.
2. Open the scanner modal. Confirm the error message appears ("Camera access denied. Enable it in browser settings.").
3. Cancel works. No video stream is leaked (DevTools → "More tools" → "Media" → no active streams).

**B.6.5 — Stream cleanup:**
1. Open the scanner. Confirm a `MediaStream` is active in DevTools.
2. Click Cancel. Confirm the stream is now stopped (no green camera indicator in browser, no active MediaStreamTrack).

**B.6.6 — iOS Safari smoke test (if available):**
- The user is likely on a Pixel + Chromebook (per memory + handoff). Safari is the failure-mode browser. If you can't test on Safari iOS, document the limitation in the report.

### B.7 What Section B is NOT doing

- No server-side image decode (browser handles it)
- No AI-assisted decoding for damaged/blurry barcodes
- No QR-code-as-deep-link handling (the QR just yields its text content)
- No backend barcode lookup chain enhancement (`_lookup_barcode` still uses Open Food Facts only)
- No native Android integration (the user's separate Android repo handles that)

---

## Section C — Inventory: UPC scan + bulk mode + audit assist

### C.0 What and why

`api/routes/inventory.py:376` exposes `GET /api/inventory/scan/{ein}` — scans River Song-internal EIN labels (the QR codes the app prints on items). Real-world unboxing means scanning **factory UPCs** and creating fresh inventory items. Bulk-scan mode makes this fast. Audit-assist closes the loop when items go missing.

### C.1 Extract `_lookup_barcode` to a shared module

**Current state:** `_lookup_barcode` is defined at `api/routes/culinary.py:842`. It uses Open Food Facts. The function is *only* called from culinary's `scan_barcode`.

**Action:** move it to `providers/web/barcode_lookup.py` (new file) so both culinary and inventory can import it without circular imports.

**New file `providers/web/barcode_lookup.py`:**

```python
"""
providers/web/barcode_lookup.py

UPC/EAN barcode lookup against Open Food Facts.
Returns {name, brand} or None.
"""
from typing import Optional
import httpx


async def lookup_barcode(upc: str) -> Optional[dict]:
    """
    Look up a UPC/EAN against Open Food Facts (free, food-focused, no API key).
    Returns {name: str, brand: str} on hit, None on miss or error.
    """
    url = f"https://world.openfoodfacts.org/api/v0/product/{upc}.json"
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.get(url)
            data = resp.json()
            if data.get("status") == 1:
                product = data.get("product", {})
                return {
                    "name": product.get("product_name") or product.get("product_name_en") or upc,
                    "brand": product.get("brands", ""),
                }
        except Exception:
            pass
    return None
```

**Update `api/routes/culinary.py`:**

Find lines 842-859 (the old `_lookup_barcode` definition). Delete it. Add to the imports near the top:

```python
from providers.web.barcode_lookup import lookup_barcode
```

Find every call to `_lookup_barcode(` in `api/routes/culinary.py` (`grep -n "_lookup_barcode" api/routes/culinary.py` — there will be at least the call at line ~2123 in `scan_barcode`). Replace with `lookup_barcode(`.

**Regression test the culinary stockroom scan after this move** — the existing browser flow must still work. Manual scan of a known UPC must return the same shape as before.

### C.2 New endpoint — `POST /api/inventory/items/scan-upc`

In `api/routes/inventory.py`, after the existing `scan_item` route (around line 376), add:

```python
from providers.web.barcode_lookup import lookup_barcode

class UPCScanBody(BaseModel):
    home_id: str
    upc: str
    location: Optional[str] = None
    notes: Optional[str] = None


@router.post("/items/scan-upc")
async def scan_upc(
    body: UPCScanBody,
    db: Session = Depends(get_db),
    user: InvUser = Depends(get_current_inv_user),
):
    """
    Scan a factory UPC into the inventory:
    - If a matching item exists in this home, return it with {existing: true}.
    - Otherwise, look up the UPC, create a new InventoryItem, return it with {existing: false}.
    """
    try:
        # Permission check: user owns or collaborates on this home
        home = db.query(InvHome).filter_by(id=body.home_id).first()
        if not home:
            raise HTTPException(status_code=404, detail="Home not found")
        # Match the membership pattern used in other inventory routes — read the
        # existing `_get_household` helper or membership check; do not reimplement.

        # Existing item by UPC in this home?
        existing = db.query(InventoryItem).filter_by(
            home_id=body.home_id, upc=body.upc
        ).first()
        if existing:
            return {**_ser_item(existing), "existing": True}

        # Look up product info (may return None for non-food / unknown)
        product = await lookup_barcode(body.upc)
        name = (product["name"] if product else body.upc)
        brand = (product["brand"] if product else "")

        # Create the new item — use the existing item-creation helper if there is one
        # (look for fast_scan_item or similar in inventory/management.py).
        # Auto-generate a fresh EIN via inventory/qr_utils.py::generate_ein.
        from inventory.qr_utils import generate_ein
        new_item = InventoryItem(
            home_id=body.home_id,
            ein=generate_ein(),
            name=name,
            brand=brand,
            upc=body.upc,
            location=body.location or "",
            notes=body.notes or "",
        )
        db.add(new_item)
        db.commit()
        db.refresh(new_item)
        return {**_ser_item(new_item), "existing": False}
    except Exception as e:
        raise _http(e)
```

**Schema dependency — STOP and check first:** does `InventoryItem` already have `upc` and `brand` columns?

```bash
grep -nE "upc|brand|last_seen" inventory/models.py
```

- If `upc` is present, use it.
- If `upc` is NOT present, this is a **schema migration**. Stop and ask the user before adding a column. Options to present:
  1. Add `upc = Column(String, nullable=True, index=True)` to `InventoryItem` and the corresponding migration (SQLAlchemy doesn't auto-migrate; the existing pattern uses `Base.metadata.create_all` which won't add columns to existing tables).
  2. Use the existing `description` or `notes` field to store UPC. Hacky but no migration.
- Same for `brand` and (for C.4) `last_seen_location` / `last_seen_at`.

Document which the user chose in the report-back.

### C.3 Bulk scan UI — `frontend/src/pages/InventoryBulkScan.jsx` (new file)

Add to the inventory page hierarchy. Since `InventoryPage.jsx` is the single inventory entry point, add a "Bulk Scan" button on the InventoryPage that opens the bulk-scan view (either as a separate sub-page or a full-screen modal).

**Decision:** make it a full-screen modal that opens from a button on InventoryPage's header. This avoids adding a new route to App.jsx (which is the page-key chain at lines 217-243).

**Add to `InventoryPage.jsx`** at the top of the JSX (near the existing scan bar):

```jsx
const [bulkOpen, setBulkOpen] = useState(false)

// ... in the JSX:
<button className="inv-btn" onClick={() => setBulkOpen(true)}>📦 Bulk Scan</button>
{bulkOpen && <InventoryBulkScan onClose={() => setBulkOpen(false)} />}
```

**The component:**

```jsx
import React, { useState, useEffect } from 'react'
import BarcodeScanner from '../components/BarcodeScanner'
import { useAuth } from '../context/AuthContext'

export default function InventoryBulkScan({ onClose }) {
  const { token } = useAuth()
  const [homes, setHomes] = useState([])
  const [homeId, setHomeId] = useState('')
  const [recent, setRecent] = useState([])  // last 10 scanned
  const [count, setCount] = useState(0)

  useEffect(() => {
    fetch('/api/inventory/homes', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(hs => { setHomes(hs); if (hs[0]) setHomeId(hs[0].id) })
  }, [token])

  const onDetected = async (upc) => {
    if (!homeId) return
    const res = await fetch('/api/inventory/items/scan-upc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ home_id: homeId, upc }),
    })
    if (!res.ok) return
    const item = await res.json()
    setRecent(prev => [{ ...item, _t: Date.now() }, ...prev].slice(0, 10))
    setCount(c => c + 1)
  }

  return (
    <div className="inv-bulk-modal">
      <div className="inv-bulk-header">
        <select value={homeId} onChange={e => setHomeId(e.target.value)}>
          {homes.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
        <span>Scanned: {count}</span>
        <button onClick={onClose}>Finish</button>
      </div>
      <BarcodeScanner onDetected={onDetected} onClose={onClose} continuous={true} />
      <div className="inv-bulk-recent">
        {recent.map((item, i) => (
          <div key={i} className={`inv-bulk-row ${item.existing ? 'existing' : 'new'}`}>
            <div>{item.name}</div>
            <div className="meta">{item.brand} · {item.existing ? 'already in inventory' : 'added'}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

Add CSS for `.inv-bulk-modal`, `.inv-bulk-header`, `.inv-bulk-recent`, `.inv-bulk-row`, `.inv-bulk-row.existing`, `.inv-bulk-row.new` in `frontend/src/pages/InventoryPage.css` — match the existing inventory page visual style.

### C.4 Audit assist

**Goal:** during audit, "missing items" panel shows where each item was last seen.

**Schema dependency:** `InventoryItem` needs `last_seen_location` and `last_seen_at` columns. Both nullable. **Stop and ask the user** before adding (see C.2 note about migrations). If approved, add to `inventory/models.py`:

```python
last_seen_location = Column(String, nullable=True)
last_seen_at = Column(DateTime, nullable=True)
```

**Update points** — every place the item is "seen":

1. `scan_item` route (line 377): set `item.last_seen_location = item.location` and `item.last_seen_at = datetime.utcnow()` then commit.
2. `scan_upc` route (the new one in C.2): same update.
3. `scan_item_audit` route (line 450): set both on the scanned item.

**Audit detail UI:**

Find the audit detail JSX in `InventoryPage.jsx` (grep for `audit`, `missing`, `_ser_audit` references). The existing `_ser_audit` response shape (line 384) is:

```json
{
  "id": "...",
  "scanned": [{"id", "ein", "name", "location"}, ...],
  "missing": [{"id", "ein", "name", "location"}, ...]
}
```

Extend the backend `_ser_audit` (in `api/routes/inventory.py:384`) to include `last_seen_location` and `last_seen_at`:

```python
missing = [{
    "id": str(i.id), "ein": i.ein, "name": i.name, "location": i.location,
    "last_seen_location": i.last_seen_location,
    "last_seen_at": i.last_seen_at.isoformat() if i.last_seen_at else None,
} for i in all_items if i.id not in scanned_ids]
```

Sort `missing` by `last_seen_at` descending (most-recent first) — the user is most likely to find recent items.

In the frontend audit detail JSX, render the missing list with: `{item.name} | last seen in {item.last_seen_location || 'unknown'} on {formatDate(item.last_seen_at)}`.

### C.5 Acceptance checks — Section C

**C.5.1 — Compile + import:**
```bash
python3 -c "import py_compile; py_compile.compile('api/routes/inventory.py', doraise=True); py_compile.compile('api/routes/culinary.py', doraise=True); py_compile.compile('providers/web/barcode_lookup.py', doraise=True)"
python3 -c "import sys; sys.path.insert(0,'.'); from main import app; print('routes:', len(app.routes))"
```
Expected: routes count = baseline + 1 (the new `scan-upc`).

**C.5.2 — Regression: culinary scan still works:**
```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"barcode": "0049000028904"}' \
  http://localhost:8000/api/culinary/stockroom/scan
```
Expected: same shape as before the refactor (existing item upserted, broadcast fires).

**C.5.3 — UPC scan creates new item:**
```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"home_id": "<home_id>", "upc": "0028400064057", "location": "pantry"}' \
  http://localhost:8000/api/inventory/items/scan-upc
```
Expected: `{ein: "...", name: "...", brand: "...", upc: "0028400064057", existing: false, ...}` with the product name populated from Open Food Facts.

**C.5.4 — Same UPC twice returns existing:**
Run C.5.3 a second time. Expected: same item returned with `existing: true`.

**C.5.5 — Bulk scan UI:**
1. Open browser, navigate to Inventory page, click 📦 Bulk Scan.
2. Select a home. Scanner modal opens.
3. Scan 5 different barcoded items. All 5 appear in the rolling list within ~5 seconds.
4. Scan a duplicate. Row appears with "already in inventory" indicator.

**C.5.6 — Audit assist:**
1. Run a normal scan of 3 items (via either the existing EIN scan or new UPC scan). Each updates `last_seen_*`.
2. Start an audit on that home. Scan 1 of the 3 items.
3. Mark audit complete. Open audit detail.
4. Missing items show `last seen in <location> on <date>`. Items with no last-seen show "unknown."
5. Missing items are sorted by `last_seen_at` desc (most recent first).

### C.6 What Section C is NOT doing

- No multi-home scanning in one bulk session
- No photo capture during scan (Section B only does barcode)
- No predictive location autofill ("you usually put soup in pantry")
- No audit scheduling
- No bulk export of audit history

---

## Section D — Walmart real API + auto-suggest mappings

### D.0 ⚠️ PREREQUISITE — STOP AND ASK BEFORE STARTING

**The Walmart Affiliate API requires onboarding through Impact.com.** The Walmart Open API was deprecated in 2020. The Marketplace API is for sellers (a different program).

**Before any work in this section, confirm with the user:**

1. Do you have an active Impact.com account approved for the Walmart Affiliate Program?
2. Do you have an API key issued for that program?
3. If yes, what endpoints have you been granted access to? (Search? Item details? Cart?)

**If any of those are no, stop and write this in the report:**

> Walmart API access required — user to provision Impact.com Affiliate access before Section D resumes. Skipping Section D for now.

**Do not** scrape walmart.com directly (against their TOS, brittle, will break). Do not use third-party reseller APIs without explicit user approval. Do not generate a fake API key for testing.

If the user provides an alternative integration (e.g., a direct partner deal not via Impact.com), adapt — but document the deviation prominently.

### D.1 Settings additions (only after D.0 cleared)

Add to `config/settings.py`:

```python
    # Walmart Affiliate API
    walmart_api_enabled: bool = False
    walmart_api_key: str = ""       # set in .env, never commit
    walmart_api_base: str = "https://developer.api.walmart.com"  # adjust per user's actual base
    walmart_cache_seconds: int = 300
```

Add to `.env.example` (this file IS committed; values must be placeholders):

```
WALMART_API_ENABLED=false
WALMART_API_KEY=
WALMART_API_BASE=
```

### D.2 Provider — `providers/commerce/walmart_provider.py` (new file)

Verify directory exists: `ls providers/commerce/`. If not, create it with `__init__.py`.

```python
"""
providers/commerce/walmart_provider.py

Walmart Affiliate API client.
Adapt the exact endpoint shapes once the user confirms which Affiliate API
program they're enrolled in (Impact.com routes differ from legacy Open API).
"""
from __future__ import annotations
import time
import logging
import httpx
from typing import Optional
from config.settings import get_settings

logger = logging.getLogger(__name__)


class WalmartAPIError(Exception):
    pass


class WalmartProvider:
    def __init__(self):
        s = get_settings()
        if not s.walmart_api_enabled or not s.walmart_api_key:
            raise WalmartAPIError("Walmart API not configured")
        self.api_key = s.walmart_api_key
        self.base = s.walmart_api_base.rstrip("/")
        self.cache_seconds = s.walmart_cache_seconds
        self._cache: dict[str, tuple[float, object]] = {}

    def _cache_get(self, key: str):
        entry = self._cache.get(key)
        if entry and time.time() - entry[0] < self.cache_seconds:
            return entry[1]
        return None

    def _cache_set(self, key: str, value):
        self._cache[key] = (time.time(), value)

    async def search(self, query: str, limit: int = 10) -> list[dict]:
        """Search Walmart catalog. Returns list of normalized products."""
        cached = self._cache_get(f"search:{query}:{limit}")
        if cached is not None:
            return cached

        # ADJUST PATH + AUTH HEADER PER ACTUAL API SPEC
        url = f"{self.base}/api-proxy/service/affil/product/v2/search"
        async with httpx.AsyncClient(timeout=10) as client:
            try:
                resp = await client.get(url, params={"query": query, "numItems": limit},
                                        headers={"WM_SEC.KEY_VERSION": "1", "WM_CONSUMER.ID": self.api_key})
                resp.raise_for_status()
                data = resp.json()
            except httpx.HTTPError as e:
                logger.warning(f"Walmart search failed: {e}")
                return []
            except Exception as e:
                logger.warning(f"Walmart search parse failed: {e}")
                return []

        # ADJUST FIELD MAPPING PER ACTUAL API SHAPE
        items = data.get("items", [])
        normalized = [{
            "item_id": str(it.get("itemId", "")),
            "name": it.get("name", ""),
            "price": float(it.get("salePrice", 0.0)),
            "available": it.get("availableOnline", False),
            "image_url": it.get("thumbnailImage", ""),
        } for it in items[:limit]]

        self._cache_set(f"search:{query}:{limit}", normalized)
        return normalized

    async def get_prices(self, item_ids: list[str]) -> dict[str, dict]:
        """Batch price + availability. Returns {item_id: {price, available, name}}."""
        cached = self._cache_get(f"prices:{','.join(sorted(item_ids))}")
        if cached is not None:
            return cached

        # ADJUST PATH PER ACTUAL API SPEC
        url = f"{self.base}/api-proxy/service/affil/product/v2/items"
        async with httpx.AsyncClient(timeout=10) as client:
            try:
                resp = await client.get(url, params={"ids": ",".join(item_ids)},
                                        headers={"WM_SEC.KEY_VERSION": "1", "WM_CONSUMER.ID": self.api_key})
                resp.raise_for_status()
                data = resp.json()
            except (httpx.HTTPError, Exception) as e:
                logger.warning(f"Walmart batch lookup failed: {e}")
                return {}

        result = {}
        for it in data.get("items", []):
            iid = str(it.get("itemId", ""))
            result[iid] = {
                "price": float(it.get("salePrice", 0.0)),
                "available": it.get("availableOnline", False),
                "name": it.get("name", ""),
            }

        self._cache_set(f"prices:{','.join(sorted(item_ids))}", result)
        return result
```

**Critical:** the exact paths, headers, and response shapes above are *placeholders*. The user must confirm the actual API contract before you finalize. Update the comments labeled `ADJUST ...` with what you actually find.

### D.3 New endpoint — auto-suggest mappings

In `api/routes/culinary.py`, after the existing mapping routes (line 2433–2479), add:

```python
class WalmartSuggestBody(BaseModel):
    ingredient_name: str


@router.post("/walmart/mappings/suggest")
async def walmart_suggest_mapping(
    body: WalmartSuggestBody,
    request: Request,
    db: Session = Depends(get_db),
):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    try:
        from providers.commerce.walmart_provider import WalmartProvider
        provider = WalmartProvider()
        suggestions = await provider.search(body.ingredient_name, limit=3)
        return {"ingredient_name": body.ingredient_name, "suggestions": suggestions}
    except WalmartAPIError as e:
        raise HTTPException(status_code=503, detail=str(e))
```

### D.4 Enrich `walmart_export`

The current `walmart_export` (line 2484) builds a cart URL only. After D.0/D.1/D.2 are in place, modify the response:

After `cart_items` and `unmapped` are computed (around line 2540, in the existing function), add a price lookup:

```python
    # Price lookup for mapped items
    item_ids = [cart_item.split("_")[0] for cart_item in cart_items]
    prices_map = {}
    total = 0.0
    try:
        from providers.commerce.walmart_provider import WalmartProvider
        provider = WalmartProvider()
        prices_map = await provider.get_prices(item_ids) if item_ids else {}
        # Compute total based on quantity from cart_items "_qty" suffix
        for ci in cart_items:
            iid, _, qty = ci.partition("_")
            qty = int(qty) if qty.isdigit() else 1
            if iid in prices_map:
                total += prices_map[iid]["price"] * qty
    except WalmartAPIError:
        # API not configured — skip price enrichment, still return cart URL
        pass

    # Log to price history
    if prices_map:
        for iid, info in prices_map.items():
            await db_async_log_walmart_price(hh.id, iid, info["price"])
```

Update the response shape to include `total_estimated_cost`, `prices: {item_id: {price, available, name}}`, and keep the existing `cart_url`/`unmapped`.

### D.5 Schema — `walmart_price_history` table

Add to `providers/memory/sqlite_store.py`:

```sql
CREATE TABLE IF NOT EXISTS walmart_price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    household_id TEXT NOT NULL,
    walmart_item_id TEXT NOT NULL,
    price REAL NOT NULL,
    ts REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_walmart_price_history_item ON walmart_price_history(walmart_item_id, ts DESC);
```

And an async store method `log_walmart_price(household_id, item_id, price)`. No UI for this yet — it's data collection for a future trend chart.

### D.6 Frontend — suggest button

In `frontend/src/pages/CulinaryPage.jsx` Walmart tab (around line 2080–2200), in the mapping management UI, find where unmapped ingredients are listed (search for `unmapped` in WalmartTab). Add a "Suggest" button per row:

```jsx
const [suggestions, setSuggestions] = useState({})  // {ingredient_name: [3 items]}

const suggest = async (name) => {
  const res = await api.post('/walmart/mappings/suggest', { ingredient_name: name })
  setSuggestions(prev => ({ ...prev, [name]: res.suggestions }))
}

// In the unmapped row:
<button onClick={() => suggest(ingredient.name)}>Suggest</button>
{suggestions[ingredient.name] && (
  <div className="walmart-suggestions">
    {suggestions[ingredient.name].map(s => (
      <div key={s.item_id} className="walmart-suggestion">
        <img src={s.image_url} alt={s.name} />
        <div>
          <div>{s.name}</div>
          <div>${s.price.toFixed(2)} · {s.available ? 'In stock' : 'Out'}</div>
        </div>
        <button onClick={() => createMapping(ingredient.name, s.item_id)}>Use</button>
      </div>
    ))}
  </div>
)}
```

### D.7 Acceptance checks — Section D

**D.7.1 — Pre-flight without API key:**
```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"ingredient_name": "milk"}' \
  http://localhost:8000/api/culinary/walmart/mappings/suggest
```
Expected: HTTP 503 with `{"detail": "Walmart API not configured"}`. The rest of the app must still work.

**D.7.2 — With API key configured:**
1. Set `WALMART_API_ENABLED=true` and `WALMART_API_KEY=<real key>` in `.env`. Restart.
2. Run the curl from D.7.1. Expected: 3 suggestions with prices.

**D.7.3 — Export with prices:**
1. Run an export against a prep session with mapped items.
2. Response includes `total_estimated_cost` and per-item prices.
3. `walmart_price_history` table now has one row per mapped item.

**D.7.4 — Cart URL regression:**
The existing `cart_url` field in the export response must still be present and still work when pasted.

### D.8 What Section D is NOT doing

- No Kroger / Target / Amazon Fresh — multi-store is a separate phase
- No auto-substitution
- No price-alert subscriptions
- No scheduled exports
- No actual Walmart cart submission via API (the URL still drives the user to walmart.com)

---

## Section E — Universal out-of-scope (applies to all sections)

- **No commits or pushes.** User commits.
- **No changes to audit-protected files** beyond what §0.4 lists.
- **No new dependencies** beyond: `resemblyzer`, `@zxing/browser`, `@zxing/library`. Stop and ask if anything else seems necessary.
- **No CHRONOS / MCP / Pulse work** — those are Phase 1.
- **Voice ID does not override an explicit auth token.** Non-negotiable.
- **Biometric data never leaves the server.** Voice prints stay in `data/voice_prints/`, gitignored.
- **No silent assumptions about schema.** If a column doesn't exist where this brief says it should, stop and ask.

---

## Section F — Reporting back

After each section's acceptance checks pass, output a short report. Pause for the user's go-ahead before starting the next section.

**Required report sections:**

1. **Section completed:** A / B / C / D
2. **Files created or modified:** one per line
3. **Schema migrations applied:** which columns / tables added, with the migration SQL inlined
4. **Dependencies added:** Python + npm, with version constraints
5. **Acceptance checks run:** exact commands + terse output (one line per check: PASS/FAIL + key detail)
6. **Anything unexpected:** files that looked wrong but you didn't touch, decisions made not covered above, anything flagged for the user

Do not commit. Do not push. Do not create additional markdown files.
