# Known Issues

Wiring gaps, minor bugs, and deferred follow-ups noticed during the
2026-05-23 documentation remediation. None of these are blockers —
they are recorded here so the next session can address them deliberately
without re-discovering each one.

---

## C-3 wiring — analytics AI flag is not enforced

**Status:** settings added, route not wired.

`ANALYTICS_AI_ENABLED` and `ANALYTICS_LLM_MODEL` were added to
`config/settings.py` and `.env.example` on 2026-05-23 to resolve audit
issue C-3. The settings exist and pass validation. **They are not yet
respected by the route that the audit called out.**

- **Endpoint:** `GET /api/analytics/{platform}/summary`
  (`api/routes/analytics.py:131`).
- **Current behaviour:** unconditionally builds an LLM provider via
  `core.conversation_loop._build_llm_provider` and calls
  `llm.chat(...)` to generate insights.
- **Intended behaviour:** check
  `get_settings().analytics_ai_enabled` first; if false, return
  HTTP 503 with `detail="Analytics AI summaries are disabled by
  configuration."` or similar — without ever instantiating the LLM.
- **Suggested fix location:** insert a guard block right after the
  `_require_user` call (around `api/routes/analytics.py:149`), before
  the LLM provider is built.
- **Bonus:** the route should also honour `analytics_llm_model`. Today
  it uses whatever model `_build_llm_provider()` defaults to. Passing
  `analytics_llm_model` through to the provider is a small follow-up
  that makes the setting meaningful end-to-end.

This was deferred deliberately during the docs remediation — the rule
was "settings additions only, no route logic changes."

---

## n8n webhooks router is imported but not registered

**Severity:** dead route.

In `main.py:308-356` the import block on line 315 includes
`n8n_webhooks` as a module reference, not as `n8n_webhooks.router`.
Every other router in the block is imported as `*_router` and then
mounted via `app.include_router(*_router)`. Because `n8n_webhooks` is
imported as the bare module, there is no corresponding
`app.include_router(n8n_webhooks.router)` call, so the endpoints under
`/api/webhooks/n8n` (defined in `api/routes/n8n_webhooks.py`) are
**not mounted**.

- **Suggested fix:** rename the import to `n8n_webhooks_router` and
  add `app.include_router(n8n_webhooks_router)` in the same block, or
  change the existing reference to
  `app.include_router(n8n_webhooks.router)`.
- **Impact:** any n8n workflow trying to call back into River Song via
  the documented webhook URL will get 404.

---

## Sifter daemon is a stub

`daemons/sifter/sifter.py::_main_loop()` is a 60-second idle sleep. The
intent is to walk `WAPS_DOCUMENTS_PATH` and index documents into
ChromaDB for the RAG route, but no scanning code exists yet. The
systemd unit and `SIFTER_ENABLED` flag are in place, so the moment the
indexing logic is implemented it'll come online without further
plumbing.

---

## Warden daemon is a stub

Same shape as Sifter — `daemons/warden/warden.py::_main_loop()` is a
60-second idle sleep. Settings for YOLO + RTSP cameras
(`WARDEN_RTSP_CAMERAS`, `YOLO_MODEL`, `YOLO_CONFIDENCE`,
`YOLO_INFERENCE_DEVICE`) are reserved in `config/settings.py` but no
vision pipeline is implemented.

---

## Scribe `analyze_note` task is a placeholder

`daemons/scribe/scribe.py::_analyze_note()` returns
`{"status": "analyzed", "path": virtual_path}` without doing any
actual deep analysis. The 5-minute heuristic scan (stale-note fact
extraction) works; the on-demand "analyse this single note" path
does not yet.

---

## CHRONOS — `shared/` root not implemented

`providers/vault/vault_provider.py` reserves `VROOT_SHARED = "shared"`
but `_get_roots()` only ever returns `personal/` and (optionally)
`household/`. The `/api/vault/tree` route accepts `root=shared` as a
valid literal but will return `[]` for it.

---

## RAG chunk settings exist but provider uses hardcoded defaults

`config/settings.py` now has `rag_chunk_size`, `rag_chunk_overlap`, and
`rag_top_k` (added 2026-05-23). The defaults match
`providers/rag/chunker.py:15` (`chunk_size=512`, `overlap=64`), so
behaviour is unchanged. **The chunker function still uses its own
hardcoded defaults** and does not consult `get_settings()`. To make
the settings actually drive behaviour:

- In `providers/rag/chunker.py`, read the settings once at the top of
  `chunk_text` (or accept the values as parameters and let the caller
  pull them from settings).
- Wire `rag_top_k` into `providers/rag/rag_provider.py` similarly.

This is a follow-up, not a regression — the settings were always
specified by the integration plan and just never landed in code.

---

## HANDOFF.md "Restore Claude Memory" path is wrong

The "To Restore Claude Memory on a New Machine" section near the end of
`HANDOFF.md` references
`~/.claude/projects/-home-river-song-RiverSongAI/memory/`. The actual
path on this machine is
`~/.claude/projects/-home-riversong-RiverSongAI/memory/` (no hyphen in
`river-song`). Not fixed in this docs sweep because the user-facing
fix is a one-character correction and DeepSeek's prompt didn't scope
it — flag for the next maintenance pass.

---

## Notes on style

This file records issues; it doesn't track work. As issues are
resolved, **delete the relevant section** rather than marking it
"DONE". Resolved issues belong in git history, not in a permanent
known-issues list.
