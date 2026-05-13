# RIVER SONG AI — SECURITY AUDIT

**Auditor:** Claude Opus 4.7 (read-only)
**Date:** 2026-05-13
**Snapshot:** `4689cc1` on `main`
**Scope:** every file shipped in the repository at HEAD plus git history for credential leaks.
**Severity scale:** CRITICAL · HIGH · MEDIUM · LOW.

> A note on the brief: the request asks for an audit of **Firebase Auth / Firestore / Storage rules**. Those services are **not** part of this codebase. Authentication is JWT (`PyJWT`, HS256) against a local `users` table inside `data/river_song.db`. There are no Firestore rules to audit. "Data-layer authorization" in this report refers to the `user_id` and `role` columns enforced via SQLAlchemy filters and inline `decode_token` calls inside each FastAPI route.

---

## Executive summary (counts)

| Severity | Count |
|---|---|
| CRITICAL | 4 |
| HIGH | 9 |
| MEDIUM | 11 |
| LOW | 8 |

If only one round of remediation is possible before any public deployment, fix the four CRITICAL items in this order: **C-1 → C-2 → C-3 → C-4.**

---

## CRITICAL

### C-1 — Live Google OAuth `client_secret` is extractable from git history

**File path:** `config_files/google_client_secrets.json` (deleted at HEAD, present in earlier commits).
**Commit:** `6252652` — `git show 6252652:config_files/google_client_secrets.json` returns a JSON document with the following fields **populated with real values** (values redacted in this report; verify with `git show` yourself):

| Field | Status in history |
|---|---|
| `client_id` | Real `*.apps.googleusercontent.com` value (12-digit project number prefix, full 40-char hash) |
| `client_secret` | Real Google OAuth client-secret value (28 chars after the standard 7-char Google prefix) |
| `auth_uri` | `https://accounts.google.com/o/oauth2/auth` |
| `token_uri` | `https://oauth2.googleapis.com/token` |
| `redirect_uris` | `["http://localhost"]` |

The full secret is intentionally not quoted here so this report is itself safe to share. Run `git show 6252652:config_files/google_client_secrets.json` locally to confirm — the secret will appear there until git history is rewritten.

The cleanup commit `8cdf2a6 — remove tracked credential files and .env from git history` only ran `git rm`. The blob is still in the pack, accessible to anyone who clones from `https://github.com/cassu123/RiverSongAI`.

**Remediation (do in this order):**
1. Rotate the OAuth client immediately at `console.cloud.google.com` (delete the credential, create a fresh one). Replace the local `config_files/google_client_secrets.json` and the prod copy.
2. Rewrite git history with `git filter-repo --invert-paths --path config_files/google_client_secrets.json --path config_files/google_config.json --path .env --path authentication/google/google.oauth2.credentials` and force-push.
3. Run `gh repo edit cassu123/RiverSongAI --visibility private` if it is currently public until step 2 completes.
4. Audit the Google project for unexpected OAuth grants (Cloud Console → IAM & Admin → Audit Logs).

### C-2 — `POST /api/image/generate` is anonymous

**File path:** `api/routes/image.py:22-50`.
**Vulnerable pattern:**
```python
@router.post("/generate")
async def generate_image(body: ImageGenerateBody):
    settings = get_settings()
    if not settings.image_generation_enabled:
        raise HTTPException(status_code=403, …)
    provider = SDProvider()
    img_bytes = await provider.generate(prompt=body.prompt, …)
    return Response(content=img_bytes, media_type="image/png")
```

There is no Bearer token check. Anyone who can reach the host (via the Cloudflare tunnel, the LAN, or a leaked Tailscale node) can run arbitrary Stable Diffusion prompts on the user's GPU. The provider spawns the SD process if it is not already running (`SDProvider._ensure_running`) and tells Ollama to unload its model. An attacker can repeatedly toggle the system between SD and Ollama, denying voice service. They can also generate any content (including illegal imagery) tied to this server's IP.

**Remediation:** add `user_id: str = Depends(_require_user)` to the function signature; refuse without auth. Add rate limiting (≤ 5 generations per user per hour). Log every prompt + user id to a tamper-evident audit log.

### C-3 — Shopify webhook receiver accepts unsigned payloads

