# River Song AI — Layout Rework (ultra-detailed)

**Audience:** Gemini (or any model with shell + file access in the repo root).
**Mode:** Feature build. Three discrete fixes against the post-presence-swap codebase committed at `08a3d0e`. User feedback is that the swap is "invisible" — colors + body backdrop apply but get covered by the opaque app shell, the PRESENCE toggle is in the wrong settings page, and the layout itself doesn't transform per environment. This brief addresses all three.

**Do not commit. Do not push.** User commits.

---

## 0. Verification standards (read first)

### 0.1 Python — use `py_compile` not `ast.parse`
The Round 3 lesson: `ast.parse` does not catch `await` outside `async def`. Always `python3 -c "import py_compile; py_compile.compile('<path>', doraise=True)"`.

### 0.2 App imports after backend changes
```bash
source venv/bin/activate
python3 -c "import sys; sys.path.insert(0,'.'); from main import app; print('routes:', len(app.routes))"
```
Expected: routes ≥ 310 (current baseline at `08a3d0e`).

### 0.3 Frontend build sanity
```bash
cd frontend && npm run build
```
No errors. Bundle should mention `index-*.css`, `index-*.js`, `ProfilePage-*`, etc.

### 0.4 Browser-test before claiming done
Spin up `python3 main.py` + `npm run dev`, open `http://localhost:5173`, click through Speak → Profile → Settings → Dashboard → Inventory. **You must see the environment backdrop on every page** when the work is done. If you cannot reach a browser, say so — do not claim "looks correct" without rendering.

### 0.5 Do NOT touch
- `core/auth.py`, `core/family.py`, `core/conversation_loop.py`
- `api/routes/conversation.py`, anything in `api/routes/` except where this brief edits
- `providers/llm/*`, `providers/tts/*`, `providers/stt/*`
- `.env`, `.env.example`
- The orb shader code inside `RiverSong.jsx` — that's already correct. Section 3 of this brief touches only the wrapper, not the shaders.

### 0.6 Source of truth for the orb visual
`prototypes/presence-orb.html` v3.3 — already deployed to `frontend/public/presence-orb.html`. Don't touch it.

---

## Section 1 — Make the environment backdrop actually visible

### 1.1 The bug

The `body::before` pseudo-element in `frontend/src/styles/themes.css` (lines 560-617) paints the four environment rooms (Atreides / Harkonnen / Forerunner / UNSC) on the body using `position: fixed; inset: 0; z-index: 0`. This is correct.

But `frontend/src/styles/global.css` and the per-page component CSS paint **opaque** backgrounds over the entire viewport:

- `global.css:41` defines `--md-background: #0F1316` (hardcoded dark).
- `global.css:126` applies `background-color: var(--md-background)` to (verify the selector — likely `html` or `.app-shell` or `#root`; grep `--md-background` to find consumers).
- Every page-level component (`.dashboard-page`, `.conversation-page`, `.settings-page`, etc.) inherits or duplicates this opaque background.

**Result:** the body backdrop renders, but every pixel above z-index 0 covers it. The user sees no change.

### 1.2 What "fixed" looks like

The environment backdrop **must be visible** somewhere on every page. The visibility doesn't need to be 100% of the viewport — but it must be apparent that the page exists *inside a room*. Acceptable presentations:

- **Translucent main content area** so the body backdrop shows through everywhere there isn't a card.
- **Visible gutters / padding** between cards where the backdrop shows.
- **Transparent header strip** at the top where the backdrop bleeds through.

The simplest correct change: stop painting `--md-background` over the body. Let body's `var(--bg-base)` (palette-derived) be the ambient color, and let `body::before` (environment) paint the room. Then individual cards/panels can use semi-translucent surfaces (`var(--md-surface)` with reduced alpha) so the room shows through *behind* them.

### 1.3 Step-by-step

#### 1.3.1 Audit current surface-color uses

```bash
grep -rn "var(--md-background)\|var(--md-surface)\|var(--md-surface-container)" frontend/src --include="*.css" | head -40
```

You'll find them used as opaque fills on `.dashboard-card`, `.settings-section`, `.conversation-panel`, etc. Don't change those individually yet — change them centrally.

#### 1.3.2 Modify `frontend/src/styles/global.css`

Find the consumer of `--md-background` (likely a selector like `html, body { background-color: var(--md-background); }` or `.app-shell { ... }`). Replace its background-color with `transparent` (or remove the rule entirely). Body color comes from `themes.css`'s `body { background: var(--bg-base); ... }` rule — that stays.

#### 1.3.3 Make panel surfaces translucent

For the surface fills:
- `--md-surface` was an opaque color; redefine it as a *translucent* derivative of `--md-background`:

```css
:root {
  --md-surface:                 color-mix(in srgb, var(--md-background) 88%, transparent);
  --md-surface-container:       color-mix(in srgb, var(--md-background) 82%, transparent);
  --md-surface-container-low:   color-mix(in srgb, var(--md-background) 76%, transparent);
  --md-surface-container-high:  color-mix(in srgb, var(--md-background) 92%, transparent);
}
```

(`color-mix` is supported in all modern browsers — Chrome 111+, Safari 16.2+, Firefox 113+. The frontend already requires modern browsers, so this is fine.)

Result: cards are 76-92% opaque over a translucent palette ambient, with the environment backdrop showing through gaps and bleeding faintly through every card.

#### 1.3.4 Sidebar adjustment

`frontend/src/components/Sidebar.jsx` and its CSS — the sidebar should keep a *high* opacity (so its content stays readable) but should have a faint translucency so the environment continues *behind it*. Set its surface to roughly 90-94% opacity over the palette base.

#### 1.3.5 Add a subtle vignette to focus the eye

Add to `themes.css` *after* the environment backdrops:

```css
/* Vignette — concentrates attention on the content, lets the room breathe at edges */
body::after {
  content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 0;
  background: radial-gradient(ellipse at center, transparent 35%, rgba(0,0,0,.45) 100%);
}
```

The existing v3 holo-grid `body::after` block in themes.css — if it conflicts with this rule, replace the holo-grid with this vignette. The holo-grid was a mockup-only ornament; the vignette is better for the live app.

### 1.4 Acceptance check — Section 1

1. `cd frontend && npm run build` — passes.
2. Reload the live app, navigate Speak → Dashboard → Inventory → Settings → Profile. **On every page, the room backdrop (stone blocks / iron ribs / hex tiles / steel plates) is visible behind the content.**
3. Switch palette in Profile (Section 2 will move the picker, but the mechanism works today): the room visibly changes within ~1 second.
4. Switch environment: the room shifts within ~1 second.
5. The text in cards stays readable — translucency does not make content illegible. If it does, bump the alpha closer to 95%.

---

## Section 2 — Move PRESENCE controls to ProfilePage

### 2.1 Why

The user calls `ProfilePage` "user settings." The theme picker (theme-grid + theme-cards) lives there at `frontend/src/pages/ProfilePage.jsx:304-320`. The user wants the PRESENCE toggles directly next to those theme cards — same page, same visual register, same mental model.

The PRESENCE section currently in `SettingsPage.jsx:538` should be **removed** from SettingsPage and **added** to ProfilePage.

### 2.2 Edit ProfilePage.jsx

`frontend/src/pages/ProfilePage.jsx:30` — the current signature is:

```jsx
export default function ProfilePage({ profile, onSave, theme, onThemeChange })
```

Extend it to:

```jsx
export default function ProfilePage({
  profile, onSave,
  theme, onThemeChange,
  palette, environment, onPaletteChange, onEnvironmentChange
})
```

After the theme-grid block at line 304-320, insert a new block. Match the existing visual style (use the same `theme-grid` / `theme-card` class structure if possible so they read as siblings — or introduce parallel `palette-grid` / `palette-card` classes for visual distinction):

```jsx
{/* Universe (palette) */}
<div className="profile-section">
  <h3 className="profile-section-title">UNIVERSE</h3>
  <div className="palette-grid">
    {['spice', 'halo'].map(p => (
      <button
        key={p}
        className={`theme-card ${palette === p ? 'theme-card--active' : ''}`}
        onClick={() => onPaletteChange(p)}
      >
        <div className="theme-card-preview">
          <div className="theme-card-ring" />
          <div className="theme-card-bar" />
        </div>
        <span className="theme-card-label">{p === 'spice' ? 'SPICE · DUNE' : 'HALO'}</span>
        {palette === p && <span className="theme-card-active-dot" />}
      </button>
    ))}
  </div>
</div>

{/* Environment — gated by palette */}
<div className="profile-section">
  <h3 className="profile-section-title">ENVIRONMENT</h3>
  <div className="palette-grid">
    {(palette === 'spice'
      ? [['atreides', 'ATREIDES'], ['harkonnen', 'HARKONNEN']]
      : [['forerunner', 'FORERUNNER'], ['unsc', 'UNSC']]
    ).map(([key, label]) => (
      <button
        key={key}
        className={`theme-card ${environment === key ? 'theme-card--active' : ''}`}
        onClick={() => onEnvironmentChange(key)}
      >
        <div className="theme-card-preview">
          <div className="theme-card-ring" />
          <div className="theme-card-bar" />
        </div>
        <span className="theme-card-label">{label}</span>
        {environment === key && <span className="theme-card-active-dot" />}
      </button>
    ))}
  </div>
</div>
```

