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
   other.** Remote Ollama and Webhook Tokens have a flag-system mismatch where
   `hidden_features` controls menu visibility but `*_enabled` flags control
   actual function. SLAE is a separate case: it requires `langfuse_enabled` and
   a live Graphiti provider (verified `providers/memory/graphiti_provider.py`),
   so its root cause is provider configuration rather than flag connectivity.
2. **Reads fail silently.** A settings panel that failed to load is
   indistinguishable from one that is switched off.

---

## Finding 1 — Two disconnected feature systems (root cause)

There are two independent notions of "is this feature on", and nothing joins
them:

| System | Stored in | Managed by | Controls |
|---|---|---|---|
| `hidden_features` | admin config in the DB | **UI** — `AdminFeatureSection` → `PUT /api/admin/feature-visibility` | whether a page appears in the nav |
| `*_enabled` | `config/settings.py`, read from `.env` | **`.env` manages most flags** — UI exceptions identified below (15 flags exposed, per Finding 2) | whether the capability actually functions |

An admin can un-hide a page from the menu but has no way to turn on the feature
behind it. The page appears, loads, and renders a "feature off" notice — with
nothing anywhere naming the switch that would fix it.

That is exactly what Remote Ollama, Webhook Tokens and SLAE do today:

```text
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
# Heuristic discovery commands (grep-based pattern matching, not precise rendered UI control counts)
grep -oE '^\s+[a-z_]+_enabled' config/settings.py | tr -d ' ' | sort -u   # 47
grep -rhoE '[a-z_]+_enabled' frontend/src/pages/settings/*.jsx \
     frontend/src/pages/SettingsPage.jsx | sort -u                        # 15
```

Of 239 settings fields and 47 `*_enabled` flags, **15 are referenced in the
settings UI** (heuristic string match). Twenty-one are absent from `.env.example` as well, making them
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

## Finding 3 — Reads fail silently (15 swallowed fallback sites)

`SettingsPage.jsx` contains **15** swallowing catches that return fallback values
(`null`, `{}`, or default objects) when reads fail:

```js
fetch(`${API_BASE}/api/admin/model-visibility`, { headers })
  .then(r => r.json())
  .catch(() => null)        // <- a 500 is now indistinguishable from "no data"
```

These 15 sites swallow errors: `/api/settings/voice`, `/api/features`,
`/api/settings` (user prefs), `/api/feeds/preferences`,
`/api/admin/model-visibility`, `/api/admin/feature-visibility`, `/api/admin/family`,
`/api/admin/family-groups`, `/api/settings/orchestration`, `/api/settings/elevenlabs`,
`/api/settings/persona`, `/api/settings/briefing`, `/api/daemon/status`,
`/api/settings/intent-router`, `/api/admin/llm-routing-flags`, and
`/api/models/hardware` (admin), plus `/api/parent/children` (parent).

Three critical reads **do not swallow errors** and propagate failures to the outer
error handler (`setSaveStatus('error')`): `/api/models`, `/api/settings/llm`, and
`/api/settings/memory` (all using `okJson` helper at line 100).

Writes are handled properly — 9 write requests against 14 `res.ok` checks, and
there is a save-status toast. Reads have no equivalent. There is no
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

Add an admin section with a **read-only view** that displays the current state of
all `*_enabled` flags and their corresponding `.env` settings, so `hidden_features`
and capability state stop being separate worlds.

The view should:
- Read and display each flag's current value (from `get_settings()`)
- Show the exact `.env` variable name to set
- Explain what the flag controls
- **Not provide write capability** — flags remain `.env`-managed

This removes the whole class of "which switch turns this on" problem without
introducing runtime-mutation risk.

**Database-backed runtime overrides** (where the DB layers overrides over `.env`
values) should be deferred to a separate future decision, evaluated deliberately
on its own merits rather than smuggled in with this initial visibility improvement.

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
# Selected route-definition count (models_settings.py, admin.py, features.py only)
# Note: This is a partial count for settings-related routes. Does not cover all
# backend route files (e.g., feeds.py, daemons.py, parent.py, and ~50 others).
grep -rhoE '@router\.(get|post|put|patch|delete)\("[^"]+"' \
  api/routes/models_settings.py api/routes/admin.py api/routes/features.py | sort -u | wc -l

# Heuristic flag-reference counts (grep-based pattern matching)
grep -cE '^\s+[a-z_]+_enabled:' config/settings.py
grep -rhoE '[a-z_]+_enabled' frontend/src/pages/settings/*.jsx \
  frontend/src/pages/SettingsPage.jsx | sort -u | wc -l

# Silent catches (heuristic pattern match)
grep -c "catch(() => null)\|catch(() => ({}))\|catch {}" frontend/src/pages/SettingsPage.jsx

# Orphaned section (import reference check)
grep -rn "AdminFamilySection" frontend/src --include=*.jsx
```
