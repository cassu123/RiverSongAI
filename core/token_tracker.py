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
}


def _db_path() -> Path:
    return Path(__file__).parent.parent / "data" / "river_song.db"


def ensure_table() -> None:
    """Create token_usage table if it doesn't exist. Safe to call repeatedly."""
    with sqlite3.connect(_db_path()) as conn:
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
    try:
        ensure_table()
        with sqlite3.connect(_db_path()) as conn:
            conn.execute(
                "INSERT INTO token_usage (ts, provider, model, input_tokens, output_tokens, user_id, call_type) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (time.time(), provider, model, input_tokens, output_tokens, user_id, call_type),
            )
            conn.commit()
    except Exception as exc:
        logger.debug("token_tracker: write failed: %s", exc)


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
    try:
        ensure_table()
        cutoff = time.time() - days * 86400
        with sqlite3.connect(_db_path()) as conn:
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
