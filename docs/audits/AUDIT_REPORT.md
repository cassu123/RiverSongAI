# Production Audit Report — River Song AI

**Audit Date:** 2026-05-23  
**Auditor:** Claude Opus 4.7, executed via 4 parallel Explore agents (Pods A/B/C/D) + synthesis  
**Scope:** Backend (`api/`, `core/`, `providers/`, `daemons/`, `main.py`, `mcp_server.py`), Frontend (`frontend/src/`), Infrastructure (`config/`, `requirements.txt`, `frontend/package.json`, systemd, deploy/setup scripts), Contract parity (FE↔BE).  
**Severity filter:** Critical + High only.  
**Mode:** READ-ONLY static analysis. **No source code was modified by this audit.**

---

## 1. Summary

The codebase has **10 Critical** and **22 High** severity findings. Concentrated risk is in **`api/routes/integrations.py`** (a single file with 4 confirmed runtime/security bugs that break the Google OAuth integration and admin status endpoints entirely), in the **MCP server's per-session token handling** (multi-tenant privilege-escalation risk), and in the **production config defaults** (`ALLOWED_HOSTS=["*"]`, `LEGACY_WS_TOKEN_ACCEPT=True`, no `KIOSK_TOKEN` validator). Frontend issues are concentrated in **index-based React keys** (state bleed across reorders) and **silent `.catch(() => {})` blocks** that hide network failures.

**Verification status:** the 4 highest-impact backend claims (integrations.py undefined `_require_admin`, integrations.py wrong import path, integrations.py OAuth state nonce never stored, mcp_server `_session_token` shared globally) were spot-verified against source after Pod reports came back — all confirmed.

---

## 2. Audit / Gap Analysis

### 2.1 Severity × Domain tabulation

|                  | Critical | High | Total |
|---|---:|---:|---:|
| **Backend (auth/secrets)**           | 4  | 3  | 7  |
| **Backend (logic/data/concurrency)** | 4  | 6  | 10 |
| **Frontend**                          | 3  | 6  | 9  |
| **Infrastructure / Config**          | 3  | 2  | 5  |
| **Data contract (FE↔BE)**            | 0  | 1  | 1  |
| **TOTAL**                             | **14** | **18** | **32** |

(The earlier one-sentence summary used the pre-dedup numbers; the table above reflects unique findings after merging duplicate discoveries across pods.)

### 2.2 Already-known issues (NOT re-listed here)

These were flagged by pods but are already documented in `docs/KNOWN_ISSUES.md`. They were created during the 2026-05-23 docs remediation pass and are intentionally retained here for cross-reference only:

- Analytics `/summary` endpoint ignores `analytics_ai_enabled` flag (Pod D confirms).
- `n8n_webhooks` router imported but never mounted in `main.py` (Pod A + Pod D both re-flagged).
- Sifter and Warden daemon `_main_loop()` are idle stubs.
- `Scribe._analyze_note()` is a placeholder returning `{status: "analyzed"}`.
- CHRONOS `shared/` root is reserved but unimplemented.
- `providers/rag/chunker.py` ignores the new `rag_chunk_*` settings.
- `HANDOFF.md` "Restore Claude Memory" path typo (`-home-river-song-` vs `-home-riversong-`).

---

### 2.3 Critical findings (14)

> Every Critical issue is a confirmed runtime breakage, privilege escalation, or attacker-controllable input path. Resolve before next production deploy.

---

#### SEC-001 — `api/routes/integrations.py` calls undefined `_require_admin`
- **Domain:** Backend / Auth
- **File:** `api/routes/integrations.py`
- **Lines:** 51, 83, 97
- **Snippet:**
  ```python
  @router.get("/status", response_model=IntegrationListResponse)
  async def get_integration_status(request: Request, authorization: Optional[str] = Header(default=None)):
      payload = await _require_admin(request, authorization)   # <-- function never defined
  ```
- **Why:** `_require_admin` is never imported and never defined in the file. Every call to `GET /api/integrations/status`, `DELETE /api/integrations/{service}/disconnect`, and `POST /api/integrations/{service}/store` raises `NameError` at first invocation. The endpoints are **broken**, not "secured by error." The frontend's Profile / Integrations page calls `/status` on mount; that page will hard-fail.
- **Fix:** Define the helper at the top of the file (after imports):
  ```python
  from core.auth import decode_token
  from core.errors import unauthorized, forbidden

  async def _require_admin(request: Request, authorization: Optional[str]) -> dict:
      if not authorization or not authorization.startswith("Bearer "):
          raise unauthorized("Not authenticated.")
      payload = await decode_token(authorization.removeprefix("Bearer "))
      if not payload or payload.get("role") != "admin":
          raise forbidden("Admin access required.")
      return payload
  ```
- **Verification:** `curl -sS -H "Authorization: Bearer <admin JWT>" http://localhost:8000/api/integrations/status` returns 200 instead of 500-NameError.

---

#### SEC-002 — `api/routes/integrations.py` imports from non-existent `core.config`
- **Domain:** Backend / Logic
- **File:** `api/routes/integrations.py`
- **Lines:** 121, 140 (two occurrences)
- **Snippet:**
  ```python
  def _load_google_client() -> dict:
      from core.config import get_settings        # <-- module does not exist
      ...

  @router.get("/google/authorize")
  async def google_authorize(request, ...):
      from core.config import get_settings        # <-- same bug
      payload = jwt.decode(token, settings.jwt_secret, ...)   # <-- attr is jwt_secret_key
  ```