**File path:** `api/routes/shopify_webhooks.py:13-22`.
**Vulnerable pattern:**
```python
@router.post("/orders")
async def shopify_order_webhook(request: Request):
    payload = await request.json()
    wrapper = ShopifySyncWrapper(db_path="data/commercial_inventory.db", workspace_id="default", user_id="system")
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, wrapper.handle_order_created, payload)
    return {"status": "ok"}
```

There is no `X-Shopify-Hmac-SHA256` signature verification. Any HTTPS client can post a fake order payload; the handler will write fictitious orders into `data/commercial_inventory.db`. Worse: the path is hardcoded to a database file that is **different** from the one used elsewhere (`data/commerce.db`). The webhook is wide open and quietly populates the wrong DB.

**Remediation:** read the raw body, recompute HMAC-SHA256 with the Shopify shared secret, base64-encode, compare to the header with `hmac.compare_digest`. Reject mismatches with 401. Fix the DB path while you are in there.

### C-4 — JWT `sub` is trusted everywhere with no token revocation

**File paths:** `core/auth.py:18-23`, every route's `_require_user`.
**Vulnerable pattern:** tokens are 7-day-valid by default (`jwt_expire_minutes=10080` in `config/settings.py:220`), signed with HS256, and never revoked. A leaked token is valid for a week. There is no token blocklist, no fingerprinting, no IP binding, and `logout()` only clears localStorage (`AuthContext.jsx:108-113`) — the JWT remains valid server-side.

A user who logs out from a shared device and then closes the browser leaves a valid token in localStorage **and** the JWT will still authenticate WebSocket and HTTP calls if recovered.

**Remediation:** add a `token_jti` column in the `users` table and a `revoked_jti` table. Sign tokens with a per-token UUID `jti` claim. On `logout`, POST to `/api/auth/logout` to insert the jti into the revoked table. `decode_token` rejects revoked jtis. Drop the default token lifetime to 24h, or 1h with a refresh-token flow.

---

## HIGH

### H-1 — `daemon_internal_secret` defaults to the literal string `"change_me_in_production"`

**File path:** `config/settings.py:656-658`.
**Risk:** any daemon-only endpoint (`/api/broadcast/lip_sync`, `/api/rover/telemetry`, `/api/context/sensor_event`) accepts `Authorization: Bearer change_me_in_production` if the operator forgets to override the value. The string is also published in `.env.example`.
**Remediation:** refuse to start the app if `daemon_internal_secret == "change_me_in_production"`; add a `field_validator` similar to `validate_jwt_secret`.

### H-2 — `_CloudflareIPMiddleware` trusts the `CF-Connecting-IP` header unconditionally

**File path:** `main.py:194-199`.
**Risk:** if the server is ever exposed outside the Cloudflare tunnel (LAN, Tailscale, or a misconfigured firewall), any client can spoof any IP for access logs, intent routing, and the IP-based geolocation in `/api/location/city`. There is no check that the request actually came from a Cloudflare IP range.
**Remediation:** either (a) only enable this middleware when an env flag confirms we're behind the tunnel, or (b) check the request's `request.client.host` against the official Cloudflare CIDR list before promoting `CF-Connecting-IP`.

### H-3 — SSE error messages leak server internals to the browser

**File path:** `api/routes/conversation.py:362`.
**Vulnerable pattern:**
```python
yield f"data: [ERROR] {exc}\n\n"
```
**Risk:** Anthropic / OpenAI / Bedrock exceptions can contain account IDs, model names, region info, API quota detail, and rate-limit headers. A failed call exposes all of that to the user-facing client. Same pattern in `_exec_*` tool executors — they return `f"...{exc}"` strings as user-facing replies.
**Remediation:** log the full exception server-side, return a generic `data: [ERROR] An error occurred` to the client.

### H-4 — WebSocket auth via `?token=` query string

**File path:** `api/routes/conversation.py:81`.
**Risk:** tokens in URLs leak into Cloudflare access logs, Nginx logs, browser history, and the referer header on any external image the page loads. They are vastly more leak-prone than `Authorization` headers.
**Remediation:** require a `Sec-WebSocket-Protocol` subprotocol containing the token (RFC 6455), or issue a short-lived (60s) one-time WebSocket ticket from a separate REST endpoint.

### H-5 — Stack traces for cloud-provider errors land in the conversation history

