# River Song AI — Round 3 Repair Brief

**Audience:** Gemini (or any model running in the repo root with shell + file access).
**Mode:** Repair only. Do not introduce new features. Do not commit. Stop and ask if anything in the working tree contradicts this brief.

---

## 1. Background — what happened

The previous session shipped two layers of work in parallel:

1. **Audit Round 3 (security)** — JWT revocation, WebSocket ticket exchange, LLM error scrubbing, admin gates on metadata routes, integrations storage migration, daemon-secret boot validation, pre-commit hook for `data/*.db`, voice-cascade enforcement, memory DELETE ownership. **This work is correct and is already in the tree.** Verification details are in §3 below; do not re-do any of it.

2. **An attempted async migration of route auth helpers.** `core/auth.py::decode_token` became `async def`, so every route file's `_require_user` / `_require_admin` helper had to follow. The session tried to do this across 18 route files in one pass and corrupted every signature it touched. This is the source of every problem this brief addresses.

A third concern surfaced inside that same migration pass: `api/routes/analytics.py` was rewritten to a different shape — three new endpoints, three deleted endpoints, two Pydantic models replaced with raw `dict`, the `api_secret` masking removed, and three calls to store methods that do not exist on `providers/memory/sqlite_store.py`. This needs to be undone, not patched.

Round 3 is **uncommitted in the working tree**. `git status` shows the dirty files; nothing here exists at `HEAD` yet.

---

## 2. The three exact failure modes

### 2A. Malformed async helper signatures (18 files)

Every file in §4 contains a helper whose `def` line reads one of these three malformed patterns:

- `async def await _require_user(…)` — extra `await` keyword between `def` and the function name.
- `async async def await _require_user(…)` — double `async` plus the extra `await` keyword. Appears in `models_settings.py` and `analytics.py`.
- `def await _require_admin(…)` — missing leading `async`, plus the extra `await` keyword. Appears in `context.py`, `killswitch.py`, and the second helper in `rover.py`.

In every case, the **function body is already correct**: it does `await decode_token(authorization.removeprefix("Bearer "))` and returns `payload["sub"]`. Only the `def` line is broken. The fix is purely a signature normalisation: every one of these must become `async def <name>(<original-params>) -> <original-return>:` with the body left untouched.

These files fail `python3 -c "import ast; ast.parse(open(path).read())"`. uvicorn cannot import any of them; the server cannot start; the entire API is offline until this is repaired.

### 2B. Missing `Depends` import in n8n_webhooks.py

`api/routes/n8n_webhooks.py` line 13 imports `APIRouter, Header, HTTPException, Request` from `fastapi`. Lines 59 and 70 reference `Depends(_require_admin)` in their parameter lists. Even after fixing the signature in 2A, this file will raise `NameError: name 'Depends' is not defined` at import time. Add `Depends` to the existing `from fastapi import …` line — do not add a second import line.

### 2C. analytics.py functional regressions

The diff against `HEAD` for `api/routes/analytics.py` removes ~213 lines and adds ~127. The intent of the diff was the async migration (legitimate); the side effect was a full redesign that:

- **Deletes** the `/business-report` endpoint (which calls `core.tools._exec_generate_business_report`).
- **Deletes** the `/{platform}/summary` AI-summary endpoint (which calls the LLM provider with snapshot data).
- **Deletes** the `PlatformBody` and `SnapshotBody` Pydantic models, and replaces both endpoint parameters with `body: dict` — losing all input validation.
- **Deletes** the `api_secret` masking on GET `/platforms` (the original code overwrites every `api_secret` field with bullet characters before returning; the rewrite returns them in clear text — a **security regression**).
- **Deletes** the `.lower()` normalisation on the `platform` path parameter in `/platforms/{platform}` (PUT and DELETE) and on snapshot platforms.
- **Deletes** the `date` parameter on `POST /snapshots` and the `upsert_analytics_snapshot` call, replacing both with `save_analytics_snapshot(user_id, platform, metrics)` — **a method that does not exist on the store**.
- **Adds** three new endpoints — `GET /growth`, `GET /summary`, `GET /platforms/available` — and the first two call `calculate_analytics_growth` and `get_analytics_summary`, **methods that also do not exist on the store**. These endpoints would 500 on first call.
- **Removes** several imports (`json`, `re`, `Dict`, `Query`, `BaseModel`) along with the models they supported.