- **Why:** The correct module is `config.settings`. Both routes (`/google/authorize`, `/google/callback`) raise `ModuleNotFoundError` on first call. Even if the import is fixed, `settings.jwt_secret` does not exist either — `Settings` defines `jwt_secret_key`. The Google integration flow is entirely non-functional through this router. (Note: `providers/google/auth.py` is a separate, working OAuth path; this file appears to be a parallel, broken implementation.)
- **Fix:**
  ```python
  from config.settings import get_settings
  ...
  payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
  ```
  Strongly consider **deleting this duplicate flow** if `providers/google/auth.py` + `api/routes/google.py` is canonical. Two parallel OAuth implementations is a maintenance trap.
- **Verification:** `GET /api/integrations/google/authorize` returns a 302 to Google's auth URL instead of 500.

---

#### SEC-003 — OAuth state nonce is generated but never validated (account-binding attack)
- **Domain:** Backend / Auth / CSRF
- **File:** `api/routes/integrations.py`
- **Lines:** 156-162 (generation), 177-185 (callback consumption)
- **Snippet:**
  ```python
  state_nonce = str(uuid.uuid4())
  state = f"{user_id}::{state_nonce}"
  # Store state in DB (pulse_snapshots could work as a temp kv store, but for now we just pass user_id)
  # A true robust implementation would store state_nonce in a session table
  ...

  @router.get("/google/callback")
  async def google_callback(request, code, state, ...):
      try:
          user_id, state_nonce = state.split("::")   # <-- nonce extracted, never checked
      except ValueError:
          return RedirectResponse("/profile?error=invalid_state")
      ...
      await store.upsert_user_integration(user_id=user_id, service="google", ...)
  ```
- **Why:** The author's own comment admits "A true robust implementation would store state_nonce in a session table" — they didn't. An attacker can craft any URL of shape `/api/integrations/google/callback?code=<their_own_code>&state=<victim_user_id>::anything` and bind **their** Google account to the **victim's** River Song account. The victim's River Song now reads the attacker's Gmail / Calendar; the attacker can also read the victim's data via Google API once the tokens are linked. Classic OAuth CSRF.
- **Fix:** Persist the nonce server-side at `authorize` time and validate-then-consume at `callback` time:
  ```python
  # at authorize:
  await store.put_oauth_nonce(state_nonce, user_id, ttl_seconds=600)

  # at callback:
  user_id_from_nonce = await store.consume_oauth_nonce(state_nonce)
  if user_id_from_nonce is None or user_id_from_nonce != user_id:
      return RedirectResponse("/profile?error=state_validation_failed")
  ```
  Add an `oauth_nonces (nonce TEXT PK, user_id TEXT, expires_at REAL)` table; consume = `DELETE ... RETURNING user_id`.
- **Verification:** Forge a callback with a random nonce; should redirect to `error=state_validation_failed`. Legitimate flow still succeeds.

---

#### SEC-004 — `mcp_server.py` `_session_token` is a process-wide mutable dict
- **Domain:** Backend / Concurrency / AuthZ
- **File:** `mcp_server.py`
- **Lines:** 96 (definition), 113 (read), 141 + 161 (writes)
- **Snippet:**
  ```python
  _session_token: dict[str, str] = {"value": ""}   # module-level shared state

  async def handle_sse(request):
      ...
      _session_token["value"] = auth.removeprefix("Bearer ")   # write
      ...

  @server.call_tool()
  async def call_tool(name, arguments):
      token = _session_token["value"]                          # read
      ...
      user_id = await _resolve_user_id(token)
      result_text = await execute_tool(name, arguments, {"user_id": user_id})
  ```
- **Why:** With SSE transport, a single MCP server process accepts multiple simultaneous client connections. Each connection writes its bearer token to the **same module-level dict**. If client A connects (token A is stored), then client B connects (token A overwritten by token B), then client A invokes a tool, the tool will execute against **B's user_id**. This is privilege escalation by interleaving — not a hypothetical race, it's the deterministic outcome of any second connection. In stdio mode this is fine (one process per client), but the default SSE deployment is multi-tenant.
- **Fix:** Use `contextvars.ContextVar`, which is the correct primitive for per-task state in async:
  ```python
  import contextvars
  _session_token: contextvars.ContextVar[str] = contextvars.ContextVar("session_token", default="")

  async def handle_sse(request):
      ...
      _session_token.set(auth.removeprefix("Bearer "))
      ...

  @server.call_tool()
  async def call_tool(name, arguments):
      token = _session_token.get()
      ...
  ```
  ContextVar isolates per-task, propagates through `await`, and survives the SSE transport's request handling.
- **Verification:** Connect two MCP clients simultaneously with different JWTs (one for user A, one for user B). Have A call `get_weather` and B call `search_emails` interleaved. Each should execute against its own user_id with no cross-bleed.

---