**File path:** `providers/llm/claude_api.py:48-49`, `providers/llm/gemini.py:122-135`.
**Vulnerable pattern:**
```python
except Exception as exc:
    logger.error("Claude API call failed: %s", exc)
    return f"I had trouble reaching my cloud brain: {exc}"
```
The error string is appended to `self._history` as an assistant message and persisted into summary memory. Future turns see the leaked error text.
**Remediation:** strip the exception detail from the user-facing string; log internally.

### H-6 — `_get_ollama_installed_models` makes outbound HTTP without auth

**File path:** `api/routes/models_settings.py:51-68`.
**Risk:** the function ships with a remote-host guard (`raise ValueError` if `OLLAMA_BASE_URL` is non-local over HTTP), good. **But** it is called by `GET /api/models`, which has no auth check at all (`@router.get("/models")` takes no `Authorization`). Anyone can ping the endpoint to enumerate the installed Ollama model list, which leaks server fingerprint info.
**Remediation:** require auth on `/api/models`; the ChatPage already sends the Bearer header on every other call.

### H-7 — `GET /api/webhooks/n8n/status` and `/workflows` are anonymous

**File path:** `api/routes/n8n_webhooks.py:46-71`.
**Risk:** exposes `n8n_url`, `n8n_enabled`, and the full workflow list to anyone who can hit the public host. Reveals which automations are available, which is half the work for an attacker who has already breached one workflow.
**Remediation:** require admin auth on both endpoints; the webhook receiver is correctly gated by `X-N8N-Secret` already.

### H-8 — `auth/integrations` writes to `.env` from request bodies

**File path:** `api/routes/auth.py:227-272`.
**Risk:** even disregarding the `NameError` (`re` / `dotenv` not imported), this endpoint **rewrites `.env`** based on a request body, then reloads it. There is no admin check (only "logged-in user"), so any approved user can overwrite the Amazon and Walmart credentials. The path is `Path(".env")` — relative to cwd; if the app starts from a different directory the wrong file could be edited.
**Remediation:** gate behind `_require_admin`; store the values in `admin_config` (the existing JSON blob in `users` table) instead of mutating `.env`.

### H-9 — `data/*.db` files appear in working tree and may be tracked

**File paths:** `data/commerce.db`, `data/inventory.db`, `data/vehicles.db`, `data/culinary.db`, `data/river_song.db`.
**Risk:** these are real user-data databases. They were not in `git ls-files` at HEAD when this audit ran, but `data/.gitkeep` was. If a future commit `git add data/` is run, all user data (facts, hashed passwords, OAuth user records) ships to GitHub. The `.gitignore` covers `.env` and `*.key` but not `data/*.db`.
**Remediation:** add `data/*.db` to `.gitignore`; add a `pre-commit` hook that refuses commits inside `data/`.

---

## MEDIUM

### M-1 — No rate limiting anywhere on the public-facing API

**Files:** every route in `api/routes/`.
**Risk:** denial-of-service trivially possible: `POST /api/conversation/chat` triggers Ollama on the server, `POST /api/conversation/extract-facts` triggers three LLM dispatches, `POST /api/image/generate` runs SD. There is no per-user or per-IP throttle.
**Remediation:** add `slowapi` (1 LOC dependency) and decorate the expensive endpoints with `@limiter.limit("10/minute")`.

### M-2 — `setup` endpoint relies on caller honesty about being first-run

**File path:** `api/routes/auth.py:65-92`.
**Risk:** the only check is `if await store.has_admin(): 409`. If the database is wiped (or a SQLite file replaces the live one) the next caller becomes admin. There is no setup-token-required mode.
**Remediation:** require an out-of-band setup token (env var) for `/api/auth/setup` and remove it after the first admin exists.

### M-3 — `IntentRouter` can reach commerce + smart-home with no role check

**File path:** `core/intent_router.py:170-272`.
**Risk:** the WebSocket route authenticates the user (good), but once the transcript reaches the intent router, `_handle_smart_home` and `_handle_commerce` operate with the user's id with **no role check**. A child role connected via WebSocket can say "turn off the lights" and the assistant will obey, bypassing the parent-feature cascade enforced in `/api/features`. The cascade only governs which pages render in the sidebar — voice commands ignore it.
**Remediation:** in `_handle_smart_home` and `_handle_commerce`, fetch the user's role from `user_id` and short-circuit if the feature is not enabled for that role.

