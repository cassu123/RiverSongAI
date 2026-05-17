# RIVER SONG CHROME — LIVE APP MIGRATION PLAN
**Source:** `/preview` sandbox (9-scene PhotoStage + cohesive chrome)
**Target:** Live app (`App.jsx` + `Sidebar.jsx` + 30+ pages)
**Status:** Plan locked, awaiting Phase 1 execution.

---

## Goal
Take what's working in `/preview` (photographic backdrop engine + header/drawer/sheet/card grammar) and replace the live app's flat-color body backdrop + permanent left-rail Sidebar with it, one phase at a time. Every phase ships a visible, standalone improvement so the app is never broken-in-progress.

---

## Architectural deltas (preview → live)

| Concern | Preview today | Live today | Action |
|---|---|---|---|
| Routing | none (PreviewApp owns state) | `App.jsx` state-machine via `currentPage` | Keep `App.jsx` model, just swap chrome around it |
| Chrome | Header (top) + Drawer (overlay) + Action bar (bottom) | Permanent left Sidebar (432 lines, inline styles) + mobile topbar inline in App.jsx | Replace |
| Backdrop | `<Stage>` — 9 scenes, photographic engine | `themes.css` `body::before/::after` flat tinted gradient | Replace |
| Tokens | `preview.css` `@layer preview-tokens` (--rs-*) | `themes.css` (--md-*, --bg-base, --primary, etc.) | Merge — preview already consumes `--bg-base` and `--primary` |
| Auth/admin/features | none (mocked) | `AuthProvider`, admin toggle in Sidebar, feature flags | Preserve all logic, move admin into drawer footer |
| Universe/env/mood | local state | `App.jsx` state + `/api/auth/profile` PATCH | Already correct, no change needed |

---

## Phase 1 — Backdrop engine into live app
**Goal:** every page in the live app gets the photographic 9-scene backdrop behind it. Sidebar + pages untouched.

**Files to create:**
- `frontend/src/chrome/Stage.jsx` — port of `preview/PreviewStage.jsx`
- `frontend/src/chrome/Grade.jsx` — port of `preview/PreviewGrade.jsx`
- `frontend/src/chrome/useCanvasEffect.js` — extract the hook (currently inlined in PreviewStage)
- `frontend/src/styles/chrome-stage.css` — extract `@layer preview-stage` block (everything `.rs-photo-*` and per-env scene styles)

**Steps:**
1. Copy PreviewStage.jsx → `chrome/Stage.jsx`. Strip the preview-only `import PreviewGrade`. Wire `Grade` import.
2. Copy PreviewGrade.jsx → `chrome/Grade.jsx`. Identical.
3. Move `@layer preview-stage` rules out of `preview.css` into `chrome-stage.css`. Update `.rs-stage*`/`.rs-photo*` rules to live outside the preview layer cascade so they apply globally.
4. In `App.jsx`: import `Stage` + `chrome-stage.css`. Render `<Stage environment={environment} />` as the first child of `.app-shell` so it sits behind everything.
5. In `themes.css`: gate `body::before`/`body::after` behind `body:not(.rs-stage-active)` so the flat backdrop disappears when the engine is mounted.
6. In `App.jsx` mount effect: `document.body.classList.add('rs-stage-active')` (cleanup on unmount).
7. Drop the 9 base images into `frontend/public/` (see `PREVIEW_IMAGE_PROMPTS.md`). Optional — fallback gradients work without them.
8. Verify every env across the existing app: Dune·Atreides (Caladan), Dune·Harkonnen, Dune·Arrakis (new), Halo·Forerunner, Halo·UNSC, MV·Spires, MV·Garden, NC·Corpo, NC·Pacifica.

**Risks:**
- `themes.css` has 529 lines of skin logic that may conflict with `chrome-stage.css`. Gate everything behind `body.rs-stage-active`.
- Live app uses `--primary` and `--bg-base` from `themes.css`. Stage CSS reads these — should already work.
- Sidebar sits at z-index 50 and uses backdrop-filter. Stage must sit at z-index ≤ 0.

**Done when:**
- Loading the app at `/` shows the photographic backdrop behind the Sidebar + page content
- Switching env in Profile triggers a clean backdrop swap
- No visible flicker / double-backdrop / z-index issues
- `/preview` still works identically (sandbox preserved during migration)

**Out of scope:**
- Replacing the Sidebar (Phase 2)
- Rewriting any page (Phase 3)
- Removing themes.css (the design tokens stay — only the backdrop layer gets gated)

---

## Phase 2 — Chrome shell replacement
**Goal:** retire the permanent Sidebar. Adopt header (top) + overlay drawer + action bar (bottom). Pages render in a content slot.

