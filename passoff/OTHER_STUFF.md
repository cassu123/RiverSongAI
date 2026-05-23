# OTHER STUFF — pass-off for next phase

Catch-all for context that should travel forward into the next session/agent.
Append freely; trim when items land.

---

## Uncommitted state on `main` (as of 2026-05-19)

Seven files dirty. Not committed yet — user verifies in browser, then commits.

**Layout pass (responsive chrome):**
- `frontend/src/App.jsx` — header context now time-of-day / env label, not page name
- `frontend/src/chrome/Shell.jsx` — accepts optional `chatSidebar` slot
- `frontend/src/chrome/Drawer.jsx` — Primary / More / Admin grouping
- `frontend/src/styles/chrome-shell.css` — new @media (768–1199) and (≥1200) blocks; 240px desktop rail; 280px chat sidebar slot
- `frontend/src/utils/constants.js` — nav groups restructured

**Chat Phase A (model selector):**
- `frontend/src/pages/ChatPage.jsx` — standalone THINKING pill removed; new model pill opens Family→Variant sheets
- `frontend/src/utils/modelFamilies.js` *(new)* — 10 families mapped to real model_ids with Fast/Thinking/Pro tiers

Verify in browser at 375px / 1024px / 1440px before committing.

---

## Open judgment calls

### OpenAI tier placement
Phase A placed:
- Fast = `gpt-4o-mini`
- Thinking = `o4-mini` (the reasoning model)
- Pro = `gpt-4o`

User may want GPT-4o as Thinking and something else as Pro. One-line swap in `frontend/src/utils/modelFamilies.js`.

### Mistral (cloud) middle tier
Cloud Mistral has only `mistral-small-latest` and `mistral-large-latest`. Thinking tier is `null` — UI renders the row disabled. Admin can fill in Phase B if a suitable middle model appears.

### Desktop rail "River Song" label
The Drawer's head still shows "River Song" text. At desktop (≥1200px) where the rail is permanent, this reads alongside the header's RsMark — possibly redundant. CSS tweak candidate: hide `.rs-drawer-head` at `@media (min-width: 1200px)`.

---

## Phase B — Admin model configuration (next)

**Goal:** Admin can toggle which model families show in Chat, assign quirky display names, and override the tier→model_id mappings.

**Scope:**
- New "Models" section in `AdminSettingsPage.jsx`
- Backend: persist family config (enabled, quirky_name, tier overrides) under `admin_config["model_families"]` (mechanism already exists in `models_settings.py` — see ElevenLabs/Wake Word saves)
- New GET/POST `/api/settings/model-families` endpoints (admin-only)
- Frontend `modelFamilies.js` becomes a fallback default — Chat fetches admin config first, falls back to the hardcoded map

**Already in place:**
- `hidden_llms` in admin_config — model-level hiding works today
- `LLMRegistry` has `display_name` per model — can be overridden per family
- Sheet primitive (`chrome/Sheet.jsx`) handles all UI patterns needed

---

## Phase C — Broken buttons (after B)

### 🎙 Microphone
- Frontend wired: `useAudioRecorder` hook → `/api/conversation/transcribe` (ChatPage.jsx:262)
- User reports it doesn't work. Trace:
  1. Does the recorder hook actually capture audio? (browser mic permission, blob format)
  2. Does `/api/conversation/transcribe` exist and respond? (check `api/routes/conversation.py`)
  3. Is a STT provider configured? (Whisper, Vosk, etc.)

### ✨ Dreamscape (auto_awesome)
- Frontend wired: `handleGenerateImage` → `/api/image/generate` (ChatPage.jsx:285)
- Image router exists (`api/routes/image.py`, 68 lines — small, easy to trace)
- Check: is an image provider configured? (Stable Diffusion endpoint, DALL-E key, etc.)

### 🌐 WEB
- Frontend toggles `web_search: bool` in chat body
- Backend: `conversation_loop.py:830` gates the `web_search` tool in `TOOL_SCHEMAS`
- Need to confirm: is the tool's implementation actually wired to a search provider? Plan calls for DuckDuckGo, SearXNG, or Brave Search.

---

## Stray notes / future ideas

- Chat history sidebar at desktop is empty-state only. Wire to `loadHistory(user.id)` (already exists in ChatPage.jsx:18) to populate.
- The plan's "quirky names" concept (Phase B) — admin may want presets like "DeepSpeak", "Wise One", "Spark" — leave naming to user per deployment.
- ConversationPage (Speak/voice) is a separate page from ChatPage (text). Both share Shell action slot. If we change input bar UX in one, mirror in the other.
- The `forgetMemory` state in ChatPage.jsx:55 is set on reset but never exposed in UI. Either expose or remove.
