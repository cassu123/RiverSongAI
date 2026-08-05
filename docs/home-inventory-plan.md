# River Song — Home Inventory: Full Build Plan

Handoff document for the implementing agent (Kimi / Antigravity). Self-contained:
read this top to bottom and you can execute without prior session context.

Branch: `claude/chat-voice-integration-bzdo2v` (same branch as the other plans).

Companion documents:
- `docs/chat-voice-unification-plan.md` — unified conversation service, agent
  loop, tool receipts. Inventory chat tools (Phase I3) depend on it.
- `docs/maintenance-garage-plan.md` — establishes the proactive reminder sweep
  pattern (G1). Inventory's reminders (Phase I5) reuse that machinery.

---

## 1. Mission

The owner is in the military. Home inventory is a **PCS move companion**: a
registry of everything they own that isn't consumable, so that when movers
pack the household out, every item can be verified on arrival — and anything
missing or damaged has claim-ready documentation (photos, serials, values,
receipts) already on file. Day to day it doubles as the "where is it / what's
it worth" brain for the household's stuff.

Owner-confirmed product decisions (structured interview, 2026-07-19):

| Topic | Decision |
|---|---|
| Purpose | Asset registry of all non-consumable possessions. Move verification: "when I move I can verify I have everything from transport." NOT a consumables/stock tracker — kill the LOW/DEPLETED framing. |
| Capture | All paths: photo + AI identification, UPC/barcode lookup, voice ("add the DeWalt drill to the garage"), and a fast manual form. OCR for serial plates and receipts. |
| Move workflow | Not fully decided yet — keep it flexible. Hard requirements: **camera/barcode scanning in the app** and **printable labels**. Foundation = manifest export + delivery audit + discrepancy report; box-level tracking stays a future option. |
| Custody (issue/return) | **Remove entirely.** "I'm not TCMAX." Routes and UI deleted, columns deprecated. |
| Proactive | Warranties + registry health: warn before warranty expiry, flag items missing photos/serials/values (claim-readiness), nudge re-verification of long-unaudited homes. Same briefing/push/chat machinery as the garage plan. |
| Chat | Per the global vision: full inventory powers from the unified brain, plus everything works in the app UI. The existing chat tool writes to a shadow table and must be replaced. |

---

## 2. Current state (audited 2026-07-19)

### What exists and works (backend is deep, UI is a shell)
- `inventory/models.py` — own DB via SQLAlchemy: `InvUser` (linked by JWT
  sub), `InvHome` (multiple locations: house, storage unit…), `InventoryItem`
  (auto-generated **EIN** `EIN-XXXX-XXXX-XXXX` + QR/Code128 label image
  base64, category enum, quantity, location, manufacturer/model/serial,
  purchase price/date, replacement cost, warranty expiry + image, receipt
  image, insured flag, custody fields), `ItemAttachment`, `InventoryAudit` +
  `AuditScan` (scan-based physical audit sessions with progress + history),
  collaborators table (viewer/editor).
- `inventory/management.py` (673 lines) — full CRUD, QR generation
  (`qr_utils.py`), receipt/warranty processing, audits,
  `generate_insurance_manifest`, collaborator management.
- `api/routes/inventory.py` (801 lines) — routes for all of the above,
  family-group aware (`resolve_module_owner`).
- Frontend: `InventoryPage.jsx` ("The Stash") — list, search, ZXing camera
  barcode scanner (`BarcodeScanner.jsx`), `HomeAuditModal` (working audit
  flow), `AssetDetailModal` (receipt/warranty upload only).

### Confirmed bugs / dead code / gaps
1. **No way to create an item in the UI.** No add button anywhere; the
   "ADJUST" button opens a modal that cannot edit name/quantity/location —
   only upload receipt/warranty. No home-creation UI either: with zero homes
   the page is empty and unrecoverable from the UI.
2. **Chat writes to a shadow inventory.** `core/tools.py::_exec_add_inventory`
   creates its own raw `inventory_items` table inside the main app SQLite DB
   (`settings.db_path`) — completely disconnected from the real inventory
   system. Chat-added items are invisible to the Stash and vice versa.
3. **`InventoryVault.jsx` (536 lines + CSS) is orphaned** — imported nowhere;
   an abandoned commerce-flavored UI. Dead code.
4. **UI shows consumables stats** (LOW THRESHOLD / DEPLETED on quantity) that
   contradict the asset-registry schema and the owner's purpose.
5. **The rich backend is ~15% surfaced**: EIN, QR labels, financials,
   attachments, audit history, insurance manifest, collaborators — none
   visible. `generate_insurance_manifest` is only referenced from
   CulinaryPage (a misplaced call — verify and remove during I0).
