"""
core/email_triage.py

Q2#8 — Gmail triage. Classifies unread mail by urgency, attaches tags,
and drafts a reply for HIGH-urgency messages only. Built on top of the
existing GmailProvider; no new OAuth scopes required.

Public surface:
  - triage_inbox(user_id, max_results)  → list of enriched message dicts
  - classify_message(subject, sender, body, llm=None) → classification dict

Each classification has:
  {
    "urgency":      "high" | "medium" | "low",
    "tags":         List[str],
    "summary":      str,    # 1-line gist
    "draft_reply":  str,    # empty unless urgency=="high"
    "classifier":   "llm" | "heuristic",
  }

Design:
- Single LLM call per message with a strict JSON-output prompt.
- If the LLM is unreachable, malformed, or disabled, falls back to a
  pure-stdlib heuristic so the UI always gets *something* useful.
- All callers must check settings.gmail_triage_enabled themselves; this
  module's own flag check is defensive.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any, Dict, List, Optional

from config.settings import get_settings

logger = logging.getLogger(__name__)


_VALID_URGENCY = {"high", "medium", "low"}
_HIGH_URGENCY_KEYWORDS = (
    "urgent", "asap", "deadline", "today", "tomorrow", "overdue",
    "important", "action required", "please respond", "final notice",
    "reminder", "due", "expires",
)
_TAG_KEYWORDS = {
    "billing": ("invoice", "billing", "payment", "receipt", "refund", "charge"),
    "family": ("mom", "dad", "kid", "school", "family"),
    "work": ("meeting", "deadline", "client", "project", "team"),
    "shipping": ("tracking", "shipped", "delivery", "package", "order"),
    "calendar": ("schedule", "appointment", "calendar", "rsvp"),
    "promo": ("deal", "sale", "discount", "newsletter", "unsubscribe"),
    "security": ("password", "verify", "verification", "two-factor", "login"),
}


def _enabled() -> bool:
    return bool(getattr(get_settings(), "gmail_triage_enabled", False))


def _triage_model() -> str:
    s = get_settings()
    chosen = getattr(s, "gmail_triage_model", "") or ""
    return chosen.strip() or getattr(s, "llm_model", "")


# -----------------------------------------------------------------------------
# Heuristic classifier — runs when the LLM is unavailable
# -----------------------------------------------------------------------------

def _heuristic_classify(subject: str, sender: str,
                        body: str) -> Dict[str, Any]:
    blob = " ".join([subject, sender, body]).lower()
    urgency = "medium"
    if any(kw in blob for kw in _HIGH_URGENCY_KEYWORDS):
        urgency = "high"
    elif any(kw in blob for kw in ("newsletter", "no-reply", "noreply", "unsubscribe")):
        urgency = "low"

    tags = [
        tag for tag,
        kws in _TAG_KEYWORDS.items() if any(
            k in blob for k in kws)]
    summary = (subject or sender or "")[:140]
    return {
        "urgency": urgency,
        "tags": tags,
        "summary": summary,
        "draft_reply": "",  # heuristic never drafts
        "classifier": "heuristic",
    }


# -----------------------------------------------------------------------------
# LLM classifier
# -----------------------------------------------------------------------------

_CLASSIFY_PROMPT = (
    "You triage emails. Given the metadata + body excerpt of ONE email, "
    "return a single JSON object with exactly these keys: "
    "urgency (one of: high, medium, low), tags (array of short lowercase "
    "strings), summary (one sentence, ≤25 words), draft_reply (one short "
    "polite reply if urgency is high; empty string otherwise). "
    "Return ONLY the JSON object — no preamble, no markdown fence."
)


def _build_messages(subject: str, sender: str,
                    body: str) -> List[Dict[str, str]]:
    user_payload = (
        f"From: {sender}\n"
        f"Subject: {subject}\n"
        f"Body excerpt: {body}\n"
    )
    return [
        {"role": "system", "content": _CLASSIFY_PROMPT},
        {"role": "user", "content": user_payload},
    ]


def _strip_code_fence(s: str) -> str:
    s = s.strip()
    # Some local models emit ```json ... ``` fences. Strip them.
    m = re.match(r"^```(?:json)?\s*(.*?)\s*```$", s, flags=re.DOTALL)
    return (m.group(1) if m else s).strip()


def _coerce_classification(
        raw: Any, fallback: Dict[str, Any]) -> Dict[str, Any]:
    """Coerce LLM JSON output into the contract; fall back on each missing piece."""
    if not isinstance(raw, dict):
        return fallback

    urgency = str(raw.get("urgency", "")).strip().lower()
    if urgency not in _VALID_URGENCY:
        urgency = fallback["urgency"]

    tags_raw = raw.get("tags") or []
    if isinstance(tags_raw, str):
        tags_raw = [t.strip() for t in tags_raw.split(",")]
    tags = [str(t).strip().lower() for t in tags_raw if str(t).strip()]
    tags = list(dict.fromkeys(tags))[:6]  # dedup + cap

    summary = str(raw.get("summary") or fallback["summary"])[:300]

    draft = str(raw.get("draft_reply") or "")
    if urgency != "high":
        draft = ""
    draft = draft[:1200]

    return {
        "urgency": urgency,
        "tags": tags,
        "summary": summary,
        "draft_reply": draft,
        "classifier": "llm",
    }


async def classify_message(
    subject: str,
    sender: str,
    body: str,
    *,
    llm: Optional[Any] = None,
) -> Dict[str, Any]:
    """
    Single-message classifier. Returns a classification dict (see module
    docstring). Always returns *something* — falls back to a heuristic
    when the LLM is unavailable, malformed, or disabled.
    """
    fallback = _heuristic_classify(subject, sender, body)

    if not _enabled():
        return fallback

    try:
        if llm is None:
            from providers.llm.ollama import OllamaLLM
            llm = OllamaLLM(model=_triage_model() or None)

        messages = _build_messages(subject, sender, body)

        # Prefer non-streaming chat when available for cleaner JSON capture.
        if hasattr(llm, "chat"):
            chat_fn = getattr(llm, "chat")
            res = await chat_fn(messages)
            if isinstance(res, dict):
                content = res.get("content") or res.get("text") or ""
            else:
                content = str(res)
        else:
            stream_fn = getattr(
                llm, "stream_chat", None) or getattr(
                llm, "stream_response", None)
            if stream_fn is None:
                return fallback
            content = ""
            async for chunk in stream_fn(messages):
                content += chunk
                if len(content) > 6000:  # safety budget
                    break

        content = _strip_code_fence(content)
        try:
            parsed = json.loads(content)
        except (ValueError, TypeError):
            logger.info(
                "Triage LLM returned non-JSON output; falling back to heuristic.")
            return fallback

        return _coerce_classification(parsed, fallback)

    except Exception as exc:
        logger.warning(
            "Triage LLM call failed: %s — using heuristic fallback.", exc)
        return fallback


# -----------------------------------------------------------------------------
# Inbox triage orchestrator
# -----------------------------------------------------------------------------

async def triage_inbox(
    user_id: str,
    *,
    max_results: int = 10,
    body_chars: int = 600,
    llm: Optional[Any] = None,
    gmail_provider: Optional[Any] = None,
) -> List[Dict[str, Any]]:
    """
    Fetch unread messages for a user, classify each, return the enriched
    list. Caller is responsible for the surrounding flag check at the
    route layer (this function will short-circuit on its own if disabled,
    returning []).
    """
    if not _enabled():
        return []

    cap = int(getattr(get_settings(), "gmail_triage_max_messages", 15))
    limit = max(1, min(max_results, cap))

    if gmail_provider is None:
        try:
            from providers.google.auth import GoogleAuth
            from providers.google.gmail import GmailProvider
            auth = GoogleAuth()  # type: ignore
            gmail_provider = GmailProvider(auth, user_id)
        except Exception as exc:
            logger.warning("Gmail provider unavailable for triage: %s", exc)
            return []

    try:
        unread = await gmail_provider.get_unread_messages(max_results=limit)
    except Exception as exc:
        logger.warning("get_unread_messages failed during triage: %s", exc)
        return []

    # Parallelize per-message body fetch + classify so a 10-message inbox
    # finishes in ~one LLM round-trip instead of ten. Order is preserved
    # via the zip below — gather returns results in input order.
    async def _enrich_one(msg: Dict[str, Any]) -> Dict[str, Any]:
        try:
            body = await gmail_provider.get_message_body(msg["id"])
        except Exception as exc:
            logger.debug(
                "get_message_body failed for %s: %s",
                msg.get("id"),
                exc)
            body = msg.get("snippet", "") or ""
        body = (body or "")[:body_chars]
        classification = await classify_message(
            subject=msg.get("subject", ""),
            sender=msg.get("from", ""),
            body=body,
            llm=llm,
        )
        return {**msg, "triage": classification}

    if not unread:
        return []
    enriched = await asyncio.gather(*[_enrich_one(m) for m in unread])
    return list(enriched)
