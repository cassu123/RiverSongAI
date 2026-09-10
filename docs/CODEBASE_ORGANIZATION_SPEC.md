# River Song AI — Codebase Reorganization & Architecture Specification
**Document ID:** `SPEC-2026-ARCH-01`  
**Classification:** Internal Engineering Standard & Architecture Plan  
**Target Audience:** Engineering Team & AI Agents (Antigravity, Claude, DeepSeek)  
**Status:** PROPOSED FOR REVIEW  
**Date:** September 2026  

---

## 1. Executive Summary & Mission Directives

As the River Song AI ecosystem expanded from a local conversational assistant into a multi-program governance system (spanning household robotics, IoT sensors, culinary management, fleet operations, and ambient intelligence), the file layout grew organically.

This specification outlines a **Google/NASA-grade architectural reorganization** designed to:
1. **Eliminate Root Directory Pollution:** Reduce root directories and loose scripts from 29 items down to a disciplined, standardized layout.
2. **Implement Domain-Driven Modularization:** Group fragmented business logic (culinary, inventory, commerce, vehicles) currently dumped at root into structured domain packages.
3. **Partition Monolithic Flat Folders:** Modularize `api/routes/` (62 flat routers), `core/` (50+ flat modules), and `frontend/src/pages/` (41 flat pages) into domain namespaces.
4. **Purge Dead Artifacts:** Remove abandoned scratch directories, obsolete databases, and duplicate configs.
5. **Guarantee Absolute Zero-Downtime & Import Stability:** Employ **Facade Re-export Shims** and **Vite Path Aliasing** so that any code referencing historical paths continues to resolve seamlessly without breaking tests, API routing, or the frontend build.

### Mission Invariants (Non-Negotiable)
* **Invariant A (Zero Regression):** The 904 backend pytest tests must pass at 100% after every phase.
* **Invariant B (Build Stability):** The Vite frontend build must bundle cleanly in <2.5 seconds with zero build errors.
* **Invariant C (Contract Continuity):** No REST endpoint URL (`/api/...`) or WebSocket route contract may change.
* **Invariant D (Graceful Deprecation):** Every moved file must maintain a backwards-compatible stub/re-export shim during the transition window.

---

## 2. Current State Audit (The Flaws)

### 2.1 Root Directory Pollution
The project root currently contains **29 top-level items**, exhibiting severe namespace pollution:

```text
[ROOT POLLUTION INVENTORY]
├── commercial_inventory/   <-- Domain package sitting at root
├── culinary/               <-- Single-file models package sitting at root
├── inventory/              <-- Domain package sitting at root
├── vehicles/               <-- Domain package sitting at root
├── config/                 <-- Python settings
├── config_files/           <-- JSON configs & OAuth templates (split from config/)
├── fake_storage/           <-- Empty abandoned directory
├── scratch/                <-- Empty abandoned directory
├── prototypes/             <-- Single old HTML prototype (presence-orb.html)
├── river_song.db           <-- Stale 462KB SQLite DB (real DB is /mnt/data/river-song/db/river_song.db)
├── .env.bak*               <-- Leftover root backups
├── deploy.sh               <-- Shell script in root
├── dev.sh                  <-- Shell script in root
├── restart_backend.sh      <-- Shell script in root
├── setup.sh                <-- Shell script in root
└── river-song.service      <-- Systemd unit file in root (duplicates daemons/ template)
```

### 2.2 Core Logic Sprawl (`core/`)
`core/` currently contains 50+ files in a flat directory, mixing conversational loops with hardware drivers, sweeping routines, and smart home tools:
* **Vortex Cluster:** 12 individual files prefixed `vortex_*.py` (`vortex_actions.py`, `vortex_calls.py`, `vortex_vision.py`, etc.) totaling ~150KB.
* **Tools Cluster:** 7 individual files prefixed `tools_*.py` (`tools.py`, `tools_commerce.py`, `tools_schemas.py`, etc.).
* **Domain Sweep Cluster:** `kitchen_sweep.py`, `inventory_sweep.py`, `sweeps.py`.
* **Subsystem Misplacement:** `cooking_sessions.py` and `garage.py` live in `core/` while their corresponding domain packages live at root (`culinary/` and `vehicles/`).

### 2.3 API Router Sprawl (`api/routes/`)
`api/routes/` contains **62 flat router files**. Handlers for authentication, system health, background daemons, autonomous lawnmowers, recipes, and e-commerce transactions all sit in a single unindexed directory.

