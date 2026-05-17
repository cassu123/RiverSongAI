# RIVER SONG — CHROME & UX DESIGN PLAN
**Version:** 1.0  
**Status:** Design Lock — Pre-Implementation  
**Scope:** Global chrome, chat page, dashboard, navigation, model selector, component system  
**Stack:** React + Vite, Tailwind CSS, existing 3-axis theme system (Universe / Environment / Mood)

---

## 1. CORE PHILOSOPHY

### What This Is Not
- Not a SaaS dashboard (no sidebar + main + card grid)
- Not a fake-JARVIS UI (no bogus radial gauges, fake telemetry, spinning rings)
- Not a website with a theme applied on top

### What This Is
**A room you inhabit.** The background IS the universe. The chrome is glass — thin, translucent, floating in front of the world. The user is not looking *at* an interface. They are *inside* a space that belongs to its universe.

### Design Principles
1. **Background is the room.** Universe environment fills the screen. Chrome does not compete with it.
2. **Liquid glass aesthetic.** `backdrop-blur`, translucent backgrounds, soft borders. Rounded corners — not bubble corners. `rounded-2xl` is the standard. Never `rounded-full` on cards.
3. **Content breathes.** Generous whitespace. Nothing edge-to-edge unless intentional.
4. **Chrome is ephemeral.** Persistent elements are minimal. Navigation appears when summoned, not by default.
5. **Two modes, everywhere.** Every page exists in either **Foyer mode** (home, overview) or **Workshop mode** (focused tool page). The chrome behaves differently in each.
6. **No repeated labels.** If the header says where you are, the content doesn't say it again. No breadcrumbs.
7. **Empty states are invitations.** Never "Nothing stored yet." Always a suggested action.

---

## 2. THE EXISTING 3-AXIS SYSTEM (DO NOT REDESIGN)

This is already shipped. The chrome plan builds on top of it.

| Axis | Values |
|---|---|
| **Universe** | `dune` · `halo` · `mv` (Monument Valley) · `nightcity` |
| **Environment** | Atreides · Harkonnen · Forerunner · UNSC · Sacred Spires · Garden Pavilion · Corpo Plaza · Pacifica Street |
| **Mood** | ~16 color palettes per environment |

Each environment already has: backdrop on `body::before`, density tokens, card material grammar, CSS-morphed RS logo. The chrome plan slots into this — it does not replace it.

---

## 3. GLOBAL CHROME SKELETON

### Three Zones — Every Page

```
┌─────────────────────────────────────────┐
│  ZONE 1: HEADER (56px, fixed top)       │
├─────────────────────────────────────────┤
│                                         │
│  ZONE 2: CONTENT (flex-1, scrollable)   │
│                                         │
├─────────────────────────────────────────┤
│  ZONE 3: INPUT / ACTION BAR (auto)      │
└─────────────────────────────────────────┘
```

### Zone 1 — Header

**Always contains (in order, left to right):**
- `[RsMark]` — small logo glyph, taps to home/dashboard. Never "River Song" text.
- `[Context]` — NOT the page name. Contextual info: time of day, active vehicle, active note title, location. Small, muted.
- `[Orb]` — voice trigger. Tap = start listening. Always top-right area.
- `[≡]` — nav drawer trigger. Always far right.

**Never contains:** Page title text, breadcrumbs, back arrows (swipe handles back), search bar.

**Tailwind:**
```html
<header class="h-14 px-4 flex items-center justify-between 
               backdrop-blur-xl bg-white/5 border-b border-white/10 
               fixed top-0 w-full z-50">
```

### Zone 2 — Content

Full bleed below header, above input bar. Internal padding `px-5`. Scrollable. The only zone that changes between pages.

```html
<main class="pt-14 pb-[var(--input-bar-height)] px-5 min-h-screen overflow-y-auto">
```

### Zone 3 — Input / Action Bar

**Contextual — changes per page.** Not a persistent nav bar.

| Page | Action Bar Contents |
|---|---|
| Chat / Speak | Two-row input box (see Section 6) |
| Dashboard | `[Speak to River]` prominent button |
| Memory | `[Search]` + `[+ Add Fact]` |
| Inventory | `[Scan]` + `[Search]` + `[+ Add]` |
| Maintenance | `[Log Service]` full-width |
| CHRONOS | `[+ New Note]` + `[Search]` |
| Read-only pages | Orb only, minimal |

