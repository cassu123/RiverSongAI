# River Song AI — Presence Swap (ultra-detailed)

**Audience:** Gemini (or any model with shell + file access in the repo root).
**Mode:** Feature build. Port the approved orb design from `prototypes/presence-orb.html` (v3.3, in working tree) into the live React app, replacing the `avatar.glb`-based component. Add palette + environment as per-user settings persisted via the existing `/api/auth/profile` endpoint.

**Source of truth for the visual design:** read `prototypes/presence-orb.html` end to end before writing any code. Every shader, geometry, animation rule, palette value, environment backdrop, and state behavior is defined there and already user-approved. **Do not redesign. Do not improvise. Adapt the existing JS to react-three-fiber where needed but preserve every visual decision.**

**Do not commit. Do not push.** User commits.

---

## 0. Verification standards (read this first)

### 0.1 Python syntax checking
Use `py_compile`, not `ast.parse`:
```bash
python3 -c "import py_compile; py_compile.compile('<path>', doraise=True)"
```
Round 3 lesson: `ast.parse` silently accepts `await` outside `async def` and lets server-breaking bugs reach uvicorn. `py_compile` is the real check.

### 0.2 App imports
After any backend change:
```bash
source venv/bin/activate
python3 -c "import sys; sys.path.insert(0,'.'); from main import app; print('routes:', len(app.routes))"
```
Expected: `routes:` ≥ 308 (the baseline at HEAD `e93a322` + 7 vault routes). Any traceback means stop and fix before continuing.

### 0.3 Frontend build sanity
After any frontend change:
```bash
cd frontend && npm run build
```
No errors, output mentions the changed chunks.

### 0.4 Browser-test before claiming done
Always:
```bash
# terminal 1
source venv/bin/activate && python3 main.py
# terminal 2
cd frontend && npm run dev
```
Open `http://localhost:5173/`, log in, click through the affected pages. If you can't reach a browser, say so — do not claim a UI works without seeing it render.

### 0.5 Do NOT touch these files except where explicitly authorized

- `core/auth.py`
- `core/family.py`
- `core/conversation_loop.py`
- `api/routes/conversation.py`
- `providers/llm/*.py`, `providers/tts/*.py`, `providers/stt/*.py`
- `.env`, `.env.example`
- Anything outside the explicit edit list in §1–§5 below

### 0.6 Source of truth file

`prototypes/presence-orb.html` is the canonical implementation of the orb visual. When you need a shader, an envelope function, a uniform default, an animation rule, or a palette hex code — **copy it verbatim from that file**. Do not invent variations. The file is approved.

---

## 1. Backend — schema + profile route

### 1.1 Schema migration — add `palette` and `environment` columns to `users`

**File:** `providers/memory/sqlite_store.py`

**Current state (line 378):** `"ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'halo'"`

