# Design System: River Song AI

## 0. How to use this file

**The stylesheets are the source of truth. This file describes them.** Where
the two disagree, the CSS is right and this file is stale — fix the file, do
not "restore" the code to match it.

Everything below names real tokens and real classes. If a rule here sends you
to a token that does not exist, that is a bug in this document.

Tokens live in:

| What | Where |
| --- | --- |
| Colour roles, surfaces, status, veils, hairlines, scrims | `src/styles/global.css` |
| Per-environment material (border alpha, radius, glass, texture) | `src/styles/themes.css` |
| Type scale, spacing scale, motion, tap target | `src/styles/chrome-shell.css` |
| Layout utilities (`.rs-flex`, `.rs-gap-*`, `.rs-type-*`, …) | `src/styles/utilities.css` |
| Card, panel, field, pill, button | `src/styles/chrome-components.css` |
| Breakpoints and responsive helpers | `src/styles/breakpoints.css` |

An earlier version of this document specified a "double-bezel" nested card,
Tailwind class syntax, an Orbitron display font, Lucide icons and a spring
physics engine. None of those describe this codebase, and agents pointed at
the file rebuilt the UI to match them. That is why section 0 exists.

## 1. Visual theme

A high-density "command instrument" interface, spanning **Ethereal Glass**
(Atreides, Garden, Spires, Forerunner) and **Tactical Telemetry** (Harkonnen,
UNSC, Pacifica, Corpo), with Arrakis between them.

The governing idea: **a card is a surface sitting in the scene, not a window
laid over it.** The backdrop should read through it. Anything that draws a
crisp rectangle around a panel — a bright border, a hard shadow, a nested
inner shell — breaks this and is wrong, however good it looks in isolation.

- **Density:** dense on desktop, relaxed on phones (see §8).
- **Motion:** CSS transitions on `--rs-motion-curve`. No physics library.

## 2. Colour

Nothing in a component may name a colour literally. Use a token; the theme
moves it.

**Text**
- `--fg` — primary text
- `--text-muted` — secondary text. Do **not** stack `opacity` on top of it;
  the token is already at the contrast floor and dimming it again drops below
  4.5:1.

**Surfaces**
- `--bg-base` — the substrate, per environment
- `--md-surface-container-lowest` … `-highest` — the container hierarchy
- `--rs-veil-1 / -2 / -3` — a white lift over the ground (4% / 6% / 10%)
- `--rs-scrim-1 / -2 / -3` — a dark wash over media (25% / 60% / 80%)

**Edges**
- `--rs-hairline-soft / --rs-hairline / --rs-hairline-strong`

  All three derive from `--card-border-alpha`, which is what separates the
  ethereal environments from the tactical ones. Each is an offset plus a
  *fraction* of that alpha, not a straight multiple: at a straight multiple
  the tactical environments hit 0.25 and every panel outlined itself. Computed
  range is 0.053–0.145 across all three tiers.

**Status**
- `--rs-status-nominal`, `--rs-status-warning`, `--rs-status-critical`
- `--md-error` for form and validation errors

**Accent**
- `--primary` (theme accent), `--md-primary` (M3 primary)

**The one exception:** brand colours are data, not theme. Shopify `#96bf48`,
Walmart `#0071dc`, Home Depot `#f96302` and the like stay literal, as do
colours handed to a chart library — those reach SVG attributes, where `var()`
does not resolve.

**Banned:** pure `#000000` for UI, neon purple glows, generic SaaS
blue/purple gradients, and any raw `rgba(255,255,255,x)` or `rgba(0,0,0,x)`
where a veil, hairline or scrim token exists. A test enforces the last one.

## 3. Typography

- **UI:** Plus Jakarta Sans (`--font-base`)
- **Display:** `--font-display`, and `--font-mood` per universe (Ibarra Real
  Nova on Dune)
- **Telemetry:** JetBrains Mono (`--font-mono`) for numbers, timestamps, VINs
- **Icons:** Material Symbols Rounded, as a font

**Eight sizes, and nothing between them:**

```
--rs-fs-h1     clamp(2.5rem, 8vw, 4.5rem)
--rs-fs-h2     clamp(1.5rem, 4vw, 2.2rem)
--rs-fs-h3     1.25rem
--rs-fs-body   1.05rem
--rs-fs-small  0.9rem
--rs-fs-tiny   0.8125rem
--rs-fs-micro  0.75rem
--rs-fs-nano   0.6875rem   ← the floor. Nothing goes under it.
```

Reach for `.rs-type-h3 … .rs-type-nano` rather than setting `font-size`. The
app previously carried 79 distinct sizes, some at 7px. A test now fails on
anything below the nano rung.

Icon glyphs are exempt: sizing a `material-symbols-rounded` span sets a box,
not type.

Cap prose with `max-inline-size`, as `.rs-card-meta` and `.rs-greeting-sub`
do. (`.rs-readable` and `.rs-touch` were removed — they were never applied to
a single element.)

## 4. Components

- **Cards are one layer.** `.rs-card` is a single surface: theme-derived
  background, `--rs-hairline-strong` border, `--card-radius` corners,
  `clamp(18px, 4cqi, 28px)` padding, blur, and an inset highlight from
  `--inner-refraction`. Do not nest a second shell inside it. Use dividers or
  spacing.
- **`.rs-panel`** — a plain inset box: surface-container-low,
  outline-variant border, `--md-shape-md` corners. No glass.
- **`.rs-field`** — an input surface: `--rs-veil-1`, outline-variant border,
  `--md-shape-sm`.