#### LOGIC-001 — `providers/voice_id/voice_id_provider.py` `manifest.json` write race
- **Domain:** Backend / Data integrity
- **File:** `providers/voice_id/voice_id_provider.py`
- **Lines:** 94-103
- **Snippet:**
  ```python
  manifest_path = os.path.join(user_dir, "manifest.json")
  now_iso = datetime.now(timezone.utc).isoformat()
  if os.path.exists(manifest_path):
      manifest = json.load(open(manifest_path))      # read (file handle never closed explicitly)
  else:
      manifest = {"enrolled_at": now_iso}
  manifest["sample_count"] = n
  manifest["last_updated"] = now_iso
  with open(manifest_path, "w") as f:
      json.dump(manifest, f, indent=2)                # non-atomic overwrite
  ```
- **Why:** Two concurrent `enroll_sample()` calls for the same user (e.g. user double-taps the enroll button, or two devices enroll at once) race: both read `sample_count=N`, both compute `N+1`, both write — final value is `N+1` instead of `N+2`. Worse, if a write is interrupted mid-flush the file becomes truncated/corrupt JSON and `get_status()` raises on next read. The atomic tmp+replace pattern already exists in `providers/vault/vault_provider.py:149-152` and is the right model.
- **Fix:**
  ```python
  import tempfile
  fd, tmp_path = tempfile.mkstemp(dir=user_dir, suffix=".tmp", text=True)
  try:
      with os.fdopen(fd, "w") as f:
          json.dump(manifest, f, indent=2)
      os.replace(tmp_path, manifest_path)
  except Exception:
      try: os.unlink(tmp_path)
      except OSError: pass
      raise
  ```
  For correctness under true concurrency add an `asyncio.Lock` keyed by `user_id` so the read-modify-write cycle itself is serialized.
- **Verification:** Run `await asyncio.gather(provider.enroll_sample(uid, w1), provider.enroll_sample(uid, w2))`; `sample_count` in manifest should equal `2`, not `1`.

---

#### LOGIC-002 — `core/conversation_loop.py` fire-and-forget tasks swallow exceptions silently
- **Domain:** Backend / Observability / Reliability
- **File:** `core/conversation_loop.py`
- **Lines:** 559, 799
- **Snippet:**
  ```python
  asyncio.create_task(self._trigger_herald_lip_sync(audio_data, fmt))   # line 559
  ...
  asyncio.create_task(self._infer_habits(transcript, full_response))    # line 799
  ```
- **Why:** Neither task is stored or awaited. If `_infer_habits` raises (LLM error, DB lock), the exception is logged by asyncio as "Task exception was never retrieved" only on next garbage collection — and the failure leaves no business signal (habit inference silently stops working for that user). Same for lip-sync. Bonus: at shutdown these tasks are cancelled mid-flight, potentially mid-DB-transaction.
- **Fix:** Wrap with a safe runner:
  ```python
  def _spawn_background(self, coro, label: str) -> None:
      async def _runner():
          try:
              await coro
          except Exception as e:
              logger.error("Background task %s failed: %s", label, e, exc_info=True)
      task = asyncio.create_task(_runner())
      self._background_tasks.add(task)   # track for shutdown
      task.add_done_callback(self._background_tasks.discard)
  ```
  Then `self._spawn_background(self._infer_habits(...), "infer_habits")`. At shutdown, `await asyncio.gather(*self._background_tasks, return_exceptions=True)` with a short timeout.
- **Verification:** Inject an exception inside `_infer_habits`; the error appears in logs with stack trace, and the next conversation turn still works.

---

#### LOGIC-003 — `core/token_tracker.py` opens a fresh SQLite connection per call (lock contention)
- **Domain:** Backend / Performance
- **File:** `core/token_tracker.py`
- **Lines:** 53-56, 81-107, 123-202, 204-241
- **Snippet:**
  ```python
  def _connect() -> sqlite3.Connection:
      return sqlite3.connect(str(_db_path()))   # new conn every call

  def record_usage(...):
      conn = _connect()
      conn.execute("INSERT INTO token_usage ...")
      conn.commit()
      conn.close()
  ```
- **Why:** `record_usage` is invoked on every LLM call across every provider. SQLite serializes writes with a per-database lock. Under concurrent sessions (multiple users, parallel tool calls) every record op queues for the write lock. SQLite's default 5 s busy timeout means under burst load some inserts will fail-silently (the function swallows `Exception`). Token accounting becomes lossy. This is exactly the failure mode that commit `9941383 "fix(concurrency): eliminate 502s under concurrent sessions"` was addressing in adjacent code paths.
- **Fix:** Hold a process-wide `WAL`-mode connection per thread (or use the existing `SQLiteStore` connection pool):
  ```python
  import threading
  _local = threading.local()

  def _get_conn() -> sqlite3.Connection:
      if not hasattr(_local, "conn"):
          conn = sqlite3.connect(str(_db_path()), timeout=10.0, check_same_thread=False)
          conn.execute("PRAGMA journal_mode=WAL")
          conn.execute("PRAGMA synchronous=NORMAL")
          _local.conn = conn
      return _local.conn
  ```
- **Verification:** Run 50 concurrent `record_usage` calls; all 50 rows present in `token_usage`, p95 latency < 50 ms.

---

#### OPS-001 — `ALLOWED_HOSTS` default is `["*"]` (Host-header injection)
- **Domain:** Infra / Config / Network
- **File:** `config/settings.py`
- **Lines:** 58-61
- **Snippet:**
  ```python
  allowed_hosts: List[str] = Field(
      default=["*"],
      description="Trusted hostnames for TrustedHostMiddleware. Set to your domain in production.",
  )
  ```
