# RiverSongAI — Full Code Review (June 2026)

A prioritized review of the whole repo: backend security, backend code quality, and frontend.
Work top-to-bottom — items are ordered by impact. Each item lists the file(s) so you can
ask Claude to "fix item N in CODE_REVIEW.md" in a future session.

**Overall verdict:** The fundamentals are good. Parameterized SQL throughout, JWT auth with
expiry, no disabled TLS verification, secrets properly gitignored, no XSS sinks in the React
frontend. The biggest risks are one critical config bug, a few security hardening gaps, and a
lot of repo clutter that makes the project harder to maintain than it needs to be.

---

## 🔴 Priority 1 — Fix now (production-impacting)

### 1. CRITICAL: Token encryption key is regenerated on every restart
- **File:** `api/routes/integrations.py:91-99`
- If `TOKEN_ENCRYPTION_KEY` is not set in `.env`, the server silently generates a new random
  key at startup. Every Google/Shopify/Amazon/Walmart token encrypted with the old key becomes
  **permanently unreadable** after a restart — integrations silently break.
- **Fix:** Make it a required setting in `config/settings.py` (like `jwt_secret_key`), add it
  to `.env.example` with generation instructions
  (`python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`),
  and remove the auto-generate fallback. **On the production server, set this key in `.env`
  immediately** — then re-link any integrations that are already broken.

### 2. HIGH: WebSocket tokens accepted in the URL query string
- **Files:** `config/settings.py:131-139`, `api/routes/conversation.py:103-113`
- `legacy_ws_token_accept=True` lets JWTs ride in `?token=...`, which leaks them into access
  logs, browser history, and Referer headers. The code already has the secure alternative
  (one-time `/api/auth/ws-ticket` exchange).
- **Fix:** Confirm all clients use the ticket flow, then set `legacy_ws_token_accept=False`
  in production.

---

## 🟠 Priority 2 — Security hardening (do soon)

### 3. Dynamic SQL column-name interpolation (risky pattern, currently allowlisted)
- **Files:** `api/routes/vector_fleet.py:884, 971, 1052`; `providers/memory/sqlite_store.py:4114-4163`
- `", ".join(f"{k}=?" for k in updates)` builds column names from request bodies. Today an
  allowlist protects it, but the pattern breaks the moment someone extends the allowlist
  carelessly.
- **Fix:** Map request keys to hardcoded column names explicitly instead of interpolating keys.

### 4. CORS is broader than needed
- **File:** `main.py:300-301`
- `allow_credentials=True` combined with `allow_methods=["*"]` and `allow_headers=["*"]`.
  Origins are validated (good), but tighten methods/headers to what the app actually uses.

### 5. Auth tokens in localStorage (frontend)
- **Files:** `frontend/src/context/AuthContext.jsx:63,83,101,128,153`,
  `frontend/src/pages/ReadingOAuthCallbackPage.jsx:15,17`
- Any XSS bug becomes full account takeover because tokens are readable by JS. Long-term fix
  is httpOnly cookie sessions; short-term, at least clear the OAuth callback values after use
  and move the admin impersonation backup token to sessionStorage.

### 6. `subprocess` via shell for backups
- **File:** `api/routes/health.py:268-271`
- `create_subprocess_shell("./deploy.sh --backup")` — hardcoded today, so safe, but switch to
  `create_subprocess_exec("./deploy.sh", "--backup")` so it never becomes injectable.

### 7. Vault should reject symlinks
- **File:** `providers/vault/vault_provider.py:87-91`
- Path traversal is handled, but a symlink created inside a user vault could point at another
  user's files. Add `if target.is_symlink(): raise PermissionError(...)`.

### 8. Upload filename sanitization is incomplete
- **File:** `vehicles/management.py:1414`
- `basename(...).replace("..", "")` misses edge cases. Use an explicit character allowlist
  (alphanumerics plus `._-`).

### 9. Disable production source maps (frontend)
- **File:** `frontend/vite.config.js`
- Add `build: { sourcemap: false }` so the production bundle doesn't ship readable source.

### 10. Defense-in-depth on `/setup`
- **File:** `api/routes/auth.py:73`
- Admin bootstrap endpoint has no rate limit. It's gated by `has_admin()` so risk is low, but
  add a rate limit anyway.

---

## 🟡 Priority 3 — Bugs & debugging blockers

### 11. Bare `except:` in the vector discovery daemon
- **File:** `daemons/vector_discovery/listener.py:44`
- Swallows everything including `KeyboardInterrupt`, so the daemon can refuse to shut down and
  hides real errors. Catch specific exceptions and log them.

### 12. Silent `except Exception: pass` blocks
- **Files:** `mcp_server.py:81-82, 189-190`; `providers/web/playwright_browser.py` (3 places)
- These hide auth and browser failures — the #1 reason debugging this project is hard.
  Minimum fix: `logger.warning("...", exc_info=True)` before any `pass`.

