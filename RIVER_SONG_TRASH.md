# RIVER SONG AI — TRASH REPORT

> Files this audit recommends deleting. Each row gives the path, why it is dead weight, and whether removing it can break anything.
> Generated alongside `RIVER_SONG_AUDIT.md` on 2026-05-13.
> **Read the "Side effects" column before `git rm`.** A few entries (e.g. the orphan `users/` tree) are imported by sibling files inside the same dead subtree, so they look "used" by grep but the whole subtree is collectively dead.

---

## Backend — Orphan Python packages

| Path | Why useless | Side effects of deletion |
|---|---|---|
| `users/__init__.py` *(if present)* | The whole `users/` package is leftover legacy scaffolding. Real auth + role storage live in `providers/memory/sqlite_store.py` + the `users` SQLite table. Nothing in `main.py`, `api/`, `core/`, or `providers/` imports from `users.`. | None — only inter-package references exist. |
| `users/user_management/user_management.py` | `UserManager` class with stub methods and a `pass` body. No callers anywhere. | None. |
| `users/user_profiles/user_profile.py` | Only referenced by `user_management.py` (also dead) and `roles.py` (also dead). | Delete with the rest of `users/`. |
| `users/roles/permission.py` | Only referenced by `users/roles/roles.py` (also dead). | None. |
| `users/roles/roles.py` | Only referenced by `user_management.py` and `admin_dashboard.py` (also dead). | None. |
| `users/user_roles/admin/admin_dashboard.py` | Zero external references. Admin features live entirely in `api/routes/admin.py`. | None. |
| `legacy/ha_environment_snapshot.txt` | A snapshot of a Home Assistant install. Never read by any code (`grep` returns zero references). | None. |
| `legacy/` directory itself | Only contains the file above. | None. |
| `docs/testing/test_cli_test_ascii.txt` | Test fragment that reads `"Can you make pink a little more pinkish… How much will it cost the website doesn't have the theme i was going for."` — looks like a user message that ended up committed. | None. |
| `docs/testing/test_cli_test_utf8.txt` | Mandarin sentences about a three-year-old learning to see — appears to be a Whisper/locale test that was never integrated. | None. |
| `docs/testing/` directory | Only contains the two .txt files above. | None. |
| `docs/modules/gemini.txt` | Spec for a "GeminiAI core module" that never shipped. The actual Gemini integration is `providers/llm/gemini.py`. | None. |
| `docs/modules/medical_image_analysis.txt` | Spec for an unrelated medical-imaging module. Nothing implements it. | None. |
| `docs/modules/` directory | Empty after the two files above are removed. | None. |
| `culinary/migrate_strip_html_steps.py` | One-time migration script. The migration has already been applied (the `_migrate_culinary_schema` ALTER TABLE blocks in `api/routes/culinary.py` are idempotent). | None — but keep the file as `migrations/` archived if you want a history. |
| `inventory/customerSchema.json` | JSON schema file. `grep -rn customerSchema` returns nothing. Not loaded anywhere. | None. |

## Backend — Suspect / overlap

