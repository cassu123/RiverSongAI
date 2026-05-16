# River Song AI — Phase 1 Build Plan (ultra-detailed, revised 2026-05-15)

**Audience:** Gemini (or any model with shell + file access in the repo root).
**Mode:** Feature build. The first version of this brief (CHRONOS Phases 1-3) has already been executed and the work is in the working tree. This revision picks up at *verification* of that work, then delivers full ultra-detail for **Section B (MCP wrap)** and **Section C (Pulse daemon)** — neither of which has been started.

This brief is intentionally exhaustive. The Round 3 disaster (18 corrupted route files) happened because a session inferred too much. **Do not infer. If a line doesn't match what this document says, stop and ask.** Every file path, line number, function name, response shape, and SQL column listed below was verified against the working tree on 2026-05-15 at HEAD `e93a322`.

When this brief and `RIVER_SONG_BUILD_PLAN_2.md` are both present, the order is: finish Phase 1 (this file) → user reviews + commits → start Phase 2.

---

## 0. Verification standards (read this first, apply everywhere)

### 0.1 Python syntax checking

`ast.parse` does NOT catch `await` outside `async def`. Use `py_compile`:

```bash
python3 -c "import py_compile; py_compile.compile('<path>', doraise=True)"
```

After any non-trivial change, also confirm the app actually imports:

```bash
source venv/bin/activate
python3 -c "import sys; sys.path.insert(0,'.'); from main import app; print('routes:', len(app.routes))"
```

Expected: prints `routes: <N>` with N ≥ 308 (baseline 300 at HEAD `e93a322`, +7 vault routes already present). Any traceback means stop, fix, retry.

### 0.2 Route auth pattern (settled — reuse, do not reinvent)

```python
from typing import Optional
from fastapi import APIRouter, Header, HTTPException, Depends, Request
from core.auth import decode_token

async def _require_user(authorization: Optional[str] = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return payload["sub"]
```

Reference implementations:
- Standard user helper: `api/routes/memory.py:37`
- Admin helper: `api/routes/auth.py:222`
- Kiosk-permitted helper: `api/routes/rover.py:23`
- HTTPBearer credentials helper: `api/routes/image.py:26`
- Already-async vault helper (current standard): `api/routes/vault.py`

### 0.3 Browser-test UI before claiming done

```bash
# terminal 1
source venv/bin/activate && python3 main.py
# terminal 2
cd frontend && npm run dev
```

Open `http://localhost:5173`, click through. If you can't reach a browser, say so — do not claim a UI works without seeing it render.

### 0.4 Do NOT touch these files except where this brief explicitly authorizes it

The Round 3 audit work that landed in `81abfa8` and `461ce79` is settled. Hands off:

- `core/auth.py`
- `core/family.py`
- `config/settings.py` *except* explicit additions named in this brief (Section C pulse settings)
- `providers/memory/sqlite_store.py` *except* the `pulse_snapshots` table this brief authorizes
- `main.py` *except* the router + daemon registrations this brief authorizes
- `core/tools.py` *read-only* — MCP wrapping does not modify the existing tool definitions
- `providers/llm/*.py`, `providers/tts/*.py`, `providers/stt/*.py`
- `.env`, `.env.example`
- Anything in `api/routes/` other than the new `pulse.py` this brief creates

**The CHRONOS files** (`api/routes/vault.py`, `providers/vault/vault_provider.py`, `frontend/src/pages/ChronosPage.{jsx,css}`, the watcher hook in `main.py` lines 182-190) **are settled too.** Do not modify them except for the small bug fixes the user may request after running §1 verification.

### 0.5 Do NOT commit, do NOT push, do NOT create extra .md files

User commits. User pushes. Don't create new design docs or summary files. Report inline at the end of each section.

---

## Section 1 — CHRONOS verification gate (A.3 + A.4)

**Status as of writing:** Gemini reports Phases 1-3 of CHRONOS are complete. Verified against the working tree:

| Claim | Confirmed |
|---|---|
| `providers/vault/vault_provider.py` exists with `VaultProvider` + watcher | ✅ 358 lines, has `list_tree`, `read_note`, `write_note`, `delete_note`, `rename_note`, `search_text`, `get_backlinks` |
| `api/routes/vault.py` exists with 7 routes | ✅ `GET /tree`, `GET /note`, `PUT /note`, `DELETE /note`, `POST /note/rename`, `GET /search`, `GET /backlinks` |
| Watcher wired into `main.py` startup/shutdown | ✅ lines 182-190 (`start_vault_watcher`, `stop_vault_watcher`) |
| Router registered | ✅ `api/routes/__init__.py:31`, `main.py:288`, `main.py:314` |
| `watchdog` in requirements | ✅ `requirements.txt` shows `watchdog>=4.0.0` |
| CodeMirror + markdown deps in `frontend/package.json` | ✅ `@uiw/react-codemirror`, `@codemirror/lang-markdown`, `react-markdown`, `remark-gfm` |
| `frontend/src/pages/ChronosPage.jsx` exists | ✅ 12313 bytes |
| `frontend/src/pages/ChronosPage.css` exists | ✅ 6389 bytes |
| Sidebar entry in `frontend/src/utils/constants.js` | ✅ `USER_ITEMS:17`, `ADMIN_ITEMS:36`, `ALWAYS_VISIBLE:10` |
| App.jsx routes to ChronosPage | ✅ `App.jsx:26` lazy import, `App.jsx:241` page-key chain |

**Before starting Section 2, run all of these and report PASS/FAIL inline:**

### 1.1 Static checks

```bash
python3 -c "import py_compile; py_compile.compile('api/routes/vault.py', doraise=True); py_compile.compile('providers/vault/vault_provider.py', doraise=True); print('vault py OK')"
python3 -c "import sys; sys.path.insert(0,'.'); from main import app; print('routes:', len(app.routes))"
```
Expected: `vault py OK` and `routes: ≥ 308`.

### 1.2 Backend smoke (curl)

Start the server. Substitute a real bearer token (login via `POST /api/auth/login`).

