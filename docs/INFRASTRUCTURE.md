# INFRASTRUCTURE.md — RiverSongAI Runbook

This document tracks the sidecars, libraries, and external integrations that power RiverSongAI.

## 0. Initial Audit (2026-05-25)

| Subsystem | Status | Notes |
|---|---|---|
| Providers | ✅ Exists | `providers/` directory confirmed. |
| Daemons | ✅ Exists | `daemons/` directory confirmed. |
| Chronos | ✅ Canonical | `docs/CHRONOS.md` is substantial and confirmed. |
| Current STT | 📦 `openai-whisper` | `import whisper` found in `providers/stt/whisper_local.py`. |
| Docker | ❌ Missing | `docker` and `docker compose` not found in PATH; `docker.service` not found. |

### Hardware
- **Dev Box:** GTX 1050 Ti (4GB VRAM).
- **Current State:** Pure Python/systemd services.

---

## 1. Phase 1 — Python Libraries

### Faster-Whisper
- **Status:** [PENDING]
- **Repo:** https://github.com/SYSTRAN/faster-whisper
- **Notes:** 3-4x speedup on 1050 Ti.

### Apprise
- **Status:** [PENDING]
- **Repo:** https://github.com/caronc/apprise
- **Notes:** Unified push notifications.

### Open-Interpreter
- **Status:** [PENDING]
- **Repo:** https://github.com/OpenInterpreter/open-interpreter
- **Notes:** Local code execution tool.

### Unstructured
- **Status:** [PENDING]
- **Repo:** https://github.com/Unstructured-IO/unstructured
- **Notes:** Advanced RAG ingestion (PDF, HTML, OCR).

---

## 2. Phase 2 — Docker Sidecars

### Paperless-ngx
- **Official URL:** https://github.com/paperless-ngx/paperless-ngx
- **Image:** `ghcr.io/paperless-ngx/paperless-ngx:2.10`
- **Port:** 8010
- **Env Vars:** `PAPERLESS_URL`, `PAPERLESS_TOKEN`
- **Volume:** `./infra/paperless/data`, `./infra/paperless/media`
- **Backup:** Back up the entire `./infra/paperless` directory.

### Immich
- **Official URL:** https://immich.app/
- **Image:** `ghcr.io/immich-app/immich-server:v1.106.4`
- **Port:** 2283
- **Env Vars:** `IMMICH_URL`, `IMMICH_API_KEY`
- **Volume:** `${UPLOAD_LOCATION}`
- **Backup:** Back up the database and the upload location.

### Home Assistant
- **Official URL:** https://www.home-assistant.io/
- **Image:** `ghcr.io/home-assistant/home-assistant:2026.5`
- **Port:** 8123 (Host mode)
- **Env Vars:** `HOME_ASSISTANT_URL`, `HOME_ASSISTANT_TOKEN`
- **Volume:** `./infra/homeassistant`
- **Backup:** Back up `./infra/homeassistant/config`.

### Zigbee2MQTT
- **Official URL:** https://www.zigbee2mqtt.io/
- **Image:** `koenkk/zigbee2mqtt:1.36.1`
- **Port:** 8081
- **Volume:** `./infra/zigbee2mqtt/data`
- **Backup:** Back up `./infra/zigbee2mqtt/data`.

### Firefly III
- **Official URL:** https://www.firefly-iii.org/
- **Image:** `fireflyiii/core:version-6.1.16`
- **Port:** 8082
- **Env Vars:** `FIREFLY_URL`, `FIREFLY_TOKEN`
- **Volume:** `./infra/firefly/export`
- **Backup:** Back up the MariaDB database.

### Grocy
- **Official URL:** https://grocy.info/
- **Image:** `lscr.io/linuxserver/grocy:4.1.0`
- **Port:** 9283
- **Env Vars:** `GROCY_URL`, `GROCY_API_KEY`
- **Volume:** `./infra/grocy/data`
- **Backup:** Back up `./infra/grocy/data`.

### Tandoor
- **Official URL:** https://tandoor.dev/
- **Image:** `vabene1111/recipes:1.5.21`
- **Port:** 8085
- **Env Vars:** `TANDOOR_URL`, `TANDOOR_TOKEN`
- **Volume:** `./infra/tandoor/media`, `./infra/tandoor/static`
- **Backup:** Back up the Postgres database.

### Homebox
- **Official URL:** https://homebox.software/
- **Image:** `ghcr.io/sysadminsmedia/homebox:v0.18.0`
- **Port:** 7745
- **Env Vars:** `HOMEBOX_URL`, `HOMEBOX_TOKEN`
- **Volume:** `./infra/homebox/data`
- **Backup:** Back up `./infra/homebox/data`.

### SearXNG
- **Official URL:** https://searxng.github.io/searxng/
- **Image:** `searxng/searxng:2026.5.20`
- **Port:** 8888
- **Volume:** `./infra/searxng/settings.yml`

---

## 3. Backups

The following directories must be included in your backup routine:

| Service | Directory |
|---|---|
| Paperless | `./infra/paperless/` |
| Immich | `${UPLOAD_LOCATION}` + Database |
| Home Assistant | `./infra/homeassistant/` |
| Zigbee2MQTT | `./infra/zigbee2mqtt/data/` |
| Firefly | Database |
| Grocy | `./infra/grocy/data/` |
| Tandoor | `./infra/tandoor/media/` + Database |
| Homebox | `./infra/homebox/data/` |
| MemGPT | `./infra/memgpt/` |
| GPT-SoVITS | `./infra/gpt-sovits/output/` |
| ComfyUI | `./infra/comfyui/` |

**Database Backups:** Use `docker exec` to run `pg_dump` or `mariadb-dump` for the corresponding containers.

---

## 4. Environment Variables Index

| Variable | Phase | Description |
|---|---|---|
| `WHISPER_MODEL` | 1 | Model name for Faster-Whisper (e.g., `small.en`). |
| `APPRISE_URLS` | 1 | Comma-separated list of Apprise notification URLs. |
| `PAPERLESS_URL` | 2 | URL for Paperless-ngx API. |
| `PAPERLESS_TOKEN` | 2 | API Token for Paperless-ngx. |
| `IMMICH_URL` | 2 | URL for Immich API. |
| `IMMICH_API_KEY` | 2 | API Key for Immich. |
| `HOME_ASSISTANT_URL` | 2 | URL for Home Assistant. |
| `HOME_ASSISTANT_TOKEN` | 2 | Long-lived Access Token for HA. |
| `FIREFLY_URL` | 2 | URL for Firefly III. |
| `FIREFLY_TOKEN` | 2 | Personal Access Token for Firefly III. |
| `GROCY_URL` | 2 | URL for Grocy. |
| `GROCY_API_KEY` | 2 | API Key for Grocy. |
| `TANDOOR_URL` | 2 | URL for Tandoor Recipes. |
| `TANDOOR_TOKEN` | 2 | API Token for Tandoor. |
| `HOMEBOX_URL` | 2 | URL for Homebox. |
| `HOMEBOX_TOKEN` | 2 | API Token for Homebox. |
| `MEMGPT_URL` | 3 | URL for MemGPT API. |
| `MEMGPT_TOKEN` | 3 | Admin Token for MemGPT. |
| `SOVITS_URL` | 3 | URL for GPT-SoVITS API. |
| `COMFYUI_URL` | 3 | URL for ComfyUI API. |
| `GLANCES_URL` | 5 | URL for Glances API. |


