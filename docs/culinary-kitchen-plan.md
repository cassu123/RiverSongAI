# River Song — Culinary / Kitchen: Full Build Plan

Handoff document for the implementing agent (Kimi / Antigravity). Self-contained:
read this top to bottom and you can execute without prior session context.

Branch: `claude/chat-voice-integration-bzdo2v` (same branch as the other plans).

Companion documents:
- `docs/chat-voice-unification-plan.md` — conversation service, agent loop,
  voice. Cook mode (K3) and autopilot (K4) depend on it.
- `docs/maintenance-garage-plan.md` — G1 establishes the proactive sweep
  machinery (reused in K1/K4); G4 sends verified parts to the shopping list
  built here.
- `docs/home-inventory-plan.md` — consumables were explicitly scoped OUT of
  the asset registry and INTO this domain.

Supersedes: `passoff/culinary-hardening.md` and `passoff/kitchen-restoration.md`
(both largely implemented; the few residual items are folded into K0 — after
K0 lands, those two files should be deleted from `passoff/`).

---

## 1. Mission

The kitchen runs three ways in this household — a planned week, nightly
"what's for dinner" votes, and bulk meal-prep sessions — and River supports
all three, tied together by a meal calendar. One household consumables
shopping list feeds itself (chat adds, stockroom auto-replenishes) and is the
single list every other section targets. At the stove, River is a hands-free
guided cook. Unprompted, River drafts the week, proposes dinner, and warns
about stock — the full autopilot.

Owner-confirmed product decisions (structured interview, 2026-07-19):

| Topic | Decision |
|---|---|
| Household style | Mix of all three: planned week + nightly voting + bulk prep, working together. The missing meal calendar is the spine. |
| Shopping list | ONE household consumables list. Chat adds to it; it auto-updates when stockroom items run low/empty. Check-off at the store. (Garage parts land on the same list under their own category.) |
| Cook mode | Full guided: River reads steps aloud, "next"/"repeat" voice control, named timers, on-the-fly scaling, mid-cook Q&A, stockroom depletion on completion. |
| Proactive | Plan + propose + warn: River drafts the week's meal plan for approval, fires the daily dinner proposal when nothing's planned, and warns about stock issues. |
| Store | Undecided ("I don't know"). Keep the existing Walmart mapping/export working against the new list; core list is store-agnostic; deeper Walmart (cart/API) is an **open judgment call** — do not build without a new decision. |

---

## 2. Current state (audited 2026-07-19)

### What exists and works (best-shaped section so far)
- `culinary/models.py` — `Household` (family-group aware via
  `resolve_module_owner(uid, "culinary")`, auto-created, equipment toggles),
  `Recipe` (JSON ingredients/steps/equipment, rating, image_url, blacklist
  flags, **synced to the Chronos vault as markdown** on save/delete),
  `BannedIngredient` (+ AI substitute recommendations), `StockroomItem`
  (barcode, good/low/out states, quantity/min_quantity), `PrepSession` +
  `PrepSessionRecipe` (bulk-cook, per-recipe scaling, container targets),
  `KitchenEquipment` (vision-based identify), `WalmartMapping`,
  `DinnerProposal` (family voting, live WebSocket broadcast).
- `api/routes/culinary.py` (2,334 lines) — biggest route file in the app:
  recipe CRUD/rate/scale/translate-equipment; **ingest engine** (URL or PDF
  incl. scanned pages via vision + Ollama parse, blacklist flagging, dedupe
  check); dinner proposals/vote/dismiss/cook-now; stockroom CRUD + barcode
  scan (Open Food Facts) + deplete; prep sessions (add/scale/remove recipes,
  staging, per-session master shopping list that cross-references stockroom,
  complete); Walmart mappings + export; `/api/culinary/ws` WebSocket for
  live vote/stock updates.
- `frontend/src/pages/CulinaryPage.jsx` (914 lines) — 7 tabs
  (MENU/DINNER/STOCK/PREP/LIST/HARDWARE/BANNED); the `kitchen-restoration`
  passoff was implemented: centered `RecipeDetailModal`, dynamic
  ingredient/step forms, interactive `StarRating`, filters, prep deck,
  vote/veto panel.

### Confirmed bugs / gaps
1. **The grocery LIST tab reads the home-inventory insurance manifest**
   (`/api/inventory/homes/{id}/manifest`, filtered by "low") — the asset
   registry, not food. The household grocery list does not exist as an
   entity; the tab shows nonsense.
2. **Chat's shopping tool writes to a shadow table**:
   `core/tools.py::_exec_add_shopping_list` creates its own raw
   `shopping_list` table in the main app DB. Nothing reads it.