Find the matching `profile-section` / `profile-section-title` styles in `ProfilePage.css` and confirm the class names are real; if the file uses different naming, match it. Don't invent class names without confirming.

### 2.3 Remove the PRESENCE section from SettingsPage

`frontend/src/pages/SettingsPage.jsx` — find the section added at line 538 (`<Section title="PRESENCE">` block). Delete it cleanly, including its CSS additions at lines 469-470 if those are exclusive to PRESENCE. Also remove `palette`, `environment`, `onPaletteChange`, `onEnvironmentChange` from the destructured props at line 129-132. Settings no longer needs them.

### 2.4 Update App.jsx — re-route the props

`frontend/src/App.jsx` — currently `SettingsPage` receives palette/environment props (per commit `08a3d0e`). Move them to `ProfilePage` instead.

Find the SettingsPage render (where `palette={palette} environment={environment}` were added). Strip those four props back to the original:

```jsx
{currentPage === 'settings' && <SettingsPage onFeaturesChanged={refreshFeatures} />}
```

Find the ProfilePage render block (around line 230-240 — grep for `<ProfilePage`). Extend it:

```jsx
{currentPage === 'profile' && (
  <ProfilePage
    profile={profile}
    onSave={setProfile}
    theme={theme}
    onThemeChange={setTheme}
    palette={palette}
    environment={environment}
    onPaletteChange={setPaletteSafe}
    onEnvironmentChange={setEnvironment}
  />
)}
```

### 2.5 Acceptance check — Section 2

1. Navigate to Profile page. Theme cards visible, AND directly below them (or above — match the visual flow of the existing page), Universe cards (Spice / Halo) and Environment cards (Atreides+Harkonnen or Forerunner+UNSC) appear.
2. Navigate to Settings page. PRESENCE section is gone.
3. Click a Universe card. Body recolors immediately; Environment cards swap to the new universe's pair.
4. Click an Environment card. Room backdrop swaps.
5. Refresh: all settings persist (via existing server profile sync).

---

## Section 3 — Palette-aware layout (the architectural fix)

This is the work that makes River Song "feel like an AI home assistant, not a website." The user is right that color + backdrop alone isn't transformative. The *shape* of the chrome needs to shift per palette/environment.

### 3.1 Scope of this section

Do not redesign every page. Instead:
1. Introduce **density tokens** (CSS variables) that environments override.
2. Update the global chrome — sidebar, page header, card borders, scrollbars — to consume those tokens.
3. Re-test that the four palette × environment combinations now look genuinely different.

Deferred from this brief: per-page redesigns (Inventory list density, Dashboard widget grid, etc.) — those are individual followups. This brief gets the *shell* feeling theme-aware.

### 3.2 Density / chrome tokens

Add to `frontend/src/styles/themes.css`, immediately after the palette blocks at line 553 (before the env-backdrop blocks):

```css
/* ─ Density / chrome tokens — overridden per environment ──────────────────── */
:root {
  --layout-pad:           20px;
  --layout-gap:           14px;
  --card-radius:          2px;
  --card-border-width:    1px;
  --card-border-style:    solid;
  --card-shadow:          none;
  --divider-style:        solid;
  --type-tracking:        0.08em;
  --type-case:            uppercase;
  --sidebar-width:        260px;
  --sidebar-bg-alpha:     0.88;
}

/* Atreides — noble, sparse, calm, raking light */
body[data-env="atreides"] {
  --layout-pad:           28px;
  --layout-gap:           20px;
  --card-radius:          1px;
  --card-border-width:    1px;
  --card-shadow:          0 4px 20px rgba(0,0,0,0.35);
  --divider-style:        solid;
  --type-tracking:        0.18em;
  --type-case:            uppercase;
  --sidebar-bg-alpha:     0.82;
}

/* Harkonnen — dense, industrial, tight grids, oppressive */
body[data-env="harkonnen"] {
  --layout-pad:           12px;
  --layout-gap:           6px;
  --card-radius:          0px;
  --card-border-width:    1px;
  --card-shadow:          inset 0 0 0 1px rgba(255,40,20,.08);
  --divider-style:        solid;
  --type-tracking:        0.04em;
  --type-case:            uppercase;
  --sidebar-bg-alpha:     0.95;
}

/* Forerunner — pristine, hex-architectural, tall */
body[data-env="forerunner"] {
  --layout-pad:           24px;
  --layout-gap:           18px;
  --card-radius:          4px;
  --card-border-width:    1px;
  --card-shadow:          0 0 24px rgba(180,230,250,.10);
  --divider-style:        solid;
  --type-tracking:        0.12em;
  --type-case:            none;
  --sidebar-bg-alpha:     0.78;
}

/* UNSC — tactical, hard-edged, military hangar */
body[data-env="unsc"] {
  --layout-pad:           14px;
  --layout-gap:           8px;
  --card-radius:          0px;
  --card-border-width:    2px;
  --card-shadow:          0 2px 0 rgba(240,140,50,.18);
  --divider-style:        solid;
  --type-tracking:        0.06em;
  --type-case:            uppercase;
  --sidebar-bg-alpha:     0.92;
}
```