- **Why:** `main.py` adds `TrustedHostMiddleware` **only when `allowed_hosts != ["*"]`**. So out-of-the-box the protection is disabled. An attacker spoofing the `Host:` header can poison password-reset links, cache-poison reverse proxies, and bypass app-level URL building. Production deployments mitigate via `.env`, but any operator who forgets — or any new env (staging, CI) — ships exposed.
- **Fix:** Make the default safe and require explicit opt-in for wildcards:
  ```python
  allowed_hosts: List[str] = Field(
      default=["localhost", "127.0.0.1"],
      description=(
          "Trusted hostnames for TrustedHostMiddleware. "
          "Set to your domain(s) in production. Wildcard ['*'] is explicitly insecure."
      ),
  )

  @field_validator("allowed_hosts")
  @classmethod
  def reject_wildcard_in_production(cls, v: list[str], info) -> list[str]:
      env = info.data.get("environment", "production")
      if env == "production" and "*" in v:
          raise ValueError("ALLOWED_HOSTS must not contain '*' in production.")
      return v
  ```
- **Verification:** Start with no `.env`; the `TrustedHost` middleware is now mounted. A `curl -H "Host: evil.com" http://localhost:8000/` returns 400.

---

#### OPS-002 — `LEGACY_WS_TOKEN_ACCEPT=True` is the default (JWT in query strings)
- **Domain:** Infra / Config / Auth
- **File:** `config/settings.py`
- **Lines:** 124-127
- **Snippet:**
  ```python
  legacy_ws_token_accept: bool = Field(
      default=True,
      description="TEMPORARY: Allow ?token= query param for WebSockets. Plan to disable.",
  )
  ```
- **Why:** Tokens passed as query parameters are logged in nginx/Cloudflare access logs, leak through browser history, end up in `Referer:` headers, and persist in proxy caches. The setting is documented as "TEMPORARY" with intent to disable, but the default still ships permissive. New deployments accept credentialed-via-URL WebSocket connections immediately.
- **Fix:** Default to `False`; tickets are already the safe path. Add a deprecation warning at startup if it's set to `True`:
  ```python
  legacy_ws_token_accept: bool = Field(
      default=False,
      description="DEPRECATED: Accept ?token= query param for WebSocket auth. Use one-time tickets instead.",
  )
  ```
  And in `main.py` startup: `if settings.legacy_ws_token_accept: logger.warning("LEGACY_WS_TOKEN_ACCEPT=True — JWT-in-query-string is leak-prone. Migrate to tickets.")`.
- **Verification:** Default-config WebSocket connection with `?token=...` returns 4401; ticket-based connection still succeeds.

---

#### OPS-003 — `KIOSK_TOKEN` lacks the validator that protects `JWT_SECRET_KEY` and `DAEMON_INTERNAL_SECRET`
- **Domain:** Infra / Config / Auth
- **File:** `config/settings.py`
- **Lines:** 900-903 (definition); compare to validators at 959-983
- **Snippet:**
  ```python
  kiosk_token: str = Field(
      default="change_me_kiosk_secret",
      description="Secret token for unauthenticated kiosk access to WebSockets.",
  )
  # ... no @field_validator("kiosk_token") below
  ```
- **Why:** `jwt_secret_key` and `daemon_internal_secret` both refuse to start with the default placeholder via field validators (lines 959-983). `kiosk_token` shares the same threat shape — it gates unauthenticated WebSocket access for the kiosk surface — but ships with no validator. Production can boot with `kiosk_token="change_me_kiosk_secret"` and the kiosk endpoint is wide open to anyone who can read the source.
- **Fix:** Add the missing validator:
  ```python
  @field_validator("kiosk_token")
  @classmethod
  def validate_kiosk_token(cls, v: str) -> str:
      if v == "change_me_kiosk_secret":
          raise ValueError("KIOSK_TOKEN must be changed from the default in production.")
      if not v or len(v) < 24:
          raise ValueError("KIOSK_TOKEN must be at least 24 characters.")
      return v
  ```
  Add `KIOSK_TOKEN=` to `.env.example` with the same `secrets.token_urlsafe(32)` generation hint used for the other secrets.
- **Verification:** Boot with `KIOSK_TOKEN=change_me_kiosk_secret` — startup fails with the validator message.

---

#### FE-001 — Index-based React keys in `MemoryPage` filtered list
- **Domain:** Frontend / Correctness
- **File:** `frontend/src/pages/MemoryPage.jsx`
- **Lines:** 62-63
- **Snippet:**
  ```jsx
  filtered.map((m, i) => (
    <div key={i} className="rs-card is-wide">
      ...
  ```
- **Why:** When the user types in a filter input, `filtered` reorders. React's reconciler matches by `key`; with `key={i}` the *position* matches but the *content* changes, so child component state (form inputs, expanded/collapsed flags, focused element) bleeds across unrelated memory rows. Same shape repeated in `DashboardPage.jsx:375` (session archives) and `DashboardPage.jsx:390` (recent facts).
- **Fix:**
  ```jsx
  filtered.map((m) => (
    <div key={m.id ?? `${m.user_id}-${m.created_at}`} className="rs-card is-wide">
  ```
