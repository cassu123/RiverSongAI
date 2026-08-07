# Local AI right-sizing — implementation spec

Handoff spec for an agent implementing this. Written from measurements taken on
the live server on 2026-08-05, not from assumptions. Every number below was
observed, not estimated.

**Read this first:** some items are repository changes and some are changes to
`.env` on the server, which is gitignored and cannot be changed from this repo.
Each task says which it is. Do not try to change server config by editing
`.env.example` — that file is documentation only and has no effect on a running
box.

---

## 1. The hardware this must fit

```
GPU   NVIDIA GeForce GTX 1050 Ti — 4096 MiB total, 347 MiB already used
RAM   30 GiB total, 27 GiB available
Swap  8 GiB, 0 B used
```

Usable VRAM is therefore **~3.7 GB**, and 277 MB of the 347 MB in use is
`gnome-shell` — the box boots to a desktop it does not need.

**RAM is not a constraint. VRAM is the only constraint that matters here.**

Three consumers compete for that 3.7 GB:

| Consumer | Notes |
|---|---|
| Whisper STT | `providers/stt/whisper_local.py:84` selects `cuda` when available, and holds the model on the instance — so it stays resident |
| Chat LLM | `LLM_MODEL`, currently `llama3.2:3b` (2.0 GB) — fits |
| Culinary vision | `CULINARY_VISION_MODEL`, currently `gemma3:12b` (8.1 GB) — does not fit |

## 2. The core problem

`.env` on the server currently sets:

```
LLM_MODEL=llama3.2:3b              #  2.0 GB — fits
CULINARY_LLM_MODEL=qwen2.5:14b     #  9.0 GB — 2.4x over budget
CULINARY_VISION_MODEL=gemma3:12b   #  8.1 GB — 2.2x over budget
```

The two culinary models cannot fit in 3.7 GB. Ollama splits them across GPU and
CPU, which is far slower than either extreme. `providers/culinary/llm.py:23`
sets a 180-second timeout, and a 14B model running mostly on CPU can genuinely
exceed that.

There is a second-order effect that matters more than the first: because the
culinary models are larger than the whole card, **loading one evicts the chat
model**. Going back to voice reloads it. Every switch between subsystems pays a
full model load. Adding more subsystems with their own distinct models makes
this worse, not better.

### Design principle for this work

> Prefer one shared model serving many subsystems over many specialised models
> competing for one card. On a 4 GB budget, a warm 3B model shared by five
> callers beats five right-sized models that evict each other.

Keep a separate model only where the task genuinely differs — vision being the
clear case.

---

## 3. Task — repository changes

### 3.1 Fix the hardcoded oversized defaults

`providers/culinary/llm.py:28`

```python
OLLAMA_MODEL = os.environ.get("CULINARY_LLM_MODEL", "qwen2.5:14b")
```

The fallback default is a 9 GB model. Anyone deploying without setting that env
var lands on a model that cannot run on this class of hardware. Change the
default to a model that fits (`qwen2.5:3b`). Do the same for the vision default
if one is hardcoded.

Rationale: defaults should be the conservative choice. Someone who wants a 14B
model can set it explicitly; someone who sets nothing should get something that
runs.

### 3.2 Fix `api.put` — five broken features

`frontend/src/pages/CulinaryPage.jsx:436` defines a local API helper exposing
`get`, `post`, `patch`, `delete` — **but not `put`**. `api.put` is called at
lines **139, 174, 212, 232, 956**. Every one throws
`TypeError: api.put is not a function` on click.

Broken as a result: prep recipe scaling, recipe step editing, recipe editing,
recipe saving, stockroom quantity adjustment.

Add a `put` method matching the shape of the others.

### 3.3 `api.delete` swallows failures

Same helper. `delete` returns the raw `fetch` response and skips the `_handle`
error check the other verbs use, so a failed delete looks identical to a
successful one. Route it through `_handle` like the rest.

### 3.4 Remove the dead shopping stub

`api/routes/culinary_shopping.py` is 13 lines: imports, a bare `APIRouter()`,
and the comment *"We will integrate this into culinary.py later"*. It defines no
endpoints, is registered nowhere, and imports `db.database` — **a package that
does not exist in this repository**. It only survives because nothing imports
it. Delete it, or implement it.

### 3.5 Unbuilt: the cooking phase

