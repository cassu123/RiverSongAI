# River Song AI — Daemons

River Song's daemon layer is a set of long-running background processes that
sit alongside the main FastAPI app (`main.py`) on `:8000`. Each daemon owns
one concern (telemetry, kiosk casting, ambient feeds, vault indexing, vision,
document RAG) and communicates with the app via a small shared protocol:

- **Heartbeat:** every 30 s the daemon POSTs `{name, status, timestamp, port}`
  to `http://localhost:{app_port}/api/daemon/heartbeat` with
  `Authorization: Bearer ${DAEMON_INTERNAL_SECRET}`.
- **Internal task server:** each daemon runs a tiny FastAPI server bound to
  `127.0.0.1:{daemon_port}` that exposes a single `POST /task` endpoint
  accepting `{action, payload}`. The main app reaches in via
  `daemons.registry.call_daemon(name, action, payload)`.
- **Registry:** `app.state.daemon_registry` (a `DaemonRegistry` instance)
  tracks last-seen heartbeats; a daemon is `alive` if seen in the last 60 s.

Both heartbeat and task-server scaffolding live in `daemons/base_daemon.py`.
Concrete daemons subclass `BaseDaemon` and implement `_main_loop()` plus an
optional `_handle_task(action, payload)`.

---

## Orchestration

### systemd (production)

#### Initial install (once per machine)

The repo ships the templated unit file at
`daemons/river-song-daemon@.service`. Before any of the per-instance
`enable` commands below will work, that template has to be copied into
`/etc/systemd/system/`:

```
sudo cp /home/riversong/RiverSongAI/daemons/river-song-daemon@.service \
        /etc/systemd/system/
sudo systemctl daemon-reload
```

Verify with `systemctl list-unit-files 'river-song-daemon@*'`. If it
returns "0 unit files listed", the copy didn't take.

#### Enable + start the daemons you want

Each daemon is a templated instance of the unit file:

```
sudo systemctl enable --now river-song-daemon@herald
sudo systemctl enable --now river-song-daemon@pulse
sudo systemctl enable --now river-song-daemon@scribe
sudo systemctl enable --now river-song-daemon@sifter
sudo systemctl enable --now river-song-daemon@warden
sudo systemctl enable --now river-song-daemon@mechanic
```

The unit runs `python -m daemons.<instance>` from
`/home/riversong/RiverSongAI`, loads `.env`, restarts on failure, and writes
to the journal:

```
journalctl -u river-song-daemon@herald -f
```

### Manual (development)

Inside the venv:

```bash
python -m daemons.herald
python -m daemons.pulse
# ...etc
```

Each daemon's `__main__.py` simply instantiates the class and calls
`asyncio.run(daemon.start())`.

### Disabling without uninstalling

Every daemon honours a per-daemon enable flag in `config/settings.py`. When
the flag is false the daemon still runs (heartbeat + task server stay live)
but its `_main_loop()` idles in a 60 s sleep. To turn one off without
stopping the service, flip the flag in `.env` and restart the unit.

---

## Shared configuration

| Setting | Purpose |
|---|---|
| `DAEMON_INTERNAL_SECRET` | Shared bearer token. Must be ≥ 24 chars and not the default; validated at boot. |
| `APP_PORT` | Used by every daemon for heartbeat + callback URLs (default `8000`). |
| `DAEMON_<NAME>_PORT` | Internal port for each daemon's task server. Bound to `127.0.0.1` only. |

### Internal port map (defaults)

| Daemon | Port | Setting |
|---|---|---|
| Warden | 8010 | `DAEMON_WARDEN_PORT` |
| Mechanic | 8011 | `DAEMON_MECHANIC_PORT` |
| Herald | 8012 | `DAEMON_HERALD_PORT` |
| Sifter | 8013 | `DAEMON_SIFTER_PORT` |
| Navigator | 8014 | `DAEMON_NAVIGATOR_PORT` *(reserved; no daemon yet)* |
| Chemist | 8015 | `DAEMON_CHEMIST_PORT` *(reserved; no daemon yet)* |
| Pulse | 8016 | `DAEMON_PULSE_PORT` |
| Scribe | 8017 | `DAEMON_SCRIBE_PORT` |

Navigator and Chemist are reserved port numbers; no concrete daemon class
exists for them yet.

---

## Daemons

### Herald — Hub Casting + Lip-Sync

- **File:** `daemons/herald/herald.py`
- **Enable:** `HERALD_ENABLED=true`
- **Inputs:** `HUB_ENTITIES` (JSON array of Home Assistant `media_player`
  entity IDs), `KIOSK_URL`, Home Assistant URL + token.
- **What it does:** every 45 s, for each Hub entity, queries Home Assistant
  for current `media_content_id`. If the hub is idle or showing something
  other than `KIOSK_URL`, re-casts the kiosk URL via
  `media_player.play_media`.
- **Task actions:**
  - `lip_sync` — decode base64 audio (WAV or MP3), compute per-20 ms RMS
    "mouth open" values, broadcast `lip_sync` event to
    `/api/broadcast/lip_sync`.
  - `recast_now` — force the kiosk re-cast loop to run immediately.