---

## 4. TWO CHROME MODES

### Foyer Mode (Dashboard / Home)
The welcome state. River is present and speaking first.

| Element | Behavior |
|---|---|
| Orb | Larger, center-weighted, gentle pulse |
| Nav | Not visible. Accessed via header `≡` only |
| Content | Greeting + brief cards. Floating, not grid-locked |
| Input bar | Single prominent CTA: "Speak to River" |

### Workshop Mode (Any Tool Page)
You are doing a task. River is present but quiet.

| Element | Behavior |
|---|---|
| Orb | Small, header corner, dim pulse |
| Nav | Hidden. Reachable via `≡` or edge-swipe |
| Content | Full work surface, full focus |
| Input bar | Page-specific primary action |

**Transition:** No drama. Cards recede. Input bar morphs. 200ms ease-out.

---

## 5. NAVIGATION

### Taxonomy

**Primary — Always accessible via drawer (6 items):**
1. Speak — voice/text conversation
2. Memory — facts, preferences, history
3. Home Node — device control
4. CHRONOS — markdown vault
5. Pulse — maintenance, tasks, vehicles
6. Routines — automations

**Secondary — Behind "More" section in drawer (14 items):**
Inventory, Culinary, Garage, Store, Analytics, Feeds, Sifter, Reading, Google, Dreamscape, Environment, Admin, Profile, Settings

**Nav Drawer Structure:**
```
┌─────────────────────────────┐
│  [RS]  River Song      [×]  │
├─────────────────────────────┤
│  🎙  Speak                  │
│  🧠  Memory                 │
│  🏠  Home Node              │
│  📓  CHRONOS                │
│  ⚡  Pulse                  │
│  ⚙️  Routines               │
├─────────────────────────────┤
│  — More —                   │
│  📦 Inventory  🍳 Culinary  │
│  🚗 Garage     🏪 Store     │
│  📊 Analytics  📰 Feeds     │
│  🔍 Sifter     📚 Reading   │
│  ✨ Dreamscape 🌍 Environment│
├─────────────────────────────┤
│  — Admin —                  │
│  ⚙️ Settings   🚪 Logout    │
└─────────────────────────────┘
```

**Drawer behavior:**
- Slides from left on mobile/tablet
- `backdrop-blur-2xl` overlay, not full dark block
- Primary items: icon + label, always
- Secondary items: two-column grid, icon + label
- Closes on outside tap or swipe

**Navigation methods (in priority order):**
1. `≡` header button → drawer
2. Voice: "Hey River, open Memory"
3. Edge swipe from left (mobile)
4. `Cmd+K` / `Ctrl+K` → command palette

---

## 6. CHAT / SPEAK PAGE

### Empty State Layout

```
┌─────────────────────────────────────────┐
│  [Rs]  SPEAK              [orb]  [≡]   │
│                                         │
│                                         │
│                                         │
│   Good evening, Cheryl.                 │
│   What do you need?                     │
│                                         │
│   [contextual suggestion if any]        │
│                                         │
│                                         │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │  Ask River Song...              │   │
│  │                                 │   │
│  │  [+]  [Think] [Search]  [llama3][🎙]│
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

### Input Bar — Two-Row Structure

**Row 1:** Text input field. Placeholder: "Ask River Song..." Full width, no icons.

**Row 2 (below text):**
- Left: `[+]` attachment button → bottom sheet
- Left: `[Think]` toggle pill — active/inactive
- Left: `[Search]` toggle pill — active/inactive
- Right: Model name pill (e.g., `llama3`) → taps to model selector sheet
- Right: `[🎙]` mic button

**Tailwind (input container):**
```html
<div class="rounded-2xl backdrop-blur-2xl bg-white/5 border border-white/10 
            px-4 pt-3 pb-3 mx-4 mb-4 shadow-xl shadow-black/30">
  <!-- Row 1: text -->
  <textarea class="w-full bg-transparent text-primary placeholder:text-muted 
                   resize-none outline-none text-sm min-h-[44px]" 
            placeholder="Ask River Song..." rows="1" />
  <!-- Row 2: controls -->
  <div class="flex items-center justify-between mt-2">
    <div class="flex items-center gap-2">
      <button class="...">+</button>
      <TogglePill label="Think" icon="..." />
      <TogglePill label="Search" icon="..." />
    </div>
    <div class="flex items-center gap-2">
      <ModelPill /> 
      <MicButton />
    </div>
  </div>