6. **No proactivity**: warranty expiry stored but never triggers anything.
7. **No AI capture**: no UPC product lookup, no photo identification, no OCR —
   despite `api/routes/vision.py` existing.

---

## 3. Build phases

Work in order; each phase independently shippable with its listed
verification. Commit per phase, push to `claude/chat-voice-integration-bzdo2v`.

### Phase I0 — Cleanup & repairs

1. **Remove custody/issue-return** (owner decision): delete
   `POST /items/{id}/issue`, `POST /items/{id}/return`, `issue_item`,
   `return_item`, the `IssueItem` schema, and `AssetStatus.IN_USE` handling
   tied to custody. Keep DB columns (`current_custodian_id`, `issued_at`)
   untouched for data safety but drop them from serializers and docs — mark
   deprecated in the model with a comment.
2. **Delete orphaned code**: `InventoryVault.jsx` + `InventoryVault.css`.
   Remove the stray insurance-manifest fetch from `CulinaryPage.jsx` if it
   proves unrelated to culinary (it appears to be).
3. **Reframe the Stash stats**: replace LOW/DEPLETED with registry stats —
   total items, total replacement value, items missing photo/serial/value
   (claim-readiness count), last completed audit date.
4. **Point the chat tool at the real system** (interim fix ahead of I3):
   `_exec_add_inventory` calls `inventory.management.create_item` against the
   inventory DB (get-or-create `InvUser` from the River user, use their
   active/first home, create a default home when none). Delete the shadow
   `CREATE TABLE`. Existing rows in the shadow table: one-time best-effort
   migration into the real system at startup, then drop.

Verify: no custody routes respond; "add the drill to the garage" in chat
creates an item that appears in the Stash; stats show value/claim-readiness;
frontend builds with the orphan removed.

### Phase I1 — Make the UI match the backend (CRUD + labels)

1. **First-run onboarding**: no homes → guided "name your home" card.
   Home switcher when more than one (house / storage unit / office).
2. **Add/edit item form**: all fields (name, category, quantity, location,
   manufacturer, model, serial, purchase price/date, replacement cost,
   warranty expiry, insured, notes-in-description). Fast defaults: category
   inferred later by capture paths; location remembered from the last add
   ("room sweep" friendly).
3. **Item detail rebuilt**: photos (see below), EIN + rendered QR/barcode,
   all fields editable, financials, warranty countdown, attachments list
   (existing endpoints), receipt/warranty uploads (existing), delete.
4. **Item photos**: use the existing `ItemAttachment` table — an attachment
   flagged as the primary photo (add `is_primary` boolean via the additive
   migration pattern). Camera capture on mobile web (`<input capture>`).
   Thumbnails served through the authed download route.
5. **Label printing** (hard requirement): `GET /api/inventory/homes/{id}/labels.pdf`
   — server-side PDF of QR labels on standard label-sheet layouts (Avery
   5160 30-up and 5163 10-up; layout constants in one place), filterable to
   selected items or "items added since last print" (track
   `label_printed_at` on items, additive column). Each label: QR + EIN +
   item name. Single-label reprint from item detail. Use `reportlab` (add to
   requirements) — the QR PNGs already exist base64 in the DB.

Verify: fresh user creates a home, adds an item with a photo from their
phone, edits its location, prints a 30-up PDF where labels scan back to the
right items via the existing scanner.

### Phase I2 — Fast capture (the "catalog everything I own" push)

1. **UPC lookup**: scanning an unknown code (not an EIN) offers "create from
   product lookup." Pluggable provider interface
   (`providers/product_lookup/`): primary = free UPC database API
   (e.g. UPCItemDB trial tier / OpenGTINdb; keep the provider swappable and
   key-configurable in settings); fallback = agent web search (chat plan
   Phase 2) for name/brand/image. Pre-fills the add form.
2. **Photo identification**: snap a photo → vision model (existing vision
   route infrastructure; local-first per hardware philosophy, cloud vision as
   configured fallback) proposes name/category/manufacturer → user confirms.
   The photo becomes the item's primary photo automatically.
3. **OCR capture**: photograph a serial plate → OCR fills
   `serial_number`/`model_number`; photograph a receipt → OCR proposes
   purchase price/date and attaches the image as the receipt.
4. **Room sweep mode**: pick a room → rapid loop (photo → AI proposal →
   confirm → next) with location pinned, running count shown. This is the
   primary path to "everything I own" and must feel fast on a phone.

Verify: a can of WD-40's UPC pre-fills a form; a photo of a drill proposes
"DeWalt drill / Tool"; a serial-plate photo lands in the serial field; ten
items captured in a room sweep in under five minutes.

### Phase I3 — Inventory joins the brain
*(Depends on chat plan Phase 1 [conversation service] + Phase 2 [agent loop].)*

