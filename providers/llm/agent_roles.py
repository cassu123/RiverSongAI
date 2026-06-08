"""
providers/llm/agent_roles.py

Agent-Role Taxonomy for River Song AI.

Orthogonal to the existing intent router (which classifies *user messages*),
this module classifies *which subsystem is doing the work* and routes each
role to its assigned model.

A daemon, route handler, or core component asks for an `AgentRole` instead of
hand-picking a provider/model. That makes per-role tuning (model, temperature,
prompt hint) a single-source-of-truth concern and lets the SLAE admin panel
show "what's wired to what" at a glance.

Pattern adapted from PentAGI's `pconfig.ProviderOptionsType` (Go), trimmed to
the roles RiverSong actually has today.

Usage:
    from providers.llm.agent_roles import AgentRole, get_role_registry

    cfg = get_role_registry().get(AgentRole.SCRIBE)
    # cfg.provider, cfg.model_id, cfg.temperature, cfg.max_tokens

    # When you actually invoke a model, tell the registry so the admin panel
    # shows recent activity:
    get_role_registry().record_invocation(
        AgentRole.SCRIBE, success=True, elapsed_ms=412,
    )
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional


class AgentRole(str, Enum):
    """Named roles for every subsystem that calls an LLM.

    String-valued so JSON serialisation is automatic.
    """

    PRIMARY   = "primary"     # main user-facing assistant turn
    ASSISTANT = "assistant"   # secondary conversation flows (chat page, briefings)
    SIMPLE    = "simple"      # one-shot text completions, no chain-of-thought
    SCRIBE    = "scribe"      # vault note synthesis (CHRONOS Scribe daemon)
    SIFTER    = "sifter"      # filtering / triage (Sifter daemon)
    WARDEN    = "warden"      # safety / policy checks (Warden daemon)
    REFINER   = "refiner"     # cleanup / polish on raw model output
    REPORTER  = "reporter"    # structured JSON reports (analytics, summaries)
    SEARCHER  = "searcher"    # research + retrieval synthesis
    CODER     = "coder"       # code generation / explanation
    REFLECTOR = "reflector"   # self-critique / evaluation passes


@dataclass(frozen=True)
class RoleConfig:
    """Static configuration for one agent role.

    Attributes:
        provider:    Provider key from `LLMRegistry.providers()` (e.g. "anthropic").
        model_id:    Concrete model id from `LLMRegistry` (e.g. "claude-haiku-4-5-20251001").
        temperature: Sampling temperature; lower for structured roles, higher for creative.
        max_tokens:  Generation cap.
        json_mode:   True if the role expects strict JSON output.
        notes:       Free-text purpose hint shown in the admin panel.
    """
    role: AgentRole
    provider: str
    model_id: str
    temperature: float = 0.7
    max_tokens: int = 1024
    json_mode: bool = False
    notes: str = ""


@dataclass
class InvocationRecord:
    """Snapshot of the most recent call for a given role."""
    role: AgentRole
    model_id: str
    timestamp: float            # unix seconds (UTC)
    success: bool
    elapsed_ms: Optional[int] = None
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Default role → model assignments
# ---------------------------------------------------------------------------
# LOCAL-FIRST per [[feedback_local_first]] (2026-06-08).
#
# Every default points at an Ollama model from providers/llm/registry.py.
# Cloud LLMs are NEVER a default — they are escape hatches that River Song's
# chat path may opt into mid-turn (runtime escalation), not background work.
#
# Model picks here target the user's hardware (GTX 1050 Ti, 4GB VRAM, 32GB RAM):
#   - Roles needing low latency get GPU-resident models (≤2.2GB VRAM)
#   - Roles tolerant of slower responses get RAM-resident models for capacity
#
# To override at runtime: AgentRoleRegistry.set_config(role, RoleConfig(...))
# or the (future) SLAE admin panel role editor.

_DEFAULTS: Dict[AgentRole, RoleConfig] = {
    AgentRole.PRIMARY: RoleConfig(
        role=AgentRole.PRIMARY,
        provider="ollama",
        model_id="llama3.2:3b",
        temperature=0.7,
        max_tokens=2048,
        notes="Main user-facing assistant turn. Local-first; chat path may escalate at runtime.",
    ),
    AgentRole.ASSISTANT: RoleConfig(
        role=AgentRole.ASSISTANT,
        provider="ollama",
        model_id="llama3.2:3b",
        temperature=0.7,
        max_tokens=1024,
        notes="Secondary conversation flows (briefings, follow-ups). GPU-resident.",
    ),
    AgentRole.SIMPLE: RoleConfig(
        role=AgentRole.SIMPLE,
        provider="ollama",
        model_id="llama3.2:1b",
        temperature=0.3,
        max_tokens=512,
        notes="One-shot completions, classifiers, short rewrites. Fastest model.",
    ),
    AgentRole.SCRIBE: RoleConfig(
        role=AgentRole.SCRIBE,
        provider="ollama",
        model_id="llama3.2:3b",
        temperature=0.4,
        max_tokens=1024,
        notes="CHRONOS Scribe daemon — note synthesis from raw context.",
    ),
    AgentRole.SIFTER: RoleConfig(
        role=AgentRole.SIFTER,
        provider="ollama",
        model_id="llama3.2:1b",
        temperature=0.2,
        max_tokens=512,
        json_mode=True,
        notes="Sifter daemon — fast triage / filtering with structured output.",
    ),
    AgentRole.WARDEN: RoleConfig(
        role=AgentRole.WARDEN,
        provider="ollama",
        model_id="llama3.2:3b",
        temperature=0.0,
        max_tokens=512,
        json_mode=True,
        notes="Warden daemon — safety / policy checks. Deterministic, JSON.",
    ),
    AgentRole.REFINER: RoleConfig(
        role=AgentRole.REFINER,
        provider="ollama",
        model_id="llama3.2:3b",
        temperature=0.3,
        max_tokens=1024,
        notes="Polish raw model output before user sees it.",
    ),
    AgentRole.REPORTER: RoleConfig(
        role=AgentRole.REPORTER,
        provider="ollama",
        model_id="qwen2.5:3b",
        temperature=0.2,
        max_tokens=1024,
        json_mode=True,
        notes="Structured reports — analytics summaries, daemon outputs. Qwen handles JSON well.",
    ),
    AgentRole.SEARCHER: RoleConfig(
        role=AgentRole.SEARCHER,
        provider="ollama",
        model_id="llama3.1:8b",
        temperature=0.5,
        max_tokens=2048,
        notes="Research + retrieval synthesis. RAM-resident; more capacity for synthesis.",
    ),
    AgentRole.CODER: RoleConfig(
        role=AgentRole.CODER,
        provider="ollama",
        model_id="qwen2.5-coder:7b",
        temperature=0.2,
        max_tokens=4096,
        notes="Code generation / explanation. Specialised coder model.",
    ),
    AgentRole.REFLECTOR: RoleConfig(
        role=AgentRole.REFLECTOR,
        provider="ollama",
        model_id="llama3.2:3b",
        temperature=0.5,
        max_tokens=1024,
        notes="Self-critique passes after primary output.",
    ),
}


class AgentRoleRegistry:
    """Singleton registry for agent-role configs + recent invocations.

    Thread-safe; daemons run concurrently.
    """

    def __init__(self) -> None:
        self._configs: Dict[AgentRole, RoleConfig] = dict(_DEFAULTS)
        self._last_invocations: Dict[AgentRole, InvocationRecord] = {}
        self._lock = threading.Lock()

    # -- read ---------------------------------------------------------------

    def get(self, role: AgentRole) -> RoleConfig:
        """Return the config for `role`. Always present — defaults guarantee it."""
        with self._lock:
            return self._configs[role]

    def all(self) -> List[RoleConfig]:
        """All role configs, ordered by enum declaration."""
        with self._lock:
            return [self._configs[r] for r in AgentRole]

    def last_invocation(self, role: AgentRole) -> Optional[InvocationRecord]:
        with self._lock:
            return self._last_invocations.get(role)

    def all_last_invocations(self) -> Dict[AgentRole, InvocationRecord]:
        with self._lock:
            return dict(self._last_invocations)

    # -- write --------------------------------------------------------------

    def set_config(self, role: AgentRole, cfg: RoleConfig) -> None:
        """Override a role's config at runtime (admin panel will use this)."""
        with self._lock:
            self._configs[role] = cfg

    def record_invocation(
        self,
        role: AgentRole,
        *,
        success: bool,
        elapsed_ms: Optional[int] = None,
        error: Optional[str] = None,
        model_id_override: Optional[str] = None,
    ) -> None:
        """Stamp the last-invocation record so the admin panel shows activity."""
        with self._lock:
            cfg = self._configs[role]
            self._last_invocations[role] = InvocationRecord(
                role=role,
                model_id=model_id_override or cfg.model_id,
                timestamp=time.time(),
                success=success,
                elapsed_ms=elapsed_ms,
                error=error,
            )


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_registry: Optional[AgentRoleRegistry] = None
_registry_lock = threading.Lock()


def get_role_registry() -> AgentRoleRegistry:
    """Return the process-wide AgentRoleRegistry singleton."""
    global _registry
    if _registry is None:
        with _registry_lock:
            if _registry is None:
                _registry = AgentRoleRegistry()
    return _registry


# ---------------------------------------------------------------------------
# Convenience function for the migration in Task #4
# ---------------------------------------------------------------------------

def route_for_role(role: AgentRole) -> RoleConfig:
    """Shortcut: get the config a daemon needs to make an LLM call for `role`."""
    return get_role_registry().get(role)