The correct response is not to wire up the three missing store methods. The frontend (`frontend/src/pages/AnalyticsPage.jsx` is unmodified in this session and still calls the original endpoints) expects the original shape. **Restore the file to its `HEAD` version, then re-apply only the legitimate sync-to-async migration on top of that restored copy.**

---

## 3. What is already correct — do not touch

If any of the following looks wrong to you while reading the repo, stop and report it; do not "fix" it. Each was verified end-to-end before this brief was written:

| Area | Where it lives | Verified behavior |
|---|---|---|
| JWT revocation | `core/auth.py` (jti claim + revocation lookup), `providers/memory/sqlite_store.py` (`revoked_tokens` table, `revoke_token`, `is_token_revoked`, `delete_expired_tokens`), `api/routes/auth.py::logout` (active revoke), `main.py` (periodic purge loop) | Logging out invalidates the token immediately; expired revocations are reaped on schedule. |
| JWT lifetime | `config/settings.py::jwt_expire_minutes` default = `1440` | 24-hour tokens. |
| Daemon secret guard | `config/settings.py::validate_daemon_internal_secret` rejects the placeholder string and any value shorter than 24 chars | App refuses to start with the insecure default. |
| WebSocket ticket exchange | `api/routes/auth.py::/ws-ticket` and `/ws-ticket/kiosk`, `frontend/src/hooks/useWebSocket.js` (one-shot ticket flow), `config/settings.py::ws_ticket_lifetime_seconds = 60` | WebSocket URLs now carry `?ticket=…`, not JWTs. |
| LLM error scrubbing | `providers/llm/{claude_api,openai_api,gemini,mistral_api,bedrock}.py::_friendly_error` | User sees a generic message; stack traces stay in the server log. |
| `/api/auth/integrations` admin gate | `api/routes/auth.py::_require_admin` already async and correctly defined | Non-admins get 403. |
| Encrypted integrations storage | `providers/memory/sqlite_store.py` integrations table, `main.py:131-165` env injection at startup | `.env` is no longer mutated by the UI. |
| Pre-commit + gitignore | `scripts/pre-commit.sh`, `.gitignore:132-136` | `data/*.db` staged commits are refused. |
| Voice cascade | `core/family.py::is_feature_enabled_for`, used in `core/intent_router.py:174-175` (home) and `:466-467` (commerce) | Restricted roles cannot fire smart-home or commerce intents by voice. |
| Memory DELETE ownership | `providers/memory/sqlite_store.py::delete_fact`, `delete_preference`, `delete_summary`, `delete_pending_habit` all carry `AND user_id = ?` | Users cannot delete other users' rows. |

If you are about to modify any line in any of these locations, stop. The brief does not authorise it.

---

## 4. Task list

Work the tasks in order. Run the acceptance check at the end of each task before moving to the next. Do not batch.

### Task A — Fix the 18 mangled helper signatures

For each file in the table below, locate the listed line(s), and replace the malformed `def` line with the correct async form. Leave the function body, the parameter list, the type annotations, and the return type **exactly as they appear today**. The only edit is the signature line itself.

The pattern to apply, regardless of which malformed form is currently present:

- If the helper is `_require_user`: produce `async def _require_user(<original params>) -> str:`
- If the helper is `_require_admin` and currently returns `str`: produce `async def _require_admin(<original params>) -> str:`
- If the helper is `_require_admin` and currently returns `dict` or `None`: preserve that return annotation.

Files and helpers:

