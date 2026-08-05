# God-File Audit — Backend (2026-07-22)

Fresh audit of oversized / over-responsible files, replacing the July 2026
version (which predated the chat/voice, memory-hub, smart-home, garage,
inventory and culinary rework and only covered `sqlite_store.py` +
`SettingsPage.jsx`). Scope here is **backend**, because the immediate goal is a
solid backend; the frontend god files are catalogued at the end but deferred to
the frontend pass.

## How to read this

Each file is rated by **operational risk** (can it break production *now*), not
just size. Big-but-boring is fine; big-and-fragile is not.

| Rating | Meaning |
|---|---|
| 🔴 HIGH | Structural fragility that can degrade or corrupt the running system. Fix before calling the backend "solid." |
| 🟠 MED | Maintainability / merge-conflict / testability risk. Split when the domain is next touched. |
| 🟢 LOW | Large but cohesive or flat. Leave alone for now. |

Current top backend files by size:

| File | Lines | Shape |
|---|---|---|
| `api/routes/culinary.py` | 2,861 | 58 routes + 26 schemas + logic, one module |
| `core/tools.py` | 2,800 | 65 tool schemas + 56 executors + dispatch |
| `api/routes/vehicles.py` | 1,674 | 43 routes + 17 schemas |
| `config/settings.py` | 1,461 | 225 flat config fields |
| `vehicles/management.py` | 1,428 | vehicle domain logic |
| `core/conversation_loop.py` | 1,348 | central turn orchestrator |
| `core/intent_router.py` | 1,308 | ~15-domain keyword fast-path |
| `api/routes/models_settings.py` | 1,256 | 33 routes + 14 schemas |
| `api/routes/vector_fleet.py` | 1,079 | 47 routes + 17 schemas |
| `providers/memory/sqlite_store.py` | 1,061 | 11 mixins, 69 tables |

---

## 🔴 1. `providers/memory/sqlite_store.py` — the God Object (highest risk)

**Still the most dangerous file, and it grew** (857 → 1,061 lines since the last
audit). `SQLiteStore` composes **11 mixins** and owns **69 tables** spanning
unrelated domains: LLM memory, users/auth, vector-fleet robotics telemetry,
vault notes, documents, family permissions, routines, HA entities, chat
sessions. It is the single persistence layer for the entire app.

Concrete fragilities (verified in current code):

- **Silent migration swallow** (`sqlite_store.py:~928–932`). A long list of
  `ALTER TABLE` / `CREATE` migration statements runs in a loop, each wrapped in
  `try: conn.execute(migration) except sqlite3.OperationalError: pass`. This is
  intended to no-op "column already exists," but it **equally hides a genuinely
  broken migration** (typo, wrong table, bad type) — the schema silently ends up
  in a wrong state with no log line. *This is the top backend-solidity fix.*
- **Shared 4-worker thread pool** (`sqlite_store.py:814`,
  `max_workers=min(4, os.cpu_count() or 1)`). Every read and write for *every*
  domain funnels through the same tiny pool. High-frequency writers (vector
  telemetry, pulse snapshots) can starve latency-sensitive memory/auth reads.
- **`busy_timeout=5000`** (`sqlite_store.py:956`). Under contention between
  telemetry writes and UI reads, callers can still hit `SQLITE_BUSY`.

**Recommended (targeted, not a rewrite):**
1. Make migrations loud: log each failure with the statement; only swallow the
   specific "duplicate column" case, raise/alert on anything else. *(small, do now)*
2. Split the executor — a dedicated pool (or a separate DB file/connection) for
   high-volume robotics telemetry so it can't block memory/auth. *(medium)*
3. Longer-term: the mixin sprawl is a symptom of one DB holding many domains;
   telemetry especially belongs in its own store. *(large, separate task)*

## 🟠 2. `core/tools.py` — the God Dispatcher (2,800 lines)

Every agent capability (calendar, memory, notes, smart-home, vehicles,
shopping, web search, image gen, code interpreter, mower, browser…) lives here:
**65 tool JSON schemas + 56 `_exec_*` functions + the central dispatch**. Any
new or changed tool touches this one file → constant merge-conflict surface and
no domain-level isolation for testing.