</div>
```

### Toggle Pill States

```html
<!-- Active -->
<button class="rounded-xl px-3 py-1 text-xs font-medium 
               bg-accent/20 border border-accent/40 text-accent
               backdrop-blur-sm flex items-center gap-1.5">

<!-- Inactive -->
<button class="rounded-xl px-3 py-1 text-xs font-medium 
               bg-white/5 border border-white/10 text-muted
               backdrop-blur-sm flex items-center gap-1.5
               hover:bg-white/10 transition-colors">
```

### Active Conversation Layout

```
┌─────────────────────────────────────────┐
│  [Rs]  SPEAK              [orb]  [≡]   │
│                                         │
│                    ┌─────────────────┐  │
│                    │ You: message    │  │  ← right-aligned, user tint
│                    └─────────────────┘  │
│                                         │
│  ┌──────────────────────────────────┐   │
│  │ ◉  River's response here...     │   │  ← left-aligned, orb avatar
│  │                                  │   │
│  │    [inline card if applicable]   │   │
│  └──────────────────────────────────┘   │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │  Ask a follow-up...             │   │
│  │  [+]  [Think] [Search]  [llama3][🎙]│
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

**Message bubbles:**
- Not standard rounded chat bubbles
- Floating glass cards: `rounded-2xl backdrop-blur-xl bg-white/5 border border-white/10`
- User messages: right-aligned, slightly different tint (`bg-accent/10`)
- River messages: left-aligned, small orb avatar left of card
- Inline data (weather, search results) renders as embedded mini-cards inside River's message

---

## 7. MODEL SELECTOR — BOTTOM SHEET

### Interaction Flow

1. Tap model name pill in input bar
2. Bottom sheet slides up — **Sheet 1: Model Family**
3. Tap a family → **Sheet 2: Model Variant**
4. Tap variant → sheet dismisses, pill updates

### Sheet 1 — Model Family

```
┌─────────────────────────────────────────┐
│  ——  (drag handle)                      │
│                                         │
│  Select Model                           │
│                                         │
│  ◉ Ollama (Local)          ✓ active    │
│    llama3, deepseek, mistral            │
│                                         │
│  ○ Gemini                               │
│    Google's models                      │
│                                         │
│  ○ OpenAI                               │
│    GPT-4o, o1, o3                       │
│                                         │
│  ○ Image Generation                     │
│    DALL-E, Stable Diffusion             │
│                                         │
└─────────────────────────────────────────┘
```

### Sheet 2 — Model Variant (example: Ollama selected)

```
┌─────────────────────────────────────────┐
│  ——                                     │
│                                         │
│  ← Ollama                               │
│                                         │
│  Fast                          ✓        │
│  Quick answers, daily tasks             │
│                                         │
│  Thinking                               │
│  Complex reasoning, step-by-step        │
│                                         │
│  Pro                                    │
│  Advanced code, analysis                │
│                                         │
└─────────────────────────────────────────┘
```

**Sheet Tailwind:**
```html
<div class="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl 
            backdrop-blur-2xl bg-surface/80 border-t border-white/10
            shadow-2xl shadow-black/50 p-6">
```

### `+` Attachment Sheet

```
┌─────────────────────────────────────────┐
│  ——                                     │
│                                         │
│  📷  Camera                             │
│  🖼  Photo / Gallery                    │
│  📎  Document                           │
│  🔗  Link / URL                         │
│  📁  File                               │
│                                         │
└─────────────────────────────────────────┘
```

---

## 8. DASHBOARD PAGE

### Layout — Foyer Mode