### M-4 — `MemoryPage` can delete arbitrary facts owned by other users *if* the JWT is forged

**File path:** `api/routes/memory.py` — `DELETE /api/memory/facts/{fact_id}`.
**Risk:** the handler trusts `decode_token` only for authentication, not authorization: it does not check that the fact belongs to the caller's user_id. `_sync_delete_fact` deletes by `id` only. If the JWT is forged (see C-4) the attacker can wipe any user's memory by id.
**Remediation:** SQL filter on `WHERE id = ? AND user_id = ?` in `_sync_delete_fact`.

### M-5 — Tool executor writes to root-level SQLite without auth-scoped writes

**File path:** `core/tools.py:343-528`.
**Risk:** `_exec_add_inventory` and friends insert rows into `inventory_items`, `shopping_list`, `reminders`, `vehicle_logs`, `recipe_stubs`, `routine_stubs` with `user_id` taken from the conversation context. The context is set via `{"user_id": self._user_id}` inside `ConversationLoop`, which trusts the JWT. So far ok — **but** these tables live in the same DB as `users`, and the auto-`CREATE TABLE IF NOT EXISTS` calls add columns silently. If the schema drifts between releases, tool calls will fail mid-execution and partially-written rows remain.
**Remediation:** centralize the schema with the rest of the migrations and refuse to run tool calls if the schema migration has not been applied.

### M-6 — Auth tokens in localStorage

**File path:** `frontend/src/context/AuthContext.jsx:10`, every page that does `localStorage.getItem('rs-auth-token')`.
**Risk:** an XSS payload anywhere in the SPA exfiltrates the JWT. React auto-escapes most content, but the app has no Content-Security-Policy header and the bundle contains 3D model loaders + react-three-fiber which load remote assets. Any open redirect or unsanitized fact value rendered through `dangerouslySetInnerHTML` (none today) would be catastrophic.
**Remediation:** store the token in an HttpOnly cookie, return it via the login response and rely on the cookie for `Authorization: Bearer` on subsequent calls. Add a strict CSP that blocks inline scripts.

### M-7 — `lipsync` broadcast endpoint accepts arbitrary timing data

**File path:** `api/routes/broadcast.py:23-40`.
**Risk:** authenticated only via `daemon_internal_secret`. Anyone who steals the secret can flood the WebSocket clients with `{"type":"lip_sync"}` payloads, freezing the avatar or causing the React state machine to misbehave.
**Remediation:** rotate the secret on every deploy and add a payload-size limit (currently unbounded).

### M-8 — `_CloudflareIPMiddleware` does not strip the path of double slashes

**File path:** `main.py:194-199`.
**Risk:** generally fine — it only mutates the client IP. Mentioned here only because the middleware runs **before** the SPA fallback (`@app.get("/{full_path:path}")`), so a malformed request could in theory take an unusual code path. Validated and currently benign.
**Remediation:** none required; tracked for awareness.

### M-9 — Cloud-LLM enable flags can be flipped at runtime by admins via `/api/features/{flag_name}`

**File path:** `api/routes/features.py:98-136`.
**Risk:** admins can flip `ANTHROPIC_ENABLED` etc. at runtime. This persists to `admin_config` in the DB so the change survives restart. The flip is logged. **Not a bug — confirm it's intentional.** Mentioned here only because the same code path can enable any flag in `AI_FEATURE_MAP`, and the map currently lists `IMAGE_GENERATION_ENABLED`. Flipping that flag from the UI immediately enables the unauthenticated `/api/image/generate` route (see C-2).
**Remediation:** after C-2 is fixed (auth on the image route) this becomes safe.

### M-10 — `core/kill_switch.py` resolves its state file relative to its own location

**File path:** `core/kill_switch.py:36-44`.
**Risk:** if the daemon is launched with a different cwd, the state file path resolves correctly thanks to `__file__`, **but** if the file is symlinked the link may not be followed consistently across platforms. Also the file is plain text, world-readable on default umask.
**Remediation:** lock down the file mode (`chmod 600`); consider moving the state into the SQLite `admin_config` blob.

### M-11 — `ChatPage` `extractFacts` runs three LLM passes on visibility change