`api/routes/culinary_sessions.py` is a complete 613-line implementation —
sessions, step navigation, timers that survive a reboot, WebSocket broadcast,
and push to the kitchen Vortex. Its own module docstring describes the intended
UX.

**No frontend code calls it.** A search across `frontend/src` for the
`/api/culinary/sessions` endpoints returns zero hits. The tabs that exist are
`library, stockroom, dinner, prep, grocery, equipment, banned` — there is no
cooking tab, and no device/appliance selection anywhere in the page.

The backend is finished and orphaned. Building the UI is a feature-sized task,
not a bug fix — scope it separately.

---

## 4. Task — server changes (not in this repo)

These live in `.env` and systemd on the server. They cannot be committed.

### 4.1 Right-size the culinary models

Both replacements are **already downloaded** on the box — no pulls needed.

```bash
cd ~/RiverSongAI
cp .env .env.bak
sed -i 's/^CULINARY_LLM_MODEL=.*/CULINARY_LLM_MODEL=qwen2.5:3b/' .env
sed -i 's/^CULINARY_VISION_MODEL=.*/CULINARY_VISION_MODEL=gemma3:4b/' .env
grep CULINARY .env
sudo systemctl restart river-song
```

`moondream` (1.7 GB) is an even lighter vision option if `gemma3:4b` at 3.3 GB
still crowds the card.

**Known tradeoff:** 14B to 3B is a real drop in reasoning quality. It is still
the right call, because a 14B model that exceeds a 180-second timeout returns
nothing at all. `qwen2.5:7b` (4.7 GB) is a middle option — slightly over budget,
so partial offload, but far better than 9 GB.

### 4.2 Keep the model warm, but bounded

```bash
sudo systemctl edit ollama
#   [Service]
#   Environment="OLLAMA_KEEP_ALIVE=30m"
sudo systemctl restart ollama
```

`ollama ps` on the live box returned **empty** — no model resident. Every
request after an idle period pays a full load.

Use a bounded value, **not `-1`**. Infinite keep-alive pins ~2 GB of a 3.7 GB
card permanently and starves the vision model. 30 minutes keeps things warm
through an active session and releases the VRAM afterwards.

### 4.3 Reclaim the desktop's VRAM

```bash
sudo systemctl set-default multi-user.target
sudo reboot
```

Frees the 277 MB `gnome-shell` holds — 7% of total VRAM on this card, spent on a
desktop nobody sits at.

---

## 5. Cloud routing (design note, not yet a task)

Cloud providers are already wired in `providers/llm/`: `nvidia_nim`,
`claude_api`, `openai_api`, `gemini`, `bedrock`, `mistral_api`, plus
`remote_ollama`. `NVIDIA_NIM_MODEL` is already set in `.env`.

The stated goal is local-first. When cloud is used, route by **data
sensitivity**, not by convenience:

| Task | Where | Why |
|---|---|---|
| Voice chat | Local | Latency dominates; a network round-trip makes it worse |
| Email triage, memory, family, documents | Local | Household data must not leave |
| Recipe parsing from a URL, equipment ID, substitutions | Cloud | Generic knowledge, no personal data in the prompt |

Routing per-subsystem rather than globally means each task can be pulled back
in-house independently once hardware allows.

---

## 6. What is NOT the problem

Recorded so nobody re-investigates these:

- **Voting, dinner suggestion, and serving-scale do not use AI.** `/dinner/suggest`
  (`api/routes/culinary.py:989`) is a plain database write — look up recipe,
  insert `DinnerProposal`, commit, broadcast. No LLM anywhere in it. The LLM is
  called in exactly three places: `/recipes/ingest`,
  `/household/banned/recommend`, and `/recipes/{id}/translate-equipment`.
- **`_get_household` cannot fail** — it auto-creates when absent
  (`api/routes/culinary.py:307`).
- **The WebSocket broadcast cannot throw** — it catches per-socket and prunes
  dead connections (`api/routes/culinary.py:495`).

So the reported "can't vote" and "can't send to prep" failures are **not**
explained by the model sizing, and not by any of the above. They need a browser
console error to diagnose. Do not guess at them.

## 7. Separate latency suspect

`providers/tts/piper.py` invokes Piper as a **subprocess per call** (`--model
<path>`), so the voice model is reloaded on every utterance. Because TTS streams
sentence-by-sentence (`core/conversation_loop.py:788`), that spawn cost is paid
per sentence, not per response. Worth measuring before optimising — it may be
minor, or it may be a significant part of why speech feels choppy.