```
┌─────────────────────────────────────────┐
│  [Rs]  Good evening          [orb] [≡] │  ← context = time greeting
│                                         │
│                                         │
│   Good evening, Cheryl.                 │  ← H1, large, left
│   Here's where things stand.           │  ← subtitle, muted
│                                         │
│   ┌─────────────┐  ┌────────────────┐  │
│   │  Email       │  │  Weather       │  │  ← floating glass cards
│   │  3 unread    │  │  76°F Clear    │  │    NOT grid-locked
│   └─────────────┘  └────────────────┘  │    different sizes OK
│                                         │
│   ┌──────────────────────────┐         │
│   │  Events  ·  2 today       │         │  ← wider card
│   │  09:00 Team sync          │         │
│   │  14:00 PT test            │         │
│   └──────────────────────────┘         │
│                                         │
│   ┌─────────────────────────────────┐  │
│   │  System · Nominal · 7h uptime   │  │  ← status strip, subtle
│   └─────────────────────────────────┘  │
│                                         │
│         [  Speak to River  ]            │  ← prominent CTA button
└─────────────────────────────────────────┘
```

### Dashboard Rules
- Greeting is the H1. It is personal and time-aware.
- Cards float — they are NOT in a CSS grid. Use `flex flex-wrap gap-4` with varying `basis` widths.
- Cards are glass: `rounded-2xl backdrop-blur-xl bg-white/5 border border-white/10 p-4`
- System status is one compressed line at the bottom, not a 12-label grid.
- "Speak to River" button is the only bottom action bar element on dashboard.
- Tapping a card expands it to fill the content zone. Other cards recede (opacity 40%, scale 98%).

### What Is NOT on the Dashboard
- No breadcrumb
- No "DASHBOARD" page title
- No system health grid with 12 individual status indicators
- No suggestion chips (this is not a general AI — River knows the user)

---

## 9. GLASS CARD SYSTEM

### Base Card

```html
<div class="rounded-2xl backdrop-blur-xl bg-white/5 border border-white/10 
            shadow-lg shadow-black/20 p-4">
```

### Elevated Card (important info)

```html
<div class="rounded-2xl backdrop-blur-2xl 
            bg-gradient-to-br from-white/10 to-white/5 
            border border-white/20 shadow-xl shadow-black/30 p-4">
```

### Card Sizes (dashboard, not grid-locked)

| Type | Width | Use |
|---|---|---|
| Small | `w-[calc(50%-8px)]` | Weather, quick stat |
| Medium | `w-full` | Events, messages list |
| Wide | `w-full` | System status, brief text |

### Card Interaction
- Hover: `hover:bg-white/10 hover:border-white/20 transition-all duration-200`
- Tap/click: scale down slightly, then expand to fill if navigable
- Active/expanded: `ring-1 ring-accent/40`

---

## 10. COMPONENT STANDARDS

### Sub-Navigation (tabs within a page)

One style across the entire app. Pill tabs:

```html
<div class="flex gap-1 bg-white/5 rounded-xl p-1">
  <!-- Active tab -->
  <button class="rounded-lg px-4 py-1.5 text-sm font-medium 
                 bg-white/15 text-primary transition-all">
  <!-- Inactive tab -->
  <button class="rounded-lg px-4 py-1.5 text-sm font-medium 
                 text-muted hover:text-primary hover:bg-white/5 transition-all">
</div>
```

### Search Input

One style across the entire app:

```html
<div class="flex items-center gap-2 rounded-xl 
            bg-white/5 border border-white/10 px-3 py-2.5">
  <SearchIcon class="w-4 h-4 text-muted flex-shrink-0" />
  <input class="flex-1 bg-transparent text-sm text-primary 
                placeholder:text-muted outline-none" 
         placeholder="Search [context-appropriate]..." />
</div>
```

### Empty States

```html
<div class="flex flex-col items-center justify-center py-16 gap-3 text-center">
  <div class="text-4xl opacity-40">[icon]</div>
  <p class="text-primary font-medium">No [items] yet.</p>
  <p class="text-muted text-sm">River can help you add your first [item].</p>
  <button class="...primary button...">Add [Item]</button>
</div>
```

### Primary Button

```html
<button class="rounded-xl px-5 py-2.5 font-medium text-sm
               bg-accent text-on-accent 
               hover:bg-accent/90 active:scale-[0.98]
               transition-all duration-150">
```

### Destructive / Secondary Button

```html
<button class="rounded-xl px-5 py-2.5 font-medium text-sm
               bg-white/5 border border-white/10 text-primary
               hover:bg-white/10 active:scale-[0.98]
               transition-all duration-150">
```

---

## 11. RESPONSIVE BEHAVIOR