**File path:** `frontend/src/pages/ChatPage.jsx:196-205`.
**Risk:** while not a classical security risk, the aggressive trigger means every screen-lock or tab switch costs three LLM calls' worth of inference time on the server. On the cloud providers this is a billing-loss surface; an attacker who fires `visibilitychange` repeatedly from a victim's authenticated tab can run up the user's cloud-LLM bill.
**Remediation:** debounce the trigger to once per minute and skip the call when `messages.length < 2`.

---

## LOW

### L-1 — `RIVER_SONG_SYSTEM_PROMPT` in `.env.example` is a permissive instruction

**File path:** `.env.example:69`. The default prompt encourages "concise" output but does not include a safety preamble. Cloud LLMs apply their own safety filters; local Ollama models do not. Output filtering is not implemented anywhere.
**Remediation:** add a "refuse to help with [X]" preamble appropriate to the deployment.

### L-2 — `POST /api/auth/google/callback` does not verify the OAuth `state` parameter

**File path:** `api/routes/auth.py:312-381`. The callback accepts `{code, redirect_uri}` and immediately exchanges. There is no CSRF state parameter — anyone with the auth code can complete the login flow. The frontend does set a `state` in its OAuth URL, but the server never validates it.
**Remediation:** issue the `state` value server-side, store it in a short-lived cookie, and validate it in the callback.

### L-3 — Password complexity check is min-length only

**File path:** `api/routes/auth.py:73`. ≥ 12 characters is required; no complexity, no breach-list lookup.
**Remediation:** integrate `zxcvbn` or HIBP `pwnedpasswords` k-anonymity API on signup.

### L-4 — JWT default expiry is 7 days

See C-4. Listed here at LOW because the same item is tracked at CRITICAL with the broader revocation gap.

### L-5 — `ALLOWED_HOSTS=["*"]` in `.env.example`

Default in `config/settings.py:60` is `["*"]`, which is correct for local dev but if `.env.example` is copied verbatim to production it disables the `TrustedHostMiddleware`. The actual prod `.env` correctly narrows to the three domains.
**Remediation:** set the example to a comment line `# ALLOWED_HOSTS=["yourdomain.com"]` so operators must opt in.

### L-6 — `frontend/package.json` is missing security-floor pins

The Python `requirements.txt` lists explicit security floors for `setuptools`, `requests`, `urllib3`, `certifi`, `cryptography`. The frontend `package.json` does not. `react@18.3.1`, `react-dom@18.3.1`, `vite@6.4.2`, `three@0.184.0`, `@react-three/fiber@8.18.0`, `@react-three/drei@9.122.0`, `@react-three/postprocessing@3.0.4`, `react-leaflet@4.2.1`, `leaflet@1.9.4`. **GitHub's Dependabot reported 43 vulnerabilities (2 critical, 24 high, 14 moderate, 3 low) on push.** Run `npm audit` and update or pin.
**Remediation:** `npm audit` + `npm audit fix`; review CVE-flagged transitive deps individually.

### L-7 — Voice / audio inputs are not size-capped

**File paths:** `api/routes/conversation.py:201-220` (`audio_data`) and `/api/conversation/transcribe`. The base64 audio blob is decoded with no size limit. A malicious client can send a multi-gigabyte WAV and exhaust memory.
**Remediation:** reject `len(raw_data) > 10_000_000` (≈ 10 MB) before base64-decoding.

### L-8 — Logs go to stdout with no rotation

