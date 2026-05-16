# River Song AI — Session Handoff

Use this file to catch up Claude in a new session. Paste it into the chat or reference it.

---

## Current State

River Song AI is **live in production** at `https://riversongai.com`.

- Cheryl is the admin user
- Server is running, auto-deploys nightly at 3am
- All local LLM models installed and showing in UI with friendly names

---

## In Flight (2026-05-16) — read this first

Two parallel tracks are open. Do not start new work until you've read both.

### Track A — Phase 2 build (Voice ID + camera barcode)

Plan file: `RIVER_SONG_BUILD_PLAN_2.md`. Sections **A and B only** are in scope for now; C (UPC bulk) and D (Walmart API) are gated until the user green-lights them.

- Brief was handed to **Gemini** to do the heavy lifting. Gemini's working tree shows:
  - New: `api/routes/voice_id.py`, `providers/voice_id/`, `frontend/src/components/BarcodeScanner.{jsx,css}`
  - Modified: `api/routes/__init__.py`, `core/conversation_loop.py`, `main.py`, `requirements.txt`, `frontend/package.json`, `frontend/src/pages/CulinaryPage.jsx`, `frontend/src/pages/InventoryPage.jsx`, `frontend/src/pages/SettingsPage.jsx`
  - `voice_id_events` table added to `sqlite_store.py`
- **Not yet committed.** Before committing, walk the §A.10 + §B.6 acceptance checks in the build plan.
- Resemblyzer is the speaker-ID library; `@zxing/browser` + `@zxing/library` for barcode. User is on Python 3.14 — pip resolution may need attention.

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

**Still open — the chrome rework.** User feedback: the three-axis system changed colors/materials/fonts/density but the *chrome itself* (sidebar + main + card grid) is still a SaaS dashboard. They want a layout that doesn't look like a website — Kimi-clean, futuristic without cluttered fake-JARVIS charts/graphs, with the chrome physically *rearranging per environment* (nav position, presence orb position, page frame shape) so each room embodies its universe. Sidebar should die. **This conversation has moved to the Claude/Gemini chat app** for faster visual iteration with screenshots and references. See the prompt at `RIVER_SONG_UI_BRAINSTORM.md` (top-level).

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

## Audit Remediation In Flight (2026-05 cycle)

Full architecture/trash/security audit produced three reports in repo root: `RIVER_SONG_AUDIT.md`, `RIVER_SONG_TRASH.md`, `RIVER_SONG_SECURITY.md`. Gemini executes; Claude verifies each round against actual code before accepting "done."

- **Round 1 (32 fixes)** — ✅ committed `a81933a`, pushed to `origin/main`.
- **Round 2 (9 gap-closure tasks)** — ✅ same commit.
- **Round 3 (security sweep, 10 tasks)** — prompt staged at `~/.claude/plans/i-mchronos-chronological-heuristic-recor-majestic-pizza.md`. Scope: JWT revocation, daemon-secret boot validator, WebSocket ticket auth, LLM error scrub, auth gaps on `/api/models` + n8n + integrations, `.gitignore data/*.db`, voice cascade for child role, memory DELETE ownership filter. Not yet sent.
- **Deferred:** C-1 (Google OAuth secret in git history) — needs Cloud Console rotation + `git filter-repo`, handled out-of-band.
- **CHRONOS** (Obsidian-style local vault, page name = CHRONOS, daemon = Scribe) — design locked, build paused until Round 3 ships. Full intent + phasing captured in Claude memory.

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

## To Restore Claude Memory on a New Machine
Copy this directory from the Chromebook:
`~/.claude/projects/-home-river-song-RiverSongAI/memory/`