### Mobile (< 768px) — Primary Design Target

- Header: full width, 56px, all 4 elements
- Content: single column, `px-5`
- Cards: full width OR two-column flex-wrap
- Nav: drawer from left
- Input bar: anchored to bottom, above safe area inset
- Model sheet / attachment sheet: bottom sheet, full width

### Tablet (768px – 1199px)

- Header: same as mobile
- Content: max-width centered, `max-w-2xl mx-auto`
- Cards: can be two or three columns
- Nav drawer: wider (320px vs 280px)
- Input bar: centered, `max-w-2xl mx-auto`
- Consider: persistent thin left rail (48px, icons only) replacing hamburger

### Desktop (≥ 1200px)

- Left rail: 240px, collapsible. Primary nav always visible.
- Header: slimmer, no hamburger when rail is expanded
- Content: centered with max-width `max-w-3xl`
- Chat history sidebar: 280px, left of content, collapsible
- Input bar: centered, `max-w-3xl mx-auto`

---

## 12. THE SKIN — 3-AXIS VISUAL TRANSFORMATION

The bones (§3–§11) **do not move** per environment. RsMark stays top-left. Orb stays top-right. Zones stay in their slots. What changes is the **skin**: backdrop, symbols, glyphs, ornament, and motion — driven entirely by the existing 3-axis system (Universe × Environment × Mood).

### 12.1 The Three Skin Axes

| Axis | What it drives | Lives on |
|---|---|---|
| **Universe** (`dune` · `halo` · `mv` · `nightcity`) | Backdrop scene, ambient motion, RsMark morph family | `<body data-universe>` |
| **Environment** (Atreides, Harkonnen, Forerunner, UNSC, Sacred Spires, Garden Pavilion, Corpo Plaza, Pacifica Street) | Symbol set (icons, glyphs, ornament), card frame language, enter/exit motion curve | `<body data-env>` |
| **Mood** (~16 per env) | Color tokens only — surfaces, accents, text, borders | `<body data-mood>` |

A skin change never touches HTML structure or component code. It only changes the cascade.

### 12.2 The Skin Layers (what actually swaps)

1. **Backdrop** — `body::before` scene per Universe (already shipped).
2. **Symbol set** — one SVG sprite per Environment. Icons, drawer glyphs, divider characters, ornament marks. Components reference symbols by semantic name (`<Icon name="memory" />`); the sprite mapping changes per env.
3. **RsMark** — CSS-morphed glyph, already per-environment.
4. **Ornament** — card edge style, drawer trim, button corner, divider character. Tokens: `--ornament-card-edge`, `--ornament-divider`, `--ornament-corner`.
5. **Motion** — enter/exit curve, axis, duration. Tokens: `--motion-enter-curve`, `--motion-enter-axis`, `--motion-duration`. Atreides rises; Harkonnen slides; Sacred Spires layers in Z; Pacifica assembles from fragments.
6. **Color** (Mood layer) — `--surface`, `--surface-elev`, `--accent`, `--text-primary`, `--text-muted`, `--border`, `--ring`. Everything else derives via `color-mix()`.

### 12.3 CSS Architecture (the "best type of CSS")

**One cascade. No CSS-in-JS. No styled-components. No runtime style computation.**

- **Cascade layers** (`@layer reset, tokens, bones, skin, components, utilities`) — predictable specificity, no `!important`.
- **Custom properties** scoped to `<body data-universe data-env data-mood>` — the single source of skin truth.
- **Logical properties** everywhere (`padding-inline`, `margin-block`, `border-inline-start`) — RTL-ready, future-proof.
- **`color-mix()`** for derived tints — one accent token yields hover/active/ring states without extra variables.
- **`clamp()`** for fluid type and spacing — no per-breakpoint font-size rules.
- **Container queries** (`@container`) for component-level responsiveness — a card adapts to *its slot*, not the viewport. This is what makes the same component look right in a drawer, a sheet, and a full-page grid without code branches.
- **`:has()`** for context-aware styling — e.g. header densifies when content is scrolled (`body:has(main.scrolled) header`).
- **Native CSS nesting** — flatter source, no preprocessor needed.
- **View Transitions API** — Foyer ↔ Workshop, sheet open/close, card expand are declarative cross-document or same-document transitions, not JS animation libraries.
- **`prefers-reduced-motion`** — every motion token has a reduced fallback.
- **No Tailwind arbitrary values** for skin concerns. Skin lives in tokens; Tailwind references tokens (`bg-[var(--surface)]`). Components stay env-agnostic.

