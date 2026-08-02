# Dependency advisories — standing decisions

What `pip-audit` and `npm audit` report, and what has been decided about each.

The point of this file is that an accepted risk should be accepted **once**,
in writing, with a reason — not re-argued every time someone runs an audit and
finds the same two entries.

Last swept: 2026-08-02.

---

## Current state

| Ecosystem | Before | After | Remaining |
|---|---|---|---|
| Python (`pip-audit -r requirements.txt`) | 24 advisories / 5 packages | **1** | chromadb, accepted below |
| npm (`npm audit`, `frontend/`) | 4 (1 critical, 3 high) | **2** | react-router, accepted below |

---

## Fixed

Straight version bumps, all verified against the full test suite:

| Package | From | To | Advisories cleared |
|---|---|---|---|
| `pypdf` | 6.12.0 | 6.14.2 | 11 |
| `yt-dlp` | 2026.3.17 | 2026.7.4 | 8 |
| `python-multipart` | 0.0.27 | 0.0.31 | 3 |
| `pydantic-settings` | 2.13.1 | 2.14.2 | 1 |
| `tar` (transitive) | ≤7.5.20 | patched | 5 — including the one **critical** |
| `brace-expansion` (transitive) | 3.0.0–5.0.7 | patched | 2 |

The two npm entries were fixed with `npm audit fix`, which touched only
`package-lock.json` — `package.json` is unchanged.

---

## Accepted: chromadb `PYSEC-2026-311` (= `GHSA-f4j7-r4q5-qw2c`)

**Open against every chromadb ≥1.0.0. There is no fixed release.**

Pre-authentication code injection via `trust_remote_code` on
`/api/v2/tenants/{tenant}/databases/{db}/collections`.

**Not reachable here.** `providers/memory/vector_store.py` uses
`chromadb.PersistentClient` — embedded and on-disk. The vulnerable endpoint
belongs to the `chroma run` HTTP server and does not exist in this process.
There is nothing for an unauthenticated attacker to send a request to.

The constraint is already documented at the call site, in the docstring of
`VectorStore._connect`. That comment is load-bearing, not decoration:

> Do not switch to `HttpClient` without first confirming a patched ChromaDB
> release.

**Revisit if:** chroma is ever run in client/server mode, or a patched release
ships. The version stays pinned with `==` rather than floated so a bump cannot
quietly move this.

---

## Accepted: react-router `GHSA-qwww-vcr4-c8h2`

**Affects 7.12.0 – 8.2.x. Patched in 8.3.0.**

"RSC Mode CSRF Bypass Allows Action Execution Before 400 Response."

**Not applicable here.** The advisory states plainly that it *"only affects
your application if you are using the unstable RSC APIs."* This frontend is a
client-only SPA: `src/main.jsx` mounts a plain `<BrowserRouter>`, there is no
SSR entry point, no `createStaticHandler`, and no server actions. The
vulnerable code path is not compiled into the bundle, let alone reachable.

**Why not just fix it.** There are two ways and both are worse than accepting:

- `npm audit fix --force` downgrades to `react-router-dom@7.11.0`. That undoes
  the bump merged in PR #129 and moves *backwards* past four months of other
  fixes, to close a hole that is not open.
- Upgrading forward is a migration, not a bump: `react-router-dom` stops at
  7.18.2 and was folded into `react-router` at v8, so reaching the patched
  8.3.0 means rewriting every import in the app.

**Revisit if:** this app ever adopts RSC or server-side rendering — at which
point the advisory becomes live and the v8 migration stops being optional.

---

## Running the sweep

```bash
pip-audit -r requirements.txt          # Python
cd frontend && npm audit               # JavaScript
```

Anything new that has a fixed release should just be bumped. Anything without
one, or where the fix costs more than the risk, belongs in this file with a
reason and a revisit condition — not in a comment nobody reads twice.