**Action:** mirror that migration pattern. Find the migration block that contains that line (it's a list of SQL strings inside a try/except `OperationalError` migration loop). Add two new migrations to the same list, in the order shown:

```python
"ALTER TABLE users ADD COLUMN palette TEXT NOT NULL DEFAULT 'spice'",
"ALTER TABLE users ADD COLUMN environment TEXT NOT NULL DEFAULT 'atreides'",
```

Each runs once on first boot after this change. Idempotent — `OperationalError: duplicate column` is caught by the existing pattern.

### 1.2 Store methods

**File:** `providers/memory/sqlite_store.py`

Locate the existing `update_user_theme(self, user_id: str, theme: str)` method (find with `grep -n "update_user_theme" providers/memory/sqlite_store.py`). Below it, add:

```python
async def update_user_palette(self, user_id: str, palette: str) -> None:
    await self._run(self._sync_update_user_palette, user_id, palette)

def _sync_update_user_palette(self, user_id: str, palette: str) -> None:
    with self._connect() as conn:
        conn.execute("UPDATE users SET palette = ? WHERE id = ?", (palette, user_id))
        conn.commit()

async def update_user_environment(self, user_id: str, environment: str) -> None:
    await self._run(self._sync_update_user_environment, user_id, environment)

def _sync_update_user_environment(self, user_id: str, environment: str) -> None:
    with self._connect() as conn:
        conn.execute("UPDATE users SET environment = ? WHERE id = ?", (environment, user_id))
        conn.commit()
```

Match the exact `async`/`_sync_*`/`_run`/`_connect` convention used by `update_user_theme`. Read it first and copy its style; if its naming differs (e.g., uses `self._executor` directly), match that instead.

### 1.3 `get_user_by_id` must return the new columns

**File:** `providers/memory/sqlite_store.py`

Find `get_user_by_id` (or `_sync_get_user_by_id`). The current select returns columns including `theme`. Extend the returned dict with `palette` and `environment`. The SELECT statement already does `SELECT *` (verify with grep) — if so, no SQL change needed; only update the dict assembly downstream if there is one. If the select is column-explicit, add `palette, environment` to the list.

**Test after this edit:**
```bash
python3 -c "
import sys, asyncio; sys.path.insert(0,'.')
from providers.memory.sqlite_store import SQLiteStore
async def main():
    s = SQLiteStore('data/db/river_song.db')
    await s.initialize()
    # Use an actual user_id from your DB; replace <UID>
    u = await s.get_user_by_id('<UID>')
    assert 'palette' in u, 'palette missing'
    assert 'environment' in u, 'environment missing'
    print('ok', u['palette'], u['environment'])
asyncio.run(main())
"
```

### 1.4 Profile route — accept + return palette/environment

**File:** `api/routes/auth.py`

**Current state (lines 456-485 approx):**

```python
@router.get("/profile")
async def get_profile(...):
    ...
    return {"id": user["id"], "email": user["email"], "display_name": user["display_name"], "role": user["role"], "theme": user.get("theme", "halo")}

@router.patch("/profile")
async def update_profile(body: ProfilePatch, ...):
    ...
    if body.theme is not None:
        if body.theme not in VALID_THEMES:
            raise HTTPException(status_code=400, detail=...)
        await store.update_user_theme(user_id, body.theme)
    ...
```

**Action:**

1. Find the `ProfilePatch` Pydantic model in the same file (search `class ProfilePatch`). Add two optional fields:

```python
class ProfilePatch(BaseModel):
    theme:       Optional[str] = None
    palette:     Optional[str] = None   # NEW
    environment: Optional[str] = None   # NEW
    display_name: Optional[str] = None  # only if it's already there; leave untouched otherwise
```

2. Find the `VALID_THEMES` set in the same file. Below it, add:

```python
VALID_PALETTES     = {"spice", "halo"}
VALID_ENVIRONMENTS = {"atreides", "harkonnen", "forerunner", "unsc"}

# Cross-validation: which environments are legal under which palette
PALETTE_ENV_PAIRS = {
    "spice": {"atreides", "harkonnen"},
    "halo":  {"forerunner", "unsc"},
}
```

3. Extend `update_profile` body handler. After the existing `if body.theme is not None:` block, add:

```python
    if body.palette is not None:
        if body.palette not in VALID_PALETTES:
            raise HTTPException(status_code=400, detail=f"Invalid palette. Valid: {', '.join(VALID_PALETTES)}")
        await store.update_user_palette(user_id, body.palette)

    if body.environment is not None:
        if body.environment not in VALID_ENVIRONMENTS:
            raise HTTPException(status_code=400, detail=f"Invalid environment. Valid: {', '.join(VALID_ENVIRONMENTS)}")
        # Optional cross-check — only enforce if both fields present in the same patch
        current_palette = body.palette or (await store.get_user_by_id(user_id)).get("palette", "spice")
        if body.environment not in PALETTE_ENV_PAIRS.get(current_palette, set()):
            raise HTTPException(status_code=400, detail=f"environment '{body.environment}' is not valid under palette '{current_palette}'")
        await store.update_user_environment(user_id, body.environment)
```

4. Update both the GET response and the final PATCH response to include the new fields:

```python
    return {
        "id": user["id"],
        "email": user["email"],
        "display_name": user["display_name"],
        "role": user["role"],
        "theme":       user.get("theme",       "halo"),
        "palette":     user.get("palette",     "spice"),
        "environment": user.get("environment", "atreides"),
    }
```

Apply this exact return shape to BOTH `get_profile` and `update_profile`.

### 1.5 Acceptance checks — Section 1

```bash
# 1. Compile
python3 -c "import py_compile; py_compile.compile('api/routes/auth.py', doraise=True); py_compile.compile('providers/memory/sqlite_store.py', doraise=True); print('OK')"

# 2. Import
python3 -c "import sys; sys.path.insert(0,'.'); from main import app; print('routes:', len(app.routes))"

# 3. Start server, then issue a login and a profile fetch:
TOKEN=<paste a real bearer token after login>
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/auth/profile | python3 -m json.tool
# Expected: response includes palette: "spice" and environment: "atreides" (or whatever's set)

# 4. Patch palette
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"palette":"halo","environment":"forerunner"}' \
  http://localhost:8000/api/auth/profile | python3 -m json.tool

# 5. Cross-validation rejection
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"palette":"halo","environment":"harkonnen"}' \
  http://localhost:8000/api/auth/profile
# Expected: HTTP 400 with detail mentioning the palette/environment mismatch

# 6. Invalid value rejection
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"palette":"bogus"}' http://localhost:8000/api/auth/profile
# Expected: HTTP 400 with "Invalid palette" message
```

All five must pass. If 5 returns a stack trace instead of HTTP 400, the validation is wired wrong — fix before moving on.

---

## 2. CSS — palette + environment theme variables

### 2.1 Read the existing theme file first

**File:** `frontend/src/styles/themes.css`

Inspect with `cat frontend/src/styles/themes.css` and note the existing `[data-theme="halo"]` block (and any other themes defined). Match its variable naming convention exactly. The existing CSS variables in use across the codebase are at minimum: `--primary`, `--secondary`, `--accent`, `--error`, `--bg`, `--fg`. Grep for each to confirm what's referenced.

### 2.2 Add palette-level variables

At the bottom of `frontend/src/styles/themes.css`, add:

```css
/* ──────────────────────────────────────────────────────────────────────────
   Palette × Environment — the new presence theme system.
   Hex values mirror prototypes/presence-orb.html PALETTES{} object.
   ────────────────────────────────────────────────────────────────────────── */

[data-palette="spice"] {
  --primary:        #d4a040;   /* dusty amber */
  --secondary:      #8a5a28;   /* bronze etching */
  --accent:         #ffd28a;   /* bright spice */
  --silhouette:     #e8c878;   /* sand-gold figure */
  --vortex-deep:    #6e3a16;   /* burnt copper */
  --error:          #c84030;
  --bg-base:        #0d0805;
  --fg:             #d9c4a0;
  --line:           rgba(212, 168, 100, .22);
  --panel-bg:       rgba(12, 8, 4, .58);
}

[data-palette="halo"] {
  --primary:        #78c8e6;
  --secondary:      #3a7090;
  --accent:         #e6f6ff;
  --silhouette:     #b0e0f0;
  --vortex-deep:    #1a3a52;
  --error:          #c84030;
  --bg-base:        #060a0f;
  --fg:             #d4e6f0;
  --line:           rgba(120, 200, 230, .22);
  --panel-bg:       rgba(4, 8, 14, .58);
}

body {
  background: var(--bg-base);
  color: var(--fg);
  transition: background 1.0s ease, color 1.0s ease;
}
```

### 2.3 Add environment backdrop CSS

In the same file, append the four environment backdrops. **Copy verbatim from `prototypes/presence-orb.html` v3.3 (currently in the working tree).** The four `body.env-*::before` blocks are between approximately lines 60 and 130 of the prototype. Copy them as-is, change the selector from `body.env-atreides::before` to `body[data-env="atreides"]::before`, etc. — same pattern for the four:

- `body[data-env="atreides"]::before`
- `body[data-env="harkonnen"]::before`
- `body[data-env="forerunner"]::before`
- `body[data-env="unsc"]::before`

Also copy the `body::before { content: ""; position: fixed; … }` base rule that all four share. Use `pointer-events: none` and `z-index: 0`.

Do not modify the gradient stops, color values, or pattern dimensions. Those are tuned and approved.

### 2.4 Acceptance check — Section 2

```bash
# Build the frontend
cd frontend && npm run build
# Expected: no errors, only changed chunk sizes
```

Open `http://localhost:5173/` after a hard refresh. Open browser devtools, in the Console run:

```js
document.documentElement.setAttribute('data-palette', 'spice');
document.documentElement.setAttribute('data-env', 'atreides');
```

The body should immediately recolor and the room backdrop should appear. Cycle through all four combinations:
- spice + atreides → sandstone palace
- spice + harkonnen → industrial dreadnought
- halo + forerunner → pale ceramic
- halo + unsc → military hangar

If a combination looks wrong, the CSS copy is incomplete — re-copy from the prototype.

---

## 3. App.jsx — state wiring + persistence

### 3.1 Replace single `theme` state with palette + environment

**File:** `frontend/src/App.jsx`

**Current state (lines 51-101):** there's a single `theme` state, persisted to `localStorage` as `rs-theme:${user.id}`, applied via `document.documentElement.setAttribute('data-theme', theme)`, synced to server via PATCH `/api/auth/profile` on change, and pulled on login via GET `/api/auth/profile`.

**Action:** keep the `theme` state exactly as it is. **Do not remove it.** It still drives the color theme via `data-theme`. **Add two new pieces of state** alongside it for palette and environment, each with its own persistence and sync.

Find the existing block:

```jsx
const themeKey = user ? `rs-theme:${user.id}` : 'rs-theme'
const [theme, setTheme] = useState(() => load(user ? `rs-theme:${user.id}` : 'rs-theme', 'halo'))
```

Below it, add:

```jsx
const paletteKey = user ? `rs-palette:${user.id}` : 'rs-palette'
const envKey     = user ? `rs-env:${user.id}`     : 'rs-env'
const [palette,     setPalette]     = useState(() => load(paletteKey, 'spice'))
const [environment, setEnvironment] = useState(() => load(envKey, 'atreides'))
```

Find the existing `useEffect` that runs on `theme` change (line 60-75 approx):

```jsx
useEffect(() => {
  save(themeKey, theme)
  document.documentElement.setAttribute('data-theme', theme)
  if (user) {
    const token = load('rs-auth-token', null)
    if (token) {
      fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ theme }),
      }).catch(() => {})
    }
  }
}, [theme])
```

Add TWO new `useEffect`s mirroring it, one for palette and one for environment:

```jsx
useEffect(() => {
  save(paletteKey, palette)
  document.documentElement.setAttribute('data-palette', palette)
  if (user) {
    const token = load('rs-auth-token', null)
    if (token) {
      fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ palette }),
      }).catch(() => {})
    }
  }
}, [palette]) // eslint-disable-line react-hooks/exhaustive-deps

useEffect(() => {
  save(envKey, environment)
  document.documentElement.setAttribute('data-env', environment)
  if (user) {
    const token = load('rs-auth-token', null)
    if (token) {
      fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ environment }),
      }).catch(() => {})
    }
  }
}, [environment]) // eslint-disable-line react-hooks/exhaustive-deps
```

### 3.2 Pull palette/environment from server on login

Find the existing login-sync block (search `serverTheme`):

```jsx
const serverTheme = data?.theme
const localTheme = load(`rs-theme:${user.id}`, null)
const resolved = serverTheme || localTheme || 'halo'
save(`rs-theme:${user.id}`, resolved)
setTheme(resolved)
document.documentElement.setAttribute('data-theme', resolved)
```

Below it, add:

```jsx
const serverPalette = data?.palette
const localPalette  = load(`rs-palette:${user.id}`, null)
const resolvedP = serverPalette || localPalette || 'spice'
save(`rs-palette:${user.id}`, resolvedP)
setPalette(resolvedP)
document.documentElement.setAttribute('data-palette', resolvedP)

const serverEnv = data?.environment
const localEnv  = load(`rs-env:${user.id}`, null)
const resolvedE = serverEnv || localEnv || 'atreides'
save(`rs-env:${user.id}`, resolvedE)
setEnvironment(resolvedE)
document.documentElement.setAttribute('data-env', resolvedE)
```

### 3.3 Cross-validation guard in setEnvironment

When a user flips palette, the current environment may become invalid (e.g., currently `harkonnen`, flip palette to `halo`, but `harkonnen` is spice-only). Add a guard so palette change auto-corrects environment.

Add a wrapper around `setPalette` (or modify the existing). Define above the JSX return:

```jsx
const PAL_ENV_PAIRS = {
  spice: ['atreides',   'harkonnen'],
  halo:  ['forerunner', 'unsc'],
}

const setPaletteSafe = (p) => {
  setPalette(p)
  const valid = PAL_ENV_PAIRS[p]
  if (!valid.includes(environment)) {
    setEnvironment(valid[0])  // jump to first env of the new palette
  }
}
```

Then `setPaletteSafe` is what the Settings page consumes (Section 4). Internal `setPalette` is left available but only `setPaletteSafe` is exported to children.

### 3.4 Pass palette/environment + setters down to SettingsPage

The existing render block at line 233:

```jsx
{currentPage === 'settings' && <SettingsPage onFeaturesChanged={refreshFeatures} />}
```

Update it to:

```jsx
{currentPage === 'settings' && (
  <SettingsPage
    onFeaturesChanged={refreshFeatures}
    palette={palette}
    environment={environment}
    onPaletteChange={setPaletteSafe}
    onEnvironmentChange={setEnvironment}
  />
)}
```

### 3.5 Acceptance check — Section 3

1. Build frontend cleanly: `cd frontend && npm run build`
2. Log in. Open devtools, run:
   ```js
   document.documentElement.dataset
   ```
   Should show `palette: "spice"` and `env: "atreides"` (or whatever the server returned).
3. Change palette via the Settings UI (Section 4 below). Refresh the page. The new palette should persist (came from localStorage).
4. Log out, log in. The setting should come from the server, not local cache.
5. Open another browser, log in as the same user. Setting should match. (This proves server sync.)

---

## 4. Settings page — palette + environment controls

### 4.1 New section

**File:** `frontend/src/pages/SettingsPage.jsx`

Read the existing file. Find the `function Section({ title, children })` wrapper at line ~39 — that's the section building block. Find an existing simple section like `VOICE` (line 940 approx) for the row-and-button pattern. Match its style.

Find the component's outer `export default function SettingsPage(props)` and add `palette`, `environment`, `onPaletteChange`, `onEnvironmentChange` to its destructured props.

Then add a new `<Section title="PRESENCE">` block **above** the existing AI MODEL section (so it's first — appearance is more user-friendly to find than model config). The new section:

```jsx
<Section title="PRESENCE">
  <div className="settings-presence-group">
    <div className="settings-label">Universe</div>
    <div className="settings-button-row">
      <button
        className={`settings-button ${palette === 'spice' ? 'settings-button--active' : ''}`}
        onClick={() => onPaletteChange('spice')}
      >
        Spice (Dune)
      </button>
      <button
        className={`settings-button ${palette === 'halo' ? 'settings-button--active' : ''}`}
        onClick={() => onPaletteChange('halo')}
      >
        Halo
      </button>
    </div>
  </div>

  <div className="settings-presence-group">
    <div className="settings-label">Environment</div>
    <div className="settings-button-row">
      {(palette === 'spice'
        ? [['atreides', 'Atreides'], ['harkonnen', 'Harkonnen']]
        : [['forerunner', 'Forerunner'], ['unsc', 'UNSC']]
      ).map(([key, label]) => (
        <button
          key={key}
          className={`settings-button ${environment === key ? 'settings-button--active' : ''}`}
          onClick={() => onEnvironmentChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  </div>

  <p className="settings-hint">
    Saved to your account. Other family members keep their own.
  </p>
</Section>
```

### 4.2 Styles

The existing settings CSS (`frontend/src/pages/SettingsPage.css` if present, or wherever `.settings-*` classes are defined — grep `settings-label` in `frontend/src/`) already covers `.settings-button`, `.settings-button--active`, `.settings-button-row`, `.settings-label`. Reuse them.

For the new `.settings-presence-group` and `.settings-hint`, add to the same CSS file (or inline in SettingsPage.jsx as a `<style>` block if the file uses that convention elsewhere — grep `<style>` in SettingsPage.jsx to confirm):

```css
.settings-presence-group { margin-bottom: 16px; }
.settings-hint { font-size: 11px; opacity: 0.55; margin-top: 12px; letter-spacing: 0.02em; }
```

### 4.3 Acceptance check — Section 4

1. Navigate to Settings page. The new "PRESENCE" section should be first.
2. Both buttons under "Universe" visible. Clicking Halo should:
   - Repaint the page (CSS vars update via data-palette).
   - Show Forerunner/UNSC as the environment buttons (the spice envs disappear).
   - Trigger a PATCH to `/api/auth/profile` (visible in devtools network tab).
3. Click Forerunner → page applies environment. Click UNSC → page applies environment.
4. Click Spice → palette flips back; if you had UNSC selected (invalid under spice), it should auto-correct to Atreides per Section 3.3.
5. Refresh. Settings persist. Log out, log in. Same settings come from server.

---

## 5. RiverSong.jsx — replace with shader-based presence orb

This is the big one. Replace the `avatar.glb`-based component with a port of `prototypes/presence-orb.html`'s shader + particle system. Same external prop surface so consumers don't break.

### 5.1 External contract (do NOT change)

`frontend/src/components/RiverSong.jsx` exports a default React component:

```jsx
export default function RiverSong({ state, audioLevel = 0, lipSyncOpen = 0, compact = false })
```

Consumers:
- `frontend/src/pages/ConversationPage.jsx:298` — `<RiverSong state={convState} audioLevel={visualLvl} />`
- `frontend/src/pages/KioskPage.jsx:118` — `<RiverSong … />`

Possible values of `state`: `'idle'`, `'connecting'`, `'listening'`, `'transcribing'`, `'thinking'`, `'speaking'`, `'error'`. **Map them to the orb's internal 6 states:**

| `state` prop          | Orb state    |
|-----------------------|--------------|
| `idle`                | idle         |
| `connecting`          | thinking     |
| `listening`           | listening    |
| `transcribing`        | thinking     |
| `thinking`            | thinking     |
| `speaking`            | speaking     |
| `error`               | error        |

The mockup also has an `acting` state; it's not yet driven by the conversation pipeline, so don't map anything to it for now. Leave it definable for future use.

`audioLevel` (0..1) maps directly to the mockup's `audioSim` value.

`lipSyncOpen` (0..1) is currently used for `.glb` mouth animation. **In the new orb, use it as a stronger audio-level signal when speaking.** Replace the existing fallback (`const driver = lipSyncOpen > 0 ? lipSyncOpen : audioLevel`) with the same fallback so `lipSyncOpen` overrides `audioLevel` when present.

`compact` (bool) scales the orb down for embedded contexts.

### 5.2 Read the source of truth

```bash
cat prototypes/presence-orb.html | wc -l
```

Open `prototypes/presence-orb.html` and locate these blocks. Do not modify the prototype.

- `PALETTES` object (~line 220) — hex values for spice/halo
- `STATE_TINT` object (~line 250) — per-state bloomBump and speed
- `VORTEX_VERT` shader source (~line 280)
- `VORTEX_FRAG` shader source (~line 290)
- `RING_FRAG` shader source (~line 340)
- `insideTorso(x, y, z)` function (~line 380)
- `buildOrb(scale)` function (~line 410) — vortex + core + silhouette + 4 rings + dots + track
- `updateOrb(orb, t, tint)` function (~line 700) — per-frame animation logic
- `animate()` loop (~line 760) — audioSim integration + camera drift

The exact line numbers may have drifted; use grep:

```bash
grep -n "PALETTES = {\|VORTEX_VERT = \|VORTEX_FRAG = \|RING_FRAG = \|insideTorso\|buildOrb\|updateOrb\|animate()" prototypes/presence-orb.html
```

### 5.3 Architecture — port to react-three-fiber

The existing `RiverSong.jsx` uses `@react-three/fiber` (Canvas, useFrame) — keep using r3f. The mockup is vanilla three.js; adapt.

Target file structure for the new `frontend/src/components/RiverSong.jsx`:

```jsx
import React, { useRef, useMemo, useEffect } from 'react'
import { Canvas, useFrame, extend } from '@react-three/fiber'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import * as THREE from 'three'

// ─ Constants pulled verbatim from prototypes/presence-orb.html ─────────────
const PALETTES = { /* copy from prototype */ }
const STATE_TINT = { /* copy */ }
const STATE_MAP = {
  idle: 'idle', connecting: 'thinking', listening: 'listening',
  transcribing: 'thinking', thinking: 'thinking',
  speaking: 'speaking', error: 'error',
}

// ─ Shaders — copy verbatim from prototype ──────────────────────────────────
const VORTEX_VERT = `...`
const VORTEX_FRAG = `...`
const RING_FRAG   = `...`

// ─ Torso silhouette envelope — copy from prototype ─────────────────────────
function insideTorso(x, y, z) { /* copy */ }

// ─ Pre-build particle positions once (memoized) ────────────────────────────
function useSilhouettePositions() {
  return useMemo(() => {
    const N = 2600
    const home = new Float32Array(N * 3)
    const cur  = new Float32Array(N * 3)
    let i = 0
    while (i < N) {
      const x = (Math.random() - 0.5) * 1.4
      const y = (Math.random() * 1.9) - 0.9
      const z = (Math.random() - 0.5) * 0.7
      if (insideTorso(x, y, z)) {
        home[i*3]   = x * 0.74
        home[i*3+1] = y * 0.62 - 0.05
        home[i*3+2] = z * 0.74
        cur[i*3]   = home[i*3]
        cur[i*3+1] = home[i*3+1]
        cur[i*3+2] = home[i*3+2]
        i++
      }
    }
    return { home, cur, count: N }
  }, [])
}

// ─ Read CSS var for palette/env (data-palette on documentElement) ──────────
function useCurrentPalette() {
  const [palette, setPalette] = React.useState(() =>
    document.documentElement.dataset.palette || 'spice')
  useEffect(() => {
    const obs = new MutationObserver(() => {
      setPalette(document.documentElement.dataset.palette || 'spice')
    })
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-palette'] })
    return () => obs.disconnect()
  }, [])
  return palette
}

// ─ Inner orb mesh group — runs inside Canvas ───────────────────────────────
function OrbCore({ state, audioLevel, lipSyncOpen, palette }) {
  const groupRef = useRef()
  const vortexMatRef = useRef()
  const ringMats = useRef([])
  const silhouetteRef = useRef()
  const dotsRef = useRef()
  const trackMatRef = useRef()

  const { home, cur, count } = useSilhouettePositions()
  const audioSim = useRef(0)
  const actingFlash = useRef(0)

  // Build vortex shader material — memoized
  const vortexMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: VORTEX_VERT,
    fragmentShader: VORTEX_FRAG,
    transparent: true, side: THREE.DoubleSide, depthWrite: false,
    uniforms: {
      uTime:      { value: 0 },
      uAudio:     { value: 0 },
      uPulse:     { value: 0 },
      uWarm:      { value: new THREE.Color(0xd4a040) },
      uDeep:      { value: new THREE.Color(0x6e3a16) },
      uAccent:    { value: new THREE.Color(0xffd28a) },
      uCamPos:    { value: new THREE.Vector3(0, 0, 6) },
      uSpeed:     { value: 1.0 },
      uStyleSeed: { value: 1.0 },
    },
  }), [])

  // 4 ring specs — copy from prototype's ringSpecs (~line 470)
  const ringSpecs = [ /* copy verbatim from prototype */ ]

  // Per-frame update — copy logic from prototype's updateOrb + animate
  useFrame(({ clock, camera }) => {
    const t = clock.elapsedTime
    const orbState = STATE_MAP[state] || 'idle'
    const pal = PALETTES[palette]
    const tint = STATE_TINT[orbState]

    // ... audioSim update (use audioLevel/lipSyncOpen as the target, same logic as prototype) ...
    // ... uniform lerps (copy applyPaletteTo) ...
    // ... rotate rings, dots, track ...
    // ... displace silhouette particles ...
    // ... group rotation ...
    // ... vortexMat.uniforms.uCamPos.value.copy(camera.position) ...
  })

  return (
    <group ref={groupRef}>
      <mesh material={vortexMat}>
        <icosahedronGeometry args={[1.45, 32]} />
      </mesh>
      <mesh>
        <icosahedronGeometry args={[0.95, 2]} />
        <meshBasicMaterial color={0x1a0e06} transparent opacity={0.55} />
      </mesh>
      <points ref={silhouetteRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[cur, 3]} count={count} />
        </bufferGeometry>
        <pointsMaterial size={0.024} transparent opacity={0.85}
          blending={THREE.AdditiveBlending} depthWrite={false} sizeAttenuation />
      </points>
      {/* 4 rings — map ringSpecs */}
      {/* 36 dots — sample like prototype's dotN */}
      {/* track torus */}
    </group>
  )
}

// ─ Outer wrapper — Canvas + bloom postprocessing ───────────────────────────
export default function RiverSong({ state, audioLevel = 0, lipSyncOpen = 0, compact = false }) {
  const palette = useCurrentPalette()

  return (
    <div className={`river-song-wrapper ${compact ? 'river-song-wrapper--compact' : ''}`}>
      <Canvas
        camera={{ position: [0, 0.05, compact ? 5.8 : 7.2], fov: 38 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.9 }}
        onCreated={({ gl }) => { gl.outputColorSpace = THREE.SRGBColorSpace }}
      >
        <OrbCore state={state} audioLevel={audioLevel} lipSyncOpen={lipSyncOpen} palette={palette} />
        <EffectComposer>
          <Bloom intensity={0.62} luminanceThreshold={0.18} luminanceSmoothing={0.78} />
        </EffectComposer>
      </Canvas>
    </div>
  )
}
```

### 5.4 Critical implementation notes

1. **Shaders are verbatim from the prototype.** Do not "improve" them. Do not change uniform names. Do not reorder attribute decoders. The exact strings in `VORTEX_VERT`, `VORTEX_FRAG`, `RING_FRAG` from `prototypes/presence-orb.html` v3.3 are the contract.

2. **`STATE_TINT.bloomBump` is not used in this swap.** The prototype lerps the `UnrealBloomPass.strength` per frame. In r3f the `<Bloom>` component takes a static `intensity` prop. The simplest approximation: pass `intensity={0.62}` always (the prototype's base) and let the orb's surface brightness handle the per-state pulse. If you want per-state bloom, pass a `useState`-driven intensity from `OrbCore` up via context or render `<Bloom>` inside `OrbCore` — only do this if you can confirm `EffectComposer` accepts being mounted inside the scene group.

3. **`useFrame` in r3f gives `(state, delta)`** — state has `clock`, `camera`, `gl`, etc. Use `state.clock.elapsedTime` for the prototype's `t = clock.getElapsedTime()`. Use `state.camera` for the camera position uniform.

4. **Particle displacement** — the prototype iterates the position buffer every frame. In r3f, get `silhouetteRef.current.geometry.attributes.position.array` and mutate, then set `position.needsUpdate = true`. Same pattern as the prototype.

5. **MutationObserver for palette changes** — the `useCurrentPalette` hook watches `data-palette` on `document.documentElement`. When the user flips palette in Settings, App.jsx sets the attribute, and the orb re-renders with new palette colors. This is the cheapest sync path; no React context plumbing needed.

6. **`useGLTF.preload('/avatar.glb')` line — remove it.** The `.glb` file stays on disk (for a potential future character avatar) but is no longer loaded.

7. **CSS wrapper classes** — keep `.river-song-wrapper`, `.river-song-wrapper--compact`, `.river-song-scanlines`, `.river-song-vignette`, `.river-song-canvas` for compatibility with the consumers' surrounding CSS. The scanline + vignette divs are decorative and can stay (they don't conflict with the new orb).

8. **`compact` scaling** — the prototype's HUD-corner replica is rendered with `buildOrb(0.95)` in its own Canvas. For the live component, `compact={true}` should reduce the orb's overall feel by pulling the camera closer (e.g., z=5.8 instead of z=7.2 per the snippet above). Test in both KioskPage (uses default) and ConversationPage (uses default) — there's no current consumer passing `compact`, but keep the prop for future small-size embedding.

### 5.5 Acceptance check — Section 5

1. Compile + build:
   ```bash
   cd frontend && npm run build
   ```
   No errors. Bundle size for the chunk containing `RiverSong.jsx` may shrink (no `.glb` loader) or stay similar.

2. Open the Speak (Conversation) page in a browser. The new orb should render *exactly* like `prototypes/presence-orb.html` v3.3 with the user's current palette + environment applied. The avatar.glb model should not be visible.

3. State transitions: speak into the mic. The flow should run idle → listening (orb ripples) → transcribing (still ripples) → thinking (sparkles orbit, particles disperse) → speaking (ripples with audio) → idle. **Each state should be visually distinct** as in the prototype.

4. Flip palette in Settings. Without reload, the orb should recolor (the `MutationObserver` fires, palette state updates, uniforms lerp).

5. Flip environment. The page backdrop should update (CSS-only — no orb change).

6. Kiosk page: navigate to `/kiosk` (or whatever route renders KioskPage). Orb should render identically.

7. Refresh while on Speak. Orb renders cleanly without a fallback `.glb` flash.

---

## 6. (Optional / deferred) Orbital data panels on Speak page

The prototype shows 4 floating data panels orbiting the orb (`#panel-1`..`#panel-4` divs with `positionPanels(t)` updating their transforms). For the live app, these panels would show real-time household data:

- Spice palette: Calendar next event · Active daemons · Current temperature · Now playing
- Halo palette: Calendar next event · Active daemons · Current temperature · Now playing
  (Same data, palette only changes the labels/styling, not the data source)

**This is deferred.** Do NOT implement in this swap. Leave the orb alone in its space on the Speak page. The panels can be a separate task once the orb is stable.

If you implement them anyway, you'll have to wire data fetches (calendar, daemon registry, environment sensors) which is out of scope. Stop and ask before going there.

---

## 7. Universal out-of-scope

- **No commits or pushes.** User commits.
- **No new dependencies.** All needed packages (`three`, `@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing`) are already in `frontend/package.json`.
- **No changes to `avatar.glb`** — it stays on disk, just isn't loaded.
- **No changes to `core/conversation_loop.py`, `api/routes/conversation.py`,** or anything that drives the `state` prop. The new orb is a drop-in replacement.
- **No removal of the `theme` field.** Color theme (light/dark/halo) is separate from palette+environment for now. Don't consolidate them — that's a future cleanup task.
- **No styling changes to other pages** beyond the body-level backdrop. Inventory, Garage, Memory, etc. continue to look as they do today.
- **No real-time data wiring on the orbital panels.** Section 6 is deferred.

---

## 8. Reporting back

After each section's acceptance checks pass, output a short report. **Pause for the user's go-ahead between sections.**

Required report sections:

1. **Section completed:** §1 / §2 / §3 / §4 / §5
2. **Files created or modified:** one per line, full path from repo root
3. **Dependencies added:** Python + npm with version constraints (expected: none)
4. **Schema changes applied:** SQL inlined
5. **Acceptance checks run:** exact command + PASS/FAIL + 1-line detail
6. **Anything unexpected:** files that looked wrong but you didn't touch, decisions made not covered above, anything flagged for the user

Do not commit. Do not push. Do not create additional markdown files.
