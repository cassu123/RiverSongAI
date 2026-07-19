# River Song — Memory Hub / Chronos: Full Build Plan

Handoff document for the implementing agent (Kimi / Antigravity). Self-contained:
read this top to bottom and you can execute without prior session context.

Branch: `claude/chat-voice-integration-bzdo2v` (same branch as the other plans).

Companion documents:
- `docs/chat-voice-unification-plan.md` — Phase 2 (agent loop) powers the
  memory/note tools here (M4/M5); Phase 4 (distiller) writes INTO the system
  this plan repairs — its output must follow M3 provenance + M4 confidence
  rules.
- `docs/routines-briefings-plan.md` — R1 DeliveryRouter carries memory
  suggestion prompts; R2 SweepRunner hosts the TTL cleanup sweep.

---

## 1. Mission

River's memory becomes three honest layers instead of five aspirational ones:
a SQLite profile (facts/preferences/summaries with TTL), Chroma semantic
recall that actually fires on every conversation turn, and the Chronos vault —
with River acting as scribe. The user gets a full glass box: see everything,
edit anything, real deletion, provenance on every memory, and "remember/forget
that" by voice. Inferred knowledge follows a confidence split: high-confidence
auto-applies (labeled), low-confidence queues for approval.

Owner-confirmed product decisions (structured interview, 2026-07-19):

| Topic | Decision |
|---|---|
| Control | **Full glass box**: view everything, edit/correct facts inline, add manually, delete for real (vectors too), see where each memory came from, and "River, forget that" / "remember that I…" in conversation. |
| Inferred memories | **Confidence split**: high-confidence inferences auto-apply (marked `inferred` in the glass box); low-confidence ones queue as suggestion cards (Memory hub + occasional chat prompt). |
| Infrastructure | **Trim to 3, leave the door open**: retire the MemGPT container (dead project, never reached); pause Graphiti's per-turn writes behind its existing flag (code stays for a future phase); fix Chroma recall and wire it into every conversation. |
| Notes | **River is my scribe**: notes created, appended, and read back by voice/chat; the daily note becomes a running journal River adds to; "what did I note about X?" works. |

---

## 2. Current state (audited 2026-07-19)

### The five layers
1. **SQLite profile** (`core/memory_manager.py`, `providers/memory/store/facts.py`,
   models) — facts (source explicit/inferred), preferences (confidence),
   conversation summaries with a real **TTL engine**
   (`providers/memory/ttl_engine.py`: per-user default TTL, auto-extend on
   reference, forever option), pending habits. **Works** — this is what
   personalizes River today.
2. **Chroma vector memory** (`providers/memory/vector_store.py`) — facts and
   preferences embedded on upsert; `get_context_for_prompt` does semantic +
   archival recall. **Written, never read in practice** (see gaps).
3. **MemGPT** (`providers/memory/memgpt_provider.py`, `cpacker/memgpt:0.5.6`
   in docker-compose) — archival recall service. Project abandoned/renamed
   (Letta); only called from the same never-firing path. **Dead weight.**
4. **Graphiti knowledge graph** (`providers/memory/graphiti_provider.py`,
   Neo4j) — well-engineered wrapper (never-raise, timeouts, lazy healthcheck);
   episodes written from every conversation turn (both voice and text paths)
   and from Scribe. Each write costs an LLM extraction call. **Nothing ever
   searches it.** Write-only.
5. **Chronos vault** (`providers/vault/vault_provider.py`,
   `providers/memory/store/vault.py`, `api/routes/vault.py`,
   `ChronosPage.jsx`) — markdown notes, wiki-links + backlinks + graph view,
   daily notes (conversation summaries already append there), search, file
   watcher, and the **Scribe daemon** extracting facts from stale notes.
   **Works.**

UI: `MemoryHubPage` (tabs: Memory / Notes / Docs), `MemoryPage` (combined
read-only list), `ChronosPage` (editor), routes in `api/routes/memory.py`
(facts CRUD-ish, preferences get/delete, summaries get/delete, pending-habit
list/approve/delete).

### Confirmed bugs / gaps
1. **Preferences render "undefined: undefined"** — `MemoryPage.jsx:24` reads
   `p.topic`/`p.preference`; the API returns `category`/`value`.
2. **The habit-approval loop is dead-ended** — approve/delete routes exist,
   habit inference writes pending habits, but no frontend anywhere fetches
   `/api/memory/pending-habits`. They accumulate forever, unseen.
3. **Semantic recall never runs in conversation** — the loop calls
   `build_context_block(user_id)` with no `query_text`
   (`conversation_loop.py::_rebuild_system_prompt`), so the semantic branch
   (Chroma + MemGPT) is skipped every turn.