New tools in `core/tools.py`, family-group aware, receipt-emitting, all
backed by `inventory.management` (never raw SQL):

- `add_asset(name, location, home?, category?, details?)` — replaces the
  legacy tool name in the schema list.
- `find_asset(query)` — "where's the torque wrench" → name/EIN/serial/
  location match; answers with location and last-audit-seen.
- `asset_summary(scope?)` — counts and replacement value by home/category/
  room ("what are my electronics worth?").
- `registry_health(home?)` — items missing photo/serial/value/receipt.
- `warranty_check(item?|expiring_within_days?)` — warranty status queries.
- The in-app ASK button routes through the unified chat with the item pinned
  in context (same pinned-scope pattern as the garage helper, G2).

Verify: from main chat, "where's the generator" answers with its room;
"what's my inventory worth" gives the registry totals with a receipt card;
"add the new monitor to the office" creates a real item.

### Phase I4 — Move mode & claims kit

The owner hasn't fixed the exact workflow — build the flexible foundation,
defer box-level tracking (out of scope, §4).

1. **Manifest export**: upgrade `generate_insurance_manifest` output into two
   downloadable formats from the UI — CSV and a PDF dossier (item, photo
   thumbnail, EIN, serial, purchase price, replacement cost, receipt/warranty
   presence). This is the pre-move evidence baseline; generating one stamps a
   `manifest_generated_at` snapshot marker on the home.
2. **Delivery verification = the existing audit flow**, surfaced properly:
   start audit → scan labels (or search-check-off for unlabeled items) →
   complete. Already works; polish the modal into a full-screen flow with
   progress and per-room grouping (group by `location`).
3. **Discrepancy report** on audit completion: unscanned items listed with
   photos, values, and documentation status — the claim-starter document,
   downloadable as PDF, and items optionally batch-marked
   `AssetStatus.MISSING`.
4. Home-vs-home support for the move itself: items carry `location` strings —
   add a bulk "reassign home" action (new house = new `InvHome`, items move
   over) so the registry survives the PCS without re-entry.

Verify: export the dossier PDF; run an audit skipping two items; the
discrepancy report names them with values and photos; bulk-move all items to
a new home.

### Phase I5 — Proactive registry health
*(Reuses the reminder-sweep machinery from garage plan G1 — generalize that
sweep runner rather than duplicating it.)*

- **Warranty sweep** (daily): items with `warranty_expiry_date` within
  `INV_WARRANTY_REMIND_DAYS` (default 30, setting) → push + briefing line,
  deduped per item per cooldown like G1.
- **Registry health nudge** (weekly, gentle): if claim-readiness gaps exceed
  a threshold ("14 items have no photo"), one briefing mention with a deep
  link to a "needs attention" filter in the Stash — never per-item spam.
- **Stale audit nudge**: no completed audit in `INV_AUDIT_STALE_DAYS`
  (default 180) → suggest a re-verify, framed around move-readiness.
- Per-user opt-outs alongside the garage reminder settings.

Verify: an item with a warranty expiring in 3 weeks produces one push and a
briefing line; the health nudge appears at most weekly; opt-out silences all.

---

## 4. Explicitly out of scope (leave hooks, do not build)

- **Box-level move tracking** (numbered boxes, box QR labels, scan-box-see-
  contents). The owner hasn't settled the move workflow; the audit +
  discrepancy foundation covers verification. If it comes later it's a
  `Box` entity + `box_id` FK on items — nothing in this plan blocks it.
- Custody/issue-return — removed by owner decision, do not resurrect.
- Consumables/stock tracking — lives in shopping list / culinary domains.
- `commercial_inventory/` — separate commerce subsystem, untouched here.
- Insurance-company API integrations; value estimation/appraisal AI.

## 5. Working agreements for the implementing agent

- Same branch and conventions as the other plans (chat plan §6): commit per
  phase, push `-u origin claude/chat-voice-integration-bzdo2v`, follow
  existing route/auth patterns, feature flags in `config/settings.py`.
- Inventory keeps its own DB and SQLAlchemy models; additive-only migrations
  (columns: `is_primary`, `label_printed_at`, `manifest_generated_at`).
- Family-group awareness via `resolve_module_owner(user_id, "inventory")`
  everywhere (match the existing routes' module key — verify it before
  assuming the string).
- All item mutations go through `inventory/management.py` — chat tools and
  routes alike; no raw SQL anywhere (that rule is what prevents shadow-table
  regressions).
- Tests: shadow-table migration idempotency, label PDF layout (item count →
  page/slot math), UPC provider fallback chain, audit discrepancy math,
  warranty sweep dedupe, `find_asset` matching (name/EIN/serial).
- Production auto-deploys nightly from `main` — merge only verified phases.
