# Admin settings — audit and remediation plan

Audit of the settings surface on `main` at `1b77551`. Every count below was
measured, not estimated; the commands are given so they can be re-run.

---

## Verdict

The plumbing is sound. All 58 settings and admin endpoints have a frontend
caller, and all 39 `/api/` paths the settings UI calls resolve to a real route.
There are no dead endpoints and no broken calls.

The problems are structural, and there are two:

1. **The feature model is split in two, and the halves do not talk to each
   other.** This is the direct cause of "Remote Ollama, Webhook Tokens and SLAE
   don't work."
2. **Reads fail silently.** A settings panel that failed to load is
   indistinguishable from one that is switched off.

---

## Finding 1 — Two disconnected feature systems (root cause)

There are two independent notions of "is this feature on", and nothing joins
them:

| System | Stored in | Managed by | Controls |
|---|---|---|---|
| `hidden_features` | admin config in the DB | **UI** — `AdminFeatureSection` → `PUT /api/admin/feature-visibility` | whether a page appears in the nav |
| `*_enabled` | `config/settings.py`, read from `.env` | **`.env` only** — no UI anywhere | whether the capability actually functions |

An admin can un-hide a page from the menu but has no way to turn on the feature
behind it. The page appears, loads, and renders a "feature off" notice — with
nothing anywhere naming the switch that would fix it.

That is exactly what Remote Ollama, Webhook Tokens and SLAE do today:

```
remote_ollama_enabled   default False   "Off by default per anti-regression guardrail"
webhook_tokens_enabled  default False   "Off by default per anti-regression guardrail"
```

Both defaults are deliberate. The defect is that there is no supported way to
change them from inside the product, and until recently neither appeared in
`.env.example` either.

(SLAE is a third case and not a flag at all: `api/routes/slae.py:89` gates on
`langfuse_enabled` **and** a live Graphiti provider, so it needs those services
configured, not a toggle.)

## Finding 2 — 42 of 47 capability flags have no UI; 21 are undocumented

```bash
grep -oE '^\s+[a-z_]+_enabled' config/settings.py | tr -d ' ' | sort -u   # 47
grep -rhoE '[a-z_]+_enabled' frontend/src/pages/settings/*.jsx \
     frontend/src/pages/SettingsPage.jsx | sort -u                        # 15
```

Of 239 settings fields and 47 `*_enabled` flags, **5 are reachable from the
settings UI**. Twenty-one are absent from `.env.example` as well, making them
discoverable only by reading `config/settings.py`.

The consequential ones:

| Flag | Why it matters |
|---|---|
| `CSRF_PROTECTION_ENABLED` | A security control that can be switched off with no record of it in the UI or the sample env |
| `NVIDIA_NIM_ENABLED` | The intended free cloud-inference path; currently undiscoverable |
| `SKILLS_ENABLED`, `RAG_ENABLED`, `DOCUMENTS_ENABLED` | Whole feature areas with pages already built |
| `DEEP_RESEARCH_ENABLED`, `IMAGE_GENERATION_ENABLED` | Ditto |
| `WAKE_WORD_ENABLED` | There is an `AdminWakeWordSection` for *configuring* wake word, but not for enabling it |
| `DAEMON_PULSE_ENABLED`, `MECHANIC_ENABLED`, `SIFTER_ENABLED`, `WARDEN_ENABLED` | Daemon toggles that `DaemonControlSection` cannot reach |

`AdminWakeWordSection` and `DaemonControlSection` are the sharpest cases: both
exist, both are wired, and both configure a subsystem whose master switch they
cannot see.

## Finding 3 — Reads fail silently (15 sites)

`SettingsPage.jsx` contains **15** swallowing catches:

```js
fetch(`${API_BASE}/api/admin/model-visibility`, { headers })
  .then(r => r.json())
  .catch(() => null)        // <- a 500 is now indistinguishable from "no data"
```

Writes are handled properly — 9 write requests against 14 `res.ok` checks, and
there is a save-status toast at line 577. Reads have no equivalent. There is no
error state, no retry, and no distinction between:

- the endpoint returned "off"
- the endpoint 500'd
- the admin's token expired
- the feature flag is off so the route 404s

