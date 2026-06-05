"""
core/skills.py

Q2#7 — Skills system. A "skill" is a user-editable saved prompt/recipe
(e.g. "When asked to summarize a chapter, output: TL;DR + 3 takeaways +
1 quote"). Skills are vector-retrieved against the live user query at
each turn and prepended to the conversation's system prompt.

Different from MCP tools:
  - MCP tools are *callable* (functions invoked by the model).
  - Skills are *prompts* (text injected into the system message).

Reuses the existing ChromaDB collection from VectorStore by tagging
metadata with kind='skill'. The SQLite `skills` table is the canonical
store; the vector index is a derived retrieval cache that can be
rebuilt at any time.
"""

from __future__ import annotations

import logging
from typing import List, Optional

from config.settings import get_settings
from providers.memory.vector_store import VectorStore

logger = logging.getLogger(__name__)


_SKILL_METADATA_KIND = "skill"


def _is_enabled() -> bool:
    return bool(getattr(get_settings(), "skills_enabled", False))


def _top_k() -> int:
    return int(getattr(get_settings(), "skills_top_k", 3))


# -----------------------------------------------------------------------------
# Index sync — keep the vector store in lock-step with the SQLite row
# -----------------------------------------------------------------------------

def _skill_text(skill: dict) -> str:
    """The string that gets embedded — name + trigger phrases + prompt body."""
    parts = [skill.get("name", "")]
    trig  = skill.get("trigger_phrases") or ""
    if trig.strip():
        parts.append(trig)
    body = skill.get("prompt") or ""
    if body.strip():
        parts.append(body)
    return "\n".join(parts).strip()


async def index_skill(skill: dict, owner_id: str, vector_store: Optional[VectorStore] = None) -> None:
    """Upsert a skill into the vector store. Safe no-op when disabled."""
    if not _is_enabled():
        return
    vs = vector_store or VectorStore()
    text = _skill_text(skill)
    if not text:
        return
    try:
        await vs.upsert(
            id=f"skill:{skill['id']}",
            text=text,
            metadata={
                "kind":      _SKILL_METADATA_KIND,
                "owner_id":  owner_id,
                "skill_id":  skill["id"],
                "name":      skill.get("name", ""),
                "is_active": 1 if skill.get("is_active", True) else 0,
            },
        )
    except Exception as exc:
        logger.warning("Skill index upsert failed for %s: %s", skill.get("id"), exc)


async def remove_skill_from_index(skill_id: str, vector_store: Optional[VectorStore] = None) -> None:
    """Best-effort delete by id. ChromaDB delete is idempotent."""
    if not _is_enabled():
        return
    vs = vector_store or VectorStore()
    coll = getattr(vs, "_collection", None)
    if coll is None:
        return
    try:
        coll.delete(ids=[f"skill:{skill_id}"])
    except Exception as exc:
        logger.warning("Skill index delete failed for %s: %s", skill_id, exc)


# -----------------------------------------------------------------------------
# Retrieval — find the top-k skills relevant to a query
# -----------------------------------------------------------------------------

async def get_relevant_skills(
    query: str,
    owner_id: str,
    *,
    top_k: Optional[int] = None,
    vector_store: Optional[VectorStore] = None,
) -> List[dict]:
    """
    Return the top-k owner-scoped active skills semantically closest to `query`.

    Each result is `{"skill_id", "name", "text", "distance"}`. Empty list
    when the feature flag is off, when the vector store is unavailable, or
    when the user has no skills indexed yet.
    """
    if not _is_enabled():
        return []
    if not (query and query.strip()):
        return []
    vs = vector_store or VectorStore()
    k  = top_k if top_k is not None else _top_k()
    hits = await vs.search(
        query_text=query,
        n_results=k,
        where={
            "$and": [
                {"kind":      {"$eq": _SKILL_METADATA_KIND}},
                {"owner_id":  {"$eq": owner_id}},
                {"is_active": {"$eq": 1}},
            ]
        },
    )
    out: List[dict] = []
    for h in hits or []:
        meta = h.get("metadata") or {}
        out.append({
            "skill_id": meta.get("skill_id"),
            "name":     meta.get("name", ""),
            "text":     h.get("text", ""),
            "distance": h.get("distance"),
        })
    return out


def render_skills_block(skills: List[dict]) -> str:
    """
    Format the retrieved skills as a system-prompt block.
    Empty input → empty string so callers can unconditionally concatenate.
    """
    if not skills:
        return ""
    lines = ["[ User skills relevant to this turn ]"]
    for s in skills:
        name = s.get("name") or "Skill"
        body = (s.get("text") or "").strip()
        if body:
            lines.append(f"• {name}: {body}")
        else:
            lines.append(f"• {name}")
    return "\n".join(lines)