3. **No canonical shopping list**: the prep-session list is ephemeral and
   per-session; stockroom LOW items inject only into prep lists. The garage
   (parts) and inventory (consumables) plans both assume "the shopping list"
   exists — this section owes the app that list.
4. **No meal calendar** — proposals are one-off; nothing plans a week.
5. `cook_now` hardcodes `target_servings = 4`.
6. Cooking never depletes the stockroom (deplete is a manual endpoint).
7. Residual hardening items from `culinary-hardening.md` to verify: modal
   Escape/focus trap, `api.del` purge, step `line-height`, test coverage for
   filters/edit/vote.

---

## 3. Build phases

Work in order; each phase independently shippable with its listed
verification. Commit per phase, push to `claude/chat-voice-integration-bzdo2v`.

### Phase K0 — Cleanup & quick fixes

1. Remove the insurance-manifest fetch from the grocery tab (interim: show
   the active prep session's shopping list + stockroom low/out items with a
   "real list coming" affordance; K1 replaces it properly).
2. `cook_now`: accept `target_servings` (default = household size setting,
   fallback 4).
3. Verify/finish the residual hardening items (Escape + focus trap on
   `RecipeDetailModal`, no `api.del` usages, step text `line-height ≥ 1.7`,
   tests for filter/edit/vote flows).
4. Delete `passoff/culinary-hardening.md` and `passoff/kitchen-restoration.md`
   once 1–3 verify (they are superseded by this plan).

Verify: grocery tab shows real (if interim) data; cook-now respects servings;
hardening acceptance boxes from the old passoff all check.

### Phase K1 — The One List (household consumables shopping list)

**Schema** (culinary models + the `_migrate_culinary_schema` pattern):

```python
class ShoppingListItem(Base):
    __tablename__ = "cul_shopping_list"
    id            # uuid pk
    household_id  # fk cul_households.id
    name          # str, indexed
    qty           # str (free-form: "2", "1 lb")
    unit          # str nullable
    category      # str — "grocery" default; "parts", "household", etc.
    source        # Enum: manual | chat | stockroom_auto | prep | meal_plan | parts
    source_ref    # nullable str (stockroom item id, prep session id, …)
    added_by      # user id
    checked_at    # nullable DateTime — checked off at the store
    created_at
```

- Routes: list (open + recently-checked), add, edit, check/uncheck, clear
  checked, bulk add. WebSocket broadcast on change (reuse `_ws_manager`) so
  two phones at the store stay in sync.
- **Auto-replenish**: when a stockroom item transitions to LOW or OUT
  (update/deplete/scan paths all funnel through one helper), auto-add to the
  list with `source=stockroom_auto`, deduped on (household, name,
  unchecked). Checking it off at the store optionally bumps the stockroom
  item back to GOOD (prompt once, remember the preference).
- **Chat tool rewrite**: `add_shopping_list_item` targets this table via the
  culinary session/household resolution; add `get_shopping_list` +
  `check_off_item` tools. One-time migration of shadow-table rows, then drop
  the shadow `CREATE TABLE` from `core/tools.py`.
- **Prep integration**: "send to shopping list" on a prep session's master
  list (source=prep, source_ref=session id) instead of the list being
  view-only.
- **Store mode UI** (replaces the LIST tab): grouped by category, big
  check-off rows, undo, "clear bought." Works one-handed on a phone.
- **Walmart export**: rewire the existing mappings/export to read this list.
  No deeper Walmart work (open judgment call — see §1).
- Garage plan G4's `find_parts` add-to-list lands here with
  `category="parts"` — coordinate the category constant.

Verify: "add milk" in chat appears on the list; marking a stockroom staple
OUT auto-adds it once; a prep session's needs land with one tap; two browser
tabs stay in sync while checking off; Walmart export still produces a file.

### Phase K2 — The meal calendar (the spine)

**Schema**:

```python
class MealPlanEntry(Base):
    __tablename__ = "cul_meal_plan"
    id            # uuid pk
    household_id  # fk
    plan_date     # Date
    slot          # Enum: breakfast | lunch | dinner | other (dinner-first UI)
    recipe_id     # fk cul_recipes.id, nullable (allow "eating out" / freeform label)
    label         # nullable str for non-recipe entries
    status        # Enum: planned | cooked | skipped
    created_by    # user id
    created_at
```

- Routes: week view (`GET /meal-plan?start=`), upsert entry, delete, mark
  cooked/skipped. WS broadcast.
- **Voting integration**: accepting a dinner proposal (majority yes, or
  "cook now") writes tonight's `MealPlanEntry`. The DINNER tab shows
  tonight's plan when one exists, proposal flow when it doesn't.
