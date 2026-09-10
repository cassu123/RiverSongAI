"""
api/routes/slae.py

SLAE Control — admin observability for the Synchronized Local Autonomous
Environment. Status panel for agent roles, Langfuse tracing, Graphiti graph,
and recent daemon activity.

Each section returns a status string the frontend renders as a pill:
  - "not_configured" — nothing built yet (greyed out)
  - "disabled"       — built but turned off
  - "healthy"        — running and reachable
  - "error"          — running but broken

Sections fill in as the agent-role taxonomy, Langfuse, and Graphiti tasks land.
Until then this endpoint returns a known-empty shape so the frontend can render.

Endpoints (admin role required):
  GET /api/admin/slae/status
"""

from __future__ import annotations

from typing import Any, Optional

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header

from config.settings import get_settings
from core.auth import decode_token
from core.errors import forbidden, unauthorized
from core.observability import get_langfuse
from providers.llm.agent_roles import get_role_registry
from providers.memory.graphiti_provider import get_graphiti_provider

router = APIRouter(prefix="/api/admin/slae", tags=["slae"])


async def _require_admin(
        authorization: Optional[str] = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise unauthorized("Not authenticated.")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise unauthorized("Invalid or expired token.")
    if payload.get("role") != "admin":
        raise forbidden("Admin access required.")
    return payload["sub"]


def _agent_roles_section() -> dict[str, Any]:
    reg = get_role_registry()
    configs = reg.all()
    last = reg.all_last_invocations()

    role_rows: list[dict[str, Any]] = []
    for cfg in configs:
        inv = last.get(cfg.role)
        role_rows.append({
            "name": cfg.role.value,
            "provider": cfg.provider,
            "model": cfg.model_id,
            "temperature": cfg.temperature,
            "max_tokens": cfg.max_tokens,
            "json_mode": cfg.json_mode,
            "notes": cfg.notes,
            "last_invocation": (
                {
                    "ts": datetime.fromtimestamp(inv.timestamp, tz=timezone.utc).isoformat(),
                    "success": inv.success,
                    "elapsed_ms": inv.elapsed_ms,
                    "error": inv.error,
                }
                if inv is not None
                else None
            ),
        })

    return {
        "status": "healthy",
        "message": f"{len(role_rows)} roles registered. Defaults loaded from providers/llm/agent_roles.py.",
        "roles": role_rows,
        "last_invocations": [r for r in role_rows if r["last_invocation"] is not None],
    }


def _langfuse_section() -> dict[str, Any]:
    settings = get_settings()
    if not getattr(settings, "langfuse_enabled", False):
        return {
            "status": "disabled",
            "message": "Set LANGFUSE_ENABLED=true and configure keys to start tracing.",
            "dashboard_url": settings.langfuse_host,
            "recent_traces": [],
        }
    client = get_langfuse()
    if client is None:
        return {
            "status": "error",
            "message": "Langfuse is enabled but the client failed to initialise. Check keys and host.",
            "dashboard_url": settings.langfuse_host,
            "recent_traces": [],
        }
    return {
        "status": "healthy",
        "message": "Langfuse client active. Traces flushing every "
                   f"{settings.langfuse_flush_interval_seconds:.0f}s.",
        "dashboard_url": settings.langfuse_host,
        # The Langfuse Python SDK doesn't expose a read API for recent traces
        # at module level — the dashboard URL is the canonical read surface.
        "recent_traces": [],
    }


def _graphiti_section() -> dict[str, Any]:
    settings = get_settings()
    provider = get_graphiti_provider()
    if not provider.enabled:
        return {
            "status": "disabled",
            "message": "Set GRAPHITI_ENABLED=true, NEO4J_PASSWORD, and start the observability profile to begin recording episodes.",
            "neo4j_browser_url": getattr(settings, "neo4j_browser_url", None),
            "node_count": 0,
            "edge_count": 0,
            "recent_episodes": [],
        }
    healthy = provider.healthcheck()
    stats = provider.stats()
    return {
        "status": "healthy" if healthy else "error",
        "message": (
            "Graphiti library mode active. Episodes flowing to Neo4j."
            if healthy
            else "Graphiti is enabled but the client failed to initialise. "
            "Check NEO4J_URI / NEO4J_PASSWORD and that the neo4j-graphiti container is running."
        ),
        "neo4j_browser_url": getattr(settings, "neo4j_browser_url", None),
        "node_count": stats["node_count"],
        "edge_count": stats["edge_count"],
        "recent_episodes": stats["recent_episodes"],
    }


def _recent_activity_section() -> dict[str, Any]:
    reg = get_role_registry()
    invocations = reg.all_last_invocations()
    events: list[dict[str, Any]] = []
    for role, inv in invocations.items():
        events.append({
            "ts": datetime.fromtimestamp(inv.timestamp, tz=timezone.utc).isoformat(),
            "source": role.value,
            "summary": (
                f"ok · {inv.elapsed_ms} ms · {inv.model_id}"
                if inv.success
                else f"FAILED · {inv.error or 'unknown error'}"
            ),
        })

    # Graphiti episode tail, when present, adds a parallel stream of activity.
    graphiti_stats = get_graphiti_provider().stats()
    for ep in graphiti_stats.get("recent_episodes", []):
        events.append({
            "ts": ep["ts"],
            "source": f"graphiti:{ep['source']}",
            "summary": ep["summary"],
        })

    events.sort(key=lambda e: e["ts"], reverse=True)

    if not events:
        return {
            "status": "not_configured",
            "message": "No agent activity yet. Run a daemon or have a conversation to populate the feed.",
            "events": [],
        }
    return {
        "status": "healthy",
        "message": f"{len(events)} recent events.",
        "events": events[:50],
    }


@router.get("/status")
async def get_status(_: str = Depends(_require_admin)) -> dict[str, Any]:
    return {
        "agent_roles": _agent_roles_section(),
        "langfuse": _langfuse_section(),
        "graphiti": _graphiti_section(),
        "recent_activity": _recent_activity_section(),
    }
