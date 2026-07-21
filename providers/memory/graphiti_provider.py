"""
providers/memory/graphiti_provider.py

Graphiti knowledge-graph provider for River Song AI.

This wraps the graphiti-core library so callers (conversation_loop, scribe,
memory_manager) can write episodes and search the graph without caring
whether Graphiti is configured, reachable, or even installed.

Design (modeled on PentAGI's pkg/graphiti/client.go):

  - Single enabled-or-disabled flag derived from settings.
  - Healthcheck on first use (lazy) — bails to disabled if Neo4j is unreachable.
  - Every public method is timeout-bounded.
  - **Failures warn, never raise.** Memory is *additive*; a Graphiti outage must
    never break the conversation loop or a daemon.

Plan: docs/GRAPHITI_INTEGRATION_PLAN.md.

NOTE (Phase M1): Graphiti is currently PAUSED to trim the memory architecture to 
three core layers. The code remains in place but graphiti_enabled defaults to false.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, List, Optional

from config.settings import get_settings

logger = logging.getLogger(__name__)


@dataclass
class Episode:
    """A single event to ingest into the knowledge graph.

    Mirrors the shape Graphiti's `add_episode` wants:
      - group_id partitions the graph (e.g. "session:abc", "vault", "vector").
      - name is a short human-readable label.
      - episode_body is the actual content (text or JSON-serialised dict).
      - source identifies the runtime / daemon that emitted the episode.
    """
    group_id: str
    name: str
    episode_body: str
    source: str
    timestamp: datetime = field(default_factory=lambda: datetime.now(tz=timezone.utc))
    metadata: dict = field(default_factory=dict)


@dataclass
class RecallResult:
    """One item returned from a graph recall query."""
    summary: str
    score: float
    source: str
    timestamp: Optional[datetime]
    raw: dict = field(default_factory=dict)


class GraphitiProvider:
    """Single-instance, thread-safe wrapper around graphiti-core.

    Public surface (all no-op when disabled):

      provider.enabled         -> bool
      provider.healthcheck()   -> bool (sync)
      provider.stats()         -> dict (sync)
      provider.add_episode(ep) -> None  (async; fire-and-forget at call sites)
      provider.recall_recent(group_id, limit=10)             -> [RecallResult]
      provider.recall_related(group_id, query, limit=10)     -> [RecallResult]
      provider.recall_temporal(group_id, since, until)       -> [RecallResult]
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._client: Optional[Any] = None
        self._initialized = False
        self._enabled_cache: Optional[bool] = None
        self._last_health: Optional[bool] = None
        self._last_health_at: Optional[datetime] = None
        self._node_count: int = 0
        self._edge_count: int = 0
        self._recent_episodes: List[Episode] = []

    # -----------------------------------------------------------------------
    # Configuration + lifecycle
    # -----------------------------------------------------------------------

    @property
    def enabled(self) -> bool:
        if self._enabled_cache is None:
            settings = get_settings()
            self._enabled_cache = bool(
                getattr(settings, "graphiti_enabled", False)
                and settings.neo4j_password
                and getattr(settings, "graphiti_mode", "library") == "library"
            )
        return self._enabled_cache

    def _build_client(self) -> Optional[Any]:
        """Lazy-construct the graphiti-core client.

        Wires the entity-extraction LLM to local Ollama via its
        OpenAI-compatible /v1 endpoint, per [[feedback_local_first]] — so
        episode ingestion never calls a cloud API.

        Returns None on any failure (import, Neo4j unreachable, etc.).
        """
        if not self.enabled:
            return None

        settings = get_settings()
        try:
            from graphiti_core import Graphiti  # type: ignore
        except ImportError:
            logger.warning(
                "GRAPHITI_ENABLED=true but `graphiti-core` is not installed. "
                "Run: pip install -r requirements.txt"
            )
            return None

        llm_client = _build_local_llm_client(settings)
        embedder = _build_local_embedder(settings)

        try:
            kwargs: dict = {
                "uri": settings.neo4j_uri,
                "user": settings.neo4j_user,
                "password": settings.neo4j_password,
            }
            if llm_client is not None:
                kwargs["llm_client"] = llm_client
            if embedder is not None:
                kwargs["embedder"] = embedder

            client = Graphiti(**kwargs)
            logger.info(
                "Graphiti client initialised against %s (llm=%s, embedder=%s)",
                settings.neo4j_uri,
                "ollama:" + settings.graphiti_llm_model if llm_client else "graphiti-default",
                "ollama:" + settings.graphiti_embedder_model if embedder else "graphiti-default",
            )
            return client
        except Exception as e:
            logger.error("Failed to construct Graphiti client: %s", e)
            return None

    def _ensure_client(self) -> Optional[Any]:
        if self._initialized:
            return self._client
        with self._lock:
            if not self._initialized:
                self._client = self._build_client()
                self._initialized = True
        return self._client

    def reset(self) -> None:
        """Invalidate cached client (used after settings change in tests)."""
        with self._lock:
            self._client = None
            self._initialized = False
            self._enabled_cache = None
            self._last_health = None
            self._last_health_at = None

    # -----------------------------------------------------------------------
    # Health + stats (sync, for the admin panel)
    # -----------------------------------------------------------------------

    def healthcheck(self) -> bool:
        """Synchronous reachability probe; never raises."""
        if not self.enabled:
            self._last_health = False
            return False
        client = self._ensure_client()
        if client is None:
            self._last_health = False
            return False
        # graphiti-core doesn't expose a sync ping; the constructor succeeding is
        # our best signal short of an async query. Treat client construction as
        # the health signal here and let the async stats() refresh real numbers.
        self._last_health = True
        self._last_health_at = datetime.now(tz=timezone.utc)
        return True

    def stats(self) -> dict:
        """Return the most-recent graph stats. Read-only; never blocks."""
        return {
            "enabled": self.enabled,
            "healthy": bool(self._last_health),
            "last_health_at": self._last_health_at.isoformat() if self._last_health_at else None,
            "node_count": self._node_count,
            "edge_count": self._edge_count,
            "recent_episodes": [
                {
                    "ts": ep.timestamp.isoformat(),
                    "source": ep.source,
                    "name": ep.name,
                    "summary": ep.episode_body[:200],
                }
                for ep in self._recent_episodes[-10:]
            ],
        }

    # -----------------------------------------------------------------------
    # Write path — fire-and-forget at call sites
    # -----------------------------------------------------------------------

    async def add_episode(self, ep: Episode) -> None:
        """Best-effort episode ingest.

        Never raises. On any failure the call site is unaffected; the user-facing
        flow continues. Timeout is governed by `graphiti_write_timeout_seconds`.
        """
        if not self.enabled:
            return
        client = self._ensure_client()
        if client is None:
            return

        # Always shadow-cache the episode locally so the admin panel reflects
        # activity even if the Neo4j write fails.
        self._recent_episodes.append(ep)
        if len(self._recent_episodes) > 100:
            self._recent_episodes = self._recent_episodes[-100:]

        settings = get_settings()
        timeout = getattr(settings, "graphiti_write_timeout_seconds", 2.0)

        try:
            await asyncio.wait_for(
                self._do_add_episode(client, ep),
                timeout=timeout,
            )
        except asyncio.TimeoutError:
            logger.warning("Graphiti add_episode timed out after %.1fs (group=%s)", timeout, ep.group_id)
        except Exception as e:
            logger.warning("Graphiti add_episode failed (group=%s): %s", ep.group_id, e)

    async def _do_add_episode(self, client: Any, ep: Episode) -> None:
        """Actual ingest — separate so timeout wrapping is clean."""
        # graphiti-core API: client.add_episode(name, episode_body, source, reference_time, group_id)
        if hasattr(client, "add_episode"):
            await client.add_episode(
                name=ep.name,
                episode_body=ep.episode_body,
                source=ep.source,
                reference_time=ep.timestamp,
                group_id=ep.group_id,
            )

    # -----------------------------------------------------------------------
    # Read path — graceful no-op when disabled
    # -----------------------------------------------------------------------

    async def recall_recent(
        self, group_id: str, limit: int = 10
    ) -> List[RecallResult]:
        if not self.enabled:
            return []
        client = self._ensure_client()
        if client is None:
            return []
        try:
            # Library API surface may differ between graphiti-core releases.
            # We do a best-effort attribute probe; fall back to empty list.
            search = getattr(client, "search", None)
            if not search:
                return []
            raw = await asyncio.wait_for(
                search(query="", group_ids=[group_id], num_results=limit),
                timeout=5.0,
            )
            return [_to_recall_result(item) for item in raw or []]
        except Exception as e:
            logger.warning("Graphiti recall_recent failed: %s", e)
            return []

    async def recall_related(
        self, group_id: str, query: str, limit: int = 10
    ) -> List[RecallResult]:
        if not self.enabled or not query:
            return []
        client = self._ensure_client()
        if client is None:
            return []
        try:
            search = getattr(client, "search", None)
            if not search:
                return []
            raw = await asyncio.wait_for(
                search(query=query, group_ids=[group_id], num_results=limit),
                timeout=5.0,
            )
            return [_to_recall_result(item) for item in raw or []]
        except Exception as e:
            logger.warning("Graphiti recall_related failed: %s", e)
            return []


