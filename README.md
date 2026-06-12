# RIVER SONG AI
### Personal AI Operating System — Local-First, Voice-First

> One interface. Your rules. Your data.

---

## What This Is

River Song is a personal AI operating system built for home use. She runs entirely on your own hardware — no subscriptions, no cloud required. Talk to her, type to her, or let her run routines automatically.

She handles conversation, memory, home automation, routines, inventory, feeds, and more — all through a single web interface accessible from any device on your network or via `riversongai.com`.

---

## Current Status

**Phase 1 is complete and live in production.**

| Component | Status |
|---|---|
| Voice conversation (STT → LLM → TTS) | ✅ Live |
| Web dashboard | ✅ Live |
| Multi-user auth (admin approval flow) | ✅ Live |
| Memory system (facts, preferences, summaries) | ✅ Live |
| Routines | ✅ Live |
| Home Assistant integration | ✅ Live |
| Cloudflare Tunnel (no port forwarding) | ✅ Live |
| Auto-deploy from GitHub (nightly 3am) | ✅ Live |
| Google services (Calendar, Gmail, Maps, Tasks, YouTube Music, Books) | ✅ Shipped |
| Analytics (TikTok, Instagram, Amazon, Etsy, Facebook + AI summaries) | ✅ Shipped |
| Voice ID (per-speaker biometric recognition) | ✅ Shipped |
| Barcode scanner (camera + `@zxing`) | ✅ Shipped |
| Local AI stack (vision, RAG, image gen, voice cloning, n8n) | ✅ Shipped |
| River Vector fleet (autonomous mowers/vehicles, `/api/vector`) | ✅ Shipped |
| Satellite fleet API (Horizon, Sentinel, Vortex) | ✅ Shipped |
| River Kova chore robot API + voice dispatch (`/api/kova`) | ✅ Shipped |
| River Vexa driving companion API (`/api/vexa`) | ✅ Shipped |
| MCP server (drive River Song from Claude or any MCP client) | ✅ Shipped |
| Android app (River Song frontend) | 🔜 Phase 4 |

---

## River Product Family

River Song is the hub. Satellite products run on their own hardware and
connect back over device-token REST APIs: an admin claims a unit and gets a
unit token; the device then authenticates every call with the
`X-Unit-Token` header.