- **`.rs-empty-glyph`** — the oversized faded icon on an empty list.
- **`.rs-pill`** — fully rounded contextual control, `scale(0.98)` on press,
  `min-height: var(--rs-tap)`.

When a component does `all: unset`, any `min-height` must come **after** it,
or the tap target is silently erased.

**Shape scale:** `--md-shape-xs 4 · sm 8 · md 12 · lg 14 · xl 20 · full 999`.
A bare `borderRadius: 10` is a shape token written longhand; a test fails on
anything within 3px of a rung.

## 5. Layout

**Three zones** (`src/styles/chrome-shell.css`):
1. **Header** — fixed glass bar, `clamp(54px, 7svh, 64px)` plus the top safe
   area.
2. **Content** — independent scroll area.
3. **Action bar** — contextual, morphs per task.

**Spacing is a 4pt scale:** `--rs-space-1 4 · 2 8 · 3 12 · 4 16 · 5 24 ·
6 32 · 7 48`, reached through `.rs-gap-*`, `.rs-mb-*`, `.rs-mt-*`, `.rs-p-*`.
If a number is not on the scale, take the nearest step rather than inventing
one.

**Prefer a class to an inline style.** Inline styles outrank the entire
cascade, so every one of them is a small permanent override. They are still
right for a genuinely one-off value, and for anything computed at runtime —
a width driven by state, a colour from a data row. They are wrong for layout
that repeats.

Utility selectors are deliberately doubled (`.rs-mb-4.rs-mb-4`). Those
declarations came from inline styles; at a single class they would lose to
any component rule touching the same property and the layout would shift.
`utilities.css` is imported last so equal-specificity ties go to the utility.

**Grids:** use `minmax(0, …)` tracks, never a bare `fr`. An `fr` track's
automatic minimum is `min-content`, so one long string pushes the whole grid
past its container instead of shrinking. `.rs-auto-grid` exists in
`breakpoints.css` for card grids, though nothing currently uses it.

Full-height sections use `100dvh`/`100svh`, never `vh`.

## 6. Motion

- Transitions use `--rs-motion-fast / -mid / -slow` with `--rs-motion-curve`.
  No `linear`.
- Active status indicators breathe (opacity 0.6 ↔ 1.0).
- Lists may stagger entry.
- `prefers-reduced-motion` is honoured globally in `breakpoints.css`.

## 7. Anti-patterns

- No emojis in UI — use Material Symbols.
- No Inter.
- No side-stripe borders.
- No nested cards.
- No colour literal where a token exists (see §2 for the brand exception).
- No `font-size` below `--rs-fs-nano`.
- No `opacity` used to dim text — change the colour token instead.
- No `linear` transitions.
- No "Oops!" or "Exclamation!" in copy.

## 8. Responsive & multi-device (phone · tablet · resizable desktop)

A **web** front end used on a phone, a tablet, and a laptop with resizable
windows. Every screen must hold up from ~360px to ultra-wide. Tokens live in
`src/styles/breakpoints.css`; JS-side flags in `src/hooks/useBreakpoint.js`.

- **Fluid first, breakpoints second.** Prefer `clamp()`, `minmax()` and
  `repeat(auto-fit, …)` so layouts reflow continuously. Reach for a
  breakpoint only when the layout must change *shape* (rail ⇄ drawer), never
  just to hit a size.
- **ONE breakpoint scale:** `xs 380 · sm 480 · md 768 · lg 1024 · xl 1200`.
  Do not invent new values — there were eight before this file. CSS `@media`
  cannot read the tokens, so mirror the numbers and keep `breakpoints.css`
  and `useBreakpoint.js` in sync.
- **The three zones adapt:**
  - *Header:* stays fixed; holds the hamburger on phones.
  - *Nav:* off-canvas drawer + scrim below `xl`; a permanent 260px rail at
    `xl`. **Known gap:** `md–xl` (tablet, resized laptop) still gets the
    phone drawer.
  - *Content:* single column on phone.
  - *Action bar:* full-width and thumb-reachable on phone.
- **Touch targets ≥ 44px** (`--rs-tap`). Assume no hover on phone or tablet —
  never hide a primary action behind `:hover`; gate hover-only affordances
  behind `@media (pointer: fine)`.
- **Relax density on small screens.** "Dense" is a desktop target. On phones
  increase padding and drop non-essential columns rather than shrinking text.
- **A side-by-side split must stack.** Two panes in a fixed-height flex row
  will each take a fraction of a 390px screen, and no amount of tuning saves
  a four-column table in 118px. Put the ratios in classes, not inline — an
  inline `flex` outranks the stacking rule and it will silently do nothing.
- **Respect the platform:** honour `env(safe-area-inset-*)`, size full-height
  sections with `dvh`/`svh`, and never let the page scroll sideways — wide
  tables and code scroll inside their own `overflow-x: auto` wrapper
  (`.rs-table-wrap`).
- **Performance is design on mobile.** `backdrop-filter: blur(24px)` stutters
  on phones, so below `md` the glass steps down to `--glass-blur-sm`
  automatically.

## 9. What is enforced

`src/styles/design-tokens.test.js` fails the build on:

- a non-icon `font-size` below `--rs-fs-nano`
- a generic colour literal in a style attribute that a token covers
- a raw white/black `rgba()` inside the veil, hairline or scrim bands
- a bare `borderRadius` within 3px of a `--md-shape-*` rung

Gradient stops, shadow colours, brand colours and colours in plain data
objects are exempt, and the test says so where it checks.
