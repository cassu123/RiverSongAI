# River Song AI — UI Chrome Brainstorm Prompt

**Audience:** Claude or Gemini in their chat app (web/mobile) — where you can upload screenshots, share references, and iterate visually faster than in a CLI.

**Mode:** Visual + conceptual brainstorm. **No code yet.** The goal of this conversation is to lock the *shape* and *layout philosophy* of the chrome. Implementation happens later, back in the IDE, against a finalized direction.

Paste the entire body below as your opening message.

---

## Paste-ready prompt

I'm designing the UI chrome for **River Song AI** — a personal AI home assistant I'm building (web app at `riversongai.com`, eventually native apps). I want to brainstorm the layout/chrome with you in this thread because the CLI is too slow for visual iteration. Here's the full context — read it before responding.

### What River Song is

A multi-user, multi-modal AI assistant that lives in the home: voice-first kiosk on Google Home Hubs, web app on tablets/phones, eventually a native Android app and an ArduRover mower. It does:

- Conversation (voice + text), with a presence orb that has shader-driven idle/listening/thinking/speaking states
- Memory (facts, preferences, conversation history)
- Routines / automations
- Home device control
- Inventory (UPC scan, barcode, household items)
- Culinary (recipes, stockroom, meal prep)
- Pulse (maintenance, vehicles, household)
- CHRONOS (Obsidian-style markdown vault)
- Reading / Feeds / Analytics

Multiple "pages" in the current build. Roughly 20 distinct destinations.

### The three-axis presence system (already implemented, do NOT redesign this)

I have a three-axis theming system already shipped in code:

- **Universe** — one of `dune` | `halo` | `mv` (Monument Valley) | `nightcity` (Cyberpunk). Drives the typographic mood and which environments are valid.
- **Environment** — 2 per universe, 8 total:
  - Dune: **Atreides** (noble palace, raked sunset light, stone) · **Harkonnen** (dreadnought, oil-black, crimson, ribbed steel)
  - Halo: **Forerunner** (ceramic cathedral, hex pattern, cyan hard-light) · **UNSC** (military hangar, amber tactical, steel plates)
  - Monument Valley: **Sacred Spires** (Escher impossible geometry, cool pastel) · **Garden Pavilion** (horizontal organic, warm pastel)
  - Night City: **Corpo Plaza** (clean brutalist, chrome+magenta) · **Pacifica Street** (decayed neon, scanlines, yellow flicker)
- **Mood** — ~16 color palettes; pick one within an environment. Pure color, no layout impact.

Each environment already has: distinct backdrop on `body::before`, density tokens (padding/gap/radius/border-width), card material grammar (texture/shadow/btn actuation), per-env CSS-morph of the RS logo. **All of this works.**

### The problem — what's NOT working

The chrome is still a SaaS dashboard:

```
┌─────────┬───────────────────────────────────────┐
│  SIDE   │   page header                          │
│  BAR    │  ┌─────────────────────────────────┐  │
│  with   │  │ card                            │  │
│  20     │  └─────────────────────────────────┘  │
│  nav    │  ┌─────────────────────────────────┐  │
│  items  │  │ card                            │  │
│  on     │  └─────────────────────────────────┘  │
│  left   │  ┌─────────────────────────────────┐  │
│         │  │ card                            │  │
└─────────┴───────────────────────────────────────┘
```

This is the same pattern as Notion, ChatGPT, Linear, Slack — and as every "JARVIS clone" GitHub repo I've seen. Changing the colors and density doesn't make it stop reading as a website. The user (me) wants the **layout itself** to rearrange per environment so each room embodies its universe.

### What I do NOT want

- Cluttered fake-JARVIS dashboards with bogus radial gauges, fake telemetry, fake scrolling code, spinning rings around empty data
- The standard sidebar + main + card-grid SaaS pattern
- More "futuristic" decoration glued on top of a website
- A Tony Stark cosplay

### What I DO want (vibes, not specs)

- **Kimi-clean** (kimi.com) — flowing, minimal, generous whitespace, a clear primary action, soft transitions. NOT chart-heavy.
- **Diegetic chrome** — the frame around content should feel like it *belongs to the universe*. Atreides chrome should feel like being inside an Atreides palace. Forerunner chrome should feel like floating inside a Forerunner construct. Each environment is its own room with its own architecture.
- **Layout rearranges per environment** — the position of the logo, navigation, presence orb, and content area should physically shift between environments. Same building blocks, eight different rooms.
- **Function flows** — there should be a clear primary path through the app. Right now everything is a flat list of pages with no obvious "next action." I want it to feel like the assistant is *leading* me somewhere.