4. **Graphiti is write-only** — per-turn LLM extraction cost, zero reads.
5. **Deleting a fact leaves its vector in Chroma** (acknowledged in a code
   comment at `memory_manager.py:258`) — deletion isn't real.
6. **No scheduled TTL cleanup** — `cleanup_expired` exists; nothing calls it
   on a schedule.
7. **Memory tab is read-only** — no edit, no add (the POST /facts route
   exists unused), no provenance, no TTL visibility/override.
8. Summaries are never embedded into Chroma (only facts/prefs), so semantic
   recall — once fixed — wouldn't surface past conversations anyway.

---

## 3. Build phases

Work in order; each phase independently shippable with its listed
verification. Commit per phase, push to `claude/chat-voice-integration-bzdo2v`.

### Phase M0 — Surgical fixes

1. Fix the preferences render (`category`/`value`) in `MemoryPage.jsx`.
2. **Real deletion**: `delete_fact` / `delete_preference` /
   `delete_summary` also delete the matching Chroma vector (ids are shared
   uuids — verify and delete by id; tolerate missing).
3. **Scheduled TTL cleanup**: register an expired-summaries sweep (all
   users) — via R2's `register_sweep` if it exists by then, else a simple
   lifespan task with the same shape, migrated later.
4. Show TTL/expiry on summary cards in the Memory tab.

Verify: preferences display correctly; deleting a fact removes it from a
subsequent semantic search; an expired summary disappears within a sweep
interval.

### Phase M1 — Trim to three layers

1. **Retire MemGPT**: remove the `memgpt` + `memgpt-db` services from
   `docker-compose.yml`, delete `providers/memory/memgpt_provider.py` and its
   call in `get_context_for_prompt`. (The archival role is covered by Chroma
   + summaries + the vault.)
2. **Pause Graphiti**: default `graphiti_enabled` to `false` in settings and
   `.env` docs; the provider and its call sites stay exactly as they are
   (they already no-op cleanly when disabled). Add a short code comment +
   README note: re-enable when a phase adds graph *reads* (relationship
   queries) — the door stays open.
3. Update any admin/status surfaces that reference the removed container.

Verify: compose up runs without the two containers; conversations run with
`graphiti_enabled=false` and no episode-write log lines; nothing imports the
deleted provider.

### Phase M2 — Recall that actually works

1. **Wire the query through**: the conversation loop passes the current user
   message into context building —
   `build_context_block(user_id, query_text=<message>)` in both `run_text`
   and `run_once` (rebuild happens per turn already). Bound the block: top-k
   semantic hits (setting, default 6) + facts + prefs + recent summaries,
   with a character budget so long profiles don't blow the prompt.
2. **Embed summaries too**: `record_summary` upserts the summary text into
   Chroma (`{"type": "summary", "user_id": ...}`), and TTL cleanup deletes
   the vector alongside the row — recall must respect forgetting.
3. **Dedupe/refresh**: fact upsert replaces the prior vector for the same
   (user, key) instead of accumulating stale variants (query Chroma by
   metadata key or track vector id on the fact row — additive column
   `vector_id`).
4. Auto-extend stays: semantic hits that are summaries count as "referenced"
   for TTL extension, same as the non-semantic path.

Verify: mention "the cabin trip" in a new session and River surfaces the
right past summary; a deleted fact never resurfaces; system prompt size stays
bounded on a user with 200 facts.

### Phase M3 — The glass box (Memory hub rebuild)

**Provenance** (additive columns on facts / preferences / summaries):
`source_kind` (`conversation | note | manual | distiller | habit_inference`),
`source_ref` (session id, note path, …). All writers set them: the chat
plan's distiller, Scribe (note path), habit inference, manual adds, memory
tools (M4).

**Routes**: add PATCH for facts and preferences (edit value/key/category);
POST /preferences (manual add); summary TTL override
(PATCH /summaries/{id}/ttl).

**Memory tab rebuild** (`MemoryPage.jsx`):
- Sections or filters by type (facts / preferences / summaries /
  suggestions), search across all.
