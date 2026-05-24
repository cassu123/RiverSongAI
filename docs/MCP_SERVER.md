# MCP Server

River Song's tools exposed via the
[Model Context Protocol](https://modelcontextprotocol.io). Lets Claude
Desktop, the Claude mobile app, or any MCP-aware agent reach into the
same tool catalogue that the in-app River Song uses — under the same
auth and audit paths.

**File:** `mcp_server.py` (top-level, runs as a separate process)

---

## What it exposes

A **safe subset** of River Song's full tool catalogue. The exclusions
are intentional: anything that mutates physical state, finances, or
triggers external automations is off-limits over MCP.

### 14 exposed tools

| Tool | Purpose |
|---|---|
| `create_calendar_event` | New Google Calendar event for the caller |
| `add_inventory_item` | Add to home inventory |
| `add_shopping_list_item` | Add to shopping list |
| `set_reminder` | New reminder |
| `log_vehicle_maintenance` | Log a maintenance event for a vehicle |
| `add_recipe_to_library` | Save a recipe |
| `create_routine` | Create a new routine |
| `check_reading_status` | Status of Audible/Libby/Kindle queues |
| `sync_kindle_library` | Trigger Kindle sync |
| `search_commerce_products` | Search Amazon/Walmart/Shopify catalogue |
| `generate_business_report` | Build a commerce/analytics report |
| `web_search` | Run a search via the configured web provider |
| `search_emails` | Search the caller's Gmail |
| `get_weather` | Current weather for the user's default location |

### Excluded for safety

- `control_device` (Home Assistant write)
- `create_commerce_sale` (financial write)
- `trigger_n8n` (arbitrary external automation)

The exclusion list is enforced by `EXPOSED_TOOL_NAMES` in
`mcp_server.py`. Adding a tool to MCP is a one-line edit; review the
blast radius before doing so.

---

## How it connects

```
MCP client ── SSE or stdio ──▶ mcp_server.py ──▶ core.tools.execute_tool ──▶ providers/...
                                       │
                                       └── auth via JWT (core.auth.decode_token)
```

- The MCP server runs in the **same Python environment and SQLite
  database** as the FastAPI app. It does not call out to River Song
  over HTTP for execution — it calls `core.tools.execute_tool`
  directly. This keeps audit logs and rate-limiting in one process.
- Authentication: every connection presents a Bearer token. The
  server validates it once via `decode_token` and resolves the
  `user_id`. Every tool call in the session runs as that user.

---

## Running it

### Alongside the main API

```bash
./scripts/mcp-server.sh                  # SSE on 127.0.0.1:9090
./scripts/mcp-server.sh --stdio          # stdio (for embedded clients)
./scripts/mcp-server.sh --list-tools     # print exposed tools and exit
```

Direct invocation:

```bash
python3 mcp_server.py
python3 mcp_server.py --stdio
python3 mcp_server.py --host 0.0.0.0 --port 9090
```

### Environment

- `RS_API_BASE` (default `http://127.0.0.1:8000`) — reserved for HTTP
  fall-back; current implementation calls `execute_tool` directly so
  this is informational only.
- `RS_TOKEN` — required in stdio mode (the token passed at connection
  time is read from this env var).

---

## Connecting from Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` on
macOS, or the equivalent path on your platform:

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

After editing, restart Claude Desktop. The `river-song` server should
appear in the MCP server list with all 14 tools.

---

## Transports

| Transport | When to use |
|---|---|
| **SSE** (default) | Long-running remote clients; one process per River Song install, many sessions. Each SSE connection passes its own Bearer token in the `Authorization` header. |
| **stdio** | Single-session embedded clients (Claude Desktop, IDE plugins). The client spawns the process; the token is passed via `RS_TOKEN` env var. |

---

## Adding a new tool to MCP

1. Implement the tool in `core/tools.py` (and register its schema in
   `TOOL_SCHEMAS`).
2. Decide whether it is **read-only or low-blast-radius** — if not,
   stop. Don't add it.
3. Add its name to `EXPOSED_TOOL_NAMES` in `mcp_server.py`.
4. Update this doc's tool table.
5. Update `README.md`'s tool count.

---

## See also

- `mcp_server.py` — implementation
- `core/tools.py` — canonical tool definitions and `execute_tool`
- `scripts/mcp-server.sh` — launcher
- `README.md` § *MCP server* — user-facing setup
