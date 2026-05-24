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

## Kiosk token is baked into the public JS bundle

**Severity:** real exposure; documented for a future fix.

The kiosk page (`frontend/src/pages/KioskPage.jsx`) reads its auth token
from `import.meta.env.VITE_KIOSK_TOKEN` at **build time** — Vite inlines
it as a literal string in the bundle (`frontend/dist/assets/KioskPage-*.js`).
This bundle is served by FastAPI's static-file handler at `/assets/...`,
which is reachable to anyone who can load `https://riversongai.com/kiosk`
in a browser. They can open DevTools, search the bundle for the token,
and use it to open a WebSocket to `/ws/conversation` as if they were the
Hub.

This was already true before the 2026-05-23 hardening pass — the placeholder
`"change_me_kiosk_secret"` was right there in the bundle. The hardening
just replaced one secret with a stronger one; it did not close the
exposure path. `deploy.sh` now reads `KIOSK_TOKEN` from `.env` and
exports it as `VITE_KIOSK_TOKEN` before `npm run build` so the bundle
and backend stay in sync, but the bundle is still scrapable.

**Proper fix (deferred):**

- Authenticate the `/kiosk` page itself (require a one-time pairing flow
  from Home Assistant rather than a long-lived shared secret), OR
- Serve the kiosk SPA from a separate host/route that's LAN-only or
  Cloudflare-Access gated, OR
- Issue per-Hub short-lived tokens via Home Assistant's `media_player`
  service call so each Hub gets its own credential.

The current setup is acceptable for a household-scale deployment where
the threat model is "no one outside the household will randomly try this
URL," but it is not appropriate if `/kiosk` ever needs to be reachable
on the open internet under hostile conditions.

---

## Daemon systemd template needs a one-time install

**Severity:** docs gap; the daemons exist in code but were never deployed
to systemd on this machine until 2026-05-24.

`docs/DAEMONS.md` documents the `systemctl enable --now
river-song-daemon@<name>` invocation, but did not initially mention that
the templated unit file (`daemons/river-song-daemon@.service`) has to be
copied to `/etc/systemd/system/` once before `enable` will work. That
step has been added to the doc.

If `systemctl list-unit-files 'river-song-daemon@*'` returns "0 unit
files listed", run the install commands at the top of
`docs/DAEMONS.md` § Orchestration → systemd (production) → Initial
install.

---

## Notes on style

This file records issues; it doesn't track work. As issues are
resolved, **delete the relevant section** rather than marking it
"DONE". Resolved issues belong in git history, not in a permanent
known-issues list.
