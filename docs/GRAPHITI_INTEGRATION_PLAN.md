# Graphiti Integration Plan

**Status:** Proposed — awaiting user approval before implementation (Task #8).
**Author:** Claude (Opus 4.7) for River Song AI.
**Date:** 2026-06-08.
**Related:** [`CHRONOS.md`](./CHRONOS.md), [`agent_roles.py`](../providers/llm/agent_roles.py), [`LANGFUSE_INTEGRATION_PLAN.md`](./LANGFUSE_INTEGRATION_PLAN.md), PentAGI's `backend/pkg/graphiti/client.go`.

## TL;DR

Add **Graphiti** (a temporal knowledge graph on Neo4j) as a sidecar so River remembers *relationships and time* across conversations — not just fuzzy vector chunks. Every agent turn + tool call becomes a structured episode in the graph, queryable later as "what did I say about the mower last month" or "what worked the last three times I asked for X."

This is the heavyweight one of the three PentAGI lifts. **No code changes until this plan is approved.**

## What Graphiti is

- OSS Python library (`graphiti-core`) + Neo4j backend.
- Models a *temporal* knowledge graph: nodes for entities, edges for relationships, both stamped with valid-time ranges.
- Built for AI agent memory — every conversation becomes an "episode" the graph ingests, extracts entities from, and links into existing knowledge.
- Search shapes the library gives us:
  - **Temporal window** ("what happened between dates X and Y")
  - **Entity relationships** ("what's connected to the mower")
  - **Diverse results** (non-redundant search)
  - **Episode context** (find similar past agent turns)
  - **Successful tools** (which tool sequences worked for similar requests)
  - **Recent context** (last-N relevant episodes)
  - **Entity by label** (find by type, e.g. all "Person" nodes)

We pick it because:

1. River Song is bumping into the limits of substring search (per `docs/CHRONOS.md` § "Known limitations").
2. Chroma (the parked future vector store) gives semantic similarity but no *relationships* and no *time*. Graphiti gives both.
3. PentAGI proves the pattern works in a multi-agent system.
4. The architecture composes — vector search + graph relationships are complementary, not competing.

## How this relates to existing CHRONOS

`docs/CHRONOS.md` describes a vault of markdown notes with a sqlite index + future Chroma vector store. Graphiti does **not** replace any of that. Mapping:

| Layer | Stores | Best at |
|---|---|---|
| **Vault (CHRONOS)** | The actual note files. | Source of truth, human-readable, editable. |
| **SQLite index** | Note metadata, ownership, mtime. | Fast existence/permission checks. |
| **Chroma (planned)** | Per-chunk embeddings. | "Find passages similar to this query." |
| **Graphiti (proposed)** | Entities, relationships, episodes, time. | "Find the conversation where River decided X" / "what's related to Y" / "what tool worked last time." |

Graphiti's input is *conversational episodes* (agent turns + tool calls). Its output is a navigable graph. Notes still live in CHRONOS; Graphiti is the *event memory* layer on top.

## Architecture

```
                ┌────────────────────────────────┐
                │   River Song backend (FastAPI) │
                │                                │
                │  ┌──────────────────────────┐  │
                │  │ providers/memory/        │  │  <-- new
                │  │   graphiti_provider.py   │  │
                │  └──────────┬───────────────┘  │
                │             │ Python (async)   │
                │             │                  │
                │  core/conversation_loop.py     │  (write: every turn)
                │  daemons/scribe/scribe.py      │  (write: every note synth)
                │  core/memory_manager.py        │  (read: recall)
                └──────────────┬─────────────────┘
                               │
                    ┌──────────▼───────────┐
                    │  graphiti-service    │  (sidecar; thin HTTP wrapper
                    │  :8124               │   if we use vxcontrol's; otherwise
                    └──────────┬───────────┘   library-only in-process)
                               │ Bolt
                    ┌──────────▼───────────┐
                    │  neo4j-graphiti      │  (sidecar container)
                    │  :7474 browser UI    │
                    │  :7687 bolt          │  (host-bound 127.0.0.1)
                    │  named volume        │
                    └──────────────────────┘
```

**Two deployment shapes to choose between** (I will ask once you've read this; default is **Option B** for simplicity):

- **Option A** — separate `graphiti-service` HTTP container (matches PentAGI). Adds one more moving part but cleanly separates Python deps from River Song's venv. ~2 containers.
- **Option B** — call `graphiti-core` directly as a Python library inside River Song's venv; only Neo4j is a sidecar. Simpler, fewer containers, but adds heavy deps (OpenAI client, networkx, etc.) to `requirements.txt`. ~1 container.

I'll mark this with a `[CHOOSE]` flag below so you can answer at the same time as "go."

## Files I will touch

| File | Change |
|---|---|
| `docker-compose.yml` | Add `neo4j-graphiti` (always) and `graphiti-service` (if Option A). New `mem_net` network for Graphiti ↔ Neo4j only. Profile `observability` (same as Langfuse) so one command starts the whole observability+memory stack. |
| `.env.example` | Add 5 new vars (see below). |
| `config/settings.py` | Add the same 5 settings, default disabled. |
| `requirements.txt` | Add `graphiti-core` (Option B) or skip (Option A uses HTTP only). |
| `providers/memory/graphiti_provider.py` (new) | Health-checked, `enabled`-gated wrapper mirroring PentAGI's `client.go` semantics: never raises, only warns. Methods: `add_episode`, `recall_recent`, `recall_related`, `recall_diverse`, `successful_tools`. |
| `core/conversation_loop.py` | After each completed turn, async-call `add_episode(group_id=session_id, ...)`. Best-effort; failure never blocks user. |
| `daemons/scribe/scribe.py` | After each note synthesis, `add_episode(group_id="vault", ...)`. |
| `core/memory_manager.py` | New method `recall(query, mode)` that fans out to Chroma (when present) + Graphiti (when present) and merges. |
| `api/routes/slae.py` | `_graphiti_section()` flips to `healthy` when Neo4j is reachable; surfaces node/edge counts, Neo4j browser URL, recent episode summaries. |
| `frontend/src/pages/SlaePage.jsx` | Already has the section shell — no JSX changes; it consumes whatever the endpoint returns. |
| `tests/test_graphiti_provider.py` (new) | Unit tests with a fake graph client (no real Neo4j). |

## New env vars (all opt-in)

```
GRAPHITI_ENABLED=false                       # master switch
GRAPHITI_MODE=library                        # "library" (Option B) or "service" (Option A)
GRAPHITI_SERVICE_URL=http://127.0.0.1:8124   # only used in service mode
NEO4J_URI=bolt://127.0.0.1:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=                              # set in .env, never empty
NEO4J_BROWSER_URL=http://127.0.0.1:7474      # shown on SLAE panel
```

When `GRAPHITI_ENABLED=false` (the default), the provider returns no-op responses. **Zero behavior change from today.**

## How data flows

**Write path** (every conversation turn):

1. `core/conversation_loop.py` finishes a turn (user msg + assistant reply + tool calls).
2. Build a `GraphitiEpisode` payload: agent role, text content, tool calls, timestamps, session id.
3. `graphiti_provider.add_episode(...)` — fire-and-forget, 2s timeout, never blocks the response.
4. Inside Graphiti: LLM-driven entity + relationship extraction (uses our existing LLM provider via `AgentRole.SIMPLE`), upserts nodes/edges with time stamps.

**Read path** (when the assistant needs memory):

1. `memory_manager.recall("what did I say about the mower last month")` fans out:
   - Chroma (semantic chunks) → top-K passages
   - Graphiti (temporal + relational) → top-K episodes
2. Merge + dedupe, present as ranked context.

## What the SLAE panel does once this lands

Section "GRAPHITI KNOWLEDGE GRAPH":
- Pill: grey `NOT CONFIGURED` → green `HEALTHY` once Neo4j responds.
- Live node + edge counts.
- "OPEN NEO4J BROWSER →" link.
- Last 10 episodes added (timestamp, source daemon, summary).

## What I will *not* do without a separate ask

- Backfill existing CHRONOS notes into the graph (one-off migration; needs its own plan).
- Replace Chroma or remove substring search — Graphiti is additive.
- Open Neo4j browser to the LAN.
- Use Graphiti's auth/multi-tenancy features beyond a single River Song project.
- Tune Graphiti's entity-extraction LLM beyond `AgentRole.SIMPLE` defaults.

## Cost + footprint

- **Disk**: Neo4j needs ~500 MB baseline; episodes grow ~10 KB each. 100K episodes = ~1 GB.
- **RAM**: Neo4j ~700 MB at idle, climbs with graph size. Graphiti library inside venv = +200 MB.
- **CPU**: entity extraction at write time uses an LLM call per episode — cost goes to whatever model `AgentRole.SIMPLE` is assigned (currently `gpt-4o-mini`, ~$0.0002/call).
- **Network**: localhost only.

## Rollback

```
GRAPHITI_ENABLED=false           # in .env
docker compose --profile observability down   # stops Neo4j + (if applicable) graphiti-service
```

Provider no-ops on `GRAPHITI_ENABLED=false`. Conversation loop's `add_episode` calls become awaits-on-no-op. No data loss because Graphiti is *additive memory* — the source of truth (vault notes, sqlite, conversation transcripts) is untouched.

## What I need from you to proceed (Task #8)

1. **[CHOOSE]** Option A (separate service container, matches PentAGI) or **Option B** (library-only, simpler, my recommendation)?
2. A "go" message.

Once approved I will:

1. Add compose services + env vars + settings entries.
2. Add `graphiti-core` (if Option B) to `requirements.txt`.
3. Build `providers/memory/graphiti_provider.py` with healthcheck + fail-warn semantics.
4. Wire the two write-paths (conversation loop, Scribe) — best-effort, non-blocking.
5. Wire the one read-path in `memory_manager.recall`.
6. Add tests with a fake graph client.
7. Hand you back: `docker compose --profile observability up -d` and a one-page "first run" guide for Neo4j.

If you want to **change any of the choices above** — different env names, write-paths to skip, different daemon to wire first — say so before "go."