def _build_local_llm_client(settings: Any) -> Optional[Any]:
    """Construct graphiti-core's OpenAI-compatible LLM client pointed at Ollama.

    Returns None if the import probe fails (graphiti-core's API may differ
    between releases) — the caller then falls back to graphiti's default,
    which would call OpenAI. We log loudly in that case so the user can see
    they're about to be billed.
    """
    try:
        # graphiti-core ≥ 0.3 ships an OpenAI-compatible client + LLMConfig.
        from graphiti_core.llm_client.config import LLMConfig  # type: ignore
        from graphiti_core.llm_client.openai_client import OpenAIClient  # type: ignore
    except ImportError as e:
        logger.warning(
            "graphiti-core LLMClient probe failed (%s). Falling back to library default — "
            "this will call OpenAI on every episode and incur cost. Set GRAPHITI_ENABLED=false "
            "or upgrade graphiti-core if you want local-only.",
            e,
        )
        return None

    try:
        config = LLMConfig(
            api_key="ollama",  # dummy — Ollama ignores the key
            base_url=settings.graphiti_llm_base_url,
            model=settings.graphiti_llm_model,
        )
        return OpenAIClient(config=config)
    except Exception as e:
        logger.warning("Failed to build local Ollama LLM client for Graphiti: %s", e)
        return None


