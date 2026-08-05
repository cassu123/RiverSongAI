# Langfuse Integration Plan

**Status:** Proposed — awaiting user approval before implementation (Task #6).
**Author:** Claude (Opus 4.7) for River Song AI.
**Date:** 2026-06-08.
**Related:** [`SLAE_CONTROL_PANEL`](#) (`api/routes/slae.py`), [`agent_roles.py`](../providers/llm/agent_roles.py), PentAGI's `backend/pkg/observability/lfclient.go`.

## TL;DR

Add **Langfuse** as a self-hosted sidecar so every LLM call across daemons, the conversation loop, and Scribe gets a structured trace: prompt, response, latency, token cost, agent role. The SLAE Control panel goes from "we have token tracking after the fact" to **a live dashboard showing every call as it happens**, with a link to drill into traces.

**No code changes to model providers until this plan is approved.** This doc exists so you can see exactly what containers, env vars, and code paths are coming.

## What Langfuse is

Open-source LLM observability stack:

- **Self-hosted** (Docker), MIT for the SDK, EE-restricted features off by default.
- **OpenTelemetry-style traces**: each LLM call is a span with input, output, model, tokens, latency, error.
- **Trace tree**: a single conversation turn shows as a parent trace with child spans for each sub-call (Scribe extraction, Warden check, etc.).
- **Web UI** at `http://127.0.0.1:3000` (or whichever host port) with search/filter and per-trace drill-down.
- **Project keyed**: one project = one River Song deployment.

We pick it because:

1. The Python SDK is real and maintained (`pip install langfuse`).
2. It's the same OSS tool PentAGI uses — pattern is proven for multi-agent workloads.
3. It handles cost + tokens out of the box, so [`core/token_tracker.py`](../core/token_tracker.py) can later become a *consumer* of Langfuse data instead of duplicating it.

## What this gets us

| Today | After integration |
|---|---|
| Token accounting via `core/token_tracker.py`, written post-call, no prompt text. | Full trace: prompt, response, latency, role, success/failure, all searchable. |
| No way to ask "why did Scribe call the LLM with this content?" | Click the trace, see the exact messages array we sent. |
| Multi-daemon debugging means reading server logs. | Filter by `agent_role=scribe` in the UI and watch only Scribe calls. |
| Cost is summed; no idea which role/daemon is burning budget. | Cost broken out by role, by day, by model. |
| SLAE Control shows roles but no activity feed. | "Recent Activity" section gets a live last-20 traces widget. |

## Architecture

```
                ┌────────────────────────────────┐
                │   River Song backend (FastAPI) │
                │  ┌──────────────────────────┐  │
                │  │  core/observability.py   │  │  <-- new module
                │  │   @trace_llm decorator   │  │
                │  └──────────┬───────────────┘  │
                │             │                  │
                │  providers/llm/claude_api.py   │
                │  providers/llm/openai_api.py   │  (decorated)
                │  providers/llm/gemini.py       │
                └──────────────┬─────────────────┘
                               │ HTTP (queued/batched)
                               ▼
                    ┌──────────────────────┐
                    │  langfuse-web        │  (sidecar container)
                    │  :3000               │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │  langfuse-postgres   │  (sidecar container)
                    │  named volume        │
                    └──────────────────────┘
```

- **No external traffic** — both containers bind to `127.0.0.1` on the host, same security posture as everything else in `docker-compose.yml`.
- **New Docker network**: `obs_net` — Langfuse-web ↔ Langfuse-postgres only.
- **No data leaves the box.** SDK posts to `http://langfuse-web:3000`, not Langfuse Cloud.

## Files I will touch

| File | Change |
|---|---|
| `docker-compose.yml` | Add two services (`langfuse-web`, `langfuse-postgres`) behind a new profile `observability`. New `obs_net` network. |
| `.env.example` | Add 6 new vars (see below). All optional — empty values disable Langfuse cleanly. |
| `config/settings.py` | Add the same 6 settings with default `""` / `False`. |
| `requirements.txt` | Add `langfuse>=2.0` (Python SDK). |
| `core/observability.py` (new) | Singleton client init + `@trace_llm` decorator + helpers for sub-spans. |
| `providers/llm/claude_api.py` | Decorate `stream_response()` and `stream_response_thinking()`. |
| `providers/llm/openai_api.py` | Decorate `stream_response()`. |
| `providers/llm/gemini.py` | Decorate `stream_response()`. |
| `providers/llm/agent_roles.py` | Tiny addition: pass `AgentRole` into trace metadata so it's filterable in the UI. |
| `api/routes/slae.py` | `_langfuse_section()` flips from `not_configured` to `healthy` when settings + ping succeed; surfaces dashboard URL + last-N traces. |
| `frontend/src/pages/SlaePage.jsx` | Already has the section shell — no changes; it consumes whatever the endpoint returns. |
| `tests/test_observability.py` (new) | Unit tests for the decorator with a fake Langfuse client (no real network). |

## New env vars (all opt-in)

```
LANGFUSE_ENABLED=false                # master switch
LANGFUSE_HOST=http://127.0.0.1:3000   # web UI + ingest endpoint
LANGFUSE_PUBLIC_KEY=                  # generated in Langfuse UI on first run
LANGFUSE_SECRET_KEY=                  # generated in Langfuse UI on first run
LANGFUSE_PROJECT_ID=river-song        # arbitrary string, shown on dashboard
LANGFUSE_FLUSH_INTERVAL_SEC=5         # how often the SDK batches to the server
```

When `LANGFUSE_ENABLED=false` (the default), `core/observability.py` returns a no-op client. **Zero behavior change from today.**

## How traces flow

1. Daemon (or conversation loop) calls `providers/llm/claude_api.py::ClaudeLLM.stream_response(messages)`.
2. `@trace_llm("claude", role=AgentRole.SCRIBE)` decorator starts a Langfuse span.
3. Stream runs as today; the decorator captures tokens + latency on completion.
4. Span is queued for async batched send.
5. Langfuse web UI shows the trace tagged with `agent_role=scribe` within seconds.

## What the SLAE panel does once this lands

Section "LANGFUSE TRACING":
- Pill goes from grey `NOT CONFIGURED` → green `HEALTHY`.
- Shows last 20 trace summaries (timestamp, role, model, latency, ok/err) inline.
- "OPEN DASHBOARD →" link to `LANGFUSE_HOST`.
- "Recent Activity" section also fills in — same data, unified across all roles.

## What I will *not* do without a separate ask

- Stand up Langfuse Cloud / send any data off-box.
- Enable EE features behind paid licence keys.
- Auto-create a Langfuse user account — first run requires you to sign up in the UI and paste keys back into `.env`.
- Backfill historical token-tracker data — going forward only.
- Replace `core/token_tracker.py` (left for a follow-up; it remains the source of truth for billing).

## Cost + footprint

- **Disk**: ~200 MB Postgres + grows with trace volume. Estimate ~50 KB per trace; 10K traces = ~500 MB.
- **RAM**: ~300 MB Langfuse web, ~150 MB Postgres at idle.
- **CPU**: negligible — async queue, batched HTTP.
- **Network**: localhost only.

## Rollback

If anything breaks:

```
LANGFUSE_ENABLED=false   # in .env
docker compose --profile observability down   # stop containers
```

The decorator no-ops on `LANGFUSE_ENABLED=false`. No daemon code change needed to roll back.

## What I need from you to proceed (Task #6)

A single "go" message. Once approved I will:

1. Add the compose services + env vars + settings entries.
2. Add `langfuse` to `requirements.txt`.
3. Build `core/observability.py` + decorate the three provider files.
4. Wire `_langfuse_section()` to read live status.
5. Add tests with a fake client.
6. Hand you back: a startup command (`docker compose --profile observability up -d`) and instructions for generating Langfuse keys on first visit.

If you want to **change any of the choices above** — different profile name, different env var names, different model SDK version, different files to decorate — say so before "go" and I'll revise.