### The building blocks (constants across all 8 environments)

These four elements need a home in every chrome variant. Their *position*, *shape*, and *style* can change; their *existence* and *function* are fixed.

1. **`<RsMark>`** — the River Song logo. Already env-morphing (CSS-only). Acts as "home"/identity.
2. **Navigation** — 6–8 primary destinations (Speak, Memory, Routines, Inventory, Culinary, CHRONOS, Pulse, Profile). The remaining 12 pages live behind a "more" or a command palette. Today everything is in a sidebar list with labels; the brainstorm is open on whether to keep labels or go glyph-only.
3. **Presence orb** — the conversation/AI indicator. Three.js shader, already palette-aware. Idle by default, animates during conversation.
4. **Page content** — the actual work surface (chat, lists, forms, etc.). Should breathe. Kimi-clean.

### What I want from this thread

Help me iterate on:

1. **The fundamental chrome pattern.** Not 8 different shells from scratch — one shell whose layout *primitive* shifts per environment. Examples of patterns I'm considering (not committed to any):
   - **Dock + canvas** — nav as a dock (top/bottom/side/corner/floating-arc); content is the whole canvas. Dock position changes per env.
   - **Centered orb with orbiting controls** — orb in center, nav as a radial menu around it, content slides in/out like decks of cards.
   - **Spatial zones** — the screen IS the room; pages are zones with diegetic transitions (stepping through a Forerunner portal vs walking down a Harkonnen corridor).
   - **HUD overlay** — content fills the screen, chrome is a thin overlay at edges (corner glyphs, edge-mounted controls). NOT fake-JARVIS — minimal and meaningful.
   - **Command-first** — no persistent nav at all, a hot-key or floating action opens a command palette. Whole screen is content. Most Kimi-like.

2. **How the chrome should physically shift between the 8 environments.** ASCII mockups, sketches, or just descriptions. For each, the key questions are: where does the logo live? where is nav? where is the presence orb? what frames the content? what's the dominant motion (vertical/horizontal/radial/none)?

3. **How navigation distills from 20 pages to 6–8 visible primaries.** Which destinations are always-visible vs. behind a "more"? Glyphs vs. labels? Does nav even need to be persistent?

4. **References.** I don't have a great visual reference library. I've called out:
   - Good: Kimi (clean), the four fictional universes above
   - Bad: any "JARVIS dashboard" YouTube tutorial, generic SaaS dashboards
   
   What other actual products / fictional UIs / films / games have nailed "diegetic chrome that respects the world it lives in"? Show me images.

### Hard constraints (don't violate)

- The 3-axis system (universe/env/mood) is already shipped. Build on it, don't redesign it.
- Accessibility — keyboard nav, screen reader, focus indicators must all work
- Mobile/tablet — must collapse gracefully (we're not designing 8 chromes × 3 viewports, but the primary chrome must scale)
- No new heavy 3D — the orb is already three.js; we're not adding another WebGL scene per environment
- The presence orb stays. The shader code is locked.

### What I want you to produce in this conversation

1. **Three or four chrome patterns** with rough mockups (ASCII, image-gen, or hand-sketch descriptions). Make them genuinely different from each other — don't give me three variations of "sidebar".
2. **One recommended pattern**, with reasoning. Why does this one fit River Song specifically?
3. **For the recommended pattern: eight env-specific mockups** (one per env: Atreides / Harkonnen / Forerunner / UNSC / Spires / Garden / Corpo / Pacifica) showing how the four building blocks rearrange.
4. **A navigation taxonomy** — which 6–8 destinations are primary, and how the rest are reached.
5. **Visual references** — at least 5 images of real or fictional UIs that capture the spirit you're proposing. Upload them if you can generate, otherwise describe with enough specificity that I can google them.

Take your time. Ask me clarifying questions before you mock anything if the brief is ambiguous. I'd rather iterate slowly on the right direction than fast on the wrong one.

---

## After this conversation

Once we lock a direction in the chat app, bring back to the IDE:

- The chosen chrome pattern (one paragraph + one ASCII mockup)
- The eight env-specific layouts (one ASCII mockup each)
- The navigation taxonomy (which 6–8 primaries, how the rest are reached)
- Any specific design tokens that emerged (new CSS vars, new component contracts)

That goes into a new `RIVER_SONG_CHROME_PLAN.md` next to the existing build plans, with the same ultra-detail level as `RIVER_SONG_BUILD_PLAN_2.md` so a coding agent can execute it without inferring.
