"""
core/token_tracker.py

Records LLM token usage to river_song.db and provides summary queries.
All writes are synchronous sqlite3 (matching the project pattern).
"""

from __future__ import annotations

import logging
import sqlite3
import time
from pathlib import Path
from typing import Dict, List

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Cost table (USD per 1M tokens, as of 2026-05)
# ---------------------------------------------------------------------------
_COST_PER_M: Dict[str, Dict[str, float]] = {
    # Anthropic
    "claude-sonnet-4-6":          {"in": 3.00,  "out": 15.00},
    "claude-opus-4-7":            {"in": 15.00, "out": 75.00},
    "claude-haiku-4-5":           {"in": 0.80,  "out": 4.00},
    "claude-haiku-4-5-20251001":  {"in": 0.80,  "out": 4.00},
    # OpenAI
    "gpt-4o":                     {"in": 2.50,  "out": 10.00},
    "gpt-4o-mini":                {"in": 0.15,  "out": 0.60},
    "gpt-4.1":                    {"in": 2.00,  "out": 8.00},
    "gpt-4.1-mini":               {"in": 0.40,  "out": 1.60},
    # Google
    "gemini-2.0-flash":           {"in": 0.10,  "out": 0.40},
    "gemini-1.5-pro":             {"in": 1.25,  "out": 5.00},
    # Mistral
    "mistral-large-latest":       {"in": 2.00,  "out": 6.00},
    "mistral-small-latest":       {"in": 0.10,  "out": 0.30},
    # NVIDIA NIM — free tier, $0 cost, rate-limited ~40 req/min
    "moonshotai/kimi-k2":                            {"in": 0.0, "out": 0.0},
    "nvidia/llama-3.1-nemotron-ultra-253b-v1":       {"in": 0.0, "out": 0.0},
    "nvidia/llama-3.3-nemotron-super-49b-v1":        {"in": 0.0, "out": 0.0},
    "deepseek-ai/deepseek-r1":                       {"in": 0.0, "out": 0.0},
    "meta/llama-3.1-70b-instruct":                   {"in": 0.0, "out": 0.0},
    "mistralai/mistral-large-2-instruct":             {"in": 0.0, "out": 0.0},
}


def _db_path() -> Path:
    from config.settings import get_settings
    return Path(get_settings().db_path)


def _connect() -> sqlite3.Connection:
    """Open a connection and immediately close it after use via context manager."""
    conn = sqlite3.connect(str(_db_path()))
    return conn


def ensure_table() -> None:
    """Create token_usage table if it doesn't exist. Safe to call repeatedly."""
    conn = _connect()
    try:
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
        conn.execute("CREATE INDEX IF NOT EXISTS idx_token_usage_ts ON token_usage(ts)")
        conn.commit()
    finally:
        conn.close()


def record_usage(
    provider: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    user_id: str = "system",
    call_type: str = "stream",
) -> None:
    """Insert one token-usage row. Silently no-ops on any error."""
    if not input_tokens and not output_tokens:
        return
    conn = None
    try:
        ensure_table()
        conn = _connect()
        conn.execute(
            "INSERT INTO token_usage (ts, provider, model, input_tokens, output_tokens, user_id, call_type) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (time.time(), provider, model, input_tokens, output_tokens, user_id, call_type),
        )
        conn.commit()
    except Exception as exc:
        logger.debug("token_tracker: write failed: %s", exc)
    finally:
        if conn:
            conn.close()


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
        return 0.0
    return (input_tokens * rates["in"] + output_tokens * rates["out"]) / 1_000_000


def get_summary(days: int = 30) -> dict:
    """
    Return token usage totals grouped by provider+model over the last `days` days.

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
    conn = None
    try:
        ensure_table()
        cutoff = time.time() - days * 86400
        conn = _connect()
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT provider, model,
                   SUM(input_tokens)  AS input_tokens,
                   SUM(output_tokens) AS output_tokens,
                   COUNT(*)           AS calls
            FROM token_usage
            WHERE ts >= ?
            GROUP BY provider, model
            ORDER BY (SUM(input_tokens) + SUM(output_tokens)) DESC
            """,
            (cutoff,),
        ).fetchall()
        conn.close()
        conn = None

        by_model: List[dict] = []
        total_in = total_out = total_cost = 0

        for r in rows:
            inp, out = r["input_tokens"] or 0, r["output_tokens"] or 0
            cost = _estimate_cost(r["model"], inp, out)
            total_in  += inp
            total_out += out
            total_cost += cost
            by_model.append({
                "provider":           r["provider"],
                "model":              r["model"],
                "input_tokens":       inp,
                "output_tokens":      out,
                "estimated_cost_usd": round(cost, 6),
                "calls":              r["calls"],
            })

        return {
            "days":                days,
            "total_input":         total_in,
            "total_output":        total_out,
            "estimated_cost_usd":  round(total_cost, 6),
            "by_model":            by_model,
        }
    except Exception as exc:
        logger.warning("token_tracker: summary failed: %s", exc)
        return {
            "days": days, "total_input": 0, "total_output": 0,
            "estimated_cost_usd": 0.0, "by_model": [],
        }
    finally:
        if conn:
            conn.close()


def get_provider_rate(provider: str, window_seconds: int = 60) -> dict:
    """
    Return request count and token totals for a provider within the last
    `window_seconds`. Used by the NIM rate-limit monitor (40 req/min limit).
    """
    conn = None
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
        conn.close()
        conn = None
        calls = row[0] or 0
        return {
            "provider":       provider,
            "window_seconds": window_seconds,
            "calls":          calls,
            "input_tokens":   row[1] or 0,
            "output_tokens":  row[2] or 0,
        }
    except Exception as exc:
        logger.warning("token_tracker: rate query failed: %s", exc)
        return {"provider": provider, "window_seconds": window_seconds, "calls": 0,
                "input_tokens": 0, "output_tokens": 0}
    finally:
        if conn:
            conn.close()