| # | File | Helpers (current line) |
|---|---|---|
| 1 | `api/routes/admin.py` | `_require_admin` near line 32 |
| 2 | `api/routes/analytics.py` | `_require_user` near line 27 — currently `async async def await` (Task C will rewrite this file; you can skip the helper edit here and do it once during Task C, or fix it now and let Task C overwrite — either is fine, but do not leave the malformed form in the tree) |
| 3 | `api/routes/context.py` | `_require_admin` near line 32 — currently `def await` (missing `async`) |
| 4 | `api/routes/daemons.py` | `_require_admin` near line 24 |
| 5 | `api/routes/feeds.py` | `_require_user` near line 31 |
| 6 | `api/routes/google.py` | `_require_user` near line 30 |
| 7 | `api/routes/home.py` | `_require_user` near line 28 |
| 8 | `api/routes/image.py` | `_require_user` near line 26 — note: parameter is `creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer)`, not `authorization`. Preserve exactly. |
| 9 | `api/routes/killswitch.py` | `_require_admin` near line 40 — currently `def await` (missing `async`) |
| 10 | `api/routes/location.py` | `_require_user` near line 23 |
| 11 | `api/routes/models_settings.py` | `_require_user` near line 111 — currently `async async def await`. `_require_admin` near line 119. Note: both helpers were consolidated to the top of the file in this session; do not move them. Just fix the signatures. |
| 12 | `api/routes/n8n_webhooks.py` | `_require_admin` near line 23 |
| 13 | `api/routes/push.py` | `_require_user` near line 24 |
| 14 | `api/routes/rag.py` | `_require_user` near line 21 |
| 15 | `api/routes/reading.py` | `_require_user` near line 67 |
| 16 | `api/routes/routines.py` | `_require_user` near line 29 — parameter is `creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer)`. Preserve. |
| 17 | `api/routes/rover.py` | `_require_user` near line 23, `_require_admin` near line 31 (the admin one is missing `async`) |
| 18 | `api/routes/vision.py` | `_require_user` near line 24 — parameter is `creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer)`. Preserve. |

**Do not edit call sites in Task A.** Every call site already does `await _require_user(authorization)` or `Depends(_require_user)` — both are correct for an `async def` helper. The session got the call sites right; only the helper definitions are broken.

**Do not edit any other helpers in these files.** Some files contain additional helpers (`_store`, `_get_store`, `_get_libby`, `_bearer`, `_is_configured`, `_get_ollama_installed_models`, `_get_enabled_providers`, `_model_to_dict`, etc.). Those are unchanged from `HEAD` and must stay sync.

**Acceptance check after Task A:**
1. `grep -rn "async def await\|async async def\|def await " --include="*.py" .` returns no lines.
2. `find api/routes -name "*.py" | while read f; do python3 -c "import ast; ast.parse(open('$f').read())" 2>&1 | grep -q . && echo "FAIL $f"; done` produces no `FAIL` output.

### Task B — Add the missing `Depends` import

In `api/routes/n8n_webhooks.py`, the existing line:

> `from fastapi import APIRouter, Header, HTTPException, Request`

needs `Depends` added to the import list, alphabetically positioned. Do not introduce a new import statement; modify the existing one. Do not import `Depends` from anywhere other than `fastapi`.

**Acceptance check after Task B:**
1. `grep "from fastapi import" api/routes/n8n_webhooks.py` shows `Depends` in the list.
2. The file passes `python3 -c "import ast; ast.parse(open('api/routes/n8n_webhooks.py').read())"`.
3. `grep -n "Depends" api/routes/n8n_webhooks.py` shows three matches: one in the import line, two in the route signatures.

### Task C — Restore analytics.py and re-apply only the async migration

The cleanest path is a full restore followed by a minimal patch:

1. Run `git checkout HEAD -- api/routes/analytics.py`. This puts the file back to commit `a81933a`, which contains the original feature set: `business-report`, `/{platform}/summary`, `PlatformBody`, `SnapshotBody`, `api_secret` masking, `.lower()` normalisation, `upsert_analytics_snapshot(user_id, platform, date, metrics)`, and the original snapshot listing.
2. With the restored file, locate the `_require_user` helper (it will be `def _require_user(authorization: Optional[str]) -> str:` with a sync body calling `decode_token(...)`).
3. Edit only the helper:
   - Change `def _require_user` to `async def _require_user`.
   - Change `payload = decode_token(...)` inside the body to `payload = await decode_token(...)`.
4. Edit every call site in the same file:
   - Every `_require_user(authorization)` becomes `await _require_user(authorization)`.
   - There are roughly half a dozen such sites; grep for `_require_user(authorization)` in the file to enumerate them. Do not miss the one inside `/business-report` or `/{platform}/summary` — both depend on it.