### 3.3 Apply tokens to the shell

#### 3.3.1 Main content padding + gap

Find the main content container in `frontend/src/App.jsx` JSX (around lines 200-250 — grep for the wrapping div around `currentPage === 'dashboard' && ...`). Whatever class wraps the per-page area, its CSS in `global.css` (or App.css if present) should use:

```css
.app-main-content {  /* whatever class is currently there */
  padding: var(--layout-pad);
  gap: var(--layout-gap);
  background: transparent;  /* allow body::before backdrop through */
  transition: padding 0.6s ease, gap 0.6s ease;
}
```

#### 3.3.2 Cards / panels

Find the most-used card class in `global.css` (likely `.card`, `.dash-card`, `.settings-section`, or similar). For each:

```css
.<card-class> {
  background: var(--md-surface);   /* now translucent per §1 */
  border: var(--card-border-width) var(--card-border-style) var(--line, rgba(255,255,255,.08));
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
  padding: var(--layout-pad);
}
```

This is where the user sees the shape change: Atreides cards are spacious with soft shadows; Harkonnen cards are tight with razor-sharp corners and a subtle inset crimson; Forerunner cards float with cyan halo; UNSC cards are wide with amber bottom-bar shadow.

#### 3.3.3 Sidebar

`frontend/src/components/Sidebar.css` (or wherever sidebar styles live — grep `.sidebar` in CSS). Set:

```css
.sidebar {
  background: color-mix(in srgb, var(--bg-base) calc(var(--sidebar-bg-alpha) * 100%), transparent);
  border-right: var(--card-border-width) solid var(--line, rgba(255,255,255,.08));
  width: var(--sidebar-width);
  transition: background 1s ease, width 0.4s ease;
}
```

Harkonnen sidebar is dense and 95% opaque (industrial cockpit feel); Forerunner sidebar is 78% (ambient cathedral). Same content; different *weight*.

#### 3.3.4 Typography

Section headings, tab labels, panel titles — give them theme-aware tracking and case:

```css
.section-title, .panel-title, .tab-label {
  letter-spacing: var(--type-tracking);
  text-transform: var(--type-case);
}
```

Find what classes those are in your actual codebase (grep `section-title|panel-title` in CSS) and apply the tokens.

#### 3.3.5 Scrollbars

```css
::-webkit-scrollbar-thumb {
  background: var(--secondary);
  border-radius: var(--card-radius);
}
```

Tiny but the eye picks it up.

### 3.4 Acceptance check — Section 3

Open the live app. Cycle palette × environment from Profile page. The user must report:

| Combination | What should be obvious |
|---|---|
| Spice + Atreides | Spacious, golden ambient, soft shadows, wide tracking on labels |
| Spice + Harkonnen | Dense, dark, tight grids, near-zero gutter, sharp corners, faint crimson inset on cards |
| Halo + Forerunner | Bright, airy, hex-tile room, gentle cyan halo around cards, generous spacing |
| Halo + UNSC | Tactical, dark steel, hard borders 2px, amber bottom-bar shadow on cards, dense grid |

If the user can't tell these four apart from across the room, density tokens need stronger values. Tune by widening the spread (Harkonnen 8px gap vs Forerunner 22px; etc.).

### 3.5 What Section 3 is NOT doing

- No per-page redesigns. The shell transforms; pages remain as they are inside the new shell.
- No new components. Nothing new in `frontend/src/components/`.
- No new icons, no new fonts.
- No animation of layout density changes beyond the existing transitions. Don't add motion choreography.
- No mobile-specific overrides. The existing responsive breakpoints stay.

---

## Section 4 — Universal out-of-scope

- No commits, no pushes. User commits.
- No new dependencies. All needed CSS features (`color-mix`, attribute selectors, custom properties) are already available.
- No changes to the orb shaders. The `RiverSong.jsx` shader code from commit `08a3d0e` is settled.
- No changes to backend routes, auth, store, or settings beyond §2's prop re-route.
- No changes to `prototypes/presence-orb.html`. Source of truth for the orb visual stays.

---

## Section 5 — Reporting back

After each section's acceptance checks pass, output a short report. Pause for user go-ahead between sections.

1. **Section completed:** §1 / §2 / §3
2. **Files created or modified:** one per line, full path
3. **Dependencies added:** Python + npm with version constraints (expected: none)
4. **Acceptance checks run:** exact command + PASS/FAIL + 1-line detail
5. **Anything unexpected:** files you didn't touch but flagged, decisions made not covered above
