# Production Audit Report — River Song AI

**Audit date:** 2026-07-08
**Auditor:** Claude (claude-fable-5), interactive review
**Scope:** Full program — backend (`api/`, `core/`, `providers/`, `daemons/`, `main.py`, `mcp_server.py`), frontend (`frontend/src/`), infrastructure (`config/`, deploy/setup scripts, systemd, CI), and the satellite-fleet device APIs (Vexa, Kova, Vector).
**Mode:** READ-ONLY static analysis. **No source code was modified.** Every finding below was verified against source, not pattern-matched.
**Baseline:** This audit follows `docs/audits/AUDIT_REPORT.md` (2026-05-23). ~122 commits and ~50k line changes landed since then (Vexa/Kova APIs, HttpOnly-cookie auth, fleet ecosystem + simulator, Initiative Engine, Warden vision, React 19 + Vite 8 + Tailwind 4).

---

## 1. Executive summary

**The codebase is in good shape.** The May-2026 audit's Critical findings are all remediated (verified in §2), the data layer is correctly parameterized, secrets are not committed, and configuration has real production guardrails (JWT-secret length, daemon-secret, `ALLOWED_HOSTS` wildcard rejection). **No open Critical findings remain**, so — under the agreed "fix Criticals only" policy — this pass ships as a report, with no source changes.

