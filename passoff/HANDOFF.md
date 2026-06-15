# River Song AI — Session Handoff

Use this file to catch up Claude in a new session. Paste it into the chat or reference it.

---

## Current State

River Song AI is **live in production** at `https://riversongai.com`.

- Cheryl is the admin user
- Server is running, auto-deploys nightly at 3am
- All local LLM models installed and showing in UI with friendly names

---

## Recently Shipped — read this first

Two tracks that were in flight in May are now landed. Brief recap so you don't go hunting for a plan file that no longer exists.

### Track A — Phase 2 build (Voice ID + camera barcode) — ✅ shipped

Plan completed — Voice ID and Barcode Scanner shipped. Sections A and B of the original build plan landed; Section C (UPC bulk) and D (Walmart API) were never green-lit and remain out of scope.

- Voice ID: `api/routes/voice_id.py`, `providers/voice_id/`, `voice_id_events` table in `sqlite_store.py`. Resemblyzer is the speaker-ID library.
- Barcode scanner: `frontend/src/components/BarcodeScanner.{jsx,css}` (uses `@zxing/browser` + `@zxing/library`).
- Settings exposed via the standard Settings UI; per-user feature flag `voice_id_enabled` in `config/settings.py`.
- See `docs/VOICE_ID.md` for the full subsystem documentation.

### Track B — UI three-axis system (built, but chrome rework still open)

The presence theming was refactored from a single legacy theme picker into three orthogonal axes:

- **Universe** (`dune` | `halo` | `mv` | `nightcity`) — drives `--font-mood` + which envs are valid
- **Environment** (8 total: `atreides`, `harkonnen`, `forerunner`, `unsc`, `spires`, `garden`, `corpo`, `pacifica`) — drives density tokens, card material grammar, backdrop, logo morph
- **Mood** (~16 color palettes) — color only; subsumes the legacy 8-theme picker (`halo`/`crimson-dark`/`combat`/`midnight-violet`/`amber`/`arctic`/`cyberpunk`/`dune` are now distributed across envs as moods)

**Shipped, not committed:**
- `providers/memory/sqlite_store.py` — new `universe`, `mood` columns + one-time idempotent migration that maps legacy `theme`+`palette` → `(universe, environment, mood)` triple
- `api/routes/auth.py` — `ProfilePatch` accepts the new triple; `UNIVERSE_ENV_PAIRS` + `ENV_MOOD_PAIRS` validators; legacy `theme`/`palette` fields still accepted and translated
- `frontend/src/styles/themes.css` — complete rewrite. 8 environments × 2+ moods, 8 distinct backdrops, density+material tokens per env. Legacy `[data-theme="*"]` blocks deleted.
- `frontend/src/styles/global.css` — alias chain (`--bg-card`, `--bg-panel`, `--md-surface*`) now translucent so every page's backdrop bleeds through without per-page edits
- `frontend/src/App.jsx` — state collapsed to `{universe, environment, mood}` with cascading setters + legacy-theme client-side migration
- `frontend/src/pages/ProfilePage.jsx` — three-step nested picker (UNIVERSE → ENVIRONMENT → MOOD). Legacy "INTERFACE SKIN" 8-theme grid removed.
- `frontend/src/components/RsMark.{jsx,css}` — morphing logo component; 8 CSS-only env treatments. Sidebar + mobile topbar swapped from text "RS" to `<RsMark mark="mono">`.
- `frontend/src/components/RiverSong.jsx` — orb reads `data-universe` (with `data-palette` fallback); knows all 4 universes

**Backend on `:8000` likely needs a restart** to pick up the new validators + columns. Frontend HMR has the rest live.

**Still open — the chrome rework.** User feedback: the three-axis system changed colors/materials/fonts/density but the *chrome itself* (sidebar + main + card grid) is still a SaaS dashboard. They want a layout that doesn't look like a website — Kimi-clean, futuristic without cluttered fake-JARVIS charts/graphs, with the chrome physically *rearranging per environment* (nav position, presence orb position, page frame shape) so each room embodies its universe. Sidebar should die.

The brainstorm conversation moved to external chat for faster visual iteration with screenshots; the original local brainstorm doc is no longer in the repo. Current work lives in the `/preview` route sandbox (see Claude memory `project_chrome_preview.md`). The first UI rework pass was completed per the external Gemini plan referenced below — the next session should compare the live `/preview` route against the visual quality bar (Claude memory `feedback_visual_quality_bar.md`) and decide what to land next.

---

## Machines

### Chromebook (dev)
- Repo at `~/RiverSongAI`
- `ENVIRONMENT=development`, localhost CORS, `ALLOWED_HOSTS=["*"]`
- Run backend: `source venv/bin/activate && python main.py`
- Run frontend: `cd frontend && npm run dev` → `http://localhost:5173`

