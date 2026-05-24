# API Overview

River Song's HTTP API is FastAPI-based. Full route detail is generated
automatically at runtime — this document is the human-readable index.

---

## Auto-generated documentation

When `ENVIRONMENT=development`, FastAPI exposes interactive docs:

- **Swagger UI:** `http://localhost:8000/docs`
- **ReDoc:** `http://localhost:8000/redoc`
- **OpenAPI JSON:** `http://localhost:8000/openapi.json`

In production these endpoints are disabled (see `main.py`); use a
local dev instance to browse.

---

## Route groups

All routers live under `api/routes/` and are registered in
`main.py::_configure_routes`. They are grouped here by responsibility.

### Auth & users

| Router | Prefix | File |
|---|---|---|
| Auth | `/api/auth` | `api/routes/auth.py` |
| Admin | `/api/admin` | `api/routes/admin.py` |
| Kill switch | `/api/killswitch` | `api/routes/killswitch.py` |
| Parent controls | `/api/parent` | `api/routes/parent.py` |
| Legal | `/api/legal` | `api/routes/legal.py` |

### Conversation

| Router | Prefix | File |
|---|---|---|
| Conversation (HTTP + WebSocket) | `/api/conversation` | `api/routes/conversation.py` |
| Voice ID | `/api/voice-id` | `api/routes/voice_id.py` — see `docs/VOICE_ID.md` |
| Vision | `/api/vision` | `api/routes/vision.py` |
| Image generation | `/api/image` | `api/routes/image.py` |
| RAG | `/api/rag` | `api/routes/rag.py` |

### Memory & context

| Router | Prefix | File |
|---|---|---|
| Memory (facts, summaries, prefs) | `/api/memory` | `api/routes/memory.py` |
| Vault (CHRONOS) | `/api/vault` | `api/routes/vault.py` — see `docs/CHRONOS.md` |
| Context | `/api/context` | `api/routes/context.py` |

### Settings & models

| Router | Prefix | File |
|---|---|---|
| Model settings | `/api/models` | `api/routes/models_settings.py` |
| Features | `/api/features` | `api/routes/features.py` |
| Usage / token analytics | `/api/usage` | `api/routes/usage.py` — see `docs/TOKEN_TRACKER.md` |

### Household & lifestyle

| Router | Prefix | File |
|---|---|---|
| Dashboard | `/api/dashboard` | `api/routes/dashboard.py` |
| Home (Home Assistant) | `/api/home` | `api/routes/home.py` |
| Routines | `/api/routines` | `api/routes/routines.py` |
| Inventory | `/api/inventory` | `api/routes/inventory.py` |
| Vehicles | `/api/vehicles` | `api/routes/vehicles.py` |
| Culinary | `/api/culinary` | `api/routes/culinary.py` |
| Reading | `/api/reading` | `api/routes/reading.py` |
| Location | `/api/location` | `api/routes/location.py` |
| Feeds | `/api/feeds` | `api/routes/feeds.py` |
| Pulse (live snapshots) | `/api/pulse` | `api/routes/pulse.py` |

### Integrations

| Router | Prefix | File |
|---|---|---|
| Google suite | `/api/google` | `api/routes/google.py` |
| Commerce | `/api/commerce` | `api/routes/commerce.py` |
| Analytics | `/api/analytics` | `api/routes/analytics.py` |
| Integrations meta | `/api/integrations` | `api/routes/integrations.py` |
| Shopify auth | `/api/shopify` | `api/routes/shopify_auth.py` |
| Shopify webhooks | `/webhooks/shopify` | `api/routes/shopify_webhooks.py` |
| n8n webhooks | `/api/webhooks/n8n` | `api/routes/n8n_webhooks.py` — ⚠️ see `docs/KNOWN_ISSUES.md` |

### Infrastructure

| Router | Prefix | File |
|---|---|---|
| Health | `/api/health` | `api/routes/health.py` |
| Daemons | `/api/daemon` | `api/routes/daemons.py` — see `docs/DAEMONS.md` |
| Broadcast | `/api/broadcast` | `api/routes/broadcast.py` — see `docs/BROADCAST.md` |
| Push notifications | `/api/push` | `api/routes/push.py` — see `docs/PUSH_NOTIFICATIONS.md` |
| Rover (MAVLink) | `/api/rover` | `api/routes/rover.py` |
| Vault audit (under Vault) | `/api/vault` | `api/routes/vault.py` |

---

## Auth model

- **JWT Bearer.** Most endpoints require `Authorization: Bearer <token>`.
  Token is issued by `POST /api/auth/login` and decoded via
  `core.auth.decode_token`. The `sub` claim is the `user_id`; the
  `role` claim (`"admin"` or default) gates admin-only routes.
- **Daemon internal secret.** A small set of endpoints (e.g.
  `/api/broadcast/*`, `/api/pulse/_internal/*`,
  `/api/daemon/heartbeat`) accept only
  `Authorization: Bearer ${DAEMON_INTERNAL_SECRET}`.
- **WebSocket tickets.** WebSocket auth uses one-time tickets
  (`WS_TICKET_LIFETIME_SECONDS`). Legacy `?token=` query-string
  acceptance is gated by `LEGACY_WS_TOKEN_ACCEPT` (default true; plan
  to disable).
- **HMAC.** Shopify webhooks validate `SHOPIFY_WEBHOOK_SECRET`.

---

## Rate limiting

`slowapi`-based; per-endpoint defaults in `config/settings.py`:

| Endpoint | Default |
|---|---|
| `/api/conversation/chat` | `60/minute` |
| `/api/conversation/extract-facts` | `10/minute` |
| `/api/image/generate` | `10/minute` |
| `/api/auth/login` | `10/minute` |
| `/api/auth/signup` | `5/minute` |
| Shopify webhooks | `100/minute` |
| n8n webhooks | `60/minute` |

---

## Where to look next

- `docs/INTEGRATIONS.md` — per-service status, auth, and setup guides.
- `docs/DAEMONS.md` — the long-running background processes.
- `docs/MCP_SERVER.md` — the same tools, exposed via Model Context
  Protocol to external clients.
- `docs/KNOWN_ISSUES.md` — wiring gaps and minor bugs noticed during
  the 2026-05-23 docs remediation.