The findings that follow are **2 High, 4 Medium, 3 Low**. The two High items are architectural: (1) the frontend still keeps the JWT in `localStorage`, which nullifies the XSS protection the new HttpOnly cookie was meant to provide, and (2) fleet device tokens that authenticate internet-reachable robot/vehicle control are stored in plaintext at rest. Both need a decision (they touch multiple call sites and, for #2, a schema migration), so they are documented with recommended fixes rather than patched unilaterally.

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 2 |
| Medium | 4 |
| Low | 3 |

---

## 2. Verification of the 2026-05-23 audit — all Critical fixes confirmed

| Prior finding | Status | Evidence |
|---|---|---|
| `integrations.py` calls undefined `_require_admin` | ✅ Fixed | `_require_admin` defined at `api/routes/integrations.py:49`; also present in `auth.py:532`, `killswitch.py:41` |
| `ALLOWED_HOSTS=["*"]` accepted in production | ✅ Fixed | Validator `reject_wildcard_in_production` at `config/settings.py:1403`; enforced at `main.py:263` |
| MCP `_session_token` shared globally across SSE clients | ✅ Fixed | Now a `contextvars.ContextVar` at `mcp_server.py:117`, set per-connection at `:164`/`:186` |
| Sifter / Warden / Scribe daemon loops were idle stubs | ✅ Fixed | Real implementations: `daemons/sifter/sifter.py:56` (`_scan_once`), `daemons/scribe/scribe.py:214` (`_analyze_note` extracts facts) |
| Weak/missing JWT & daemon secret | ✅ Hardened | `validate_jwt_secret` (`config/settings.py:1377`, ≥32 chars), `validate_daemon_internal_secret` (`:1388`, rejects default, ≥24 chars) |

Additional confirmed-good posture:
- **SQL injection:** dynamic-column writes (`vector_fleet.py`, `providers/memory/store/vector.py`) route through `_safe_cols()` (`providers/memory/store/_util.py:41`), which rejects any non-identifier; all value binding is parameterized. No interpolation of user values into SQL found.
- **Secrets:** no committed `.env`, private keys, or live API keys in tracked files or git history (the one `$2b$` match is a test fixture, `tests/test_twofa.py:178`).
- **Webhooks:** Shopify verifies HMAC with `hmac.compare_digest` (`api/routes/shopify_webhooks.py:45`); n8n checks a shared secret (`api/routes/n8n_webhooks.py:44`); admin webhook tokens are stored as sha256 hashes, shown once (`core/webhook_tokens.py`).
- **Cookie flags:** login sets `HttpOnly`, `Secure` (in production), `SameSite=Lax` (`api/routes/auth.py:127`).
- **Systemd:** runs as a dedicated non-root `riversong` user (`river-song.service`).
- **Auth rate limiting:** login/signup/setup are `@limiter.limit`-guarded (`api/routes/auth.py:89,133,173,248`).

---

## 3. Findings

### HIGH

#### H-1 — JWT in `localStorage` defeats the HttpOnly-cookie migration
- **Domain:** Frontend / Auth
- **Files:** `frontend/src/context/AuthContext.jsx:10,63,83,101,128,156`; `frontend/src/lib/api.js:46`; `frontend/src/hooks/useWebSocket.js:136`
- **What:** The backend now issues the access token as an `HttpOnly` cookie (`api/routes/auth.py:127`) — the point of that change (commit *"HttpOnly auth cookies"*) is to keep the token out of reach of JavaScript, so an XSS bug cannot steal a session. But the frontend **also** persists the same token in `localStorage` under `rs-auth-token` and attaches it as an `Authorization: Bearer` header on every call. Because the token lives in `localStorage`, any XSS payload (`localStorage.getItem('rs-auth-token')`) exfiltrates a fully valid session token. The weakest storage wins, so the HttpOnly protection currently buys nothing.
- **Failure scenario:** A stored-XSS vector anywhere in the app (e.g. rendered LLM/user content) reads `localStorage` and posts the token to an attacker; the token stays valid until expiry/revocation, independent of the cookie.
- **Severity rationale:** High, not Critical — it requires a separate XSS primitive to exploit, but it silently negates a security control the team already paid for.
- **Recommended fix (needs a decision — not auto-applied):** Commit to cookie-only auth: send `credentials: 'include'` from `apiFetch`, stop writing the token to `localStorage`/reading it into a Bearer header, drive auth state from `/api/auth/me`, and add CSRF protection (the cookie is `SameSite=Lax`, which covers most cases, but state-changing POSTs from the SPA should carry a CSRF token or use a custom header the server requires). This touches every `fetch` call site and the WebSocket ticket flow, so it belongs in a dedicated change.

#### H-2 — Fleet device tokens/API keys stored in plaintext at rest
- **Domain:** Backend / Auth (physical-world actuators)
- **Files:** `api/routes/vexa.py:137` (`vexa_units.unit_token`), `api/routes/kova.py:145` (`kova_units.api_key`), `api/routes/vector_fleet.py:54,95` (`vector_units.unit_token`)
- **What:** The tokens that authenticate internet-reachable robot/vehicle endpoints (mowers, chore robots, driving companion) are generated with good entropy (`uuid4().hex + uuid4().hex`, 64 hex chars) but stored **as plaintext** in SQLite and compared directly against the presented header. The admin-issued webhook tokens in the same codebase already do this correctly — hash at rest, compare hashes (`core/webhook_tokens.py`). The fleet tables do not.
- **Failure scenario:** Any read of the SQLite file (a leaked backup, a file-disclosure bug, an offline copy of `/mnt/data`) hands an attacker working credentials to command physical machines — start a mower, dispatch a robot, drive telemetry into the initiative engine.
- **Severity rationale:** High. Impact is physical-world control; likelihood is gated behind a separate DB-read primitive.
- **Recommended fix (needs a decision — not auto-applied):** Store `sha256(token)` (mirror `core/webhook_tokens.py`), compare hashes in `_verify_unit`/`_verify_device`/`_verify_unit_token`, and add a one-time migration to re-hash existing units (or force re-claim). Touches registration + all verify sites + schema, so it should not be a drive-by edit.

### MEDIUM

#### M-1 — Unauthenticated YouTube Music control endpoints
- **Files:** `api/routes/google.py:280` (`GET /music/search`), `:315` (`POST /music/play/{video_id}`)
- **What:** These have no auth dependency. `/music/play` fires `asyncio.create_task(provider.play_video_id(...))` (`google.py:320`) — an unauthenticated caller reachable through the Cloudflare tunnel can trigger server-side playback and spawn unbounded background tasks; `/music/search` makes unauthenticated outbound API calls (resource abuse). (`GET /music/home` at `:295` is intentionally public for the dashboard charts widget — leave as-is.)
- **Recommended fix:** Add `Depends(require_role(...))` (or the module's user dependency) to `/music/play` and `/music/search`, and a `@limiter.limit` on `/music/play`. Low-risk but behavior-changing (verify the dashboard widget doesn't call these unauthenticated), so confirm before applying.

#### M-2 — No CORS wildcard guard in production
- **Files:** `main.py:311-317`, `config/settings.py:54`
- **What:** CORS is configured with `allow_credentials=True`. There is a production validator that rejects `["*"]` for `allowed_hosts` (`settings.py:1403`) but **no equivalent for `cors_origins`**. If `CORS_ORIGINS` is ever set to `["*"]`, the combination with credentials is a credential-exposing misconfiguration.
- **Recommended fix:** Add a `field_validator("cors_origins")` mirroring `reject_wildcard_in_production`. Small, low-risk, matches an existing pattern — a good candidate for a quick follow-up commit.

#### M-3 — Nightly unattended auto-deploy from `main` with floating dependencies
- **Files:** `setup.sh:431` (cron), `requirements.txt` (`>=` floors)
- **What:** The 3am cron runs `git pull origin main && pip install -r requirements.txt && npm install && npm run build && sudo systemctl restart river-song`. Dependencies are pinned as `>=` floors (not exact) and `npm install` (not `npm ci`), so an upstream release can enter production unattended, with no health gate and no rollback path. A broken or malicious upstream package ships automatically.
- **Recommended fix:** Pin exact versions (or use a lockfile + `pip install --require-hashes`), switch to `npm ci`, and gate the restart on a post-build health check with automatic rollback on failure.

#### M-4 — Sparse rate limiting on expensive/abusable endpoints
- **Files:** device ingestion in `api/routes/vexa.py`, `kova.py`, `vector_fleet.py`; `api/routes/google.py:280,315`
- **What:** Rate limiting is applied to auth and image generation but not to fleet telemetry ingestion or the music endpoints. High-volume device POSTs and unauthenticated music calls have no throttle.
- **Recommended fix:** Add `@limiter.limit` (keyed by unit token for device routes) to telemetry/ingest and music endpoints.

### LOW

#### L-1 — Non-constant-time device-token comparison
- **Files:** `api/routes/vexa.py:137`, `kova.py:145`, `vector_fleet.py:54,68,95`
- **What:** Device tokens and the daemon internal secret are compared with Python `==`/`!=`, a timing side channel. Tokens carry 256 bits of entropy so remote exploitation is impractical, but the fix is a one-line swap to `hmac.compare_digest`. Cheap hardening; bundle it with the H-2 hashing change.

#### L-2 — Test coverage skews away from critical modules
- **What:** 24 test files exist, but the largest and most security/logic-critical modules have none: `core/auth.py`, `core/conversation_loop.py` (1286 LOC), `core/intent_router.py` (1276), `api/routes/culinary.py` (2334), `api/routes/commerce.py`, `api/routes/inventory.py`, `providers/memory/sqlite_store.py`. Newer peripheral features (twofa, webhook_tokens, fleet, observability) are tested; the core request path is not.
- **Recommended fix:** Prioritize tests for auth (token decode/revocation/2FA gating), the intent router, and the memory store.

#### L-3 — Legacy WebSocket token-in-query still supported
- **Files:** `main.py:338`, `api/routes/conversation.py`
- **What:** `LEGACY_WS_TOKEN_ACCEPT` still allows a JWT in the WebSocket query string (logged as a warning). Acceptable as an opt-in migration aid, but tokens in query strings leak via access logs/history. Remove once all devices use the `/api/auth/ws-ticket` flow.

---

## 4. What was checked and found clean

- **Auth core** (`core/auth.py`): challenge tokens carry `purpose=totp_challenge` and are rejected as access tokens (`decode_token` at `:79`); revocation, suspension, and `tokens_valid_after` forced-logout are all enforced.
- **Kill switch:** bcrypt-gated reset (`core/kill_switch.py:177`), admin-only endpoints (`api/routes/killswitch.py:41`).
- **MCP server:** allowlist-gated tools (`EXPOSED_TOOL_NAMES`, `mcp_server.py:51`); dangerous tools excluded; per-connection Bearer token.
- **Middleware:** `TrustedHostMiddleware`, spoofing-resistant Cloudflare IP handling (`main.py:273` validates the peer is a Cloudflare range before trusting `CF-Connecting-IP`), baseline security headers (`:324`).
- **Willow device WS** (`api/routes/willow.py`): refuses all connections when no device token is configured; no anonymous fallback.
- **No** `eval`/`exec`, `shell=True`, or bare `except:` in application code.

---

## 5. Recommended next steps (in priority order)

1. **H-1** — Decide on cookie-only auth and remove the `localStorage` token (highest security value; needs a frontend refactor + CSRF).
2. **H-2 / L-1** — Hash fleet device tokens at rest and use constant-time comparison (one change, with a migration).
3. **M-2** — Add the `cors_origins` production wildcard validator (quick, low-risk).
4. **M-1 / M-4** — Gate and rate-limit the music endpoints and device ingestion.
5. **M-3** — Harden the auto-deploy pipeline (pin deps, `npm ci`, health-gated restart + rollback).
6. **L-2** — Backfill tests for auth, intent router, and the memory store.

*None of the above were applied in this pass — all are documented for the maintainer to schedule. Items M-2 and L-1 are safe, self-contained candidates if a quick follow-up PR is wanted.*