| Product | Repo | What it is | API surface |
|---|---|---|---|
| River Song | [RiverSongAI](https://github.com/cassu123/RiverSongAI) | The hub — voice, memory, tools, dashboard | this repo |
| River Vector | [river-vector](https://github.com/cassu123/river-vector) | Autonomous mower / ground-vehicle fleet (zones, programs, schedules) | `/api/vector/*` |
| River Horizon | [river-horizon](https://github.com/cassu123/river-horizon) | Drones | `/api/horizon/*` |
| River Kova | [river-kova](https://github.com/cassu123/river-kova) | Household chore robots (ROS2, Pi 5) with a dedicated task-queue API | `/api/kova/*` |
| River Sentinel | [river-sentinel](https://github.com/cassu123/river-sentinel) | Patrol robots | `/api/sentinel/*` |
| River Vortex | [river-vortex](https://github.com/cassu123/river-vortex) | Home hubs | `/api/vortex/*` |
| River Vexa | [river-vexa](https://github.com/cassu123/river-vexa) | Voice-first driving companion (Android — motorcycle & car) | `/api/vexa/*` |
| Android app | [riversong_android_app](https://github.com/cassu123/riversong_android_app) | Android frontend for the hub | — |

### River Vexa (`/api/vexa`)

Vexa turns a motorcycle or car setup into a voice-first driving companion.
The Android client batches telemetry (GPS, speed, IMU lean angle, OBD-II on
the car), polls for spoken commands, and forwards voice requests.

Device endpoints (`X-Unit-Token`):

- `POST /api/vexa/session/start` — register a drive/ride; flips rider presence to `driving`
- `POST /api/vexa/session/end` — close the session; generates a trip summary from ingested telemetry
- `POST /api/vexa/telemetry` — batched GPS/speed/IMU/OBD-II samples
- `GET /api/vexa/commands/poll` — River Song → Vexa command queue (`speak`, `task_created`, `reminder_created`, `shopping_item_added`, `calendar_event_created`)
- `POST /api/vexa/event` — Vexa → River Song events. `voice_task_request` routes to the matching tool (Google Tasks, reminders, shopping list, calendar) and queues a spoken confirmation; `sos` / `crash_detected` / `fuel_low` feed the initiative engine
- `POST /api/vexa/tts` — one-shot Piper TTS, returns `audio/wav`

Admin endpoints (JWT): claim/list/delete units, queue commands, browse trip
summaries.

### River Kova (`/api/kova`)

Kova chore robots authenticate with a bearer API key plus an `X-Kova-Unit`
header (claimed per unit by an admin). The robot-side client is
`connectivity/api_client.py` in the river-kova repo.

Device endpoints:

- `POST /api/kova/units/register` / `POST /api/kova/units/deregister` — boot/shutdown lifecycle
- `POST /api/kova/heartbeat` — state, safety level, and battery; latest is kept per unit for the dashboard
- `GET /api/kova/units/{robot_id}/tasks` — poll the remote task queue (`{"tasks": [...]}`)
- `POST /api/kova/tasks/{task_id}/status` — report task progress/completion
- `POST /api/kova/telemetry` — metrics snapshots
- `POST /api/kova/alerts` — safety/system alerts; `CRITICAL` fans out as push notifications to admins

Voice dispatch: the `kova_chores` intent ("River, have Kova vacuum the
living room") parses the chore and room with the same keyword maps the
robot uses and queues the task at priority 7 on the best available unit.

Admin endpoints (JWT): claim/list/delete units, queue chores, browse
alerts.

---

## Production Setup

**Server:** Ubuntu 25.10 Desktop
- CPU: AMD FX-8350 8-core 4GHz
- RAM: 32GB
- GPU: NVIDIA GTX 1050 Ti 4GB (Whisper GPU acceleration)
- SSD: 465GB (OS + app + models)
- HDD: 1.8TB mounted at `/mnt/data` (database, logs, user data)

**Access:** `https://riversongai.com` (Cloudflare Tunnel — no port forwarding)

**Local access:** `http://192.168.1.221:8000`

---

## Architecture

```
Browser (mic) → base64 WAV over WebSocket
  → api/routes/conversation.py
  → core/conversation_loop.py
      ├─ providers/stt/whisper_local.py  → transcript
      ├─ core/intent_router.py           → route or fall through
      ├─ providers/llm/{provider}.py     → stream response
      ├─ core/memory_manager.py          → context + summary
      └─ providers/tts/piper.py          → WAV → browser
```

---

## Quick Start (New Machine)

```bash
# 1. Clone
# NOTE: on this machine, default `git@github.com:` resolves to a deploy
# key scoped to the Android repo. The main repo uses the SSH alias below.
git clone git@github-riversongai:cassu123/RiverSongAI.git
cd RiverSongAI

# 2. Copy and fill in .env
cp .env.example .env
nano .env

# 3. Run setup (handles venv, Piper, voices, Ollama models, systemd, cron)
chmod +x setup.sh
./setup.sh

# 4. Start
sudo systemctl start river-song

## Security Hooks
To prevent accidental commits of sensitive data, install the pre-commit hook:
```bash
cp scripts/pre-commit.sh .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

---

## Local Development (Chromebook)

```bash
# Backend
source venv/bin/activate
python main.py

# Frontend (hot reload)
cd frontend
npm run dev  # http://localhost:5173
```

---

## Deployment

```bash
# Manual deploy (pull + build + restart)
./deploy.sh

# Auto-deploy runs nightly at 3am via cron
# Logs: tail -f /mnt/data/river-song/logs/deploy.log
```

---

## Local LLM Models

All models run via Ollama. Installed on the production server:

| Display Name | Model ID | Best For |
|---|---|---|
| DeepSeek Thinker Lite | deepseek-r1:1.5b | Fast reasoning |
| DeepSeek Thinker Standard | deepseek-r1:7b | Reasoning |
| DeepSeek Thinker Standard+ | deepseek-r1:8b | Reasoning |
| DeepSeek Thinker Plus | deepseek-r1:14b | Complex reasoning |
| Meta Llama Lite | llama3.2:1b | Fast general |
| Meta Llama Standard | llama3.2:3b | General (default) |
| Meta Llama Plus | llama3.1:8b | General |
| Microsoft Phi Standard | phi3.5 | Efficient reasoning |
| Microsoft Phi Standard+ | phi4-mini | Efficient reasoning |
| Microsoft Phi Plus | phi4 | Strong reasoning |
| Google Gemma Lite | gemma3:1b | Fast Google model |
| Google Gemma Standard | gemma3:4b | Balanced |
| Google Gemma Plus | gemma3:12b | Capable |
| Google Gemma Max | gemma3:27b | Best Gemma |
| Alibaba Qwen Standard | qwen2.5:3b | Multilingual |
| Alibaba Qwen Plus | qwen2.5:7b | Quality |
| Alibaba Qwen Max | qwen2.5:14b | Top quality |
| Mistral Standard | mistral:7b | Fast, efficient |
| Mistral Plus | mistral-nemo | Larger context |
| Mistral Max | mixtral:8x7b | Best Mistral |
| Meta Code Llama Standard | codellama:7b | Coding |
| Meta Code Llama Plus | codellama:13b | Coding |
| Alibaba Coder Standard | qwen2.5-coder:7b | Coding |
| Alibaba Coder Plus | qwen2.5-coder:14b | Coding |

---

## Voice Models (Piper TTS)

Installed at `~/.local/share/piper/`:
- `en_US-lessac-medium` — default
- `en_US-amy-medium`
- `en_US-ryan-medium`
- `en_GB-alan-medium`

To switch: update `PIPER_MODEL_PATH` in `.env` and restart.

---

## Users

River Song supports multiple users with an admin approval flow:
- First signup becomes admin
- Additional users sign up → admin approves via `/users` page
- Roles: Admin, standard user

Current family members: Cheryl (admin), husband, sister's family.

---

## Security

- Private GitHub repo
- Cloudflare Tunnel — home IP never exposed
- JWT auth on all endpoints
- Kill switch (global shutdown with bcrypt password reset)
- Production docs (`/docs`, `/redoc`) disabled
- `.env` never committed — secrets stay on the server

## MCP server — expose tools to external clients

River Song's tools are also reachable via the [Model Context Protocol](https://modelcontextprotocol.io). Useful for driving River Song from Claude Desktop, the Claude phone app, or any future MCP-aware agent.

### Run alongside the main API

```bash
./scripts/mcp-server.sh                   # SSE on 127.0.0.1:9090
./scripts/mcp-server.sh --stdio           # stdio (embedded clients)
./scripts/mcp-server.sh --list-tools      # print exposed tools and exit
```

### Connect from Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent path on your platform:

```json
{
  "mcpServers": {
    "river-song": {
      "command": "/absolute/path/to/RiverSongAI/scripts/mcp-server.sh",
      "args": ["--stdio"],
      "env": {
        "RS_TOKEN": "<a River Song JWT — issue one via POST /api/auth/login>"
      }
    }
  }
}
```

### Exposed tools

14 tools. Excluded for safety: `control_device`, `create_commerce_sale`, `trigger_n8n`. See `mcp_server.py::EXPOSED_TOOL_NAMES` for the current list, or `docs/MCP_SERVER.md` for the full tool catalog.

---

*Private project — not affiliated with any IP holder.*
