# River Song AI — Session Handoff

Use this file to catch up Claude in a new session. Paste it into the chat or reference it.

---

## Current State

River Song AI is **live in production** at `https://riversongai.com`.

- Cheryl is the admin user
- Server is running, auto-deploys nightly at 3am
- All local LLM models installed and showing in UI with friendly names

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

## Known Fixes Applied
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