### 2.4 Frontend Sprawl (`frontend/src/`)
* **Pages (`frontend/src/pages/`):** 41 flat JSX components. Test files (`CulinaryPage.test.jsx`, `VehiclePage.test.jsx`) are mixed directly with page code instead of a dedicated test folder.
* **Components (`frontend/src/components/`):** 45 flat JSX components. Culinary tabs, vehicle telemetry modals, chat interface cards, and generic UI widgets are unsegregated.

---

## 3. Target Monorepo Architecture

Following Google Monorepo standards and NASA Flight Software architecture patterns, the target layout establishes strict layer separation:

```text
RiverSongAI/
├── .github/                      # CI/CD workflows and Dependabot configuration
├── api/                          # HTTP, REST, and WebSocket presentation layer
│   ├── middleware/               # Auth, CORS, CSRF, Rate-limiting middleware
│   └── routes/                   # Categorized route controllers
│       ├── __init__.py           # Unified router registry & backwards compatibility facade
│       ├── ai/                   # Conversation, research, RAG, CAD, memory, skills
│       ├── auth/                 # Login, 2FA, face/voice ID, tokens, OAuth
│       ├── domains/              # Culinary, inventory, commerce, vehicles, analytics
│       ├── feeds/                # Pulse, news, weather, flights, market pollers
│       ├── fleet/                # Vortex, Vector, Horizon, Vexa, Kova fleet controllers
│       ├── system/               # Health, settings, daemons, killswitch, usage
│       └── webhooks/             # n8n, Shopify, Apprise endpoints
│
├── config/                       # Centralized configuration & environment schemas
│   ├── settings.py               # Pydantic v2 application settings
│   └── templates/                # Example configs, device registry & OAuth schemas
│
├── core/                         # Central intelligence & autonomous engine
│   ├── ai/                       # Agent loop, conversation loop, intent router, distiller
│   ├── engine/                   # Context engine, initiative, proactive triggers, scheduler
│   ├── security/                 # Auth verification, CSRF, killswitch, slowapi limiter
│   ├── sweeps/                   # Sweeps framework & recurring background hygiene
│   ├── tools/                    # Tool registry, schemas, and domain tool definitions
│   └── vortex/                   # Vortex hub, actions, calling, video, and audio services
│
├── daemons/                      # Independent long-running background daemon processes
│   ├── base_daemon.py            # Abstract BaseDaemon with heartbeat and task server
│   ├── registry.py               # Daemon discovery, status tracker, and IPC caller
│   ├── mechanic/                 # ArduRover / MAVLink telemetry daemon
│   ├── pulse/                    # Ambient 5-minute news/markets/flight poller
│   ├── scribe/                   # Chronos heuristic note scanner
│   ├── sifter/                   # RAG document indexing daemon
│   ├── vector_discovery/         # Mower SSDP/mDNS LAN discovery daemon
│   ├── vector_scheduler/         # Mower zone/mission scheduler daemon
│   └── warden/                   # RTSP camera vision daemon
│
├── domains/                      # Domain-Driven Business Logic & Data Models
│   ├── commerce/                 # Commercial inventory, sales, Shopify synchronization
│   ├── culinary/                 # Recipes, ingredients, kitchen equipment, cook sessions
│   ├── inventory/                # Household assets, QR/barcode scanning, storage audit
│   └── vehicles/                 # Vehicle maintenance, service logs, odometer telemetry
│
├── frontend/                     # Modern React + Vite frontend application
│   ├── src/
│   │   ├── __tests__/            # Colocated component & page unit tests
│   │   ├── components/           # Subsystem component libraries
│   │   │   ├── conversation/     # River avatar, speech visualizers, chat interface
│   │   │   ├── culinary/         # Recipe cards, cook timers, appliance panels
│   │   │   ├── modals/           # Dialogs, walkthroughs, QR scanner modals
│   │   │   ├── ui/               # Core atomic primitives (Button, Toggle, Modal, Table)
│   │   │   ├── vehicles/         # Maintenance pulse, service logs, asset cards
│   │   │   └── widgets/          # Dashboard cards, pulse widget, health meters
│   │   ├── pages/                # Domain-scoped routed views
│   │   │   ├── ai/               # Conversation, Chat, Memory, Skills, SLAE
│   │   │   ├── auth/             # Login, Signup, Setup, OAuth callbacks
│   │   │   ├── domains/          # Culinary, Inventory, Commerce, Vehicles, Reading
│   │   │   ├── fleet/            # Fleet hub, Vector mower control, unit inspection
│   │   │   ├── home/             # Home node, Environment, Routines, Briefing
│   │   │   └── system/           # Settings, Admin, Users, KillSwitch, WebhookTokens
│   │   ├── hooks/                # React custom hooks (useWebSocket, useFleet, etc.)
│   │   ├── context/              # React Context state providers
│   │   ├── lib/                  # API client, audio processors, utility libraries
│   │   └── styles/               # CSS modules and design system tokens
│   ├── package.json
│   └── vite.config.js            # Build pipeline with path aliases (@domains, @components)
│
├── infra/                        # Docker compose sidecars (Paperless, Immich, Neo4j, etc.)
├── providers/                    # Hardware & third-party driver integrations
├── scripts/                      # Deployment, verification, and database utility scripts
├── tests/                        # Full Python integration and regression test suite
├── CLAUDE.md                     # Operational directives for Claude Code
├── README.md                     # System documentation & quickstart
└── docker-compose.yml            # Core and AI sidecar services definition
```