5. Do not introduce any of the redesign elements (no `/growth`, no `/summary`-without-platform, no `/platforms/available`, no `body: dict`, no `save_analytics_snapshot`, no `calculate_analytics_growth`, no `get_analytics_summary`).
6. Do not touch any other file as part of Task C. Frontend, store, tools — all stay as they are at `HEAD`.

**Acceptance check after Task C:**
1. `grep -c "async def _require_user" api/routes/analytics.py` returns `1` (exactly one).
2. `grep -c "business-report\|••••••••\|PlatformBody\|SnapshotBody" api/routes/analytics.py` returns `4` or more (each marker present).
3. `grep -c "save_analytics_snapshot\|calculate_analytics_growth\|get_analytics_summary" api/routes/analytics.py` returns `0`.
4. `python3 -c "import ast; ast.parse(open('api/routes/analytics.py').read())"` exits cleanly.

### Task D — Full-repo sanity sweep

Before reporting back, run all four of these checks. Each must return clean.

1. **AST parse over every Python file in the repo:**
   `find . -name "*.py" -not -path "./.venv/*" -not -path "./.git/*" -not -path "./node_modules/*" -not -path "./frontend/node_modules/*" | while read f; do python3 -c "import ast,sys; ast.parse(open('$f').read())" 2>&1 | grep -q . && echo "FAIL $f"; done` produces no `FAIL` output.

2. **No malformed async forms anywhere:**
   `grep -rn "async def await\|async async def\|def await " --include="*.py" .` returns nothing.

3. **n8n_webhooks Depends import:**
   `grep "from fastapi import" api/routes/n8n_webhooks.py` contains `Depends`.

4. **Untouched safety:** `git diff --stat HEAD` should not list any file outside the 18 route files in §4 plus `api/routes/analytics.py`. (The pre-existing working-tree changes in `api/routes/auth.py`, `api/routes/memory.py`, `api/routes/conversation.py`, `core/family.py`, `core/intent_router.py`, `core/memory_manager.py`, `providers/memory/sqlite_store.py`, `providers/llm/*.py`, `main.py`, `config/settings.py`, `frontend/src/pages/{MemoryPage,SettingsPage}.jsx`, `.gitignore`, `HANDOFF.md`, `README.md`, `api/routes/{commerce,culinary,dashboard,features,inventory,parent,vehicles}.py` are Round 1+2+3 audit work and must remain unchanged from their current state in the working tree.)

---

## 5. Out of scope — under no circumstances

- **Do not commit.** The user runs commits themselves.
- **Do not push.** Same.
- **Do not modify any file not named in this brief.** In particular: do not touch `core/auth.py`, `config/settings.py`, `providers/memory/sqlite_store.py`, `main.py`, the LLM providers, any frontend file, `.env`, or `.env.example`. All of those are correct.
- **Do not delete files.**
- **Do not "improve" any of the helpers** — no logging additions, no error-message rewording, no extra checks. Signature normalisation only.
- **Do not write store methods to satisfy analytics.py's redesign.** Task C undoes the redesign instead.
- **Do not rerun the audit, do not produce a new audit report, do not edit `RIVER_SONG_AUDIT.md` or `RIVER_SONG_SECURITY.md` or `HANDOFF.md`.**

---

## 6. What to report back

After all four acceptance checks pass, output a short summary with exactly these sections:

1. **Files modified** — flat list, one per line.
2. **Helpers fixed** — list of `(file, helper_name, original_form → new_form)`.
3. **Depends import** — confirm where it now appears in `n8n_webhooks.py`.
4. **analytics.py restoration** — confirm by quoting the line number of `business-report`, `PlatformBody`, `SnapshotBody`, and the `••••••••` mask string.
5. **AST sweep result** — paste the exact output of the Task D §1 command (should be empty).
6. **Anything unexpected** — anything you encountered that this brief didn't anticipate, anything that looked wrong but you didn't touch, anything you'd flag for a human reviewer.

Do not commit, do not push, do not produce additional Markdown files. Stop after the report.
