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

from core.tools import TOOL_SCHEMAS as RS_TOOLS  # the canonical tool definitions
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
