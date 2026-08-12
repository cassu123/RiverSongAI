"""
core/token_tracker.py

Records LLM token usage to river_song.db and provides summary queries.
All writes are synchronous sqlite3 (matching the project pattern).
"""

from __future__ import annotations

import contextlib
import logging
import sqlite3
import threading
import time
from contextvars import ContextVar
from pathlib import Path
from typing import Dict, List, Optional

# Which feature is currently spending tokens. Set by feature entrypoints via
# usage_source(...); read by record_usage so the providers themselves don't
# need to know who called them.
_usage_source: ContextVar[str] = ContextVar("usage_source", default="other")

# Who is spending them. Same ContextVar trick as the source tag above, and for
# the same reason: the providers sit three or four call frames below anything
# that knows who is talking, and threading a user_id through every signature
# would touch every provider for a field only the tracker uses.
#
# The default is "system" because that is what the column meant before this
# existed: every provider called record_usage without a user_id, so *all*
# recorded spend landed under one bucket and the per-user breakdown in
# /api/usage/models had exactly one row. Anything still unattributed keeps
# that label rather than being blamed on whoever spoke last.
_usage_user: ContextVar[str] = ContextVar("usage_user", default="system")

# Rows written by test scripts (TestClient runs, verify_gates) — never real
# spend; excluded from summaries and purged once per process.
_TEST_PROVIDERS = ("test_provider", "verify")


def set_usage_source(source: str) -> None:
    """Tag the current async task's token spend with `source`.

    For request/connection handlers where the whole task belongs to one
    feature. Use the usage_source() context manager for narrower scopes.
    """
    _usage_source.set(source)


@contextlib.contextmanager
def usage_source(source: str):
    """Attribute all LLM token usage inside this context to `source`."""
    token = _usage_source.set(source)
    try:
        yield
    finally:
        _usage_source.reset(token)


def set_usage_user(user_id: str) -> None:
    """Attribute this async task's token spend to `user_id`.

    Called wherever the speaker is known — a request handler, or the
    conversation loop when voice identification rebinds the speaker mid-turn.
    """
    _usage_user.set(user_id or "system")


@contextlib.contextmanager
def usage_user(user_id: str):
    """Attribute all LLM token usage inside this context to `user_id`."""
    token = _usage_user.set(user_id or "system")
    try:
        yield
    finally:
        _usage_user.reset(token)

logger = logging.getLogger(__name__)

_local = threading.local()

# ---------------------------------------------------------------------------
# Cost table (USD per 1M tokens, as of 2026-05)
# ---------------------------------------------------------------------------
_COST_PER_M: Dict[str, Dict[str, float]] = {
    # Anthropic
    "claude-sonnet-4-6": {"in": 3.00, "out": 15.00},
    "claude-opus-4-8": {"in": 5.00, "out": 25.00},
    "claude-opus-4-7": {"in": 5.00, "out": 25.00},
    "claude-haiku-4-5": {"in": 0.80, "out": 4.00},
    "claude-haiku-4-5-20251001": {"in": 0.80, "out": 4.00},
    # OpenAI
    "gpt-4o": {"in": 2.50, "out": 10.00},
    "gpt-4o-mini": {"in": 0.15, "out": 0.60},
    "gpt-4.1": {"in": 2.00, "out": 8.00},
    "gpt-4.1-mini": {"in": 0.40, "out": 1.60},
    # Google
    "gemini-2.0-flash": {"in": 0.10, "out": 0.40},
    "gemini-1.5-pro": {"in": 1.25, "out": 5.00},
    # Mistral
    "mistral-large-latest": {"in": 2.00, "out": 6.00},
    "mistral-small-latest": {"in": 0.10, "out": 0.30},
    # NVIDIA NIM — free tier, $0 cost, rate-limited ~40 req/min
    "moonshotai/kimi-k2": {"in": 0.0, "out": 0.0},
    "nvidia/llama-3.1-nemotron-ultra-253b-v1": {"in": 0.0, "out": 0.0},
    "nvidia/llama-3.3-nemotron-super-49b-v1": {"in": 0.0, "out": 0.0},
    "deepseek-ai/deepseek-r1": {"in": 0.0, "out": 0.0},
    "meta/llama-3.1-70b-instruct": {"in": 0.0, "out": 0.0},
    "mistralai/mistral-large-2-instruct": {"in": 0.0, "out": 0.0},
    # DeepSeek first-party cloud — METERED. Note these sit alongside the free
    # NIM entry "deepseek-ai/deepseek-r1" above; the ids differ, so a free
    # call and a billed call are never confused for one another.
    "deepseek-chat": {"in": 0.27, "out": 1.10},
    "deepseek-reasoner": {"in": 0.55, "out": 2.19},
    # Qwen via Alibaba DashScope — METERED. The local ollama "qwen2.5:*" ids
    # are absent on purpose: they cost nothing and must not be priced here.
    "qwen-turbo": {"in": 0.05, "out": 0.20},
    "qwen-plus": {"in": 0.40, "out": 1.20},
    "qwen-max": {"in": 1.60, "out": 6.40},
}


