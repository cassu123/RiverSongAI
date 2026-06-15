# CHRONOS — Chronological Heuristic Record

CHRONOS is River Song's local-first markdown vault. The design borrows
heavily from Obsidian: per-user (and per-household) trees of plain `.md`
files on disk, `[[wiki-links]]` between notes, daily notes, a backlinks
graph. Everything is stored on the same machine as River Song herself,
under `<db_path>/../vault/`.

The name **CHRONOS** is the user-facing page name; **Scribe** is the
background daemon that maintains the vault's heuristic index.

---

## Status (as of 2026-05-23)

Substantial implementation. CHRONOS is no longer "parked" — the core
provider and routes shipped after Round 3 closed.

| Surface | Status |
|---|---|
| File operations (read/write/rename/soft-delete) | ✅ Implemented (`providers/vault/vault_provider.py`) |
| Virtual paths + security (`personal/...`, `household/...`) | ✅ With path-traversal protection |
| Daily notes (`personal/Daily/YYYY-MM-DD.md`) | ✅ With auto-creation from template |
| Append API (logs, journaling) | ✅ `append_to_note`, `append_to_daily` |
| Text search (metadata + content grep) | ✅ Substring; 1 MB per-file cap |
| Backlinks + graph | ✅ Backed by `vault_notes` table |
| Live re-indexing via filesystem watcher | ✅ `watchdog` + 250 ms debounce |
| Semantic indexing on write | ✅ When `SEMANTIC_MEMORY_ENABLED=true`, every note goes into ChromaDB |
| Note summarization endpoint | ✅ `/api/vault/note/summarize` |
| Scribe — periodic fact extraction | ✅ 5-min scan of stale notes, upserts into facts table |
| `analyze_note` deep analysis task | ⚠️ Stub — returns `{status: "analyzed"}` |
| Cross-root rename | ❌ Intentionally rejected (returns 400) |
| `shared/` root ("Shared with me") | ❌ Not implemented yet (only `personal` + `household`) |
| HTTP API auth (JWT) | ✅ All endpoints require `Authorization: Bearer` |

---

## Architecture

### On-disk layout

```
<db_path>/../vault/
├── users/
│   └── <user_id>/
│       ├── Daily/
│       │   └── 2026-05-23.md
│       ├── notes/...
│       └── ...
├── households/
│   └── <family_id>/...
└── .trash/
    └── <user_id>/
        └── <unix_ts>-<filename>.md
```

`base_vault` is computed as `Path(settings.db_path).parent / "vault"` — so
in production it lives on the HDD at
`/mnt/data/river-song/vault/`.

### Virtual paths

Routes and the daemon never touch absolute paths. They pass strings like
`personal/Daily/2026-05-23.md` or `household/Recipes/Sunday-roast.md`.
`VaultProvider._resolve_virtual()` maps them to physical paths and
enforces that the resolved path stays under the owning root. Cross-root
renames are rejected at the provider level with `ValueError` (surfaced
as HTTP 400 by the route).

### Indexing pipeline

1. **`VaultWatcher`** (watchdog) watches `base_vault` recursively. On any
   `.md` create/modify/move it debounces 250 ms then triggers
   `_index_file()`.
2. **`_index_file()`** parses YAML title + `[[wiki-links]]`, stat()s the
   file, and calls `store.upsert_vault_note(...)` to update the
   `vault_notes` table. If `SEMANTIC_MEMORY_ENABLED=true`, it also pushes
   the full text to ChromaDB under the id `note:<virtual_path>`.
3. **Initial walk** runs on app startup: every `.md` under the vault is
   indexed once so the SQLite tree is in sync with what's on disk.
4. **Scribe** (`daemons/scribe/scribe.py`) runs every 300 s and scans
   `vault_notes WHERE indexed_at < mtime OR indexed_at IS NULL`. For each
   stale note it prompts the LLM with a "extract JSON `[{key, value}]`
   facts" template and upserts each fact into `memory_manager` with
   `source="scribe"`. Then stamps `indexed_at`.

The watcher gives near-real-time index updates; Scribe gives a slower
LLM-powered heuristic pass that turns notes into structured facts. The
"chronological" half of the name lives in the Daily-notes scaffolding
plus the per-event `vault_audit_log` table writes from
`write_note` / `delete_note` / `rename_note`.

### Ownership model

Personal notes live under `users/<user_id>/`. Household notes resolve via
`core.family.resolve_module_owner(user_id, "vault")` — if the user
belongs to a family group, they get a `household/` root that maps to
`households/<family_id>/`. Otherwise they only see `personal/`.

---

## API

All endpoints live under `/api/vault` and require `Authorization: Bearer
<JWT>`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/vault/tree?root=personal\|household\|shared` | Recursive directory listing |
| GET | `/api/vault/note?path=<vpath>` | Read note content |
| PUT | `/api/vault/note` (`{path, content}`) | Atomic write (tmp + replace) |
| DELETE | `/api/vault/note?path=<vpath>` | Soft-delete into `.trash` |
| POST | `/api/vault/note/rename` (`{old, new}`) | Same-root rename only |
| POST | `/api/vault/note/summarize?path=<vpath>` | LLM 2–3 sentence summary |
| GET | `/api/vault/daily/today` | Today's daily note, auto-created |
| GET | `/api/vault/daily/{YYYY-MM-DD}` | Daily note for a date, auto-created |
| GET | `/api/vault/search?q=<text>` | Substring over title + content (1 MB cap) |
| GET | `/api/vault/graph` | `{nodes, edges}` for the backlink graph |
| GET | `/api/vault/backlinks?path=<vpath>` | Inbound links for a note |

---

## Configuration

CHRONOS itself has no dedicated settings — it composes existing ones:

| Setting | Used for |
|---|---|
| `DB_PATH` | Vault root is `dirname(DB_PATH)/vault` |
| `SEMANTIC_MEMORY_ENABLED` | Toggle ChromaDB indexing of note bodies on write |
| `EMBEDDING_MODEL` / `CHROMA_PATH` | Embeddings + persistent vector store |
| `DAEMON_SCRIBE_ENABLED` | Toggle Scribe's 5-min heuristic scan |
| `DAEMON_SCRIBE_PORT` | Internal port for Scribe's task server |

---

## Known limitations

- **No `shared/` root.** Only `personal/` and `household/` are wired. Cross-user
  sharing is a future phase.
- **No conflict resolution.** Writes are atomic per-file but there is no
  multi-writer reconciliation; last-write-wins.
- **Search is substring.** No tokenization, stemming, or vector recall on the
  `/search` endpoint (Chroma is used for indexing but not for the search
  route yet).
- **Scribe is single-threaded over a 5-min loop.** A large vault will take
  many ticks to drain on first run.
- **`analyze_note` task is a stub.** The Scribe `_handle_task("analyze_note")`
  exists but returns a placeholder; deep per-note analysis is not yet
  implemented.

---

## Where the design history lives

- Earlier design intent and parking notes are in Claude auto-memory
  (`project_chronos_parked.md`).
- Implementation context for the daemon shape lives in `docs/DAEMONS.md`.
- Settings audit and the rationale for the Scribe enable flag are in
  `docs/audits/DOCS_AUDIT_REPORT.md`.