### Production Server
- Username: `riversong`
- Local IP: `192.168.1.221`
- Tailscale IP: `100.72.215.100`
- SSH: `ssh riversong@192.168.1.221` (local) or `ssh riversong@100.72.215.100` (anywhere via Tailscale)
- Repo at `~/RiverSongAI`
- Service: `sudo systemctl start|stop|restart|status river-song`
- Logs: `journalctl -u river-song -f`
- Deploy: `cd ~/RiverSongAI && ./deploy.sh`

---

## Production .env Key Values
- `ENVIRONMENT=production`
- `TTS_PROVIDER=piper`
- `CORS_ORIGINS=["https://riversongai.com","https://www.riversongai.com","https://app.riversongai.com"]`
- `ALLOWED_HOSTS=["riversongai.com","www.riversongai.com","app.riversongai.com","192.168.1.221","localhost"]`
- `DB_PATH=/mnt/data/river-song/db/river_song.db`
- `PIPER_EXECUTABLE_PATH=/usr/local/bin/piper`
- `PIPER_MODEL_PATH=/home/riversong/.local/share/piper/en_US-lessac-medium.onnx`

---

## Storage Layout
- SSD (`/`) — OS, app, Ollama models
- HDD (`/mnt/data/river-song/`) — database, google_tokens, audible, libby, logs, inventory
- Logs symlinked: `~/RiverSongAI/logs` → `/mnt/data/river-song/logs`

---

## Cloudflare Setup
- Domain: `riversongai.com` — Cloudflare Tunnel (no port forwarding)
- Tunnel name: `River-song`, ID: `a9278f3d-8ef5-4c0f-9e68-2088085943eb`
- Routes: `riversongai.com`, `www.riversongai.com`, `app.riversongai.com` → `http://localhost:8000`
- Tailscale installed on server for remote SSH access

---

## What's Still Left
1. **NVIDIA drivers** — `sudo ubuntu-drivers autoinstall` not yet run on server
2. **Tailscale on Chromebook** — install so you can SSH from anywhere
3. **Cloudflare Access** — optional second login gate for family (whitelist emails)
4. **PWA** — optional, makes it feel like a native app on phones

---

## Audit Remediation (2026-05 cycle) — ✅ closed

Full architecture/trash/security audit. Gemini executed; Claude verified each round against actual code. The three working reports (`RIVER_SONG_AUDIT.md`, `RIVER_SONG_TRASH.md`, `RIVER_SONG_SECURITY.md`) were used during the cycle and archived externally — they are not in the repo and should not be expected here.

- **Round 1 (32 fixes)** — ✅ committed `a81933a`, pushed to `origin/main`.
- **Round 2 (9 gap-closure tasks)** — ✅ same commit.
- **Round 3 (security sweep, 10 tasks)** — ✅ completed 2026-05-15 at commit `e93a322`. Scope: JWT revocation, daemon-secret boot validator, WebSocket ticket auth, LLM error scrub, auth gaps on `/api/models` + n8n + integrations, `.gitignore data/*.db`, voice cascade for child role, memory DELETE ownership filter. All rounds closed. See Claude memory `project_audit_cycle.md` for resolution detail.
- **C-1 (Google OAuth secret in git history)** — ✅ secret rotated, history rewritten with `git filter-repo`, force-pushed, 34 stale branches deleted on origin.
- **CHRONOS** (Obsidian-style local vault, page = CHRONOS, daemon = Scribe) — design locked. Build was paused until Round 3 shipped — now unblocked. See `docs/CHRONOS.md` for the design spec; Claude memory `project_chronos_parked.md` for additional history.

Detailed state for any new Claude session lives in `~/.claude/projects/-home-riversong-RiverSongAI/memory/` — see `project_audit_cycle.md`, `project_chronos_parked.md`, `reference_git_ssh_origin.md`.

---

## Origin Remote (Git SSH)

The default `git@github.com:` SSH route on this host uses a deploy key scoped to the **Android** repo, not the main one. Origin for `cassu123/RiverSongAI` must use the SSH alias:

```
git remote set-url origin git@github-riversongai:cassu123/RiverSongAI.git
```

That alias is defined in `~/.ssh/config` and uses `~/.ssh/id_ed25519`. Verify with `ssh -T -i ~/.ssh/id_ed25519 git@github.com` → expects `Hi cassu123/RiverSongAI!`.

---

## Known Fixes Applied
- **Global Responsive Overhaul**: Standardized all modules for tablets and mobile.
  - Unified 1024px (Tablet) and 768px (Mobile) breakpoints.
  - Sidebar refactored to a fixed-width (260px) drawer on all tablets.
  - Grid systems forced to 2-columns (tablet) and 1-column (mobile) for maximum legibility.
  - Fixed 16:9 aspect ratios for all recipe and news thumbnails.
  - Converted complex tables (Inventory, Memory) into responsive card layouts.
  - Refactored inline grid styles into reusable CSS classes (.settings-grid, .cul-modal-grid).