- **Prep integration**: a prep session can be created *from* a week's plan
  (selected entries → session recipes, scaled by household size); completing
  the session marks entries covered.
- **Plan-to-list**: "shop this week" aggregates planned recipes' ingredients
  (dedupe, cross-reference stockroom GOOD — reuse the prep list algorithm,
  extracted into a shared helper) → adds to the One List with
  `source=meal_plan`.
- UI: a WEEK tab (or the DINNER tab grows into PLAN) — 7-day strip,
  tap-to-assign from the library (filter/search inline), status badges.

Verify: plan three dinners, "shop this week" adds only missing ingredients;
accept a vote and it appears on tonight's slot; generate a prep session from
the plan.

### Phase K3 — Guided cook mode
*(Depends on chat plan Phases 1–3: conversation service, agent loop, voice.)*

- **Cook session**: launched from a recipe, tonight's plan entry, or a prep
  session's staging area. Backend: a pinned-context conversation session
  (same pattern as the garage helper, G2) whose context = full recipe
  (scaled), equipment translation for this household, and a step cursor.
- **Step engine**: current step displayed big + read aloud; voice intents
  "next", "back", "repeat", "how much <ingredient>", free-form Q&A answered
  against the pinned recipe + banned-substitutes + general knowledge.
  Text/tap controls work identically without voice.
- **Timers**: `set_timer(label, duration)` tool + timer state on the session;
  multiple named timers rendered in the cook UI; fired timers announce via
  TTS and push (phone in pocket, hands in dough).
- **Live scaling**: "make it for 6" re-scales remaining quantities using the
  existing scale endpoint logic.
- **Completion**: mark plan entry `cooked`; **deplete stockroom** — match
  recipe ingredients to stockroom items (normalized-name match; show a
  confirm sheet for fuzzy matches rather than guessing silently), which may
  trigger K1 auto-replenish; prompt for a star rating.

Verify: cook a recipe end-to-end by voice — steps, two named timers, one
mid-cook question, "make it for 6" — finish, stockroom decrements, list
gains the depleted staple, rating saved.

### Phase K4 — Kitchen autopilot
*(Depends on chat plan Phase 2 [agent] + the generalized sweep runner from
garage plan G1.)*

1. **Weekly draft plan**: scheduled (configurable day/time, default Sunday
   morning): River drafts the week — inputs: recipe ratings, stockroom on
   hand (prefer using what's here), variety (no repeats within N days),
   banned ingredients, household equipment. Delivered as an approval card in
   chat + briefing line; approve/edit writes `MealPlanEntry` rows; ignored
   drafts expire silently.
2. **Daily proposal**: when today has no dinner entry by the configured hour
   (default 15:00 local), auto-create a `DinnerProposal` (existing voting
   machinery + WS + push to household members). Accepted → plan entry (K2).
3. **Stock warnings**: fold into the briefing — staples (stockroom items
   with min_quantity set) at LOW/OUT beyond what auto-replenish already
   listed, phrased as "shopping day" awareness, max one line, weekly cadence
   unless newly critical.
4. Settings: per-household toggles for each of the three behaviors +
   schedule times; per-user notification opt-outs alongside the garage/
   inventory reminder settings.

Verify: Sunday draft arrives and approving it fills the week; an unplanned
day fires a proposal at 15:00 and votes resolve it; briefing mentions an OUT
staple exactly once that week.

---

## 4. Explicitly out of scope (leave hooks, do not build)

- **Walmart cart/ordering API** — owner undecided; export stays, nothing
  deeper without a new decision.
- Nutrition/macro tracking, dietary goal planning (not requested).
- Multi-store list splitting (single list, categories only).
- Recipe image generation (image_url upload/URL is enough this phase).
- Kova/child chore integration with kitchen tasks.

## 5. Working agreements for the implementing agent

- Same branch and conventions as the other plans (chat plan §6). Commit per
  phase; push `-u origin claude/chat-voice-integration-bzdo2v`.
- Culinary keeps its DB tables in the culinary models module with the
  existing `_migrate_culinary_schema` additive pattern.
- Family-group awareness via the existing `_get_household` path — every new
  route and tool goes through it; WS broadcasts key on household id.
- The One List is THE list: no other section may create its own; garage
  parts and any future source write here with a distinct `source`/`category`.
  The shared prep/plan aggregation logic lives in one helper, not copies.
- Tests: auto-replenish dedupe + state transitions, shadow-table migration,
  list check-off/undo, plan→list aggregation against stockroom, cook-mode
  step cursor + depletion matching, weekly draft respects banned/variety,
  daily proposal only fires when unplanned.
- Production auto-deploys nightly from `main` — merge only verified phases.