def _build_local_embedder(settings: Any) -> Optional[Any]:
    """Construct graphiti-core's embedder pointed at Ollama's embedding endpoint.

    Same defensive pattern as _build_local_llm_client — returns None and logs
    loudly if the import probe fails so the user knows graphiti would otherwise
    bill a cloud embeddings API.
    """
    try:
        from graphiti_core.embedder.openai import (  # type: ignore
            OpenAIEmbedder, OpenAIEmbedderConfig,
        )
    except ImportError as e:
        logger.warning(
            "graphiti-core Embedder probe failed (%s). Falling back to library default — "
            "this will call cloud embeddings on every episode. Set GRAPHITI_ENABLED=false "
            "or upgrade graphiti-core if you want local-only.",
            e,
        )
        return None

    try:
        config = OpenAIEmbedderConfig(
            api_key="ollama",
            base_url=settings.graphiti_llm_base_url,
            embedding_model=settings.graphiti_embedder_model,
        )
        return OpenAIEmbedder(config=config)
    except Exception as e:
        logger.warning("Failed to build local Ollama embedder for Graphiti: %s", e)
        return None


def _to_recall_result(item: Any) -> RecallResult:
    """Best-effort coercion from a graphiti-core result to our RecallResult."""
    summary = getattr(item, "summary", None) or getattr(item, "fact", None) or str(item)
    score = float(getattr(item, "score", 0.0) or 0.0)
    source = getattr(item, "source", "graphiti")
    ts = getattr(item, "reference_time", None) or getattr(item, "timestamp", None)
    return RecallResult(
        summary=str(summary)[:500],
        score=score,
        source=str(source),
        timestamp=ts if isinstance(ts, datetime) else None,
        raw={"repr": repr(item)[:500]},
    )


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_provider: Optional[GraphitiProvider] = None
_provider_lock = threading.Lock()


def get_graphiti_provider() -> GraphitiProvider:
    global _provider
    if _provider is None:
        with _provider_lock:
            if _provider is None:
                _provider = GraphitiProvider()
    return _provider