### 12.4 Responsive Discipline (mobile · tablet · desktop)

The bones are the same everywhere. Density and slot count change.

- **Fluid sizing first.** `clamp(min, preferred, max)` on type, spacing, card padding. The shell stops needing breakpoints for most things.
- **Container queries for components.** A `<GlassCard>` in a 320px drawer slot uses dense layout; the same card in a 720px grid slot uses spacious layout. Same component, no props.
- **Three viewport modes only** (§11): mobile < 768px, tablet 768–1199px, desktop ≥ 1200px. These switch *slot count* (drawer vs rail; bottom sheet vs popover) — not component internals.
- **`dvh` / `svh` / `lvh`** for mobile heights — keyboard-up doesn't break the input bar.
- **Safe-area insets** (`env(safe-area-inset-*)`) on the bottom action bar always.
- **Pointer media queries** (`@media (pointer: fine)`) for desktop-only hover. Mobile gets press states, not phantom hovers.
- **Input row 2 collapses** when the on-screen keyboard is open (uses `:focus-within` + container query on the input bar slot).

### 12.5 The One Rule

Components are skin-agnostic. They consume tokens. If a component file has the word `dune`, `halo`, `atreides`, or any hex color in it, that is a bug.

---

## 13. WORKSHOP MODE — TOOL PAGE STANDARD

When navigating to any tool page (Inventory, Maintenance, CHRONOS, etc.):

```
┌─────────────────────────────────────────┐
│  [Rs]  [active context]     [orb] [≡]  │
│                                         │
│  [Sub-nav tabs if applicable]           │
│                                         │
│                                         │
│              [CONTENT]                  │
│                                         │
│                                         │
│                                         │
│  [Primary action for this page]         │
└─────────────────────────────────────────┘
```

**Workshop mode rules:**
- No greeting text. Get to work immediately.
- Orb is small and dim. It's listening but not demanding.
- Sub-nav tabs (if present) directly below header, full width.
- One primary action in the bottom bar. Not multiple.
- "Ask River about this" is always available via orb tap — not a button.

---

## 14. WHAT TO BUILD FIRST (IMPLEMENTATION ORDER)

1. **Global layout shell** — Header, content zone, input/action bar. Three zones, responsive.
2. **Glass card component** — Base, elevated, sizes. Reusable.
3. **Nav drawer** — Primary + secondary + admin sections. Slide from left.
4. **Dashboard page** — Greeting, floating cards, system status strip, speak CTA.
5. **Chat / Speak page** — Two-row input bar, toggle pills, model pill.
6. **Model selector sheets** — Family sheet → variant sheet. Two-step.
7. **Attachment sheet** — Camera, Photo, Document, Link, File.
8. **Sub-nav tab component** — Pill style, reusable.
9. **Search component** — Unified across all pages.
10. **Empty state component** — Reusable with icon, text, CTA props.
11. **Tool pages** — Apply workshop mode skeleton to each existing page.

---

## 15. WHAT TO KILL IN THE CURRENT BUILD

| Current pattern | Replace with |
|---|---|
| Repeated page title in H1 after header | Remove. Header context covers it. |
| Breadcrumb (e.g., "DATA / FEEDS") | Remove entirely. |
| 12-label system health grid | One compressed status strip |
| Floating action buttons mid-screen | Integrated into bottom action bar |
| Inconsistent card border-radius | `rounded-2xl` everywhere |
| Inconsistent search bar styling | Unified search component |
| "Nothing stored yet." empty states | Invitation-style empty states |
| Full-width flat text label nav list | Grouped drawer with icons |
| "DASHBOARD", "FEEDS", "SPEAK" H1 page titles | Remove. Context in header only. |
| WEB / THINK toggles orphaned above input | Moved into input bar row 2 |
| Model selector as standalone dropdown | Two-step bottom sheet |

---

*End of RIVER_SONG_CHROME_PLAN.md*  
*Next artifact: RIVER_SONG_CHROME_COMPONENTS.md (individual component specs with full Tailwind)*