**Files to create:**
- `frontend/src/chrome/Shell.jsx` — port of `preview/PreviewShell.jsx`
- `frontend/src/chrome/Drawer.jsx` — port of `preview/PreviewDrawer.jsx`, extended with admin toggle + profile/settings/logout in footer (currently in Sidebar)
- `frontend/src/chrome/Sheet.jsx` + `SheetRow` — port of PreviewSheet
- `frontend/src/chrome/EnvIcon.jsx` — port of preview/EnvIcon.jsx (env-specific glyphs)
- `frontend/src/styles/chrome.css` — port of `preview.css` minus the `preview-stage` and `preview-skin` layers (moved to chrome-stage.css)

**Steps:**
1. Port Shell, Drawer, Sheet, EnvIcon to `chrome/`. Drawer absorbs Sidebar's admin toggle, profile row, settings/logout buttons in its bottom section.
2. Wire feature-flag filtering into Drawer's nav-item list (currently in Sidebar.jsx via `enabledFeatures.has(i.key)`).
3. In `App.jsx`:
   - Delete `<Sidebar>` import + render
   - Delete inline `<div className="mobile-topbar">` block (Shell's header replaces it)
   - Delete inline `<div className="mobile-overlay">` block (Drawer's scrim replaces it)
   - Wrap `<main className="app-main">` with `<Shell context={...} action={...} onOpenDrawer={...}>...</Shell>`
   - Compute `context` per page (e.g. "Memory · 142 facts", "Speak · 4:32pm", page-specific)
   - Compute `action` per page (Dashboard → "Speak to River" button; Chat → ChatInputBar; Memory → "Search + Add Fact"; etc.)
4. Migrate `mobile-topbar` CSS, `mobile-overlay` CSS, `sidebar*` CSS out of `global.css` (deletion).
5. Delete `Sidebar.jsx`.
6. Verify every page still loads, nav drawer opens with all groups (Primary · Tools · Account), admin toggle works, profile/settings/logout work.

**Risks:**
- Pages currently assume they own full viewport (no top header). Sticky elements in pages may collide with the new sticky header.
- Pages render with their own padding/margin — Shell's `.rs-content` adds its own. Need to audit each page's outermost wrapper.
- Mobile keyboard: input bar at bottom must not be hidden by virtual keyboard.

**Done when:**
- Live app on desktop and mobile uses Shell + Drawer + Action bar
- No Sidebar visible anywhere
- All nav reachable (drawer opens to all 16+ items, grouped)
- Admin toggle moved to drawer Account section
- Profile/Settings/Logout in drawer footer
- Every page still works (may look cramped — Phase 3 fixes that)

**Out of scope:**
- Rewriting page internals (Phase 3)
- Per-page action bar polish — Phase 2 just wires defaults

---

## Phase 3 — Page-by-page grammar migration
**Goal:** rewrite each page's internal layout to use the shared chrome grammar (`.rs-card`, `.rs-pill`, `.rs-btn-primary`, `.rs-msg`, `.rs-greeting`, `.rs-status-strip`, etc.) instead of bespoke per-page CSS.

**Priority order:**
| # | Page | Equivalent preview pattern | Notes |
|---|---|---|---|
| 1 | DashboardPage (811 lines) | PreviewDashboard | Greeting + card-flow + status strip. Card components already exist. |
| 2 | ChatPage (605 lines) / ConversationPage | PreviewChat + ChatInputBar | Thread + empty state + two-row input. |
| 3 | MemoryPage | (new) | List + search + add — uses .rs-card list + SheetRow for add flow |
| 4 | HomeNodePage | (new) | Device tiles → .rs-card grid |
| 5 | MaintenancePulsePage | (new) | Vehicles/tasks → card-flow |
| 6 | RoutinesPage | (new) | Routine cards |
| 7 | InventoryPage | (new) | Item grid + scan flow → bottom sheet |
| 8 | ProfilePage | (new) | Form fields → glass card sections |
| 9 | SettingsPage | (new) | Toggles + grouped sections |
| 10 | ChronosPage | (new) | Markdown vault — biggest rewrite, save for last |
| 11-end | Culinary, Garage, Store, Analytics, Feeds, Sifter, Reading, Google, Dreamscape, Environment, Admin, Users, Kill Switch, Setup, Signup, Login | as needed | Many are admin/rare-use, low priority |

**Per-page steps (template):**
1. Read the page, identify what's structural vs functional
2. Replace outer container with a single content wrapper (no need for own header/sidebar — Shell handles those)
3. Replace bespoke buttons with `.rs-pill` or `.rs-btn-primary`
4. Replace bespoke cards with `<article className="rs-card">`
5. Replace ad-hoc typography with `.rs-greeting`, `.rs-card-label`, `.rs-card-value`, etc.
6. Provide page-specific `action` prop to Shell from inside the page or via App.jsx wiring
7. Delete the page's now-redundant CSS file
8. Verify on mobile (S24 Ultra portrait) + desktop

**Risks:**
- Each page has its own state, hooks, API calls — preserve all logic
- Some pages (Chronos, Inventory, BarcodeScanner) have heavy specialized UI that doesn't fit card grammar — leave bespoke where appropriate
- CSS deletion is risky: keep until verified

**Done when:**
- All priority-1-through-10 pages migrated and verified
- Bespoke page CSS files deleted where the shared grammar covers them
- Page-specific action bars wired per `RIVER_SONG_CHROME_PLAN.md` Section 3

---

## Post-migration cleanup
After Phase 3 ships:
1. Delete `frontend/src/preview/` directory
2. Remove `/preview` route from `main.jsx`
3. Remove `PREVIEW_IMAGE_PROMPTS.md` from `public/` (or rename to `BACKDROP_IMAGE_PROMPTS.md` and keep)
4. Update `RIVER_SONG_CHROME_PLAN.md` status to "Shipped"

---

## Cross-cutting concerns (apply to all phases)

- **Auth flow** (LoginPage, SignupPage, SetupPage): may not need chrome — they're full-bleed splash pages. Decide per page in Phase 3.
- **Kiosk mode** (`/kiosk`): standalone, no chrome. Leave alone.
- **OAuth callbacks** (`/callback`, `/reading-oauth-callback`): no chrome. Leave alone.
- **Mobile S24 Ultra** is the perf/responsive target. Verify each phase on it.
- **Backwards-compat localStorage keys** (`rs-page`, `rs-universe:${user.id}`, etc.) must be preserved.
- **`/api/auth/profile` PATCH** for universe/env/mood — already correct, don't touch.
- **Feature flags** (`enabledFeatures` Set) — Drawer's nav list must respect these.

---

## Checklist

### Phase 1 — Backdrop engine
- [ ] Create `chrome/Stage.jsx`
- [ ] Create `chrome/Grade.jsx`
- [ ] Create `chrome/useCanvasEffect.js`
- [ ] Create `styles/chrome-stage.css` with all scene styles
- [ ] Gate `themes.css` body backdrop behind `body:not(.rs-stage-active)`
- [ ] Mount `<Stage>` in `App.jsx`, add `rs-stage-active` body class
- [ ] Verify all 9 envs render with fallback gradient
- [ ] Optional: drop 9 base images into `frontend/public/`

### Phase 2 — Chrome shell
- [ ] Create `chrome/Shell.jsx` (header + content + action)
- [ ] Create `chrome/Drawer.jsx` with sections + admin toggle + profile/settings/logout footer
- [ ] Create `chrome/Sheet.jsx` + SheetRow
- [ ] Create `chrome/EnvIcon.jsx`
- [ ] Create `styles/chrome.css` (tokens, glass, pills, cards, drawer, sheet)
- [ ] Wire feature-flag filtering into Drawer
- [ ] Delete `Sidebar.jsx` from App.jsx; wrap with `<Shell>`
- [ ] Delete `.mobile-topbar`, `.mobile-overlay`, `.sidebar*` from `global.css`
- [ ] Delete `Sidebar.jsx` file
- [ ] Verify all pages render, drawer works, admin toggle works, all envs work

### Phase 3 — Page migrations (in priority order)
- [ ] DashboardPage
- [ ] ChatPage / ConversationPage
- [ ] MemoryPage
- [ ] HomeNodePage
- [ ] MaintenancePulsePage
- [ ] RoutinesPage
- [ ] InventoryPage
- [ ] ProfilePage
- [ ] SettingsPage
- [ ] ChronosPage
- [ ] Remaining pages (one batch session each)

### Post-migration
- [ ] Delete `frontend/src/preview/`
- [ ] Remove `/preview` route from `main.jsx`
- [ ] Update `RIVER_SONG_CHROME_PLAN.md` status

---

## Notes for future sessions

- This plan is intentionally additive — each phase ships standalone. If a phase blocks on an unexpected issue, stop and re-scope rather than half-completing.
- Preview sandbox stays alive through Phase 1 + Phase 2 so we can compare. Only delete in post-migration.
- When picking up a new session, read this file + run `git log --oneline -20` to see what's already done.
- The `feedback_verify_prior_session` memory applies — don't trust prior summaries blindly; check actual code state.