All four render an empty or default-looking panel. **On an admin page this is
worse than a crash**: an operator reads a toggle as "off", believes the system
is in that state, and it is not. Every incorrect belief about production
security posture starts this way.

## Finding 4 — `AdminFamilySection.jsx` is orphaned

127 lines, imported nowhere:

```bash
grep -rn "AdminFamilySection" frontend/src --include=*.jsx   # only its own file
```

It appears to be superseded by `FamilyGroupsSection` and
`ParentChildrenSection`, both of which are imported and rendered. Dead code that
looks live — a future reader cannot tell it is unreachable without grepping.

## Finding 5 — `SettingsPage.jsx` is 1009 lines rendering 22 sections

The section components are already extracted, which is right. What remains in
the page is the fetch orchestration, save handlers, and admin/user view gating
for all 22 — in one file. That is where the 15 silent catches live, and it is
why they are easy to miss.

## What is healthy — do not "fix" these

- **Route coverage is complete.** 58 endpoints, every one called; 39 UI calls,
  every one resolving.
- **Admin gating is correct.** `showAdmin = viewMode === 'admin' && user?.role
  === 'admin'` double-gates on both view and role, and the backend re-checks with
  `_require_admin` rather than trusting the client.
- **`AdminSettingsPage` is a thin reuse of `SettingsPage`** with
  `viewMode="admin"` — the right call, not duplication.

---

## Plan

Ordered by value, not effort.

### 1. Surface capability flags in the admin UI — the real fix

Add an admin section that reads and writes the `*_enabled` flags, so
`hidden_features` and capability state stop being separate worlds.

This needs a backend decision first, and it is the significant one:
`config/settings.py` is loaded from `.env` at process start and is immutable at
runtime. Making flags editable from the UI means either

- **(a)** persisting overrides in the DB and having `get_settings()` layer them
  over the env values, or
- **(b)** a read-only view that shows each flag's current state and the exact
  env line to set, with no write path.

**(b) is the better first step.** It is small, has no runtime-mutation risk, and
removes the whole class of "which switch turns this on" problem immediately. (a)
is a real feature and should be decided deliberately, not smuggled in.

### 2. Give reads an error state

Replace the 15 `catch(() => null)` sites with a per-section status of
`loading | ok | error | forbidden`. `useFlagGatedFetch` in
`frontend/src/utils/useApi.js` already implements exactly this shape for the
flag-gated pages — extend it rather than inventing a second pattern.

Minimum bar: a panel that failed to load must not look like a panel that is off.

### 3. Document the 21 missing flags in `.env.example`

Mechanical, and it makes every feature reachable by someone reading the file the
project tells them to copy. `REMOTE_OLLAMA_ENABLED` and
`WEBHOOK_TOKENS_ENABLED` are done on `claude/dashboard-daemon-panel`; the
remaining 19 follow the same pattern.

### 4. Delete `AdminFamilySection.jsx`

Confirm `FamilyGroupsSection` and `ParentChildrenSection` cover its behaviour,
then remove it. Git history keeps it if it is ever wanted back.

### 5. Split the fetch orchestration out of `SettingsPage.jsx`

Only after (2). A `useSettingsData` hook owning the fetches and their status
would shrink the page and put the error handling in one place instead of
fifteen. Doing this before (2) just moves the silent catches to a new file.

---

## Reproducing these numbers

```bash
# endpoint coverage
grep -rhoE '@router\.(get|post|put|patch|delete)\("[^"]+"' \
  api/routes/models_settings.py api/routes/admin.py api/routes/features.py | sort -u | wc -l

# flags defined vs flags in the UI
grep -cE '^\s+[a-z_]+_enabled:' config/settings.py
grep -rhoE '[a-z_]+_enabled' frontend/src/pages/settings/*.jsx \
  frontend/src/pages/SettingsPage.jsx | sort -u | wc -l

# silent catches
grep -c "catch(() => null)\|catch(() => ({}))\|catch {}" frontend/src/pages/SettingsPage.jsx

# orphaned section
grep -rn "AdminFamilySection" frontend/src --include=*.jsx
```