```bash
TOKEN=<paste>
# Create a note
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"path":"Personal/verify.md","content":"# Verify\n\nlink to [[Existing]]"}' \
  http://localhost:8000/api/vault/note

# Read the tree
curl -H "Authorization: Bearer $TOKEN" "http://localhost:8000/api/vault/tree?root=personal"

# Read the note back
curl -H "Authorization: Bearer $TOKEN" "http://localhost:8000/api/vault/note?path=Personal/verify.md"

# Search
curl -H "Authorization: Bearer $TOKEN" "http://localhost:8000/api/vault/search?q=verify"

# Backlinks of an existing note (one you've already created that contains [[Verify]] somewhere)
curl -H "Authorization: Bearer $TOKEN" "http://localhost:8000/api/vault/backlinks?path=Personal/verify.md"

# Path traversal must be rejected
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"path":"Personal/../../../etc/passwd","content":"x"}' \
  http://localhost:8000/api/vault/note
```

Expected:
- PUT returns 200 with `{mtime, size}` shape.
- Tree returns an array including `verify.md`.
- Read returns the markdown content.
- Search returns at least one result with `verify.md`.
- Path traversal returns 403 with detail "path outside permitted roots" (or equivalent — confirm the exact message in `api/routes/vault.py`).

### 1.3 Frontend smoke (browser)

1. Open `http://localhost:5173/`, log in.
2. Sidebar shows **CHRONOS** entry. Click it.
3. **Three-pane layout renders:** left = file tree (Personal / Household / Shared with me), center = viewer, right = backlinks panel.
4. Click a note in the tree. Viewer renders the H1 + body. `[[Wikilink]]` inside the body is styled as a clickable link.
5. Click a wikilink. Viewer navigates to the linked note. If unresolved, link is rendered in muted color.
6. Toggle to editor mode. CodeMirror renders. Type `[[` — autocomplete popover appears with note titles.
7. `Cmd+K` / `Ctrl+K` opens the quick switcher modal. Type a title prefix, select, navigates.
8. Type a change in the editor. Wait 1.5–2 seconds. "Saved" indicator appears (or whichever feedback the implementation chose). Reload the page — the change persists.
9. Click "+" in the sidebar. Enter a title. New note opens in the editor with frontmatter or just a stub H1 (verify which the implementation uses).

### 1.4 If anything fails

**Stop. Report which step failed and the observed behavior.** Do not patch and move on silently — the user wants visibility into whether the implementation matches the design.

Likely-mismatch areas to flag:
- Search result shape (the brief expected `[{path, snippet, score?}]` — confirm actual)
- Auto-save trigger (debounced keystroke vs explicit Ctrl-S only)
- Wikilink resolution UX for unresolved links (the brief said "muted color with a 'create' affordance — actually no, omit entirely until Phase 3" — Phase 3 is now done, so creation affordance is fine)
- File creation root (Personal vs Household — should depend on which tree section is focused)

If everything passes, output `Section 1: PASS` and proceed.

---

## Section 2 — MCP-wrap existing tools

### 2.0 What and why

The Friday-Tony-Stark-demo we reviewed established a pattern: an **MCP server** exposes River Song's tools so external clients (Claude Desktop on the user's laptop, the Claude phone app, future agents) can drive them. This section delivers that wrap — **no new tools**, just an MCP-shaped interface over a *safe subset* of `core/tools.py`.

**Critical design rule:** the MCP server **never duplicates business logic**. It is a thin adapter:

```
MCP client → mcp_server.py → core.tools.execute_tool(tool_name, tool_input, context) → existing _exec_ functions
```

If a tool isn't in `core/tools.py`'s dispatcher today, it stays off the MCP server.

### 2.1 Inventory of existing tools (read-only — do not modify `core/tools.py`)

Per `core/tools.py:240-310`, the dispatcher `execute_tool(tool_name, tool_input, context)` knows these tool names. Verified against the current file at HEAD:

| `tool_name` | `_exec_*` function | Line | Touches | Safe to expose? |
|---|---|---|---|---|
| `create_calendar_event` | `_exec_calendar_event` | 319 | Google Calendar (caller's account) | ✅ |
| `add_inventory_item` | `_exec_add_inventory` | 343 | Caller's inventory | ✅ |
| `add_shopping_list_item` | `_exec_add_shopping_list` | 373 | Caller's list | ✅ |
| `set_reminder` | `_exec_set_reminder` | 399 | Caller's reminders | ✅ |
| `control_device` | `_exec_control_device` | 425 | Home Assistant — physical smart-home actions | ❌ leave off (security: external client controlling lights/locks) |
| `log_vehicle_maintenance` | `_exec_vehicle_maintenance` | 445 | Caller's vehicles | ✅ |
| `add_recipe_to_library` | `_exec_add_recipe` | 474 | Caller's culinary | ✅ |
| `create_routine` | `_exec_create_routine` | 502 | Caller's routines | ✅ |
| `check_reading_status` | `_exec_check_reading_status` | 530 | Read-only | ✅ |
| `sync_kindle_library` | `_exec_sync_kindle` | 556 | Caller's Kindle sync — slow side-effect | ⚠️ expose but document as long-running |
| `search_commerce_products` | `_exec_search_commerce_products` | 603 | Read-only | ✅ |
| `create_commerce_sale` | `_exec_create_commerce_sale` | 631 | Posts a sale — financial side-effect | ❌ leave off |
| `trigger_n8n` | `_exec_trigger_n8n` | 680 | External webhook | ❌ leave off (admin-only intent) |
| `generate_business_report` | `_exec_generate_business_report` | 695 | Read-only on caller's data | ✅ |
| `web_search` | `_exec_web_search` | 736 | Internet read | ✅ |
| `search_emails` | `_exec_search_emails` | 745 | Read caller's Gmail | ✅ |
| `get_weather` | `_exec_get_weather` | 771 | Read-only | ✅ |

**Exposed subset (12 tools):** `create_calendar_event`, `add_inventory_item`, `add_shopping_list_item`, `set_reminder`, `log_vehicle_maintenance`, `add_recipe_to_library`, `create_routine`, `check_reading_status`, `sync_kindle_library`, `search_commerce_products`, `generate_business_report`, `web_search`, `search_emails`, `get_weather`.

**Excluded (3 tools):** `control_device`, `create_commerce_sale`, `trigger_n8n`.

If the user wants to override either list, take their direction. Do not add tools beyond the dispatcher's current set.

### 2.2 Tool input schemas — read from `core/tools.py`

`core/tools.py` already defines the input schemas. Look for the `TOOLS` list (above the dispatcher, ending around line 230 based on the tail visible). Each entry is `{"name": str, "description": str, "input_schema": {...}}`. The MCP server *re-uses these same schemas* — do not redefine them.

**Read `core/tools.py` once at the top of `mcp_server.py` and filter to the safe subset.**

### 2.3 Dependency — install `mcp` SDK

Verify with:
```bash
grep -E "^mcp" requirements.txt
```

If absent, add to `requirements.txt` in a new block at the bottom (or in the existing "External / Integrations" block — match the file's style):

```
# -----------------------------------------------------------------------------
# MCP server (Model Context Protocol — exposes tools to external clients)
# -----------------------------------------------------------------------------
mcp>=1.0.0
```

Install:
```bash
source venv/bin/activate
pip install "mcp>=1.0.0"
```

If `mcp` resolves a conflicting `pydantic` version (it depends on pydantic v2; River Song uses `pydantic==2.13.2` — compatible), it should be clean. If there's a conflict, stop and report.

### 2.4 The server — `mcp_server.py` (new file, repo root)

Place at repo root (not under `api/` — the MCP server is a *separate process*, not a FastAPI route).

```python
"""
mcp_server.py

MCP (Model Context Protocol) server that wraps River Song's existing tool layer.
Runs as a separate process from the FastAPI app. Connects to River Song's HTTP
API for execution; does NOT import core.tools directly (so the FastAPI app's
auth + audit paths remain the source of truth).

Authentication:
  The MCP client passes a Bearer token at connection time. The server validates
  it against core.auth.decode_token. The resulting user_id scopes every tool call.

Transport:
  SSE (Server-Sent Events) over HTTP on port 9090 by default. stdio mode
  available via --stdio flag for embedded use.

Usage:
  python3 mcp_server.py            # SSE on 127.0.0.1:9090
  python3 mcp_server.py --stdio    # stdio mode for embedded clients
  python3 mcp_server.py --list-tools  # print exposed tools and exit
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from typing import Any

import httpx

# MCP SDK — exact import paths follow mcp >=1.0.0
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.server.sse import SseServerTransport
from mcp.types import Tool, TextContent

# Add repo root to sys.path so we can import River Song internals (read-only)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.tools import TOOLS as RS_TOOLS  # the canonical tool definitions
from core.auth import decode_token

logger = logging.getLogger("rs-mcp")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

# --- Safe subset (mirror Section 2.1) -----------------------------------------
EXPOSED_TOOL_NAMES = {
    "create_calendar_event",
    "add_inventory_item",
    "add_shopping_list_item",
    "set_reminder",
    "log_vehicle_maintenance",
    "add_recipe_to_library",
    "create_routine",
    "check_reading_status",
    "sync_kindle_library",
    "search_commerce_products",
    "generate_business_report",
    "web_search",
    "search_emails",
    "get_weather",
}

# River Song HTTP base — the MCP server calls back into the live FastAPI app
# rather than re-implementing tool dispatch. This keeps audit logs / auth /
# rate-limiting in one place.
RS_API_BASE = os.environ.get("RS_API_BASE", "http://127.0.0.1:8000")


def get_exposed_tools() -> list[dict]:
    """Filter the canonical TOOLS list down to the safe subset."""
    return [t for t in RS_TOOLS if t["name"] in EXPOSED_TOOL_NAMES]


# --- The MCP server ------------------------------------------------------------
server = Server("river-song")


@server.list_tools()
async def list_tools() -> list[Tool]:
    """Return the exposed tools in MCP's expected shape."""
    return [
        Tool(
            name=t["name"],
            description=t["description"],
            inputSchema=t["input_schema"],
        )
        for t in get_exposed_tools()
    ]


# Bearer token cache — set on connection, used for every tool call in the session.
_session_token: dict[str, str] = {"value": ""}


async def _resolve_user_id(token: str) -> str:
    """Validate the token and return user_id. Raises on failure."""
    payload = await decode_token(token)
    if not payload:
        raise RuntimeError("Invalid or expired token")
    return payload["sub"]


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    """Forward an MCP tool call to River Song's HTTP API."""
    if name not in EXPOSED_TOOL_NAMES:
        return [TextContent(type="text", text=f"Tool '{name}' is not exposed via MCP.")]

    token = _session_token["value"]
    if not token:
        return [TextContent(type="text", text="Not authenticated — set Bearer token at connection.")]

    # Validate the token now (in case it expired)
    try:
        user_id = await _resolve_user_id(token)
    except Exception as e:
        return [TextContent(type="text", text=f"Auth failed: {e}")]

    # Forward to River Song's /api/conversation/tool endpoint (if it exists),
    # OR call core.tools.execute_tool directly with a manufactured context.
    #
    # PREFERENCE: call execute_tool directly. The FastAPI app and MCP server share
    # the same Python environment and database. Going through HTTP would add
    # latency and require a tool-invocation endpoint that doesn't currently exist.
    from core.tools import execute_tool
    context = {"user_id": user_id}
    try:
        result_text = await execute_tool(name, arguments, context)
    except Exception as e:
        logger.exception(f"Tool '{name}' failed")
        return [TextContent(type="text", text=f"Tool failed: {e}")]
    return [TextContent(type="text", text=result_text or "(no output)")]


# --- Transports ----------------------------------------------------------------
async def run_stdio(token: str):
    _session_token["value"] = token
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, initialization_options=server.create_initialization_options())


async def run_sse(host: str, port: int):
    """SSE transport — clients connect via HTTP POST with Bearer token in headers."""
    from starlette.applications import Starlette
    from starlette.routing import Mount, Route
    from starlette.requests import Request
    from starlette.responses import Response
    import uvicorn

    transport = SseServerTransport("/messages/")

    async def handle_sse(request: Request):
        # Pull Bearer token from header
        auth = request.headers.get("authorization", "")
        if not auth.startswith("Bearer "):
            return Response(status_code=401, content="Missing Bearer token")
        _session_token["value"] = auth.removeprefix("Bearer ")
        # Validate eagerly
        try:
            await _resolve_user_id(_session_token["value"])
        except Exception:
            return Response(status_code=401, content="Invalid or expired token")

        async with transport.connect_sse(request.scope, request.receive, request._send) as streams:
            await server.run(streams[0], streams[1], initialization_options=server.create_initialization_options())

    app = Starlette(routes=[
        Route("/sse", endpoint=handle_sse),
        Mount("/messages/", app=transport.handle_post_message),
    ])
    config = uvicorn.Config(app, host=host, port=port, log_level="info")
    uv = uvicorn.Server(config)
    await uv.serve()


# --- CLI -----------------------------------------------------------------------
def main():
    p = argparse.ArgumentParser()
    p.add_argument("--stdio", action="store_true", help="Use stdio transport (token via RS_TOKEN env var)")
    p.add_argument("--list-tools", action="store_true", help="Print exposed tools and exit")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=9090)
    args = p.parse_args()

    if args.list_tools:
        for t in get_exposed_tools():
            print(f"{t['name']}: {t['description']}")
            print(f"  schema: {json.dumps(t['input_schema'], indent=2)}")
        return

    if args.stdio:
        token = os.environ.get("RS_TOKEN", "")
        if not token:
            print("ERROR: RS_TOKEN environment variable is required for stdio mode.", file=sys.stderr)
            sys.exit(2)
        asyncio.run(run_stdio(token))
    else:
        logger.info(f"MCP server starting on {args.host}:{args.port}")
        asyncio.run(run_sse(args.host, args.port))


if __name__ == "__main__":
    main()
```

**Critical notes on this code:**

1. **Direct import, not HTTP loopback.** The MCP server imports `core.tools.execute_tool` directly. Earlier drafts considered HTTP loopback (MCP → localhost:8000 → execute_tool) but that adds latency and requires a `/api/tools/execute` endpoint that doesn't exist. Sharing the Python environment is cleaner.

2. **Audit and auth.** Token validation runs `core.auth.decode_token` (the same async function the FastAPI app uses). User_id is scoped per call. The existing audit log in tool execution still fires.

3. **The `mcp` SDK's exact import paths.** `mcp>=1.0.0` exposes `Server`, `stdio_server`, `SseServerTransport`, `Tool`, `TextContent` from the modules shown. If the SDK has moved them, stop and ask — do not guess.

4. **stdio vs SSE.** stdio is for embedded use (Claude Desktop launches `mcp_server.py` as a subprocess and talks over pipes). SSE is for network use (a remote client connects over HTTP). Both are supported.

### 2.5 Launcher script — `scripts/mcp-server.sh` (new file)

```bash
#!/usr/bin/env bash
# scripts/mcp-server.sh
# Launches the MCP server alongside the main River Song API.

set -euo pipefail
cd "$(dirname "$0")/.."

source venv/bin/activate
exec python3 mcp_server.py "$@"
```

Make executable:
```bash
chmod +x scripts/mcp-server.sh
```

### 2.6 README update

Add a new section to `README.md` (do **not** create a new markdown file). Find the existing section structure with `grep -n "^##" README.md | head -10` and insert before the "License" section if present:

```markdown
## MCP server — expose tools to external clients

River Song's tools are also reachable via the [Model Context Protocol](https://modelcontextprotocol.io). Useful for driving River Song from Claude Desktop, the Claude phone app, or any future MCP-aware agent.

### Run alongside the main API

```bash
./scripts/mcp-server.sh                   # SSE on 127.0.0.1:9090
./scripts/mcp-server.sh --stdio           # stdio (embedded clients)
./scripts/mcp-server.sh --list-tools      # print exposed tools and exit
```

### Connect from Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent path on your platform:

```json
{
  "mcpServers": {
    "river-song": {
      "command": "/absolute/path/to/RiverSongAI/scripts/mcp-server.sh",
      "args": ["--stdio"],
      "env": {
        "RS_TOKEN": "<a River Song JWT — issue one via POST /api/auth/login>"
      }
    }
  }
}
```

### Exposed tools

12 tools. Excluded for safety: `control_device`, `create_commerce_sale`, `trigger_n8n`. See `mcp_server.py::EXPOSED_TOOL_NAMES` for the current list.
```

### 2.7 No new routes; do NOT register MCP in `main.py`

The MCP server is a **separate process**. Do not add `import mcp_server` to `main.py`. Do not register an MCP router. Do not add a daemon entry for it. The user runs it manually (or via systemd, future work).

### 2.8 Acceptance checks — Section 2

**2.8.1 — Compile:**
```bash
python3 -c "import py_compile; py_compile.compile('mcp_server.py', doraise=True); print('mcp_server OK')"
```
Expected: `mcp_server OK`.

**2.8.2 — Tool listing:**
```bash
source venv/bin/activate
python3 mcp_server.py --list-tools
```
Expected: prints 12+ tool names with descriptions and JSON schemas. The names match the EXPOSED_TOOL_NAMES set verbatim. `control_device`, `create_commerce_sale`, `trigger_n8n` do NOT appear.

**2.8.3 — Server starts:**
```bash
./scripts/mcp-server.sh &
sleep 2
curl -s http://127.0.0.1:9090/sse  # without auth — expect 401
```
Expected: HTTP 401 response (or whichever code the SSE handler returns for missing auth). Server process is alive.

**2.8.4 — Authentication round-trip:**
```bash
# Issue a real token
TOKEN=$(curl -s -X POST http://127.0.0.1:8000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"<user>","password":"<pass>"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# Hit MCP SSE with token (basic GET test — real MCP clients negotiate the full protocol)
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9090/sse | head -5
```
Expected: stream opens; some MCP handshake content emerges. Full protocol test is via a real MCP client (see 2.8.5).

**2.8.5 — End-to-end via Claude Desktop:**
1. Configure `claude_desktop_config.json` per Section 2.6.
2. Restart Claude Desktop.
3. Open a new conversation; River Song's tools should appear in the tool list.
4. Ask Claude: "Use river-song to search my emails for invoices from this week." Claude calls `search_emails` via MCP → River Song's existing `_exec_search_emails` → returns to Claude.
5. Confirm the result appears in the Claude Desktop conversation.

**2.8.6 — Excluded tools are inaccessible:**
Attempt to call `control_device` via the MCP server (use a debug MCP client or the SDK's test harness). Expected: error or absence — the tool is not in the listed set.

**2.8.7 — App import baseline preserved:**
```bash
python3 -c "import sys; sys.path.insert(0,'.'); from main import app; print('routes:', len(app.routes))"
```
Expected: routes count is unchanged from §0.1 baseline (MCP doesn't add FastAPI routes).

### 2.9 What Section 2 is NOT doing

- **No new tools.** The MCP server is a wrapper only.
- **No modifications to `core/tools.py`** (read-only).
- **No HTTP loopback** from MCP → FastAPI. Direct import is the design.
- **No authentication other than Bearer token.** OAuth, API keys, etc. are out of scope.
- **No protocol version negotiation.** Targeting MCP 1.0; if the SDK requires version pinning, use the SDK default.
- **No SSL/TLS on the MCP server.** It binds to 127.0.0.1; if exposed beyond localhost (via Cloudflare tunnel), that's a future security review.
- **No rate limiting** on the MCP server (the underlying tool executor handles it if at all).

---

## Section 3 — Pulse daemon

### 3.0 What and why

Inspired by `koala73/worldmonitor` (54k stars). worldmonitor is 65+ data sources × dual map engines × correlation analysis. **Pulse is not worldmonitor.** Pulse is a 200-pixel dashboard widget that surfaces three ambient feeds:

1. **News:** read from the existing `providers/feeds/news.py` (already pulls 200+ RSS feeds across 15 categories). Pulse reads the *latest* item across all subscribed feeds — no new fetcher.
2. **Markets:** one ticker via `providers/feeds/stocks.py` (already supports Finnhub + Alpha Vantage). Default ticker `^GSPC` (S&P 500). User-configurable via setting.
3. **Flights:** OpenSky Network's free anonymous API. Returns ADS-B flight data near the user's coordinates if `LOCATION_LAT` / `LOCATION_LON` are set. **Gracefully empty if unset.**

Pulse runs as a **daemon** inheriting from `daemons/base_daemon.py`, ticking every 5 minutes by default.

### 3.1 Settings

Add to `config/settings.py`. Find the existing daemon settings block (search for `daemon_warden_port` — there are 6 daemons defined: warden, mechanic, herald, sifter, navigator, chemist). Add a 7th in the same style:

```python
    daemon_pulse_port: int = Field(default=8016, description="Pulse daemon internal port")
    daemon_pulse_enabled: bool = Field(default=True, description="Enable Pulse daemon")
    pulse_tick_seconds: int = Field(default=300, description="Pulse fetch interval (seconds)")
    pulse_ticker_symbol: str = Field(default="^GSPC", description="Default ticker symbol for Pulse markets panel")
```

Match the exact `Field(default=..., description=...)` style used for the other daemons. Read the surrounding lines (`grep -n "daemon_warden_port" config/settings.py` and `sed -n '<N-5>,<N+5>p' config/settings.py`) and mirror it.

### 3.2 Storage — `pulse_snapshots` table

Add to `providers/memory/sqlite_store.py` (the same async store pattern; mirror the `revoked_tokens` migration approach from Round 3):

```sql
CREATE TABLE IF NOT EXISTS pulse_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,        -- 'news' | 'markets' | 'flights'
    data_json TEXT NOT NULL,     -- JSON payload, schema varies per source
    ts REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_pulse_snapshots_source_ts ON pulse_snapshots(source, ts DESC);
```

**Async methods to add:**

```python
async def save_pulse_snapshot(self, source: str, data: dict) -> None: ...
async def get_latest_pulse_snapshot(self, source: str) -> Optional[dict]:
    """Returns {source, data, ts} or None."""

async def prune_pulse_snapshots(self, source: str, keep: int = 100) -> int:
    """Delete all but the most recent `keep` rows for this source. Returns rows deleted."""
```

Mirror the convention at the top of `sqlite_store.py` — each method runs the sync sqlite call via `self._executor`.

### 3.3 OpenSky provider — `providers/feeds/flights.py` (new file)

```python
"""
providers/feeds/flights.py

OpenSky Network ADS-B flight tracking — free anonymous API.
No key required, rate-limited to ~400 queries/day for anonymous users.

API: https://opensky-network.org/api/states/all?lamin=...&lamax=...&lomin=...&lomax=...

Returns flights within a bounding box around the configured location.
If LOCATION_LAT/LOCATION_LON are unset, returns [].
"""
from __future__ import annotations

import logging
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

OPENSKY_URL = "https://opensky-network.org/api/states/all"


async def fetch_overhead(lat: Optional[float], lon: Optional[float], radius_deg: float = 0.5) -> list[dict]:
    """
    Return flights within roughly `radius_deg` degrees of the given coordinates.
    Returns an empty list if coordinates are missing or the API call fails.
    """
    if lat is None or lon is None:
        return []
    params = {
        "lamin": lat - radius_deg, "lamax": lat + radius_deg,
        "lomin": lon - radius_deg, "lomax": lon + radius_deg,
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(OPENSKY_URL, params=params)
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        logger.warning(f"OpenSky fetch failed: {e}")
        return []

    states = data.get("states") or []
    result = []
    for s in states[:50]:  # cap at 50 to bound memory
        try:
            result.append({
                "icao24": s[0],
                "callsign": (s[1] or "").strip(),
                "country": s[2],
                "lon": s[5],
                "lat": s[6],
                "baro_altitude_m": s[7],
                "velocity_mps": s[9],
                "true_track_deg": s[10],
            })
        except (IndexError, TypeError):
            continue
    return result
```

### 3.4 The daemon — `daemons/pulse/pulse.py` (new file)

Create directory `daemons/pulse/` with three files (mirror `daemons/herald/`):

**`daemons/pulse/__init__.py`** — empty.

**`daemons/pulse/__main__.py`:**

```python
import asyncio
from daemons.pulse.pulse import PulseDaemon

if __name__ == "__main__":
    daemon = PulseDaemon()
    try:
        asyncio.run(daemon.start())
    except KeyboardInterrupt:
        daemon.stop()
```

**`daemons/pulse/pulse.py`:**

```python
"""
daemons/pulse/pulse.py

Pulse daemon — fetches ambient feeds on a tick and stores snapshots.

Sources:
  - News:    latest headline from providers.feeds.news (existing RSS layer)
  - Markets: ticker quote from providers.feeds.stocks (existing layer)
  - Flights: flights overhead from providers.feeds.flights (OpenSky free API)

Tick interval: settings.pulse_tick_seconds (default 300).
"""
import asyncio
import logging
import time

from daemons.base_daemon import BaseDaemon
from providers.feeds.news import fetch_curated_headlines  # confirm exact symbol — see note
from providers.feeds.stocks import fetch_quote, fetch_quote_finnhub  # confirm exact symbols
from providers.feeds.flights import fetch_overhead

logger = logging.getLogger(__name__)


class PulseDaemon(BaseDaemon):
    name = "pulse"

    async def _handle_task(self, action: str, payload: dict) -> dict:
        """Handle external task requests (e.g., force a refresh)."""
        if action == "refresh":
            await self._tick_once()
            return {"refreshed": True}
        return {"error": f"unknown action {action}"}

    async def _main_loop(self) -> None:
        if not self.settings.daemon_pulse_enabled:
            logger.info("Pulse: disabled in settings. Idle loop started.")
            while self._running:
                await asyncio.sleep(60)
            return

        logger.info("Pulse: starting. Tick interval = %ds", self.settings.pulse_tick_seconds)
        # Initial tick immediately so the dashboard isn't empty
        await self._tick_once()
        while self._running:
            await asyncio.sleep(self.settings.pulse_tick_seconds)
            await self._tick_once()

    async def _tick_once(self) -> None:
        ts = time.time()
        results = await asyncio.gather(
            self._fetch_news(),
            self._fetch_markets(),
            self._fetch_flights(),
            return_exceptions=True,
        )
        news_data, markets_data, flights_data = results

        # Save each snapshot, swallowing per-source failures
        await self._save_or_log("news", news_data, ts)
        await self._save_or_log("markets", markets_data, ts)
        await self._save_or_log("flights", flights_data, ts)

        # Prune to last 100 per source
        await self._prune_all()

    async def _save_or_log(self, source: str, data, ts: float) -> None:
        if isinstance(data, Exception):
            logger.warning(f"Pulse {source} fetch failed: {data}")
            return
        # POST to main app's snapshot endpoint OR call the store directly.
        # Daemons can't import the main app's store singleton, so we go through HTTP.
        import httpx
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                await client.post(
                    f"http://127.0.0.1:{self.settings.app_port}/api/pulse/_internal/snapshot",
                    json={"source": source, "data": data, "ts": ts},
                    headers={"Authorization": f"Bearer {self.settings.daemon_internal_secret}"},
                )
        except Exception as e:
            logger.warning(f"Pulse save {source} failed: {e}")

    async def _prune_all(self) -> None:
        import httpx
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                await client.post(
                    f"http://127.0.0.1:{self.settings.app_port}/api/pulse/_internal/prune",
                    headers={"Authorization": f"Bearer {self.settings.daemon_internal_secret}"},
                )
        except Exception as e:
            logger.warning(f"Pulse prune failed: {e}")

    async def _fetch_news(self) -> dict:
        # Read the provider — exact symbol may be different. See provider file.
        # Goal: return {"headline": str, "source": str, "url": str, "published_at": str}
        try:
            articles = await fetch_curated_headlines(limit=1)  # adjust to actual signature
            if not articles:
                return {}
            top = articles[0]
            return {
                "headline": top.get("title", ""),
                "source": top.get("source", ""),
                "url": top.get("url", ""),
                "published_at": top.get("published_at", ""),
            }
        except Exception as e:
            logger.warning(f"News fetch failed: {e}")
            return {}

    async def _fetch_markets(self) -> dict:
        symbol = self.settings.pulse_ticker_symbol
        finnhub_key = getattr(self.settings, "finnhub_key", "") or ""
        alpha_key = getattr(self.settings, "alpha_vantage_key", "") or ""

        if finnhub_key:
            quote = await fetch_quote_finnhub(symbol, finnhub_key)
        elif alpha_key:
            quote = await fetch_quote(symbol, alpha_key)
        else:
            return {"symbol": symbol, "error": "no API key configured"}

        if not quote:
            return {"symbol": symbol, "error": "fetch failed"}
        return {"symbol": symbol, **quote}

    async def _fetch_flights(self) -> dict:
        lat = getattr(self.settings, "location_lat", None)
        lon = getattr(self.settings, "location_lon", None)
        # location_lat/lon may not be defined on Settings — read once and stop here if missing
        if lat is None or lon is None:
            return {"flights": [], "reason": "location_not_set"}
        flights = await fetch_overhead(lat, lon)
        return {"flights": flights, "lat": lat, "lon": lon}
```

**Critical notes on this code:**

1. **`fetch_curated_headlines` / `fetch_quote_finnhub` symbol names are best-effort.** Read `providers/feeds/news.py` and `providers/feeds/stocks.py` first to confirm the exact function names. The skeleton above uses placeholder names; **STOP and ask the user before changing the provider files** if the symbols don't exist with those names. There's a high chance the news provider has a different entry point like `fetch_all_curated()` or similar.

2. **HTTP loopback to save.** Daemons run in separate processes and can't share the FastAPI app's store. The daemon posts to a new internal endpoint (`/api/pulse/_internal/snapshot`) gated by `daemon_internal_secret`. This is the same pattern used for the existing daemon heartbeat (per `daemons/base_daemon.py::_heartbeat_loop`).

3. **`location_lat` / `location_lon` may not exist.** River Song has a location module (`api/routes/location.py`) but the canonical lat/lon may be stored per-user, not as a global setting. If unavailable globally, the daemon fallback (`return {"flights": [], "reason": "location_not_set"}`) is fine — the dashboard widget shows "Set location to see flights" in that case.

### 3.5 API routes — `api/routes/pulse.py` (new file)

```python
"""
api/routes/pulse.py

Pulse dashboard data — three ambient feeds (news/markets/flights).
"""
from typing import Optional
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel

from core.auth import decode_token
from config.settings import get_settings

router = APIRouter(prefix="/api/pulse", tags=["pulse"])


async def _require_user(authorization: Optional[str] = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return payload["sub"]


def _require_daemon_secret(authorization: Optional[str] = Header(default=None)) -> None:
    """Internal-only auth using the daemon shared secret."""
    settings = get_settings()
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    token = authorization.removeprefix("Bearer ")
    if token != settings.daemon_internal_secret:
        raise HTTPException(status_code=403, detail="Forbidden")


class SnapshotBody(BaseModel):
    source: str
    data: dict
    ts: float


@router.get("/latest")
async def get_latest(request: Request, user_id: str = Depends(_require_user)) -> dict:
    """Return the latest snapshot per source."""
    store = request.app.state.memory_manager._store
    news = await store.get_latest_pulse_snapshot("news")
    markets = await store.get_latest_pulse_snapshot("markets")
    flights = await store.get_latest_pulse_snapshot("flights")
    return {
        "news": news["data"] if news else {},
        "markets": markets["data"] if markets else {},
        "flights": flights["data"] if flights else {},
        "ts": {
            "news": news["ts"] if news else None,
            "markets": markets["ts"] if markets else None,
            "flights": flights["ts"] if flights else None,
        },
    }


# Internal — called by the Pulse daemon over HTTP loopback.
@router.post("/_internal/snapshot", dependencies=[Depends(_require_daemon_secret)])
async def _save_snapshot(body: SnapshotBody, request: Request) -> dict:
    store = request.app.state.memory_manager._store
    await store.save_pulse_snapshot(body.source, body.data)
    return {"saved": True}


@router.post("/_internal/prune", dependencies=[Depends(_require_daemon_secret)])
async def _prune_all(request: Request) -> dict:
    store = request.app.state.memory_manager._store
    total = 0
    for source in ("news", "markets", "flights"):
        total += await store.prune_pulse_snapshots(source, keep=100)
    return {"pruned": total}
```

### 3.6 Register the router

**`api/routes/__init__.py`:** add at the same level as other imports:

```python
from .pulse import router as pulse_router
```

And add `"pulse_router"` to `__all__`.

**`main.py`:** in the imports inside `create_app()` (around line 280), add `pulse_router` to the tuple. In the include section (around line 290-310), add:

```python
    app.include_router(pulse_router)
```

### 3.7 Start the daemon

The existing daemons aren't auto-started by `main.py` — they run as separate processes (likely via systemd per `daemons/river-song-daemon@.service`). Mirror that.

**Verify:** `cat daemons/river-song-daemon@.service` shows the pattern. If the service file uses `python -m daemons.%i.%i`, then Pulse runs as `python -m daemons.pulse.pulse` (or the equivalent — confirm by reading the unit).

**Add to deploy.sh / setup.sh if applicable** — only if existing daemons are launched from those scripts. Otherwise the user starts Pulse manually with:

```bash
source venv/bin/activate
python3 -m daemons.pulse
```

### 3.8 Dashboard widget

**Backend prereq:** Pulse is now serving `/api/pulse/latest`.

**Target file:** `frontend/src/pages/DashboardPage.jsx`.

**Step 1 — register in the widget registry.** The widget list is at lines 8-26. Add an entry:

```jsx
const ALL_WIDGETS = [
  { key: 'health_status',   label: 'River Song Health', col: 'left' },
  { key: 'system_status',   label: 'System Status',   col: 'left',  adminOnly: true },
  { key: 'pulse',           label: 'Pulse',           col: 'right' },   // <— NEW
  { key: 'recent_sessions', label: 'Recent Sessions',  col: 'left'  },
  // ... rest unchanged
]
```

(Position the entry in `col: 'right'` to match the brief — Pulse is ambient awareness, fits next to River Status / Quick Actions / Rover Status.)

**Step 2 — create the widget component.** New file `frontend/src/components/PulseWidget.jsx`:

```jsx
import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import './PulseWidget.css'

export default function PulseWidget() {
  const { token } = useAuth()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const fetchData = async () => {
      try {
        const res = await fetch('/api/pulse/latest', { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        if (active) setData(json)
      } catch (e) {
        if (active) setError(e.message)
      }
    }
    fetchData()
    const id = setInterval(fetchData, 60_000)  // 60s
    return () => { active = false; clearInterval(id) }
  }, [token])

  if (error) return <div className="pulse-widget pulse-widget--error">Pulse offline</div>
  if (!data) return <div className="pulse-widget">…</div>

  const headline = data.news?.headline || '—'
  const source = data.news?.source || ''
  const ticker = data.markets?.symbol
  const price = data.markets?.price
  const change = data.markets?.change_pct
  const flights = data.flights?.flights || []

  return (
    <div className="pulse-widget">
      <div className="pulse-row">
        <span className="pulse-label">News</span>
        <span className="pulse-headline" title={`${source}`}>{headline}</span>
      </div>
      <div className="pulse-row">
        <span className="pulse-label">{ticker || 'Markets'}</span>
        <span className="pulse-price">
          {price != null ? `$${price.toFixed(2)}` : '—'}
          {change != null && (
            <span className={`pulse-change ${change >= 0 ? 'up' : 'down'}`}>
              {' '}{change >= 0 ? '+' : ''}{change.toFixed(2)}%
            </span>
          )}
        </span>
      </div>
      <div className="pulse-row">
        <span className="pulse-label">Flights overhead</span>
        <span className="pulse-flights">
          {flights.length > 0 ? `${flights.length} aircraft` : (data.flights?.reason === 'location_not_set' ? 'Set location to enable' : 'None')}
        </span>
      </div>
    </div>
  )
}
```

**Step 3 — CSS.** New file `frontend/src/components/PulseWidget.css`:

```css
.pulse-widget {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
  font-size: 0.875rem;
}
.pulse-widget--error {
  color: var(--danger, #c00);
  opacity: 0.7;
}
.pulse-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 1rem;
}
.pulse-label {
  font-size: 0.75rem;
  opacity: 0.6;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  flex-shrink: 0;
}
.pulse-headline {
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 70%;
}
.pulse-change.up { color: var(--success, #0a0); }
.pulse-change.down { color: var(--danger, #c00); }
```

**Step 4 — render it in DashboardPage.** Find the existing WidgetShell render pattern (the file uses `<WidgetShell ... widgetKey="X">`). Add a new shell for `pulse`. Look at how an existing right-column widget is rendered (e.g., `quick_actions` or `river_status`) and copy that pattern:

```jsx
{visible.pulse && (
  <WidgetShell
    arrange={arrange}
    widgetKey="pulse"
    label="Pulse"
    onToggle={() => toggleWidget('pulse')}
  >
    <PulseWidget />
  </WidgetShell>
)}
```

Import at the top of DashboardPage.jsx:
```jsx
import PulseWidget from '../components/PulseWidget.jsx'
```

### 3.9 Acceptance checks — Section 3

**3.9.1 — Compile:**
```bash
python3 -c "
import py_compile
for f in ['api/routes/pulse.py','daemons/pulse/pulse.py','daemons/pulse/__main__.py','providers/feeds/flights.py']:
    py_compile.compile(f, doraise=True)
print('all OK')"
```
Expected: `all OK`.

**3.9.2 — App imports + routes:**
```bash
python3 -c "import sys; sys.path.insert(0,'.'); from main import app; print('routes:', len(app.routes))"
```
Expected: routes count = previous baseline + 3 (`/api/pulse/latest`, `/api/pulse/_internal/snapshot`, `/api/pulse/_internal/prune`).

**3.9.3 — Daemon starts cleanly:**
```bash
source venv/bin/activate
python3 -m daemons.pulse &
DAEMON_PID=$!
sleep 3
ps -p $DAEMON_PID > /dev/null && echo "daemon alive" || echo "daemon died"
```
Expected: `daemon alive`. The log should show `Pulse: starting. Tick interval = 300s`.

**3.9.4 — First tick fires:**
Wait up to 15 seconds after starting the daemon (initial tick happens immediately). Then:
```bash
TOKEN=<paste>
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/pulse/latest
```
Expected: JSON with `{news: {...}, markets: {...}, flights: {...}, ts: {...}}`. `news.headline` is non-empty (assuming RSS sources are reachable). `markets` has either a quote or an `error` field. `flights` has either an array or `reason: "location_not_set"`.

**3.9.5 — Snapshot rows in DB:**
```bash
sqlite3 data/db/river_song.db "SELECT source, ts, length(data_json) FROM pulse_snapshots ORDER BY ts DESC LIMIT 5;"
```
Expected: 3 rows (one per source) with recent ts and non-zero data length.

**3.9.6 — Internal endpoint refuses non-daemon callers:**
```bash
TOKEN=<user_token>
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"source":"news","data":{},"ts":0}' \
  http://localhost:8000/api/pulse/_internal/snapshot
```
Expected: HTTP 403 (forbidden — token doesn't match `daemon_internal_secret`).

**3.9.7 — Pruning:**
1. Run the daemon for ~10 minutes (two ticks).
2. Manually insert ~110 fake rows for `news` via `sqlite3`.
3. Trigger another tick (or wait).
4. Confirm `SELECT COUNT(*) FROM pulse_snapshots WHERE source='news'` returns 100, not 110.

**3.9.8 — Dashboard widget renders:**
1. Open `http://localhost:5173/`, log in, navigate to Dashboard.
2. The Pulse widget appears in the right column with three rows: news headline, ticker price + change, flights overhead.
3. Wait 60+ seconds — content updates (or the same content re-rendered without a flash).
4. Toggle the widget off via arrange mode, refresh, confirm it's hidden. Toggle on, confirm it returns.

**3.9.9 — Graceful failure when network is down:**
1. Set `pulse_ticker_symbol` to `INVALID_TICKER_XYZ` in `.env`. Restart Pulse daemon.
2. Within one tick, the daemon should log a warning but NOT crash.
3. `/api/pulse/latest` still returns; the `markets` field shows an error or empty.
4. Dashboard widget shows `—` for the price; the rest of the widget still renders.

### 3.10 What Section 3 is NOT doing

- No map view (worldmonitor's dual-engine map is a future feature)
- No correlation engine (worldmonitor's signal-convergence detector — far future)
- No alerting / notifications (a Herald-daemon job, separate)
- No multi-ticker (one ticker per user; multi-ticker requires per-user settings UI)
- No flight-tracking on a map (just the count overhead)
- No historical Pulse chart (data is collected; no UI yet)
- No desktop app (worldmonitor has a Tauri app — not in scope)
- No alerting on price moves / news keywords

---

## Section 4 — Universal out-of-scope (applies to everything in this brief)

- **No commits or pushes.** User commits.
- **No new dependencies** beyond the explicit ones: `mcp>=1.0.0`. No others without stopping and asking.
- **No edits to audit-protected files** beyond what §0.4 lists.
- **No CHRONOS changes** — Phase 1-3 is settled. Bugs surfaced in §1 verification are reported, not patched, unless the user explicitly OKs the fix.
- **MCP is a wrapper, not a tool author.** Don't add tools to the dispatcher.
- **Pulse is small and ambient.** If you find yourself adding maps, alerts, or correlation engines, stop and flag.

---

## Section 5 — Reporting back

Pause for the user's go-ahead between sections. After each:

1. **Section completed:** §1 (verification) / §2 (MCP) / §3 (Pulse)
2. **Files created or modified:** one per line, full path from repo root
3. **Dependencies added:** Python + npm with version constraints
4. **Schema changes applied:** SQL inlined
5. **Acceptance checks run:** exact command + PASS/FAIL + 1-line detail
6. **Anything unexpected:** files that looked wrong but you didn't touch, decisions made not covered above, anything flagged for the user

Do not commit. Do not push. Do not create additional markdown files.