**Recommended:** split into per-domain tool modules (`core/tools/memory.py`,
`core/tools/smart_home.py`, …) each exporting its schemas + executors, with a
thin registry that assembles `TOOL_SCHEMAS` and dispatches. Mechanical, low-risk,
big readability win. *(medium)*

## 🟠 3. `api/routes/culinary.py` — God Module (2,861 lines, biggest file)

58 routes + 26 Pydantic schemas + business logic, all inline. Unlike
`vehicles/` and `inventory/` (which have `management.py` + `models.py` layers),
**culinary has only `models.py` and no management layer** — so the domain logic
is fused into the route file.

**Recommended:** follow the existing vehicles/inventory pattern — extract a
`culinary/management.py` (logic) and move request/response schemas out of the
route module; leave routes thin. *(medium)*

## 🟠 4. Fat route modules — `vehicles.py` (1,674), `models_settings.py` (1,256), `vector_fleet.py` (1,079)

Same shape as culinary: dozens of endpoints + many inline schemas per file.
`vehicles.py` is the odd one — a `vehicles/management.py` already exists, yet the
route file is still 1,674 lines, so logic leaked back into routes.

**Recommended:** move Pydantic models to a `schemas.py` per domain; push logic
into the domain's management layer; keep route bodies to
validate → call-management → serialize. *(medium, per domain, as touched)*

## 🟠/🟢 5. `core/intent_router.py` (1,308) and `core/conversation_loop.py` (1,348)

- **intent_router** hardcodes keyword/regex fast-paths for ~15 domains in one
  file (`_handle_smart_home`, etc.). Adding a domain edits the monolith. A
  per-domain handler registry would help. 🟠
- **conversation_loop** is large but genuinely *central* and cohesive (one turn
  orchestrator, 31 methods). Lower priority — refactor only if a specific phase
  becomes unmanageable. 🟢

## 🟢 6. `config/settings.py` (1,461 lines) — big but fine

A single flat `Settings(BaseSettings)` with **225 `Field()` definitions** and
almost no logic (8 defs). Long, but that is a flat config schema, not a
god-object. **Leave as-is**; optionally group with comment banners. Not a
refactor target.

---

## Root-cause pattern

Two distinct problems wear the same "god file" label:

1. **Fat route modules** (`culinary`, `vehicles`, `models_settings`,
   `vector_fleet`): they bundle *schema + logic + endpoints*. The codebase
   already knows the fix (the `management.py`/`models.py` split) — it just wasn't
   applied consistently. Mechanical to correct.
2. **Two genuine cross-domain god files** (`sqlite_store.py`, `tools.py`): these
   are structurally central and need deliberate decomposition, not just moving
   code around.

## Prioritized roadmap for a solid backend

| # | Action | File | Size | Risk if skipped |
|---|---|---|---|---|
| 1 | Make migrations loud (log + raise on real errors) | `sqlite_store.py` | small | silent schema corruption |
| 2 | Isolate telemetry writes from the shared pool | `sqlite_store.py` | medium | latency spikes / `SQLITE_BUSY` |
| 3 | Split `tools.py` into per-domain modules + registry | `core/tools.py` | medium | merge pain, untestable |
| 4 | Extract `culinary/management.py` + schemas | `api/routes/culinary.py` | medium | unmaintainable domain |
| 5 | Slim `vehicles`/`models_settings`/`vector_fleet` routes | routes | medium (each) | same, per domain |
| 6 | Per-domain handler registry | `core/intent_router.py` | medium | monolith growth |

**Do #1 first** — it's small and directly prevents a class of silent production
bugs. #2 is the other true solidity item. #3–#6 are maintainability and can be
done incrementally as each domain is next touched.

## Frontend god files (deferred to the frontend pass)

Not fixed now; listed so they aren't forgotten when screenshots drive the
frontend work:

- `frontend/src/chrome/Stage.jsx` — 1,900 lines
- `frontend/src/components/MaintenancePulse.jsx` — 1,746 lines
- `frontend/src/pages/SettingsPage.jsx` — 989 lines (the prior audit's monolith:
  ~30 `useState`, 19 endpoints in one `useEffect`, all-or-nothing load)
- `frontend/src/pages/CulinaryPage.jsx` — 967 lines