---

## 4. Subsystem Refactoring & Migration Mapping

### 4.1 Domain Services Migration (`domains/`)
Move domain code from repository root into `domains/`. To ensure 100% backwards compatibility with any existing imports, create lightweight deprecation re-export shims at the old locations.

| Old Location | Target Clean Location | Backwards Compatibility Shim Strategy |
|---|---|---|
| `commercial_inventory/` | `domains/commerce/` | Keep `commercial_inventory/` with `__init__.py`, `management.py`, `models.py` doing `from domains.commerce.models import *` |
| `culinary/models.py` | `domains/culinary/models.py` | Keep `culinary/models.py` re-exporting `domains.culinary.models` |
| `core/cooking_sessions.py` | `domains/culinary/sessions.py` | Re-export in `core/cooking_sessions.py` |
| `core/kitchen_sweep.py` | `domains/culinary/sweep.py` | Re-export in `core/kitchen_sweep.py` |
| `inventory/` | `domains/inventory/` | Keep `inventory/` re-exporting `domains.inventory.*` |
| `core/inventory_sweep.py` | `domains/inventory/sweep.py` | Re-export in `core/inventory_sweep.py` |
| `vehicles/` | `domains/vehicles/` | Keep `vehicles/` re-exporting `domains.vehicles.*` |
| `core/garage.py` | `domains/vehicles/garage.py` | Re-export in `core/garage.py` |

#### Example Deprecation Shim Pattern
```python
# culinary/models.py
"""DEPRECATION SHIM: This module has moved to domains.culinary.models."""
import warnings
warnings.warn("culinary.models is deprecated; import from domains.culinary.models instead.", DeprecationWarning, stacklevel=2)
from domains.culinary.models import *  # noqa: F401, F403
```

### 4.2 Core Subsystem Modularization (`core/`)

#### Vortex Subsystem
Consolidate 12 loose `vortex_*.py` files into `core/vortex/`:
* `core/vortex/actions.py` (from `core/vortex_actions.py`)
* `core/vortex/calls.py` (from `core/vortex_calls.py`)
* `core/vortex/calls_ws.py` (from `core/vortex_calls_ws.py`)
* `core/vortex/cast.py` (from `core/vortex_cast.py`)
* `core/vortex/hub.py` (from `core/vortex_hub.py`)
* `core/vortex/media.py` (from `core/vortex_media.py`)
* `core/vortex/replica.py` (from `core/vortex_replica.py`)
* `core/vortex/security.py` (from `core/vortex_security.py`)
* `core/vortex/surfaces.py` (from `core/vortex_surfaces.py`)
* `core/vortex/units.py` (from `core/vortex_units.py`)
* `core/vortex/vision.py` (from `core/vortex_vision.py`)
* `core/vortex/voice.py` (from `core/vortex_voice.py`)

#### Tools Subsystem
Consolidate tool modules into `core/tools/`:
* `core/tools/registry.py` (core tool dispatcher from `tools.py`)
* `core/tools/schemas.py` (from `tools_schemas.py`)
* `core/tools/commerce.py` (from `tools_commerce.py`)
* `core/tools/home.py` (from `tools_home.py`)
* `core/tools/memory.py` (from `tools_memory.py`)
* `core/tools/reading.py` (from `tools_reading.py`)
* `core/tools/routines.py` (from `tools_routines.py`)