| Path | Reason | Side effects |
|---|---|---|
| `providers/web/weather.py` | Duplicates `providers/feeds/weather.py`. The only consumer of `web/weather.py` is the `get_weather` tool in `core/tools.py:771`. Migrate that one call to `providers/feeds/weather.py` and remove this file. | The tool call must be re-pointed. Otherwise the `web_search` chain has its own `search.py` that is also under `providers/web/` — keep that one. |
| `data/commerce.db`, `data/inventory.db`, `data/vehicles.db`, `data/culinary.db`, `data/river_song.db` | These are runtime database files committed to the repository. They contain real user data. **Should not be checked in.** | Add `data/*.db` to `.gitignore` and `git rm --cached data/*.db`. Production servers create them on first run. |
| `__init__.py` at repo root | Marks the repo root as a Python package, but nothing relies on this. The app is launched via `python main.py`, not `python -m`. | Verify nothing in `setup.sh` / `deploy.sh` does `python -m ...` (it doesn't). Then delete. |

## Frontend — Unimported components

| Path | Reason | Side effects |
|---|---|---|
| `frontend/src/components/NavBar.jsx` | Sidebar.jsx is the active navigation. `grep -rn NavBar frontend/src` returns only this file (no importers). | None. |
| `frontend/src/components/QuickPOS.jsx` + `QuickPOS.css` | Hardcoded `MOCK_PRODUCTS` array. `grep -rn QuickPOS frontend/src` returns only this component file. The real commerce flow is in `CommercePage.jsx`. | None. |

## Frontend — Vestigial inside-file content

| Path / location | Reason | Suggested action |
|---|---|---|
| `frontend/src/pages/ConversationPage.jsx:31` | `const STATE_TABS = [...]` is defined locally even though `utils/constants.js` exports `STATE_TABS`. The local definition reorders the values — keep one, delete the other. | Replace local with `import { STATE_TABS } from '../utils/constants.js'`. |
| `frontend/src/components/Sidebar.jsx:16, 33` | `{ key: 'google', soon: true }` — Google page is implemented. The badge is misleading. | Remove the `soon: true` flag. |
| `frontend/src/pages/AnalyticsPage.jsx` PLATFORMS array | Lists nine platforms; only `tiktok`, `instagram`, `facebook`, `amazon`, `etsy`, `youtube`, `ebay`, `shopify`, `pinterest` have UI tiles. There is no Python provider for any of them. The whole page is manual data entry. | If you don't plan to wire the actual APIs, mark the page "Manual snapshots" and remove the platform-specific badges. Otherwise build providers per SECTION 8. |

## Frontend — Public assets

| Path | Reason | Side effects |
|---|---|---|
| `frontend/public/sw.js` | Only consumer is `frontend/src/utils/pushNotifications.js`, which is never called from anywhere else. | If you keep push notifications as a planned feature, leave the file. If not, delete it together with `utils/pushNotifications.js`. |

## Configuration

| Path | Reason | Side effects |
|---|---|---|
| `.geminiignore` | A Gemini Code Assist ignore file. If you no longer use Gemini Code Assist in this repo, delete it. | None. |
| `config_files/google_config.json` | Local copy, not used by any code (`grep -rn google_config.json` returns nothing inside Python). The auth flow reads `google_client_secrets.json` only. | None — but verify against your own setup; it may contain Google project metadata you want to keep elsewhere. |
| `frontend/package-lock.json` | Keep — required for reproducible installs. *(Listed only to confirm it is **not** trash; reviewers sometimes flag it.)* | N/A. |

## Documentation

| Path | Reason | Side effects |
|---|---|---|
| `docs/future_updates/feature_requests.md`, `future_improvements.md`, `roadmap.md` | If these match SECTION 8's recommendations, keep them — they are the canonical "what's next" list. If they predate the SLAE v3 plan, replace with a single new file. | Review by hand before deleting; some of these are likely still authoritative. |
| `docs/performance_benchmarks/performance_benchmarks.md` | Useful if recent; useless if stale. Inspect the dates inside. | N/A. |
| `docs/api_registry/*.txt` | Setup notes for each external API. **Keep** — these are referenced from `.env.example`. | Do **not** delete unless you also rewrite the `.env.example` pointers. |
| `docs/gemini_prompts.md`, `docs/local_ai_integration_plan.md`, `docs/API_DOCUMENTATION.md` | Could be stale. Spot-check that they match the current routes table in `RIVER_SONG_AUDIT.md` SECTION 1.2. | None obvious. |

## Repository hygiene — not strictly trash, but advised

- `git ls-files data/` returns `data/.gitkeep` only. Verify no `.db` is actually committed (`git ls-files data/*.db`); if any are tracked, untrack them.
- `git log --all -- .env` shows `.env` was tracked at some point and removed in commit `8cdf2a6`. **The contents are still extractable from history.** This is also in `RIVER_SONG_SECURITY.md`. Rewriting history (BFG / git-filter-repo) is the only fix; rotate any keys that were ever in there.
- `config_files/google_client_secrets.json` is `.gitignore`d at HEAD but is in older commits. Rotate the Google OAuth client secret.

---

## Summary — single-pass `git rm` list (safe to run as one batch after review)

```bash
# Backend orphans
git rm -r users/
git rm -r legacy/
git rm -r docs/testing/
git rm docs/modules/gemini.txt docs/modules/medical_image_analysis.txt
# (delete docs/modules/ if empty afterwards)
git rm culinary/migrate_strip_html_steps.py
git rm inventory/customerSchema.json
git rm __init__.py  # repo-root marker, unused
git rm .geminiignore  # only if you no longer use Gemini Code Assist

# Frontend orphans
git rm frontend/src/components/NavBar.jsx
git rm frontend/src/components/QuickPOS.jsx frontend/src/components/QuickPOS.css

# Stop tracking runtime DBs (NEVER commit again)
git rm --cached data/*.db
# then in .gitignore add:  data/*.db
```

Lines of code removed by the above (rough): ~1,500 in `users/`, ~400 in `QuickPOS`, ~150 in `NavBar`, plus the docs and migration script. Total ≈ 2,200 LOC of dead weight, plus several DB files of unknown size.

*End of trash report.*