**File path:** `main.py:_configure_logging`. Logging writes to stdout. systemd journal captures it, but log noise from `_extract_facts` (which prints the LLM's raw output) ends up in `journalctl`. If an LLM hallucinates a credit-card number in the user's facts, it gets logged.
**Remediation:** down-grade the `Fact extraction output` log to `DEBUG` and ensure the journald level is set accordingly.

---

## Dependency / CVE summary

### Python (`requirements.txt`)
| Package | Pinned | Notes |
|---|---|---|
| fastapi | 0.136.0 | Recent. |
| starlette | 1.0.0 | Recent. |
| uvicorn[standard] | 0.44.0 | Recent. |
| pydantic | 2.13.2 | Recent. |
| python-jose | absent | Good — `PyJWT==2.12.1` is used (PyJWT is the safer choice). |
| torch | >=2.6.0 (security floor) | OK. |
| anthropic | 0.96.0 | OK. |
| openai | 1.82.0 | OK. |
| boto3 | 1.38.0 | OK. |
| chromadb | 1.5.9 | OK. |
| python-multipart | 0.0.27 | OK. |
| setuptools | >=78.1.1 | Floor set for CVE-2025-47273. ✓ |
| requests | >=2.32.0 | Floor for CVE-2024-35195. ✓ |
| urllib3 | >=2.2.2 | Floor for CVE-2024-37891. ✓ |
| certifi | >=2024.7.4 | ✓ |
| cryptography | >=43.0.1 | Floor for CVE-2024-26130. ✓ |
| googlemaps | 4.10.0 | OK. |
| ytmusicapi | 1.11.5 | Unofficial — keep an eye on it. |
| yt-dlp | 2026.3.17 | Recent. |
| sounddevice | 0.5.5 | Listed under YouTube Music — actually unused (audio playback is browser-side). Remove to shrink attack surface. |
| pywebpush | >=2.0.0 | OK. |
| reportlab | 4.4.1 | OK. |
| qrcode[pil] | 8.2 | OK. |
| pymupdf | 1.27.2.3 | OK. |
| pypdf | 6.10.2 | OK. |
| beautifulsoup4 | 4.14.3 | OK. |
| python-amazon-sp-api | 2.1.8 | OK. |
| pymavlink | >=2.4.41 | OK. |
| feedparser | 6.0.11 | OK. |
| httpx | 0.28.1 | OK. |
| pydub | >=0.25.1 | OK. |

**Unused / removable:**
- `sounddevice` — server never plays audio. Audio playback is in the browser.
- `chatterbox-tts`, `f5-tts`, `outetts` — commented out, OK as comments.

### Frontend (`frontend/package.json`)
GitHub Dependabot reports **43 vulnerabilities (2 critical, 24 high, 14 moderate, 3 low)** on the default branch. The push response on this audit's snapshot confirmed it: `https://github.com/cassu123/RiverSongAI/security/dependabot`.

Top recommendations:
- `npm audit fix` first.
- Pin the dev tooling explicitly (`vite`, `@vitejs/plugin-react`, `tailwindcss`).
- Audit `leaflet` and `react-leaflet` — both have older CVEs in 1.x.
- `three`@0.184 is somewhat old (current is 0.171+ → ≥ 0.180). Verify `@react-three/drei` 9.x is compatible with a newer three.js if you upgrade.

---

## Data privacy notes

- `core/conversation_loop.py:454` logs the fact-extraction output: `logger.info("Fact extraction output (user=%s): %s", user_id, full[:300])`. **This puts the LLM's free-form output into systemd journals.** If the user said "my SSN is …" the LLM might emit it as a fact and log it. Tighten to `logger.debug` and consider scrubbing.
- `core/conversation_loop.py:597-599` records a summary that begins `User said: "<first 200 chars>". River Song responded: "<first 200 chars>"`. PII present in the transcript is verbatim in `conversation_summaries`. The `--- MEMORY ---` block then re-injects it.
- `MemoryPage` allows the user to view facts/preferences/summaries — there is **no view to see what gets injected on the next turn**. Add a "preview context" view so users can audit before sending.
- `data/audible/` and `data/libby/` hold per-user OAuth chips and auth blobs in plaintext JSON. Encryption at rest is not configured. `git ls-files data/` shows only `.gitkeep` at HEAD — good — but the files exist on the server's filesystem with default permissions.
- `logs/` (symlinked to `/mnt/data/river-song/logs/` in production per `HANDOFF.md`) — verify the directory is `chmod 700` and not world-readable.

---

## Recommended remediation order

1. **C-1** rotate Google OAuth secret + rewrite history.
2. **C-2** add auth on `/api/image/generate`.
3. **C-3** add HMAC verification on Shopify webhook.
4. **C-4** add JWT revocation + drop token lifetime.
5. **H-1** refuse to boot with the default daemon secret.
6. **H-8** require admin role on `/api/auth/integrations`; stop rewriting `.env` from a request body.
7. **H-3 & H-5** strip exception detail from user-facing strings.
8. **L-6** `npm audit fix` the 43 frontend CVEs.
9. **M-1** add basic rate limiting.
10. **M-3** enforce feature/role cascade on voice intents.

After these, schedule the MEDIUM and LOW items as part of the regular sprint cadence. None of the open items requires a redesign; all are localised patches.

---

*End of security audit.*