### 4.3 API Router Categorization (`api/routes/`)
Group the 62 routes into 7 functional subdirectories while preserving `api/routes/__init__.py` as the **Contract Facade**.

| Category | Routes Included |
|---|---|
| **`api/routes/auth/`** | `auth.py`, `twofa.py`, `face_id.py`, `voice_id.py`, `webhook_tokens.py`, `shopify_auth.py` |
| **`api/routes/system/`** | `health.py`, `daemons.py`, `killswitch.py`, `features.py`, `models_settings.py`, `usage.py`, `admin.py`, `remote_ollama.py` |
| **`api/routes/ai/`** | `conversation.py`, `chat_sessions.py`, `session_presets.py`, `proactive.py`, `initiative.py`, `skills.py`, `research.py`, `rag.py`, `image.py`, `cad.py`, `memory.py`, `vault.py`, `slae.py` |
| **`api/routes/domains/`** | `culinary.py`, `culinary_sessions.py`, `inventory.py`, `commerce.py`, `vehicles.py`, `reading.py`, `analytics.py`, `home.py`, `routines.py`, `briefing.py`, `dashboard.py` |
| **`api/routes/fleet/`** | `fleet.py`, `vector_fleet.py`, `rover.py`, `kova.py`, `vexa.py`, `vortex.py`, `context.py` |
| **`api/routes/webhooks/`** | `n8n_webhooks.py`, `shopify_webhooks.py`, `push.py` |
| **`api/routes/feeds/`** | `feeds.py`, `pulse.py`, `google.py`, `location.py`, `compare.py`, `legal.py`, `parent.py`, `vision.py`, `sweeps.py` |

**Routing Stability:** `api/routes/__init__.py` continues to import all routers and re-export them under the exact same variable names (`auth_router`, `culinary_router`, etc.). `main.py` requires **zero modifications**.

### 4.4 Frontend Categorization (`frontend/src/`)

#### Pages Namespace Partitioning
* `src/pages/ai/`: `ConversationPage`, `ChatPage`, `MemoryPage`, `MemoryHubPage`, `SkillsPage`, `SlaePage`, `RemoteOllamaPage`
* `src/pages/auth/`: `LoginPage`, `SignupPage`, `SetupPage`, `ForcePasswordChangePage`, `GoogleCallbackPage`, `ReadingOAuthCallbackPage`
* `src/pages/domains/`: `CulinaryPage`, `InventoryPage`, `CommercePage`, `VehiclePage`, `ReadingPage`, `AnalyticsPage`, `DocumentsPage`, `ComparePage`
* `src/pages/fleet/`: `FleetPage`, `VectorFleetPage` (plus existing `fleet/` subcomponents)
* `src/pages/home/`: `HomeNodePage`, `EnvironmentPage`, `RoutinesPage`, `BriefingPage`, `DashboardPage`, `FeedsPage`
* `src/pages/system/`: `SettingsPage`, `AdminSettingsPage`, `UsersPage`, `KillSwitchPage`, `WebhookTokensPage`, `PresetsPage`, `ProactivePage`, `ProfilePage`, `GooglePage`
* `src/__tests__/`: Move `CulinaryPage.test.jsx` and `VehiclePage.test.jsx`.

#### Components Partitioning
* `src/components/conversation/`: `ChatInterface`, `ConversationPanel`, `RiverAvatar`, `RiverStatusBox`, `PresenceBulb`, `AudioVisualizer`
* `src/components/culinary/`: `AddRecipeModal`, `AppliancePanel`, `CookPlanTab`, `CookPlanTimeline`, `ShoppingListTab`, `StepTimer`
* `src/components/vehicles/`: `MaintenancePulse`, `AssetDetailModal`, `JobWalkthroughModal`
* `src/components/widgets/`: `PulseWidget`, `DaemonHealthWidget`, `HealthCard`, `RateIndicator`
* `src/components/modals/`: `HomeAuditModal`, `ReadingIntegrationsModal`, `ReassignHomeModal`, `RoomSweepModal`
* `src/components/ui/`: `ErrorBoundary`, `MermaidDiagram`, `ModelPickerPopover`, `STLViewer`, `ToastHost`, `BarcodeScanner`, `RsMarkdown`, `RsMark`