- Inline edit + delete on every card; add-fact and add-preference forms.
- Provenance line on each card ("learned from conversation, Jul 12" — deep
  link to the session once chat history UI exists; "from note
  Vehicles/ATV.md" links into Chronos).
- `inferred` vs `explicit` badges; confidence shown on preferences.
- TTL badge on summaries with a change control.
- **Suggestions section**: the pending queue (see M4) with approve /
  edit-then-approve / dismiss.

Verify: correct a wrong fact inline and see it corrected in River's next
answer; every card shows where it came from; an approved suggestion becomes
a preference with provenance `habit_inference`.

### Phase M4 — Conversational memory + the confidence split
*(Depends on chat plan Phase 2 [agent loop]; suggestion prompts use
routines plan R1 [DeliveryRouter].)*

**Tools** (receipt-emitting, per-user):
- `remember_fact(key?, value)` — "remember that Cheryl's birthday is March
  3rd" → explicit fact, provenance `conversation` + session ref.
- `forget_memory(query)` — semantic + keyword search across
  facts/prefs/summaries, confirm the match with the user ("Forget 'Mike has
  the generator'?"), then real-delete (row + vector).
- `recall_memory(query)` — "what do you know about my truck?" → glass-box
  search, answered with provenance.
- `update_memory(query, new_value)` — correction by voice.

**Confidence split** (replaces the dead-ended pending-habit flow):
- Generalize `pending_habits` into a `memory_suggestions` shape (additive:
  reuse the table, add `kind` and `payload` columns) — anything inferred
  lands here when confidence is low/medium: habit inference, distiller
  low-confidence preferences.
- **High confidence** → auto-apply as `inferred` fact/preference (glass box
  shows the badge; one-tap revert deletes it).
- **Low/medium** → suggestion queue; surfaced in the hub (M3) and
  occasionally in conversation via DeliveryRouter (kind=
  `memory_suggestion`, info severity, heavily rate-limited — at most one
  ask per day: "I've noticed you usually want weather before your commute —
  should I remember that?"). Yes → applied with provenance; no → dismissed
  and remembered as dismissed (don't re-suggest the same pattern).
- Distiller (chat plan Phase 4) routes its output through this same split —
  align the confidence field it already extracts.

Verify: "remember/forget/what do you know" all work by voice with receipts;
a low-confidence inference shows up as a suggestion and never auto-applies;
the same dismissed suggestion doesn't return.

### Phase M5 — River the scribe (vault meets conversation)
*(Depends on chat plan Phase 2.)*

**Tools** (all through the existing VaultProvider — family/personal root
resolution is already handled there):
- `take_note(title?, content)` — "take a note: ATV drain plug is 19 ft-lb"
  → new note (or sensible default folder), returns the path.
- `append_note(title, content)` — append to an existing note by fuzzy title
  match (confirm on ambiguity).
- `journal(content)` — append a timestamped line to today's daily note; the
  daily note becomes the running journal (conversation summaries already
  land there — keep sections tidy: Journal / Conversation summaries).
- `find_notes(query)` — vault FTS search (`store.search_vault_notes`) +
  read-back; "what did I note about the ATV?" quotes the note with its path.
- `read_note(title)` — full read-back (voice: summarized first, offer full).
- Notes created by voice get provenance in reverse too: a `source:
  conversation` frontmatter line, so the glass box and the vault agree.
- Scribe daemon continues extracting facts from notes — those facts now
  carry `source_kind=note` + path (M3), closing the loop.

Verify: dictate a note, find it in Chronos with correct frontmatter; "what
did I note about X" answers with the right note; journal entries accumulate
in today's daily note under the Journal section.

---

## 4. Explicitly out of scope (leave hooks, do not build)

- **Graphiti graph reads** — the flag and code stay; a future phase that
  wants relationship queries ("who did I say was coming?") re-enables writes
  and adds search. Do not delete the provider.
- Letta (MemGPT successor) — not unless a concrete need appears.
- Cross-user/family shared memory ("our address") — per-user only this
  phase; the vault's family root already covers shared *notes*.
- Note editor upgrades in ChronosPage (it works; this plan is about the
  conversation meeting it).
- Memory import/export tooling.

## 5. Working agreements for the implementing agent

- Same branch and conventions as the other plans (chat plan §6). Commit per
  phase; push `-u origin claude/chat-voice-integration-bzdo2v`.
- Additive-only migrations (`source_kind`, `source_ref`, `vector_id`,
  suggestion columns); never lose existing facts/preferences/summaries.
- **Deletion is sacred**: any path that deletes a memory row must delete its
  vector; add a test that asserts search-after-delete misses. The glass box
  is a lie otherwise.
- All memory writes (distiller, scribe, tools, habit inference) set
  provenance — treat a provenance-less write as a bug.
- Suggestion prompts in conversation go through the DeliveryRouter only,
  with strict rate limits — memory must never feel naggy.
- Tests: pref render shape, delete-removes-vector, TTL sweep + auto-extend,
  semantic context budget, confidence-split routing (high vs low), suggestion
  dismiss-memory, note tool round-trips (create/append/find/journal),
  provenance set on every writer.
- Production auto-deploys nightly from `main` — merge only verified phases.