def _db_path() -> Path:
    from config.settings import get_settings
    return Path(get_settings().db_path)


def _connect() -> sqlite3.Connection:
    """
    Return a thread-local SQLite connection with WAL enabled.

    Held for the life of the thread so the per-call open/close cost
    (and the per-connection mutex contention that comes with it) is
    paid only once. WAL lets readers run while a writer holds the lock,
    which matters under concurrent LLM-call bursts.
    """
    conn = getattr(_local, "conn", None)
    if conn is not None:
        return conn
    conn = sqlite3.connect(
        str(_db_path()),
        timeout=10.0,
        check_same_thread=False,
        isolation_level=None,  # autocommit; we control transactions explicitly
    )
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
    except sqlite3.Error:
        pass
    _local.conn = conn
    return conn


_schema_ready = False


def ensure_table() -> None:
    """Create/upgrade token_usage table. Safe to call repeatedly."""
    global _schema_ready
    conn = _connect()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS token_usage (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            ts           REAL    NOT NULL,
            provider     TEXT    NOT NULL,
            model        TEXT    NOT NULL,
            input_tokens  INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            user_id      TEXT    NOT NULL DEFAULT 'system',
            call_type    TEXT    NOT NULL DEFAULT 'stream'
        )
    """)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_token_usage_ts ON token_usage(ts)")
    if not _schema_ready:
        # Idempotent migration: add source attribution column.
        try:
            conn.execute(
                "ALTER TABLE token_usage ADD COLUMN source TEXT NOT NULL DEFAULT 'other'")
        except sqlite3.OperationalError:
            pass  # column already exists
        # Purge rows written by test scripts run against this database.
        try:
            placeholders = ",".join("?" * len(_TEST_PROVIDERS))
            conn.execute(
                f"DELETE FROM token_usage WHERE LOWER(provider) IN ({placeholders})",
                _TEST_PROVIDERS,
            )
        except sqlite3.Error:
            pass
        _schema_ready = True


def record_usage(
    provider: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    user_id: str | None = None,
    call_type: str = "stream",
    source: str | None = None,
) -> None:
    """Insert one token-usage row. Silently no-ops on any error.

    `source` (which feature spent the tokens) and `user_id` (who) both default
    to the ambient context set by the caller, so a provider that passes
    neither still gets attributed.
    """
    if not input_tokens and not output_tokens:
        return
    try:
        ensure_table()
        conn = _connect()
        conn.execute(
            "INSERT INTO token_usage (ts, provider, model, input_tokens, output_tokens, user_id, call_type, source) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (time.time(), provider, model, input_tokens,
             output_tokens, user_id or _usage_user.get(), call_type,
             source or _usage_source.get()),
        )
    except Exception as exc:
        logger.debug("token_tracker: write failed: %s", exc)


def _is_local(provider: str) -> bool:
    return provider == "ollama"


def _rates_for(model: str) -> Optional[Dict[str, float]]:
    """The per-1M USD rates applied to this model, or None if it has none.

    Split out of _estimate_cost so the rate can be reported next to the cost
    it produced. None means "no rate on file" — which is not the same as
    free, and the two are shown differently.
    """
    rates = _COST_PER_M.get(model)
    if rates:
        return rates
    for key, r in _COST_PER_M.items():
        if model.startswith(key) or key.startswith(model):
            return r
    try:
        from providers.llm.registry import LLMRegistry
        for entry in LLMRegistry.all_models():
            if entry.model_id == model and entry.is_cloud:
                return {
                    "in": (entry.cost_per_1k_input_usd or 0.0) * 1000,
                    "out": (entry.cost_per_1k_output_usd or 0.0) * 1000,
                }
    except Exception:
        pass
    return None


def _estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """Return estimated USD cost. Returns 0.0 for unknown / local models."""
    rates = _COST_PER_M.get(model)
    if not rates:
        # Try prefix match (e.g. "claude-sonnet" matches "claude-sonnet-4-6")
        for key, r in _COST_PER_M.items():
            if model.startswith(key) or key.startswith(model):
                rates = r
                break
    if not rates:
        # Fall back to the model catalog so every cloud/NIM model (Anthropic
        # fallback, Gemini, NVIDIA NIM, etc.) is costed in the admin dashboard
        # without maintaining a second table. Registry stores per-1K USD.
        try:
            from providers.llm.registry import LLMRegistry
            for entry in LLMRegistry.all_models():
                if entry.model_id == model and entry.is_cloud:
                    rates = {
                        "in": (entry.cost_per_1k_input_usd or 0.0) * 1000,
                        "out": (entry.cost_per_1k_output_usd or 0.0) * 1000,
                    }
                    break
        except Exception:
            rates = None
    if not rates:
        return 0.0
    return (input_tokens * rates["in"] +
            output_tokens * rates["out"]) / 1_000_000


def get_summary(days: int = 30, user_ids: Optional[List[str]] = None) -> dict:
    """
    Return token usage totals grouped by provider+model over the last `days` days.

    `user_ids` narrows the rows to those accounts. Passing None keeps the
    whole instance, which is what an administrator asking about the machine
    wants and what every caller used to get regardless of who was asking --
    on a box running more than one household that handed each of them the
    others' spending.

    Background work records under the reserved id 'system' and belongs to no
    account, so a filtered total is genuinely smaller than the instance total
    rather than a rounding difference. Callers should say which scope they
    asked for rather than presenting either number as "usage".

    Returns:
        {
          "days": 30,
          "total_input": 123456,
          "total_output": 78901,
          "estimated_cost_usd": 0.42,
          "by_model": [
            {
              "provider": "anthropic",
              "model": "claude-sonnet-4-6",
              "input_tokens": 100000,
              "output_tokens": 60000,
              "estimated_cost_usd": 0.30,
              "calls": 45
            },
            ...
          ]
        }
    """
    try:
        ensure_table()
        cutoff = time.time() - days * 86400
        conn = _connect()
        conn.row_factory = sqlite3.Row
        not_test = "LOWER(provider) NOT IN ({})".format(
            ",".join("?" * len(_TEST_PROVIDERS)))
        params = (cutoff, *_TEST_PROVIDERS)
        user_clause = ""
        if user_ids is not None:
            # An empty list must match nothing rather than degrade to "all".
            user_clause = " AND user_id IN ({})".format(
                ",".join("?" * len(user_ids)) or "NULL")
            params = (*params, *user_ids)
        rows = conn.execute(
            f"""
            SELECT provider, model,
                   SUM(input_tokens)  AS input_tokens,
                   SUM(output_tokens) AS output_tokens,
                   COUNT(*)           AS calls
            FROM token_usage
            WHERE ts >= ? AND {not_test}{user_clause}
            GROUP BY provider, model
            ORDER BY (SUM(input_tokens) + SUM(output_tokens)) DESC
            """,
            params,
        ).fetchall()

        by_model: List[dict] = []
        total_in = total_out = total_cost = 0

        for r in rows:
            inp, out = r["input_tokens"] or 0, r["output_tokens"] or 0
            cost = _estimate_cost(r["model"], inp, out)
            total_in += inp
            total_out += out
            total_cost += cost  # type: ignore
            rates = _rates_for(r["model"])
            calls = r["calls"] or 0
            by_model.append({
                "provider": r["provider"],
                "model": r["model"],
                "input_tokens": inp,
                "output_tokens": out,
                "estimated_cost_usd": round(cost, 6),
                "calls": calls,
                # The rate that produced the dollar figure, carried alongside
                # it. A cost with no visible rate cannot be checked against
                # the provider's invoice, and these rates go stale — showing
                # them is what makes a wrong number noticeable instead of
                # merely believed.
                "rate_per_1m_input_usd": rates["in"] if rates else None,
                "rate_per_1m_output_usd": rates["out"] if rates else None,
                "is_free": bool(rates is not None and rates["in"] == 0.0 and rates["out"] == 0.0)
                or rates is None and _is_local(r["provider"]),
                "priced": rates is not None,
                "avg_tokens_per_call": round((inp + out) / calls, 1) if calls else 0,
            })

        # Where the tokens went: per-feature rows, each with its model mix
        # so the UI can answer "what is using the tokens" at a glance.
        src_rows = conn.execute(
            f"""
            SELECT COALESCE(source, 'other') AS source, provider, model,
                   SUM(input_tokens)  AS input_tokens,
                   SUM(output_tokens) AS output_tokens,
                   COUNT(*)           AS calls
            FROM token_usage
            WHERE ts >= ? AND {not_test}{user_clause}
            GROUP BY COALESCE(source, 'other'), provider, model
            """,
            params,
        ).fetchall()

        sources: Dict[str, dict] = {}
        for r in src_rows:
            inp, out = r["input_tokens"] or 0, r["output_tokens"] or 0
            cost = _estimate_cost(r["model"], inp, out)
            entry = sources.setdefault(r["source"], {
                "source": r["source"], "input_tokens": 0, "output_tokens": 0,
                "estimated_cost_usd": 0.0, "calls": 0, "models": [],
            })
            entry["input_tokens"] += inp
            entry["output_tokens"] += out
            entry["estimated_cost_usd"] += cost
            entry["calls"] += r["calls"]
            entry["models"].append({
                "provider": r["provider"], "model": r["model"],
                "input_tokens": inp, "output_tokens": out,
                "calls": r["calls"],
                "estimated_cost_usd": round(cost, 6),
            })
        by_source = sorted(sources.values(),
                           key=lambda e: e["input_tokens"] + e["output_tokens"],
                           reverse=True)
        for e in by_source:
            e["estimated_cost_usd"] = round(e["estimated_cost_usd"], 6)
            e["models"].sort(key=lambda m: m["input_tokens"] + m["output_tokens"],
                             reverse=True)

        return {
            "days": days,
            "total_input": total_in,
            "total_output": total_out,
            "estimated_cost_usd": round(total_cost, 6),
            "by_model": by_model,
            "by_source": by_source,
        }
    except Exception as exc:
        logger.warning("token_tracker: summary failed: %s", exc)
        return {
            "days": days, "total_input": 0, "total_output": 0,
            "estimated_cost_usd": 0.0, "by_model": [], "by_source": [],
        }


def get_provider_rate(provider: str, window_seconds: int = 60) -> dict:
    """
    Return request count and token totals for a provider within the last
    `window_seconds`. Used by the NIM rate-limit monitor (40 req/min limit).
    """
    try:
        ensure_table()
        cutoff = time.time() - window_seconds
        conn = _connect()
        row = conn.execute(
            """
            SELECT COUNT(*) AS calls,
                   SUM(input_tokens)  AS input_tokens,
                   SUM(output_tokens) AS output_tokens
            FROM token_usage
            WHERE provider = ? AND ts >= ?
            """,
            (provider, cutoff),
        ).fetchone()
        calls = row[0] or 0
        return {
            "provider": provider,
            "window_seconds": window_seconds,
            "calls": calls,
            "input_tokens": row[1] or 0,
            "output_tokens": row[2] or 0,
        }
    except Exception as exc:
        logger.warning("token_tracker: rate query failed: %s", exc)
        return {"provider": provider, "window_seconds": window_seconds, "calls": 0,
                "input_tokens": 0, "output_tokens": 0}


def get_model_usage(days: int = 30, model: Optional[str] = None) -> dict:
    """Real recorded usage per model, with who spent it.

    get_summary already rolls up per model; this adds the two things it
    cannot answer — *when* a model was last actually used, and *which
    account* spent the tokens. Both matter once a provider costs money and
    an admin has to decide whether to keep it switched on: a model nobody
    has touched in three weeks is a different decision from one a single
    account is running up daily.

    Rows carry the rate that produced their cost, same as get_summary, so a
    stale price is visible rather than merely applied.
    """
    try:
        ensure_table()
        cutoff = time.time() - days * 86400
        conn = _connect()
        conn.row_factory = sqlite3.Row
        not_test = "LOWER(provider) NOT IN ({})".format(
            ",".join("?" * len(_TEST_PROVIDERS)))
        params: tuple = (cutoff, *_TEST_PROVIDERS)
        model_filter = ""
        if model:
            model_filter = " AND model = ?"
            params = (*params, model)

        rows = conn.execute(
            f"""
            SELECT provider, model, user_id,
                   SUM(input_tokens)  AS input_tokens,
                   SUM(output_tokens) AS output_tokens,
                   COUNT(*)           AS calls,
                   MIN(ts)            AS first_ts,
                   MAX(ts)            AS last_ts
            FROM token_usage
            WHERE ts >= ? AND {not_test}{model_filter}
            GROUP BY provider, model, user_id
            """,
            params,
        ).fetchall()

        models: Dict[tuple, dict] = {}
        for r in rows:
            key = (r["provider"], r["model"])
            inp, out = r["input_tokens"] or 0, r["output_tokens"] or 0
            cost = _estimate_cost(r["model"], inp, out)
            entry = models.get(key)
            if entry is None:
                rates = _rates_for(r["model"])
                entry = models[key] = {
                    "provider": r["provider"],
                    "model": r["model"],
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "calls": 0,
                    "estimated_cost_usd": 0.0,
                    "rate_per_1m_input_usd": rates["in"] if rates else None,
                    "rate_per_1m_output_usd": rates["out"] if rates else None,
                    "priced": rates is not None,
                    "first_used_ts": r["first_ts"],
                    "last_used_ts": r["last_ts"],
                    "by_user": [],
                }
            entry["input_tokens"] += inp
            entry["output_tokens"] += out
            entry["calls"] += r["calls"] or 0
            entry["estimated_cost_usd"] += cost
            entry["first_used_ts"] = min(entry["first_used_ts"], r["first_ts"])
            entry["last_used_ts"] = max(entry["last_used_ts"], r["last_ts"])
            entry["by_user"].append({
                "user_id": r["user_id"],
                "input_tokens": inp,
                "output_tokens": out,
                "calls": r["calls"] or 0,
                "estimated_cost_usd": round(cost, 6),
            })

        out_rows = []
        for entry in models.values():
            entry["estimated_cost_usd"] = round(entry["estimated_cost_usd"], 6)
            entry["by_user"].sort(
                key=lambda u: u["estimated_cost_usd"], reverse=True)
            out_rows.append(entry)
        out_rows.sort(
            key=lambda e: (e["estimated_cost_usd"],
                           e["input_tokens"] + e["output_tokens"]),
            reverse=True,
        )

        return {
            "days": days,
            "models": out_rows,
            "total_estimated_cost_usd": round(
                sum(e["estimated_cost_usd"] for e in out_rows), 6),
        }
    except Exception as exc:
        logger.warning("token_tracker: get_model_usage failed: %s", exc)
        return {"days": days, "models": [], "total_estimated_cost_usd": 0.0}
