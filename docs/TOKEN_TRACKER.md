# Token Tracker

Per-call LLM token accounting. Writes every input/output count to a
`token_usage` table in `river_song.db` so the admin UI can show daily
cost, model mix, and per-provider rate consumption.

**File:** `core/token_tracker.py`

---

## What it stores

`token_usage` schema (auto-created on first call):

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | auto-increment |
| `ts` | REAL | unix seconds, indexed |
| `provider` | TEXT | `anthropic`, `openai`, `ollama`, `nvidia_nim`, ... |
| `model` | TEXT | provider-specific model id |
| `input_tokens` | INTEGER | |
| `output_tokens` | INTEGER | |
| `user_id` | TEXT | calling user, or `"system"` |
| `call_type` | TEXT | typically `"stream"` |

Index: `idx_token_usage_ts (ts)`.

---

## API

`ensure_table()` — create `token_usage` if missing. Safe to call any
number of times.

`record_usage(provider, model, input_tokens, output_tokens, user_id="system", call_type="stream") -> None`
— append one row. Silently no-ops on any DB error so token accounting
never breaks LLM responses.

`get_summary(days=30) -> dict` — totals + per-`(provider, model)` rows
for the last N days, sorted by total tokens descending. Each row
includes an estimated USD cost computed from a built-in cost table.

`get_provider_rate(provider, window_seconds=60) -> dict` — request
count + token totals for one provider in the last N seconds. Used by
the NVIDIA NIM rate-limit monitor (free tier ≈ 40 req/min).

---

## Cost estimation

Built-in `_COST_PER_M` lookup covers the model families used in this
project (Claude 4.x, GPT-4o / 4.1, Gemini 1.5/2.0, Mistral, NVIDIA NIM
free tier at $0). Unknown models fall back to `0.0`.

`_estimate_cost` does a prefix match if no exact key hits, so e.g.
`claude-sonnet-4-6-20250131` will still match the `claude-sonnet-4-6`
base rate.

The cost table is hand-maintained in source — update it when provider
pricing changes. It is **not** loaded from a config file or pulled
from a provider API.

---

## Where it's called

Every LLM provider in `providers/llm/` should call `record_usage()`
once per response, after the stream completes. Look for `record_usage(`
inside `providers/llm/ollama.py`, `claude_api.py`, `openai_api.py`,
`gemini.py`, `mistral_api.py`, `bedrock.py`, `nvidia_nim.py`.

The HTTP surface for reading the data lives in
`api/routes/usage.py`.

---

## Limitations

- **Synchronous sqlite3.** Writes are blocking. At household scale
  this is fine; at higher concurrency consider batching.
- **No retention policy.** The table grows forever. Add a periodic
  prune (e.g. delete rows older than N days) if disk is tight.
- **Cost table is point-in-time.** Reflects rates "as of 2026-05" in
  the docstring; keep it in sync with provider pricing pages.
