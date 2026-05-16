#!/usr/bin/env bash
# scripts/mcp-server.sh
# Launches the MCP server alongside the main River Song API.

set -euo pipefail
cd "$(dirname "$0")/.."

source venv/bin/activate
exec python3 mcp_server.py "$@"