- Python 3.14 on Ubuntu 25.10: numpy/scipy updated, audible commented out
- npm: `--legacy-peer-deps` added to setup.sh and deploy.sh
- `pydantic[email]` added to requirements.txt
- TTS_PROVIDER was `none` — fixed to `piper`
- Piper model path had wrong username — fixed to `/home/riversong/`
- LVM only used 100GB of SSD — expanded with lvextend
- API URLs were hardcoded to `localhost:8000` — fixed to relative URLs
- `avatar.glb` not served — fixed FastAPI static file fallback
- Model display names updated to plain English

---

## Session Handoff (2026-05-20)

### Backend Status (Track A, B, and Round 3)
- **Round 3 Repairs:** Verified. All malformed `async def await` signatures in the 18 route files have been corrected. `analytics.py` has been restored to its original functional state and correctly migrated to async. `n8n_webhooks.py` now includes the missing `Depends` import.
- **Track A (Voice ID):** Infrastructure in place (`api/routes/voice_id.py`, `providers/voice_id/`). Verified that the backend compiles and routes are registered.
- **Track B (3-axis UI backend):** Support for `universe`, `environment`, and `mood` in `api/routes/auth.py` and `sqlite_store.py` is present.

### Next Steps: Chrome Rework
The first pass of the UI rework executed against an external Gemini plan; both that plan and the global chrome design doc lived outside version control and are no longer available on disk.

- **Constraint:** "Chat" and "Speak" pages were intentionally excluded from the original rework pass.
- **External plan (unavailable):** `/home/riversong/.gemini/tmp/riversongai/.../plans/chrome-rework-execution.md` is not under version control. If unavailable on this machine, the Chrome rework was completed in code — verify against `frontend/src/App.jsx` (3-zone layout) and `frontend/src/styles/themes.css` (CSS architecture).
- **Continuation surface:** A `/preview` route sandbox for chrome iteration is documented in Claude memory (`project_chrome_preview.md`) but is not yet wired into `frontend/src/App.jsx` — that scaffolding is part of the next session's work.

### Key Files for Next Session
- `frontend/src/App.jsx`: 3-zone layout skeleton; add `/preview` route here.
- `frontend/src/styles/themes.css`: CSS architecture (Universe × Environment × Mood).
- `docs/DAEMONS.md`, `docs/CHRONOS.md`, `docs/INTEGRATIONS.md`: New subsystem documentation as of 2026-05-23.

---

## To Restore Claude Memory on a New Machine
Copy this directory from the Chromebook:
`~/.claude/projects/-home-riversong-RiverSongAI/memory/`

---

## Culinary Module Restoration (2026-05-23) — Gemini

**Context for Claude:** You may have observed uncommitted edits to `CulinaryPage.jsx` during a previous turn. These were not a bug, but a deliberate **Deep-Tissue Restoration** executed by Gemini to reverse a catastrophic functional regression from commit `41340a2`.

### 🛠 Work Completed

**1. Functional Reconstruction:**
- **Reversed Regressions:** Replaced aesthetic placeholders in `CulinaryPage.jsx` with full logic.
- **API Reconnection:** Reconnected all 6 backend culinary silos (`recipes`, `stockroom`, `dinner`, `prep`, `equipment`, `banned`). Purged all `localStorage` fallbacks.
- **Structured Filtering:** Library now has a full **Filter Bar** (Search + 3 Dropdowns: Meal, Dynamic Protein, Sort).
- **Prep Deck:** Built dedicated **Shopping List** (with stockroom cross-ref) and **Staging Area** (per-recipe piles) modals. Restored the fractional math **Scaling Adjuster**.

**2. Hardening & Accessibility:**
- **Recipe Modal:** Centered, focus-trapped, and Esc-responsive. Top-right button collision fixed via explicit header padding.
- **Dynamic Forms:** Brittle JSON textareas deleted. Editor now uses row-based inputs for Provisions and steps.
- **Substitution Engine:** Wired the banned ingredient logic. Users can "Apply Substitute" to a recipe, which triggers a regex-based overhaul of ingredients and steps to ensure safety.
- **AI Integration:** Wired the "AI Recommend" button in the Banned tab to local Ollama for reasoning-based substitute suggestions.

**3. Performance & Polish:**
- **snappy-blur:** Animation durations for page-in transitions reduced to `400ms` (cards) and `250ms` (modals) to eliminate perceived latency.
- **Typography:** Enforced `line-height: 1.7` to prevent selection jitter.

### 📂 File State
- `frontend/src/pages/CulinaryPage.jsx` — **RECONSTRUCTED**
- `frontend/src/pages/CulinaryPage.test.jsx` — **EXPANDED** (5 unit test flows)
- `passoff/OTHER_STUFF.md` — Detailed turnover log appended.

**Next for Culinary:** Finish the "ADJUST" button in stockroom (inline sheet needed) and monitor WebSocket events for reactive updates.
