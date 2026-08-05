# Known Issues

Wiring gaps, minor bugs, and deferred follow-ups noticed during the
2026-05-23 documentation remediation. None of these are blockers —
they are recorded here so the next session can address them deliberately
without re-discovering each one.

> **2026-06-10 update:** the following entries were FIXED in the June 2026
> cleanup session (branch `claude/riversongai-code-review-8tr8xu`):
> C-3 analytics flag (now enforced + honors ANALYTICS_LLM_MODEL), n8n router
> (now mounted), Sifter daemon (real document indexer implemented), Scribe
> analyze_note (implemented), CHRONOS shared/ root (implemented), RAG chunk
> settings (now drive the chunker and top-k), HANDOFF.md path typo.
> Remaining open items are now tracked as GitHub issues: Warden vision
> pipeline (#56), httpOnly cookie auth (#57), culinary split (#58),
> deploy gate (#59), satellite fleet-API adoption (#60), ecosystem doc
> drift (#61). Entries below are kept for historical context.

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
`passoff/HANDOFF.md` references
`~/.claude/projects/-home-river-song-RiverSongAI/memory/`. The actual
path on this machine is
`~/.claude/projects/-home-riversong-RiverSongAI/memory/` (no hyphen in
`river-song`). Not fixed in this docs sweep because the user-facing
fix is a one-character correction and DeepSeek's prompt didn't scope
it — flag for the next maintenance pass.

---

## Kiosk surface archived 2026-05-24

The `/kiosk` page, Herald daemon, `/api/broadcast/*`, `/api/auth/ws-ticket/kiosk`,
and the `KIOSK_TOKEN` / `HUB_ENTITIES` / `KIOSK_URL` / `HERALD_ENABLED` /
`DAEMON_HERALD_PORT` settings were all removed from `main`. The full
implementation lives in branch **`archive/kiosk-v3`** on `origin` for
future reference.

**Why archived:** the original design used a Chromecast-style overlay
where the Hub's browser loaded `https://riversongai.com/kiosk` and
authenticated with a long-lived shared secret baked into the public JS
bundle. The user's revised plan is to do native device-app development
that talks to the backend directly (a generic `/ws/device`-style
endpoint with per-device credentials), not a browser overlay. The
kiosk approach was speculative scaffolding for hardware that was never
acquired and an architecture that's being replaced.

**Security side-effect of the archive:** the bundle-token exposure
path (kiosk secret reachable to anyone who could load `/kiosk` via
Cloudflare tunnel) is now closed. There is no `/kiosk` route, no
broadcast endpoint, no kiosk WS ticket endpoint, no kiosk secret to
expose.

**What was preserved on `main`:**

- `frontend/src/components/RiverSong.jsx` — the orb avatar (used by
  `ConversationPage`). Its `lipSyncOpen` prop is still wired as a
  future hook; it currently falls back to `audioLevel` for animation.
- `providers/voice_id/voice_id_provider.py` and `/api/voice-id/*` —
  Voice ID is feature-complete and lives on its own.
- The Pulse / Scribe / Sifter / Warden / Mechanic daemons — all
  unrelated to kiosk.

When real device-app development starts, see branch
`archive/kiosk-v3` for the lip-sync compute approach (per-20 ms RMS
on the TTS audio buffer in `daemons/herald/herald.py::_compute_lip_sync`)
— that algorithm is useful regardless of the transport.

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