#### Vite Path Aliasing (`frontend/vite.config.js`)
To eliminate fragile relative import chains (`../../components/ui/Button`), configure path aliases in Vite:
```javascript
resolve: {
  alias: {
    '@': path.resolve(__dirname, './src'),
    '@pages': path.resolve(__dirname, './src/pages'),
    '@components': path.resolve(__dirname, './src/components'),
    '@hooks': path.resolve(__dirname, './src/hooks'),
    '@lib': path.resolve(__dirname, './src/lib'),
  }
}
```

---

## 5. Artifact Liquidation List (Purging Useless Items)

The following items are obsolete, abandoned, or stale and should be permanently removed from disk and git tracking:

| Target File / Directory | Size | Reason for Purging |
|---|---|---|
| `fake_storage/` | 4 KB | Empty, unreferenced directory. |
| `scratch/` | 4 KB | Empty directory with stale `__pycache__`. |
| `prototypes/` | 44 KB | Contains `presence-orb.html` (obsolete May 2026 prototype). Relocate or remove. |
| `./river_song.db` (root) | 462 KB | Stale SQLite database from May 30. Active DB is in `/mnt/data/river-song/db/`. |
| `data/river_song.db` | 327 KB | Stale SQLite database from May 23. Active DB is in `/mnt/data/river-song/db/`. |
| `.env.bak*` (root) | 28 KB | Leftover local environment backups. |
| `restart_backend.sh` | 182 B | Redundant root script; consolidate into `scripts/restart_backend.sh`. |
| `dev.sh` | 570 B | Consolidate into `scripts/dev.sh`. |
| `config_files/` | 28 KB | Move JSON templates (`device_registry.example.json`, etc.) into `config/templates/`. |
| `river-song.service` (root) | 363 B | Duplicate root unit file. Real template is `daemons/river-song-daemon@.service`. |

---

## 6. Phased Execution & Verification Roadmap

### Phase 0: Non-Destructive Purge (Safe Clean)
1. Delete empty directories: `rm -rf fake_storage/ scratch/`.
2. Remove root stale SQLite artifacts: `rm river_song.db .env.bak*`.
3. Move `config_files/` into `config/templates/`.
4. Run `./venv/bin/pytest tests/ -q` to verify 904 passing tests.

### Phase 1: Domain Package Migration (`domains/`)
1. Create `domains/{commerce,culinary,inventory,vehicles}/`.
2. Move core domain files into their respective packages.
3. Place backwards-compatible re-export shims at the original root paths (`culinary/models.py`, `vehicles/management.py`, etc.).
4. Run `./venv/bin/pytest tests/ -q` to ensure 100% import compatibility.

### Phase 2: Core Subsystem Consolidation (`core/`)
1. Move 12 `vortex_*.py` files into `core/vortex/` with forwarding shims in `core/`.
2. Move 7 `tools_*.py` files into `core/tools/` with forwarding shims in `core/`.
3. Run `./venv/bin/pytest tests/ -q`.

### Phase 3: API Router Partitioning (`api/routes/`)
1. Create route category folders (`api/routes/{auth,system,ai,domains,fleet,webhooks,feeds}/`).
2. Move router files into category folders.
3. Update `api/routes/__init__.py` to import from the new category folders and export identical router symbols.
4. Run `./venv/bin/pytest tests/ -q` and run `test_fleet_api.py` and `test_daemon_secret_auth.py`.

### Phase 4: Frontend Reorganization (`frontend/src/`)
1. Add `@pages`, `@components`, `@hooks` aliases to `frontend/vite.config.js`.
2. Partition `src/pages/` into domain subdirectories (`ai/`, `auth/`, `domains/`, `fleet/`, `home/`, `system/`).
3. Partition `src/components/` into (`conversation/`, `culinary/`, `vehicles/`, `widgets/`, `modals/`, `ui/`).
4. Move `CulinaryPage.test.jsx` and `VehiclePage.test.jsx` into `src/__tests__/`.
5. Update `App.jsx` imports.
6. Run `npm run build` in `frontend/` to verify zero bundling or resolution errors.

---

## 7. Review Checklist for Engineers & Agents

Before committing any structural move in the codebase:
- [ ] Has a forwarder shim been created at the old path for Python modules?
- [ ] Does `git grep "old.module.path"` show zero unhandled callers?
- [ ] Have all router contracts in `api/routes/__init__.py` maintained identical names?
- [ ] Does `./venv/bin/pytest tests/ -q` pass with 904/904 passing tests?
- [ ] Does `npm run build` pass in `frontend/` without unresolved imports?
- [ ] Is `systemctl --user status river-song-daemon@pulse` running and healthy?