### 13. Frontend fetches swallow errors the same way
- **Files:** `frontend/src/App.jsx:230,241,252,271`, `frontend/src/pages/ReadingPage.jsx:67-68`,
  `frontend/src/components/ChatInterface.jsx:103-126`
- Empty `.catch(() => {})` everywhere, plus `.then(r => r.json())` without checking `r.ok`
  (`frontend/src/pages/SettingsPage.jsx:456-462`). When the backend errors, the UI just goes
  quiet. Add a small shared `apiFetch()` helper that checks `res.ok` and logs failures, then
  migrate call sites to it.

### 14. Awkward `asyncio.gather` usage
- **File:** `providers/feeds/sports.py:333-342`
- Gathers are created on one line and awaited later — works, but error-prone. Await directly.

### 15. Subprocess leak on failed startup
- **File:** `providers/image/sd_provider.py:74-79`
- `Popen` in `_ensure_running()` isn't cleaned up if startup throws. Wrap in try/except and
  kill the child on failure.

### 16. Mutable default in SQLAlchemy model
- **File:** `vehicles/models.py` (field with `default=[]`)
- Use a callable: `default=list`.

### 17. Tests can't run from a clean checkout
- `tests/` has 19 test files (~3k LOC) but `pytest`/`pytest-asyncio` aren't in
  `requirements.txt`, and some scripts import `from main import app` without a `conftest.py`.
- **Fix:** Add `pytest` + `pytest-asyncio` to a `requirements-dev.txt`, add `tests/conftest.py`
  with an app fixture.

---

## 🟢 Priority 4 — Cleanup (easy wins, big readability payoff)

### 18. Delete dead one-off scripts at the repo root
- `fix_loop.py`, `fix_flake8.py`, `fix_tools.py`, `fix_base.py`, `fix_trivial2.py`,
  `cleanup_script.py`, `auto_ignore.py` — one-time refactoring scripts that already ran.
- Also move or delete: `test_local.py`, `test_zones.py`, `verify_gates.py`, `verify_gate_9.py`
  (belong in `tests/` as real pytest tests, or gone).

### 19. Consolidate duplicate/confusing directories
- `PASSOFF/` vs `passoff/` (keep one), `culinary/` vs `providers/culinary/`,
  `inventory/` vs `providers/inventory/`, plus `commercial_inventory/` and `scratch/`.
  Decide on one home per domain and document the layout in README.

### 20. Split the god-files
Largest offenders — split incrementally, one at a time:
- `providers/memory/sqlite_store.py` — **4,197 lines** (facts, prefs, vectors, telemetry,
  sessions, schedules all in one class)
- `frontend/src/pages/SettingsPage.jsx` — **3,725 lines**
- `api/routes/culinary.py` — **2,854 lines** (move logic into a service module)
- `frontend/src/chrome/Stage.jsx` — ~1,900 lines
- `config/settings.py` — 1,447 lines; `vehicles/management.py` — 1,426; `core/tools.py` — 1,366

### 21. requirements.txt tidy-up
- Duplicate `pydantic` entry (lines 25-26) — keep `pydantic[email]==2.13.2` once.
- Pin loose deps (`zeroconf`, `croniter`, `resemblyzer>=`, `fastapi>=`) to exact versions so
  the nightly auto-deploy can't pull a breaking release at 3am.

### 22. Frontend housekeeping
- React.lazy() the big pages so initial load is lighter.
- Add `AbortController` to page-level fetches (`frontend/src/pages/DocumentsPage.jsx:35-46`)
  to stop state updates after unmount.
- Add `rehype-sanitize` to `RsMarkdown.jsx` as belt-and-suspenders for rendered markdown.

---

## What's already good ✅

- No hardcoded secrets in git (only `.env.example` and a public URL in `frontend/.env.production`)
- SQL is parameterized everywhere; no classic injection found
- JWT: 24h expiry, no `algorithm: none` risk
- No `verify=False` / disabled TLS anywhere
- No `eval`, `new Function`, or `dangerouslySetInnerHTML` in the frontend
- WebSocket same-origin check in place; secure ws-ticket flow already built
- `.gitignore` correctly covers `.env`, `data/`, Google client secrets

---

## Suggested order of work (one session each)

1. **Session A (urgent):** Items 1-2 — encryption key + WS token. Small diffs, big risk reduction.
2. **Session B:** Items 11-13 — replace silent error-swallowing with logging (makes every later
   debugging session easier).
3. **Session C:** Items 18-19, 21 — delete dead scripts, consolidate dirs, pin deps.
4. **Session D:** Items 3-10 — security hardening batch.
5. **Session E+:** Item 20 — split god-files one at a time, starting with `sqlite_store.py`.
6. **Session F:** Item 17 — get the test suite runnable, then add tests as you refactor.