- **Dependencies:** Home Assistant (`providers.smart_home.home_assistant`),
  `ffmpeg` on PATH for MP3 lip-sync decoding, `numpy`.
- **Health:** heartbeat every 30 s; visible at `/api/daemons` (registry).

### Pulse — Ambient Feeds

- **File:** `daemons/pulse/pulse.py`
- **Enable:** `DAEMON_PULSE_ENABLED=true` (default true) and per-source
  flags read from the admin config (`pulse_news_enabled`,
  `pulse_markets_enabled`, `pulse_flights_enabled`).
- **What it does:** every `PULSE_TICK_SECONDS` (default 300) fetches news
  headlines, markets quote (`PULSE_TICKER_SYMBOL`, default `^GSPC`), and
  flights overhead, then POSTs each snapshot back to
  `/api/pulse/_internal/snapshot`. Prunes via
  `/api/pulse/_internal/prune` to keep ~100 snapshots per source.
- **Task actions:** `refresh` — force one tick immediately.
- **Dependencies:** `providers.feeds.news`, `providers.feeds.stocks`,
  `providers.feeds.flights`, finnhub or alpha-vantage key for quotes,
  optional `LOCATION_LAT/LON` for flights overhead.
- **Health:** Pulse tab in the UI shows last snapshot; `/api/pulse` returns
  current state.

### Scribe — Chronological Heuristic Record (CHRONOS engine)

- **File:** `daemons/scribe/scribe.py`
- **Enable:** `DAEMON_SCRIBE_ENABLED=true` (default true).
- **What it does:** every 300 s scans `vault_notes` for rows where
  `indexed_at < mtime OR indexed_at IS NULL` (stale notes). For each stale
  note owned by a user it reads the markdown via
  `providers.vault.vault_provider.VaultProvider`, runs an LLM extraction
  prompt asking for `[{key, value}]` JSON, upserts each fact via
  `memory_manager.upsert_fact(source="scribe")`, and stamps `indexed_at` to
  the current time.
- **Task actions:** `analyze_note(path)` — deep-analyse a single note.
  (Currently a stub returning `{status: "analyzed"}`.)
- **Dependencies:** the main app's `memory_manager` and a working LLM
  provider via `core.conversation_loop._build_llm_provider`. See
  `docs/CHRONOS.md` for the broader design context.

### Sifter — Background Document RAG (stub)

- **File:** `daemons/sifter/sifter.py`
- **Enable:** `SIFTER_ENABLED=false` (default false).
- **Status:** scaffolded only. The class exists and the systemd template
  works, but `_main_loop()` is a 60 s idle sleep — no document scanning is
  implemented yet.
- **Intended role:** index `WAPS_DOCUMENTS_PATH` (`/mnt/data/river-song/waps`)
  into ChromaDB so the RAG route can answer questions over the WAPS corpus.

### Warden — Security / Vision (stub)

- **File:** `daemons/warden/warden.py`
- **Enable:** `WARDEN_ENABLED=false` (default false).
- **Status:** scaffolded only. Class exists and heartbeats run, but
  `_main_loop()` is a 60 s idle sleep. The settings layer reserves
  `WARDEN_RTSP_CAMERAS`, `YOLO_MODEL`, `YOLO_CONFIDENCE`,
  `YOLO_INFERENCE_DEVICE` for the eventual YOLO-on-RTSP pipeline.

### Mechanic — ArduRover Telemetry / MAVLink

- **File:** `daemons/mechanic/mechanic.py`
- **Enable:** `MECHANIC_ENABLED=false` (default false).
- **What it does:** connects to a MAVLink radio at `MAVLINK_SERIAL_PORT`
  (`/dev/ttyUSB0`) at `MAVLINK_BAUD_RATE` (57600) via `pymavlink`. Waits
  for a heartbeat, then continuously reads telemetry messages
  (`HEARTBEAT`, `GPS_RAW_INT`, `SYS_STATUS`, `VFR_HUD`, `MISSION_CURRENT`,
  `MISSION_COUNT`) into an internal dict and POSTs to
  `/api/rover/telemetry` on every update. Reconnects with a 10 s back-off
  on serial failure.
- **Task actions:**
  - `telemetry` — return the current telemetry snapshot.
  - `arm` / `disarm` — send `MAV_CMD_COMPONENT_ARM_DISARM` (id 400).
  - `set_mode(mode)` — set ArduRover flight mode by name.
- **Dependencies:** `pymavlink`, USB serial access (user `riversong` may
  need to be in the `dialout` group).

---

## Adding a new daemon

1. Add a settings field `daemon_<name>_port` (and an `enabled` flag) to
   `config/settings.py`; mirror in `.env.example`.
2. Create `daemons/<name>/<name>.py` with a `class FooDaemon(BaseDaemon)`
   that sets `name = "<name>"` and implements `_main_loop()`.
3. Create `daemons/<name>/__main__.py` that runs
   `asyncio.run(FooDaemon().start())`.
4. Enable the systemd instance: `sudo systemctl enable --now
   river-song-daemon@<name>`.
5. Optional: expose task actions by overriding `_handle_task()` and call
   them from app routes via `daemons.registry.call_daemon`.