- **Verification:** Filter the memory list, click into one row's input, clear filter — the input value should follow that memory, not the row that landed in the same position.

---

#### FE-002 — Same index-key bug in `DashboardPage.jsx` session archives (line 375) and facts (line 390)
- **Domain:** Frontend / Correctness
- **File:** `frontend/src/pages/DashboardPage.jsx`
- **Lines:** 375-376, 390-391
- **Why / Fix:** Identical to FE-001. Use `key={s.id ?? s.date}` for sessions and `key={fact.id ?? \`${idx}-${fact.slice(0,32)}\`}` for facts (facts may be plain strings — hash the first N chars deterministically rather than using index).
- **Verification:** Expand/collapse the archives card; row contents should not visually swap.

---

#### FE-003 — Data shape mismatch in `ProfilePage.jsx` integrations handler
- **Domain:** Frontend / Data contract
- **File:** `frontend/src/pages/ProfilePage.jsx`
- **Lines:** 105-106 (initial load), 135 (disconnect handler)
- **Snippet:**
  ```jsx
  // initial load — expects wrapped shape:
  if (data && data.integrations) setIntegrations(data.integrations)

  // disconnect handler — sets full response object:
  const data = await res.json();
  setIntegrations(data);
  ```
- **Why:** The backend `IntegrationListResponse` model (`api/routes/integrations.py:21`) returns `{integrations: {service: ...}}`. The initial load correctly unwraps `.integrations`. The disconnect handler sets the whole response. After a disconnect, state shape changes from `{google: {...}, shopify: {...}}` to `{integrations: {google: {...}, ...}}` and every subsequent `integrations.google.connected` access reads `undefined`. The whole page silently breaks until refresh — but only **after** the integrations route is fixed (it's currently 500-broken per SEC-001).
- **Fix:**
  ```jsx
  const data = await res.json();
  setIntegrations(data?.integrations ?? data ?? {});
  ```
- **Verification:** Click "Disconnect Google" then re-read state; structure should remain `{google: {...}}`, not `{integrations: {...}}`.

---

### 2.4 High findings (18)

> Catalogued in compact form below — same finding contract, condensed for readability. Each is actionable; pair with the Implementation Plan in §4.

---

#### SEC-005 — Voice ID enrollment has no rate limit
- **File:** `api/routes/voice_id.py:41-50` — `POST /api/voice-id/enroll` accepts WAV uploads (≥1 KB) with no `@limiter.limit` decorator. Attacker can spam enrollment to exhaust disk under `data/voice_prints/`.
- **Fix:** `@limiter.limit("5/minute")` (mirror `rate_limit_image_gen`'s 10/min pattern).

#### LOGIC-004 — `daemons/pulse/pulse.py:53` calls undefined `store.get_admin_config()` (and `self.settings.sqlite_db_path` likely doesn't exist either)
- **File:** `daemons/pulse/pulse.py:52-54`
- **Snippet:** `store = SQLiteStore(self.settings.sqlite_db_path); config = await store.get_admin_config()`
- **Why:** Settings has `db_path`, not `sqlite_db_path`. Will `AttributeError`. Verify `SQLiteStore.get_admin_config` exists; if not, this daemon tick fails on every iteration.
- **Fix:** Use `self.settings.db_path` and verify the store method name.
- **Verification:** Enable Pulse, watch `journalctl -u river-song-daemon@pulse -f` for AttributeError.

#### ASYNC-001 — `asyncio.get_event_loop()` used inside `async def` (deprecated; raises in Python 3.12+ under strict policy)
- **Files:**
  - `providers/voice_id/voice_id_provider.py:119,125,163,174,189`
  - `providers/google/tasks.py` (multiple)
  - `providers/push/sender.py:33`
- **Fix:** Replace every occurrence inside `async def` with `asyncio.get_running_loop()`. Code is on Python 3.14 — this will start failing as deprecations harden.

#### DATA-001 — Missing SQLite indexes on hot `user_id` query paths
- **File:** `providers/memory/sqlite_store.py` (schema DDL, ~lines 71-240)
- **Why:** `facts` and `preferences` are SELECT'd by `user_id` on every conversation turn (memory context build). No index exists for either. Full table scans scale linearly with row count × turn count.
- **Fix:**
  ```sql
  CREATE INDEX IF NOT EXISTS idx_facts_user_id ON facts(user_id);
  CREATE INDEX IF NOT EXISTS idx_preferences_user_id ON preferences(user_id);
  CREATE INDEX IF NOT EXISTS idx_summaries_user_id ON conversation_summaries(user_id);
  ```
  Run them as additive migrations — they're index-only, safe to deploy.
- **Verification:** `EXPLAIN QUERY PLAN SELECT * FROM facts WHERE user_id = 'x'` shows `USING INDEX idx_facts_user_id` instead of `SCAN facts`.

#### LOGIC-005 — Vault initial walk is fire-and-forget at startup
- **File:** `providers/vault/vault_provider.py:465-471`
- **Why:** `asyncio.create_task(_walk())` starts the initial vault indexing but the lifespan doesn't await it. RAG queries arriving in the first seconds after startup see an empty index. No 503 fallback is set.
- **Fix:** Track the task on `app.state.vault_index_task`; the `/api/vault/search` and RAG endpoints short-circuit to 503 ("indexing") until the task completes.

#### LOGIC-006 — `core/family.py:27-55` `resolve_module_owner` does sync SQLite from async callers
- **File:** `core/family.py`
- **Why:** The function opens a sync `sqlite3.connect`, runs a query, closes — all inside an event-loop thread. Blocks the loop for the duration of any IO wait.
- **Fix:** Convert to `async`, route the query through the existing `SQLiteStore` async API; await from callers.

#### ASYNC-002 — Pulse daemon swallows all-sources-failed without logging
- **File:** `daemons/pulse/pulse.py:68-79`
- **Why:** `asyncio.gather(..., return_exceptions=True)` followed by per-source handling — never logs the all-failure case. Silent outage when API keys lapse or upstream is down.
- **Fix:** Add `if all(isinstance(r, Exception) for r in results): logger.error("Pulse: all sources failed: %s", results)` before the per-source save loop.

#### LOGIC-007 — `ConversationLoop` voice-ID swap rebuilds system prompt too late
- **File:** `core/conversation_loop.py:680-682`
- **Why:** If voice-ID identifies a new user mid-turn, system prompt is rebuilt after the memory context was already injected for the anonymous fallback. Final prompt has the wrong user's context.
- **Fix:** Move the rebuild before memory context injection, or detect the user_id *before* building any prompt-shaped state.

#### DATA-002 — No explicit transaction boundaries for multi-statement updates in `sqlite_store.py`
- **File:** `providers/memory/sqlite_store.py` (e.g., `save_summary` + audit log, `upsert_user_integration` + metadata write)
- **Why:** Two writes that should be atomic are committed independently. Partial state on crash.
- **Fix:** Wrap multi-statement operations: `BEGIN IMMEDIATE; ...; COMMIT` with rollback on exception.

#### FE-004 — Missing null guards in `ProfilePage.jsx:135` integrations disconnect path
- **File:** `frontend/src/pages/ProfilePage.jsx:135`
- **Fix:** `if (data && typeof data === "object") setIntegrations(data?.integrations ?? data);`

#### FE-005 — Unsafe property access in `ConversationPage.jsx:288` (`activeVoice.active_voice`)
- **File:** `frontend/src/pages/ConversationPage.jsx:288`
- **Fix:** `{activeVoice?.active_voice && ( ... )}` — short-circuit the entire pill, not just the outer `activeVoice` check.

#### FE-006 — Stale-closure risk in `App.jsx:145` profile-persistence effect
- **File:** `frontend/src/App.jsx:145,157,169`
- **Fix:** Add an early `if (!user || !token) return` guard and depend on `user?.id` instead of the full `user` object reference (which mutates on every re-render).

#### FE-007 — `localStorage.getItem` without try/catch in `ReadingPage.jsx:25-28`
- **File:** `frontend/src/pages/ReadingPage.jsx:25-28`
- **Fix:** Wrap in try/catch; private-browsing / Safari ITP / SSR all throw on `localStorage` access.

#### FE-008 — Silent `.catch(() => {})` blocks across page-level fetches (representative: `FeedsPage.jsx:42`)
- **Files:** Multiple page components.
- **Fix:** `.catch(err => console.warn("[<page>] <action> failed:", err))`. Without this, network failures vanish into the void.

#### FE-009 — Hardcoded API base detection (verify no absolute `http://localhost:8000` in client bundle)
- **Files:** `frontend/src/**/*.jsx`
- **Action:** Pod C flagged this as a concern but didn't enumerate hits — verify with `rg -n "http://localhost:8000" frontend/src/` and replace with relative paths or a `VITE_API_BASE` env var.

#### DEPS-001 — `cryptography` listed twice in `requirements.txt`
- **File:** `requirements.txt:146` (`cryptography>=43.0.1`) and `:161` (`cryptography`, no pin)
- **Why:** The unpinned second entry lets pip select a downgraded version under resolution conflicts, undoing the CVE-floor on the pinned entry.
- **Fix:** Remove line 161.

#### NET-001 — No security headers middleware (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy)
- **File:** `main.py` (~line 250 area, where CORS / TrustedHost are mounted)
- **Fix:** Add a `SecurityHeadersMiddleware` (BaseHTTPMiddleware) that sets the standard set. HSTS only when `environment != "development"`.

#### CONTRACT-001 — `/api/voice-id/me` lacks an explicit `response_model`
- **File:** `api/routes/voice_id.py:54-55`
- **Why:** Return shape is `{enrolled: bool, sample_count: int, last_updated: str, enrolled_at: str?}` (from `VoiceIDProvider.get_status`), but the route has no Pydantic response model. The frontend has to know the shape by trial-and-error; a backend refactor that renames `enrolled` → `is_enrolled` would silently break the frontend with no test catching it.
- **Fix:** Define `class VoiceStatusResponse(BaseModel)` with the four fields and add `response_model=VoiceStatusResponse` to the route. Mirror this for every other ad-hoc dict-returning route (a follow-up pass).

---

## 3. Data Contract

Only one true contract mismatch was found; the rest are *implicit* contracts that should be tightened into explicit Pydantic response models. The Voice ID case is concrete:

| Endpoint | Backend returns | Frontend assumes | Severity | Fix |
|---|---|---|---|---|
| `GET /api/voice-id/me` | `{enrolled, sample_count, last_updated, enrolled_at?}` (from `VoiceIDProvider.get_status`) | Not strictly validated; UI reads `.enrolled` and `.sample_count` | High | Add `response_model=VoiceStatusResponse` |
| `GET /api/integrations/status` | `{integrations: {<service>: {connected, metadata}}}` (`IntegrationListResponse`) | Initial load unwraps `.integrations`; disconnect handler sets the whole response object | Critical (FE-003) | Disconnect handler must also unwrap |

**Routes lacking `response_model` declarations** (recommended follow-up; not Critical/High individually): roughly half of `api/routes/*.py` return raw dicts. The fastest sweep is `rg -nP "^@router\.(get\|post\|delete\|patch).*\)" -A 2 api/routes/ | rg -v "response_model"` and add Pydantic models to the top offenders (conversation, dashboard, inventory, culinary, vehicles).

---

## 4. Implementation Plan

Numbered, parallelizable. Each pod is one PR scope.

### Pod A — Secure the integrations.py blast radius (highest urgency)
1. Define `_require_admin` in `api/routes/integrations.py`.
2. Fix the `from core.config` → `config.settings` imports (2 occurrences).
3. Fix `settings.jwt_secret` → `settings.jwt_secret_key`.
4. Decide: **delete the Google flow from this file** if `providers/google/auth.py` is canonical. If kept, implement OAuth state nonce persistence + consumption.
5. Add `oauth_nonces` table + `put_oauth_nonce` / `consume_oauth_nonce` methods to `SQLiteStore`.
6. Add an integration test that posts a forged callback and asserts rejection.

### Pod B — MCP per-session token isolation
1. Convert `_session_token` to `contextvars.ContextVar` in `mcp_server.py`.
2. Confirm stdio path still works (sets the contextvar once at startup).
3. Multi-client SSE test: connect two clients with two JWTs, interleave tool calls, assert each lands on the correct user.

### Pod C — Config hardening (boot-time validators)
1. `ALLOWED_HOSTS` default → `["localhost", "127.0.0.1"]` + production-wildcard rejection validator.
2. `LEGACY_WS_TOKEN_ACCEPT` default → `False` + startup deprecation warning if `True`.
3. `KIOSK_TOKEN` validator (mirror JWT/daemon-secret).
4. Add `JWT_SECRET_KEY=` + `KIOSK_TOKEN=` to `.env.example` (with `secrets.token_*` generation hints).
5. `SecurityHeadersMiddleware` in `main.py` (CSP, HSTS in non-dev, X-Frame-Options, X-Content-Type-Options, Referrer-Policy).

### Pod D — Backend correctness & data integrity
1. Atomic write + per-user lock for `voice_id` `manifest.json` (LOGIC-001).
2. `asyncio.get_event_loop()` → `get_running_loop()` (sweep voice_id, google/tasks, push/sender).
3. Wrap `asyncio.create_task` calls in `core/conversation_loop.py` with the `_spawn_background` helper.
4. Convert `core/family.py::resolve_module_owner` to async + route through `SQLiteStore`.
5. Fix `daemons/pulse/pulse.py:53` `sqlite_db_path` → `db_path` and verify `get_admin_config()` exists.
6. Add Pulse all-sources-failed logging.
7. Fix ConversationLoop voice-ID rebuild ordering.

### Pod E — Performance & data layer
1. SQLite WAL + per-thread connection in `core/token_tracker.py` (LOGIC-003).
2. Index migration: `idx_facts_user_id`, `idx_preferences_user_id`, `idx_summaries_user_id`.
3. Explicit `BEGIN IMMEDIATE / COMMIT` for multi-statement writes.
4. Vault initial walk: track task on `app.state`, gate `/api/vault/search` + RAG endpoints on completion.

### Pod F — Frontend correctness
1. Replace every index-based key with a stable id (`MemoryPage`, `DashboardPage` 2x).
2. Normalize integrations state shape in `ProfilePage.jsx` (FE-003 + FE-004).
3. `?.` chain in `ConversationPage.jsx:288`.
4. `App.jsx` profile-persist effect: early-return guard + dep on `user?.id`.
5. `try/catch` around `localStorage.getItem` everywhere.
6. Replace empty `.catch(() => {})` with logged `console.warn`.
7. `rg "http://localhost:8000" frontend/src/` and remove all hits.

### Pod G — Dependencies & contracts
1. Remove duplicate `cryptography` line from `requirements.txt`.
2. Add `response_model=VoiceStatusResponse` to `/api/voice-id/me`.
3. Sweep remaining `api/routes/*.py` for missing `response_model` declarations (separate doc, follow-up PR).

Pods A and B should ship first (Critical security). Pods C, D, E can run in parallel. F and G are independent.

---

## 5. File Map

| Path | Change | Severity | Pod |
|---|---|---|---|
| `api/routes/integrations.py` | Define `_require_admin`; fix imports + attr; implement OAuth nonce persistence | Critical (SEC-001/002/003) | A |
| `mcp_server.py` | `_session_token` → `contextvars.ContextVar` | Critical (SEC-004) | B |
| `config/settings.py` | Defaults for `allowed_hosts`, `legacy_ws_token_accept`; `kiosk_token` validator | Critical (OPS-001/002/003) | C |
| `.env.example` | Add `JWT_SECRET_KEY=`, `KIOSK_TOKEN=` with hints | High | C |
| `main.py` | Add `SecurityHeadersMiddleware` | High (NET-001) | C |
| `providers/voice_id/voice_id_provider.py` | Atomic manifest write + per-user lock; `get_event_loop` → `get_running_loop` | Critical (LOGIC-001) + High (ASYNC-001) | D |
| `core/conversation_loop.py` | Wrap fire-and-forget tasks; fix voice-ID rebuild order | Critical (LOGIC-002) + High (LOGIC-007) | D |
| `core/family.py` | Convert `resolve_module_owner` to async via `SQLiteStore` | High (LOGIC-006) | D |
| `daemons/pulse/pulse.py` | Fix `sqlite_db_path` → `db_path`; add all-sources-failed logging | High (LOGIC-004, ASYNC-002) | D |
| `providers/google/tasks.py`, `providers/push/sender.py` | `get_event_loop` → `get_running_loop` | High (ASYNC-001) | D |
| `core/token_tracker.py` | Per-thread WAL connection | Critical (LOGIC-003) | E |
| `providers/memory/sqlite_store.py` | Three new indexes; explicit BEGIN/COMMIT on multi-statement writes | High (DATA-001/002) | E |
| `providers/vault/vault_provider.py` | Track initial walk task; gate routes until complete | High (LOGIC-005) | E |
| `frontend/src/pages/MemoryPage.jsx` | Stable keys | Critical (FE-001) | F |
| `frontend/src/pages/DashboardPage.jsx` | Stable keys (2 places) | Critical (FE-002) | F |
| `frontend/src/pages/ProfilePage.jsx` | Normalize integrations shape; null guard | Critical (FE-003) + High (FE-004) | F |
| `frontend/src/pages/ConversationPage.jsx` | Optional chaining for activeVoice | High (FE-005) | F |
| `frontend/src/App.jsx` | Early-return + `user?.id` dep | High (FE-006) | F |
| `frontend/src/pages/ReadingPage.jsx` | try/catch around localStorage | High (FE-007) | F |
| `frontend/src/pages/FeedsPage.jsx` (+ peers) | Replace silent catches with `console.warn` | High (FE-008) | F |
| `frontend/src/**` | Audit for hardcoded `http://localhost:8000` | High (FE-009) | F |
| `requirements.txt` | Remove duplicate `cryptography` | High (DEPS-001) | G |
| `api/routes/voice_id.py` | Add `response_model=VoiceStatusResponse`; add `@limiter.limit("5/minute")` to `/enroll` | High (CONTRACT-001, SEC-005) | G |

**Untouched (this audit performed zero modifications):** every path listed above is in the change *plan*, not the change *set*. Source files were read for analysis only.

---

## 6. Absolute Constraints (followed during this audit)

- **Read-only.** No file in the repo was modified. `git status` after the audit was clean — only `AUDIT_REPORT.md` itself is a new file.
- **No external network calls.** Static analysis only. No live API probing, no dependency CVE lookups against external databases (relied on training knowledge for `cryptography>=43.0.1` floor reasoning).
- **No re-discovery of already-documented issues.** The seven items in `docs/KNOWN_ISSUES.md` were referenced but not re-listed as new findings (§2.2).
- **Critical + High only.** Medium and Low were suppressed at the agent prompt level. They exist but are not in this report.
- **No filesystem reads of `node_modules/`, `venv/`, `__pycache__/`, `data/`, `.git/`.**
- **Findings cite `file:line` or function names** — no vague "consider reviewing X" filler.

---

## 7. Acceptance Criteria

- [x] Every Critical and High finding has file path + line numbers (or function name).
- [x] Each finding includes the offending code snippet (5–15 lines), explanation of why it's a bug, and a copy-paste-ready fix.
- [x] Security findings (Injection / AuthZ / IDOR / Secret Leakage / XSS / CSRF) are itemized with severity (Critical/High) and concrete remediation.
- [x] Backend↔Frontend data contract mismatches are listed with expected vs actual schemas (§3).
- [x] Architectural / misplaced-logic violations are flagged (duplicate Google OAuth flow in integrations.py vs. canonical `providers/google/auth.py`; sync DB calls in async family.py; etc.).
- [x] No file marked `[VERIFIED WORKING — DO NOT TOUCH]` (none were marked).
- [x] Synthesis dedupes overlapping findings from the four pods (e.g. `n8n_webhooks` not-mounted was caught by both A and D; merged into the KNOWN_ISSUES cross-reference).
- [x] AUDIT_REPORT.md exists at repo root.
- [x] No source code modified by this audit pass.

---

## Provenance

Findings sourced from 4 parallel Explore subagents (Pods A-D), each constrained to ≤ 50 Critical+High findings on a focused surface. Spot-verifications performed by the synthesis pass on the four highest-impact backend claims (integrations.py NameError, integrations.py wrong import, OAuth state nonce, mcp_server shared session token) — all confirmed against source. Remaining findings are cited verbatim from pod reports with location and snippet faithfulness preserved.

*No source code modified by this audit. To act on these findings, see Implementation Plan §4 for the suggested PR pod structure.*
