# Audit Report: System "God Files"

## 1. `providers/memory/sqlite_store.py`

### Overview
This file is 857 lines long and serves as the SQLite persistence layer. While theoretically scoped to the "memory system", it acts as a global database initializer and data access object for the entire application.

### Improperly Combined Responsibilities
The `SQLiteStore` class implements a "God Object" anti-pattern by inheriting from 10 distinct mixins (`FactsStoreMixin`, `UsersStoreMixin`, `VectorStoreMixin`, `VaultStoreMixin`, etc.). It manages over 40 tables across completely unrelated domains:
- **Core LLM Memory**: Facts, preferences, conversation summaries.
- **User & Auth**: User profiles, OAuth nonces, revoked tokens.
- **Hardware/Robotics**: Vector fleet management, drone schedules, telemetry, and active faults (`vector_units`, `vector_telemetry`, etc.).
- **Content Management**: Vault notes, documents, reading shelves.
- **Social**: Family groups and parent-child permissioning.

### Fragile Logic and Bottlenecks
- **Thread Pool Starvation**: All async writes/reads are pushed to a `ThreadPoolExecutor` capped at `min(4, os.cpu_count() or 1)` workers. High-frequency operations like vector telemetry ingestion and pulse snapshots will rapidly saturate this pool, blocking basic LLM memory retrievals and causing system-wide latency spikes.
- **Silent Migration Failures**: The `_sync_initialize` function applies schema updates via a list of raw `ALTER TABLE` and `UPDATE` statements, wrapped in a blanket `try... except sqlite3.OperationalError: pass`. Any syntax error or missing table in a migration will be silently swallowed, resulting in an inconsistent schema state without alerting the developer.
- **Concurrency Issues**: While WAL mode is enabled, `busy_timeout` is set to only 5000ms. Heavy contention between telemetry writes and user interface reads could lead to `SQLITE_BUSY` (database locked) errors.

## 2. `frontend/src/pages/SettingsPage.jsx`

### Overview
This file is 990 lines long and serves as the primary React component for the River Song AI settings interface. 

### Improperly Combined Responsibilities
- **Global Orchestration**: Instead of acting as a layout wrapper, the component directly orchestrates the state of over 17 distinct configuration sections (e.g., ElevenLabs, Intent Router, Vector Daemons, Family Groups).
- **Monolithic Data Fetching**: The component attempts to fetch up to 19 distinct endpoints concurrently in a single `useEffect` block, depending on whether the user has `admin`, `user`, or `parent` roles. 
- **Centralized Mutation**: Rather than letting child components handle their own API updates, this file defines over 15 distinct `save*` callbacks (`saveMemory`, `saveOrchestration`, `saveFallback`, etc.) and passes them down as props.

### Fragile Logic and Bottlenecks
- **All-or-Nothing Loading**: The core `Promise.all` data load uses `.then(okJson)` for its primary endpoints (`/api/models`, `/api/settings/llm`, `/api/settings/memory`). If *any* of these endpoints return a non-200 status, the Promise chain throws, setting a global error state and rendering the entire Settings page broken, even if the user only wanted to access a healthy subsystem.
- **Excessive Re-rendering**: Because the component maintains nearly 30 local state variables (`useState`), any state change—such as toggling a single feature flag or typing in a textbox—triggers a re-render of the entire 990-line monolith and all of its 17+ child sections.
- **Race Conditions in UX**: There is only one global `saveStatus` and `saveErrorDetail` state used for toast notifications. If a user quickly toggles two settings, the `setTimeout` from the first save can clear the status of the second save, hiding its success/error feedback.
