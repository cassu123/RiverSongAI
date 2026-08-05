# Voice ID

River Song's per-speaker biometric identification. When the user speaks,
the system can return *who* is speaking — not just *what* was said. The
result steers personalisation (whose calendar, whose preferences) and
gates child-role limits.

**Local-only. No network calls. Audio and embeddings never leave disk.**

---

## What it is

- Speaker recognition powered by [Resemblyzer](https://github.com/resemble-ai/Resemblyzer)
  (`VoiceEncoder`, runs on CPU).
- Per-utterance the encoder produces a 256-dim L2-normalised embedding.
- Identification is cosine similarity against every enrolled sample,
  picking the highest score above `VOICE_ID_THRESHOLD` (default 0.75).
- Sample storage is one directory per user under `data/voice_prints/`,
  with raw WAV + cached `.npy` embedding side-by-side, plus a small
  `manifest.json`.

---

## Enrollment flow

From the user's perspective, in the Settings UI:

1. The user opens **Settings → Voice ID** and clicks "Add voice sample".
2. The frontend records a short utterance (typically a few seconds of
   speech) and uploads it as a WAV.
3. The backend receives `POST /api/voice-id/enroll` with the WAV
   payload, requires the caller's JWT to extract `user_id`, and routes
   the audio to `VoiceIDProvider.enroll_sample`.
4. The provider:
   - Decodes the WAV to a 16 kHz mono float32 array via `soundfile` +
     Resemblyzer's `preprocess_wav` (trims silence, normalises).
   - Computes a 256-dim embedding with `VoiceEncoder.embed_utterance`.
   - Writes `data/voice_prints/<user_id>/sample_<n>.wav` and the cached
     `sample_<n>.npy` (`0o700` perms on the user directory).
   - Updates `manifest.json` with `sample_count`, `enrolled_at`,
     `last_updated`.
   - Appends the new embedding to the in-RAM cache.
5. Returns `{sample_count, mean_self_similarity}` — the second value is
   the average pairwise cosine across the user's enrolled samples, a
   sanity signal that all samples really do sound like the same person.

Repeating the flow adds additional samples; more samples means more
robust identification.

---

## Verification flow

During conversation, when an utterance is captured:

1. The conversation pipeline hands the WAV bytes to
   `VoiceIDProvider.identify` (internal call, no HTTP).
2. If the in-memory cache hasn't been hydrated yet, it walks
   `data/voice_prints/` once and loads every `.npy` into RAM.
3. The provider computes the query embedding, then for each enrolled
   user takes the **maximum** cosine similarity against that user's
   samples (so an old enrollment plus a recent one both vote, and the
   best one wins).
4. Returns `{user_id, score, runner_up_user_id, runner_up_score}` if
   the top score clears `VOICE_ID_THRESHOLD`. Otherwise `user_id` is
   `None` and the caller falls back to the session's logged-in user.

Admin debugging: `POST /api/voice-id/identify` does the same thing over
HTTP. Admin-only (`role == "admin"` in the JWT).

---

## API

All endpoints live under `/api/voice-id` and require
`Authorization: Bearer <JWT>`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/voice-id/enroll` (multipart `file=` WAV) | user | Add a sample for the calling user. Rejects audio under 1 KB. |
| GET  | `/api/voice-id/me` | user | `{enrolled, sample_count, enrolled_at, last_updated}` for the calling user. |
| DELETE | `/api/voice-id/me` | user | Remove all enrollment data for the calling user. Irreversible. |
| POST | `/api/voice-id/identify` (multipart `file=` WAV) | **admin** | Run identification end-to-end — for debugging. Returns `{user_id, score, runner_up_*}` or `{user_id: null}`. |

The conversation loop's recognition path is an internal call to the
provider, not an HTTP call to `/identify` — auth there is implicit in
the WebSocket session.

---

## Data storage

```
data/voice_prints/                   (mode 0700 per-user directory)
├── <user_id>/
│   ├── sample_1.wav                 (original audio, kept for re-enrol)
│   ├── sample_1.npy                 (256-dim float32 embedding)
│   ├── sample_2.wav
│   ├── sample_2.npy
│   └── manifest.json                ({enrolled_at, last_updated, sample_count})
```

- WAVs are kept so the embeddings can be re-computed if the encoder
  model changes.
- `.npy` is the warm-path artefact — it's what gets cosine-compared.
- Embeddings are loaded once into RAM at first `identify` call and held
  for the process lifetime.

The full `data/voice_prints/` tree must be excluded from version control
(handled by the project `.gitignore` covering `data/`).

---

## Privacy & retention

- **Local-only.** No external service ever sees the audio or embeddings.
- **User-controlled deletion.** `DELETE /api/voice-id/me` removes the
  user's entire directory and drops their cache entry; admin
  intervention is not required.
- **No raw speech in logs.** Routes do not log audio payloads. The
  provider logs only the encoder load message and cache size.
- **Filesystem perms.** Each user directory is created with `0o700`
  (owner-only). The parent `data/voice_prints/` inherits umask.
- **Self-similarity reported back.** The enroll response includes the
  user's mean pairwise self-similarity, so the UI can warn if a new
  sample looks suspiciously different from prior ones (e.g. background
  noise, wrong speaker).

---

## Configuration

| Setting | Default | Purpose |
|---|---|---|
| `VOICE_ID_ENABLED` | `true` | Global feature flag. |
| `VOICE_ID_THRESHOLD` | `0.75` | Minimum cosine similarity to accept a match. |
| `VOICE_ID_MIN_AUDIO_SECONDS` | `1.0` | Reject identification requests shorter than this. |
| `VOICE_ID_MAX_AUDIO_SECONDS` | `30.0` | Reject identification requests longer than this. |

---

## Dependencies

- `resemblyzer` — speaker encoder (CPU).
- `soundfile` (libsndfile) — WAV decoding.
- `numpy` — embeddings + cosine math.

The encoder is lazy-loaded on first use and held for the process
lifetime. There is no GPU path.

---

## Limitations

- **English-dominant training.** Resemblyzer was trained primarily on
  English speakers; identification accuracy degrades for languages or
  accents it has seen less of.
- **Noise sensitivity.** Loud background noise or low-SNR mics
  (laptops, web headphones) hurt accuracy. The 0.75 default threshold
  is conservative — expect false negatives more often than false
  positives.
- **No anti-spoofing.** Replay attacks (playing a recording of an
  enrolled user) are not detected. Voice ID should never gate
  high-stakes actions on its own.
- **No per-utterance freshness check.** Two distinct utterances from
  the same speaker will both match; the system does not detect
  "this is a replay of last week's sample".
- **Single global encoder, CPU only.** Identification cost scales
  linearly with the number of enrolled users × samples. Fine for a
  household-scale deployment (tens of users × tens of samples).

---

## Files

- `api/routes/voice_id.py` — HTTP surface (4 endpoints).
- `providers/voice_id/voice_id_provider.py` — encoder + enroll +
  identify + delete + status.
- `providers/memory/sqlite_store.py` — `voice_id_events` table for
  audit / analytics (created during the original Voice ID build).
- Frontend: `frontend/src/components/BarcodeScanner.{jsx,css}` is a
  sibling feature shipped in the same Phase 2 build; the Voice ID UI
  lives inside the Settings page.
