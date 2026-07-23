# Design System: River Song AI (Spatial Edition)

## 1. Visual Theme & Atmosphere
A high-density, diegetic "Command Instrument" interface. The atmosphere is a synthesis of **Ethereal Glass** (Atreides/Garden) and **Tactical Telemetry** (Harkonnen/UNSC). It utilizes fluid spring-physics and cinematic spatial rhythm. The UI feels like a physical glass plate sitting in a precision-machined housing.

- **Density:** Cockpit Dense (8/10) - High data throughput, minimal padding between metrics.
- **Variance:** Offset Asymmetric (7/10) - Broken grids and overlapping layers to create depth.
- **Motion:** Cinematic Choreography (8/10) - Spring-based transitions and perpetual micro-loops.

## 2. Color Palette & Roles
The palette is driven by the **Three-Axis Presence System**.
- **Neutral Base:** Charcoal OLED (#050505) — Primary substrate
- **Glass Layer:** Translucent Zinc (rgba(24, 24, 27, 0.45)) — Card and panel backgrounds
- **Primary Accent:** River Blue (#0B6CF5) — Interactive elements, primary CTA
- **Sector Green:** Vitality (#4ADE80) — Nominal status, growth
- **Sector Red:** Hazard (#F87171) — Depleted stock, critical alerts
- **Whisper Border:** Inner Refraction (rgba(255, 255, 255, 0.12)) — 1px inner bezel for glass

**Banned:** Pure Black (#000000) for UI, neon purple glows, generic SaaS blue/purple gradients.

## 3. Typography Rules
Standardized on a professional, tech-forward stack.
- **UI Base:** Plus Jakarta Sans — For all labels, controls, and system text.
- **Display:** Orbitron or Universe-specific Serifs (Ibarra Real Nova) — For high-impact headers.
- **Telemetry:** JetBrains Mono — For all numbers, timestamps, and VIN/Asset data.
- **Iron Rule:** Body line length capped at 65ch. Tight tracking (-0.02em) for H1.

## 4. Component Stylings
- **Double-Bezel Cards:** Every card must use the nested architecture. An outer shell with 20px padding and a `rounded-[2rem]` radius, containing an inner glass core with `rounded-[calc(2rem-0.5rem)]`.
- **Liquid Glass:** Panels must use `backdrop-filter: blur(20px)` and a 1px inner border (`border-white/12`) to simulate edge refraction.
- **Pill Navigation:** Contextual controls use fully rounded pills with tactile push feedback (`scale(0.98)` on active).
- **Haptic Inputs:** Textareas and inputs use a deeper translucent background with a subtle inner shadow to create "recessed" depth.

## 5. Layout Principles
- **Three-Zone Skeleton:** 
  1. **Zone 1 (Header):** Fixed glass bar (56px).
  2. **Zone 2 (Content):** Independent scroll area with "Foyer" vs "Workshop" layouts.
  3. **Zone 3 (Action Bar):** Contextual tool zone that morphs per task.
- **Bento 2.0:** Use `grid-flow-dense` for all dashboards to ensure a gapless, interlocking layout of varying card sizes.
- **Viewport Stability:** All full-height sections use `min-h-[100dvh]`.

## 6. Motion & Interaction
- **Spring Physics:** Stiffness 100, Damping 20 for all UI reveals.
- **Perpetual Loops:** Active status indicators must "breathe" (opacity 0.6 <-> 1.0).
- **Staggered Entry:** Lists use a `100ms * index` cascade delay.
- **Magnetic Buttons:** Primary CTAs pull slightly toward the cursor.

## 7. Anti-Patterns (Banned)
- No emojis (use Lucide/Phosphor SVGs).
- No Inter font (too generic).
- No side-stripe borders (SaaS cliché).
- No nested cards (always use dividers or spacing).
- No "Oops!" or "Exclamation!" in copy. Be professional.
- No standard 'linear' transitions.

## 8. Responsive & Multi-Device (phone · tablet · resizable desktop)
This is a **web** front end used across a phone, a tablet, and a laptop with
resizable windows. Every screen must hold up from ~360px to ultra-wide. Tokens
and utilities live in `src/styles/breakpoints.css`; JS-side flags in
`src/hooks/useBreakpoint.js`.

- **Fluid first, breakpoints second.** Prefer `clamp()`, `minmax()`, and
  `repeat(auto-fit, …)` so layouts reflow *continuously* as a window resizes.
  Reach for a breakpoint only when the layout must change *shape*
  (e.g. rail ⇄ drawer), never just to hit a size. Use `.rs-auto-grid` (set
  `--rs-auto-min` per container) for card/bento grids instead of fixed columns.
- **ONE breakpoint scale.** `xs 380 · sm 480 · md 768 · lg 1024 · xl 1200`.
  Do not invent new values (we had 8 before). The shell already keys off `md`
  and `xl`. (CSS `@media` can't read the tokens — mirror the numbers, and keep
  `breakpoints.css` + `useBreakpoint.js` in sync.)
- **The Three Zones adapt:**
  - *Header (Zone 1):* stays fixed; on phones it holds the hamburger.
  - *Nav:* off-canvas **drawer** + scrim below `xl`; becomes a permanent
    **260px rail** at `xl`. **Known gap:** `md–xl` (tablet / resized laptop)
    still gets the phone drawer — close this when we rework the shell (a rail at
    `lg` is the likely answer).
  - *Content (Zone 2):* single column on phone; `.rs-auto-grid` fills wider
    viewports. Cap prose with `.rs-readable` (72ch).
  - *Action bar (Zone 3):* full-width and thumb-reachable on phone.
- **Touch targets ≥ 44px** for anything tappable (`.rs-touch`, or `min-height`).
  Assume no hover on phone/tablet — never hide primary actions behind `:hover`;
  gate hover-only affordances behind `@media (pointer: fine)`.
- **Relax density on small screens.** The "Cockpit Dense" spec is a *desktop*
  target; on phones, increase padding/gap and drop non-essential columns
  (see the column-dropping pattern in `responsive.css`) rather than shrinking
  text below ~14px.
- **Respect the platform:** honor `env(safe-area-inset-*)` (notches / home
  indicator — the shell does), size full-height sections with `100dvh`/`svh`
  (not `vh`), and never let the page scroll sideways — wide tables/code scroll
  inside their own `overflow-x:auto` wrapper (`.rs-table-wrap`).
- **Performance = design on mobile.** `backdrop-filter: blur(24px)` stutters on
  phones, so below `md` the glass blur steps down to `--glass-blur-sm`
  automatically. Keep perpetual "breathing" loops off-screen-cheap; respect
  `prefers-reduced-motion` (handled globally in `breakpoints.css`).
