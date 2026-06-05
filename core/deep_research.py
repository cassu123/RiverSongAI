"""
core/deep_research.py

Q3#11 — Deep Research orchestrator.

Pipeline:
    decompose_query → gather_sources → fetch_and_extract → synthesize

Each stage is independently injectable so tests can mock the slow / network
parts (search, fetch, LLM) and exercise the orchestration logic in isolation.

The final output is a Markdown report saved as a `research`-kind document
via the Q2#6 document store; the route layer returns both the report body
and the document id.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any, Awaitable, Callable, Dict, List, Optional
from urllib.parse import urlparse

from config.settings import get_settings

logger = logging.getLogger(__name__)


# -----------------------------------------------------------------------------
# Stage 1 — decompose the user prompt into sub-queries
# -----------------------------------------------------------------------------

_DECOMPOSE_PROMPT = (
    "You break a research question into focused sub-queries that, when "
    "answered, fully cover the question. Return a JSON array of strings "
    "(no markdown fence). Each sub-query is a phrase ≤12 words, "
    "search-engine-friendly. Output exactly the requested count."
)


def _strip_fence(s: str) -> str:
    s = (s or "").strip()
    m = re.match(r"^```(?:json)?\s*(.*?)\s*```$", s, flags=re.DOTALL)
    return (m.group(1) if m else s).strip()


def _heuristic_decompose(query: str, count: int) -> List[str]:
    """Fallback when the LLM is unreachable — splits roughly on punctuation."""
    base = (query or "").strip()
    if not base:
        return []
    parts: List[str] = []
    if "?" in base:
        parts = [p.strip() for p in base.split("?") if p.strip()]
    elif "," in base:
        parts = [p.strip() for p in base.split(",") if p.strip()]
    if len(parts) < 2:
        parts = [base, f"{base} overview", f"{base} examples", f"{base} risks"]
    # Pad / trim to exactly `count`.
    while len(parts) < count:
        parts.append(f"{base} ({len(parts) + 1})")
    return parts[:count]


async def decompose_query(
    query: str,
    *,
    count: Optional[int] = None,
    llm: Any = None,
) -> List[str]:
    """Return `count` focused sub-queries. Falls back to heuristic on any failure."""
    settings = get_settings()
    n = count or int(getattr(settings, "deep_research_subquery_count", 4))
    n = max(1, min(int(n), 8))

    if llm is None:
        try:
            from providers.llm.ollama import OllamaLLM
            model = getattr(settings, "deep_research_model", "") or None
            llm = OllamaLLM(model=model)
        except Exception as exc:
            logger.info(
                "Deep research: no LLM available for decompose (%s); using heuristic.", exc)
            return _heuristic_decompose(query, n)

    user_msg = f"Question: {query}\nReturn exactly {n} sub-queries."
    messages = [
        {"role": "system", "content": _DECOMPOSE_PROMPT},
        {"role": "user", "content": user_msg},
    ]
    try:
        if hasattr(llm, "chat"):
            res = await llm.chat(messages)
            content = res.get("content") if isinstance(res, dict) else str(res)
        else:
            stream_fn = getattr(
                llm, "stream_chat", None) or getattr(
                llm, "stream_response", None)
            if stream_fn is None:
                return _heuristic_decompose(query, n)
            content = ""
            async for chunk in stream_fn(messages):
                content += chunk
                if len(content) > 4000:
                    break
        content = _strip_fence(content or "")
        parsed = json.loads(content)
        if not isinstance(parsed, list):
            return _heuristic_decompose(query, n)
        clean = [str(p).strip() for p in parsed if str(p).strip()]
        if not clean:
            return _heuristic_decompose(query, n)
        # Pad if the model under-delivered.
        while len(clean) < n:
            clean.append(_heuristic_decompose(query, n)[len(clean)])
        return clean[:n]
    except Exception as exc:
        logger.info(
            "Deep research decompose failed (%s); using heuristic.",
            exc)
        return _heuristic_decompose(query, n)


# -----------------------------------------------------------------------------
# Stage 2 — gather candidate URLs from the existing search infra
# -----------------------------------------------------------------------------

_URL_RE = re.compile(r"https?://[^\s)]+")


def _parse_urls_from_block(text: str) -> List[Dict[str, str]]:
    """
    Extract a best-effort list of (title, url, snippet) from the formatted
    string returned by `providers/web/search.py`. The provider formats
    results as numbered entries with a `Source: <url>` line — we lean on
    that, but tolerate other shapes by URL-regex sweeping.
    """
    out: List[Dict[str, str]] = []
    if not text:
        return out
    seen: set[str] = set()

    # Numbered-block format: "<n>. <title>\n   <content>\n   Source: <url>"
    block_re = re.compile(
        r"(\d+)\.\s+(?P<title>.+?)\n\s+(?P<content>.+?)\n\s+Source:\s+(?P<url>https?://\S+)",
        flags=re.DOTALL,
    )
    for m in block_re.finditer(text):
        url = m.group("url").strip().rstrip(").,;")
        if url in seen:
            continue
        seen.add(url)
        out.append({
            "title": m.group("title").strip(),
            "url": url,
            "snippet": (m.group("content") or "").strip(),
        })

    # Fallback: any remaining bare URLs.
    for m in _URL_RE.finditer(text):
        url = m.group(0).rstrip(").,;")
        if url in seen:
            continue
        seen.add(url)
        out.append({"title": "", "url": url, "snippet": ""})

    return out


async def gather_sources(
    sub_queries: List[str],
    *,
    per_query: int = 4,
    overall_cap: Optional[int] = None,
    search_provider: Any = None,
) -> List[Dict[str, str]]:
    """
    Run every sub-query through the existing search provider in parallel,
    parse the formatted output, dedupe by URL, cap at `overall_cap`.
    """
    settings = get_settings()
    cap = int(
        overall_cap or getattr(
            settings,
            "deep_research_max_sources",
            10))  # type: ignore

    if not sub_queries:
        return []

    if search_provider is None:
        try:
            from providers.web.search import build_search_provider
            search_provider = build_search_provider()
        except Exception as exc:
            logger.warning(
                "Deep research: search provider unavailable (%s).", exc)
            return []

    async def _one(q: str) -> List[Dict[str, str]]:
        try:
            raw = await search_provider.search(q, per_query)
            return _parse_urls_from_block(raw or "")
        except Exception as exc:
            logger.info("Deep research search failed for %r: %s", q, exc)
            return []

    results = await asyncio.gather(*[_one(q) for q in sub_queries])
    merged: List[Dict[str, str]] = []
    seen: set[str] = set()
    for batch in results:
        for r in batch:
            if r["url"] in seen:
                continue
            seen.add(r["url"])
            merged.append(r)
            if len(merged) >= cap:
                return merged
    return merged


# -----------------------------------------------------------------------------
# Stage 3 — fetch each URL and convert to text
# -----------------------------------------------------------------------------

_DEFAULT_FETCH_TIMEOUT = 15.0
_MAX_EXTRACT_CHARS = 8000


async def _httpx_fetch(url: str, *, timeout: float) -> Optional[bytes]:
    try:
        import httpx
    except ImportError:
        return None
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=timeout) as client:
            r = await client.get(
                url,
                headers={"User-Agent": "RiverSongAI/3.0 (+research)"},
            )
            if r.status_code >= 400:
                return None
            return r.content
    except Exception as exc:
        logger.info("Deep research fetch %s failed: %s", url, exc)
        return None


def _markitdown_to_text(content: bytes, filename: str) -> str:
    """Use the existing MarkItDown loader when available; empty on failure."""
    try:
        from providers.rag.markitdown_loader import markitdown_extract
    except Exception:
        return ""
    try:
        items = markitdown_extract(file_bytes=content, filename=filename)
        if items:
            return "\n\n".join(it.get("text", "")
                               for it in items if it.get("text"))
    except Exception:
        pass
    return ""


def _html_to_text(content: bytes) -> str:
    """Lightweight HTML → text fallback (no extra dependency)."""
    try:
        text = content.decode("utf-8", errors="ignore")
    except Exception:
        return ""
    text = re.sub(r"<script[\s\S]*?</script>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    # Collapse whitespace.
    text = re.sub(r"\s+", " ", text).strip()
    return text


async def fetch_and_extract(
    source: Dict[str, str],
    *,
    fetcher: Optional[Callable[[str], Awaitable[Optional[bytes]]]] = None,
    extractor: Optional[Callable[[bytes, str], str]] = None,
    max_chars: int = _MAX_EXTRACT_CHARS,
) -> Dict[str, str]:
    """
    Returns the source dict with `text` filled in. Empty text marks a failure
    but the source is still returned so the synthesizer can decide to drop it.
    """
    url = source.get("url", "")
    if not url:
        return {**source, "text": ""}

    if fetcher is None:
        def fetcher(u): return _httpx_fetch(u, timeout=_DEFAULT_FETCH_TIMEOUT)  # noqa: E731

    content = await fetcher(url)
    if not content:
        return {**source, "text": ""}

    fname = urlparse(url).path.rsplit("/", 1)[-1] or "page.html"
    text = ""
    if extractor is not None:
        text = extractor(content, fname) or ""
    else:
        text = _markitdown_to_text(content, fname)
        if not text:
            text = _html_to_text(content)

    text = (text or "").strip()
    if len(text) > max_chars:
        text = text[:max_chars] + "…"
    return {**source, "text": text}


# -----------------------------------------------------------------------------
# Stage 4 — synthesize the report
# -----------------------------------------------------------------------------

_SYNTH_PROMPT = (
    "You produce structured research reports. Write valid Markdown. "
    "Layout:\n"
    "# <single concise title>\n\n"
    "_Generated by River Song Deep Research_\n\n"
    "## Summary\n<2–4 sentence overview>\n\n"
    "## Findings\n- bullets with inline citations like [1], [2]\n\n"
    "## Sources\n1. [Title](URL) — one-line context\n"
    "Use ONLY the supplied excerpts; do not invent facts. If a claim is "
    "not supported, omit it."
)


def _build_synthesis_messages(
        query: str, sources: List[Dict[str, str]]) -> List[Dict[str, str]]:
    excerpts: List[str] = []
    for i, src in enumerate(sources, start=1):
        title = src.get("title") or src.get("url") or f"Source {i}"
        url = src.get("url", "")
        body = (src.get("text") or src.get("snippet") or "").strip()
        if not body:
            continue
        excerpts.append(f"[{i}] {title} — {url}\n{body[:2400]}")
    payload = "\n\n".join(excerpts) if excerpts else "(no excerpts retrieved)"
    user = f"Question: {query}\n\nSource excerpts:\n{payload}"
    return [
        {"role": "system", "content": _SYNTH_PROMPT},
        {"role": "user", "content": user},
    ]


def _heuristic_synth(query: str, sources: List[Dict[str, str]]) -> str:
    """Minimal report when no LLM is available — still useful, just terse."""
    lines = [
        f"# Research: {query}",
        "",
        "_Generated by River Song Deep Research (heuristic)_",
        "",
        "## Summary",
        ""]
    if sources:
        lines.append(f"Reviewed {len(sources)} source(s) related to: {query}.")
    else:
        lines.append("No sources were available at the time of this run.")
    lines += ["", "## Findings"]
    for i, src in enumerate(sources, start=1):
        snippet = (src.get("snippet") or src.get("text") or "")[:240].strip()
        if snippet:
            lines.append(f"- {snippet} [{i}]")
    lines += ["", "## Sources"]
    for i, src in enumerate(sources, start=1):
        title = src.get("title") or src.get("url", "")
        url = src.get("url", "")
        lines.append(f"{i}. [{title}]({url})")
    return "\n".join(lines).strip() + "\n"


async def synthesize(
    query: str,
    sources: List[Dict[str, str]],
    *,
    llm: Any = None,
) -> str:
    """Produce the final Markdown report. Always returns *something* useful."""
    settings = get_settings()
    if llm is None:
        try:
            from providers.llm.ollama import OllamaLLM
            model = getattr(settings, "deep_research_model", "") or None
            llm = OllamaLLM(model=model)
        except Exception:
            return _heuristic_synth(query, sources)

    messages = _build_synthesis_messages(query, sources)
    try:
        if hasattr(llm, "chat"):
            res = await llm.chat(messages)
            content = res.get("content") if isinstance(res, dict) else str(res)
        else:
            stream_fn = getattr(
                llm, "stream_chat", None) or getattr(
                llm, "stream_response", None)
            if stream_fn is None:
                return _heuristic_synth(query, sources)
            content = ""
            async for chunk in stream_fn(messages):
                content += chunk
        content = (content or "").strip()
        if not content:
            return _heuristic_synth(query, sources)
        return content
    except Exception as exc:
        logger.info(
            "Deep research synthesis failed (%s); using heuristic.",
            exc)
        return _heuristic_synth(query, sources)


# -----------------------------------------------------------------------------
# Orchestrator
# -----------------------------------------------------------------------------

def _enabled() -> bool:
    return bool(getattr(get_settings(), "deep_research_enabled", False))


async def run_deep_research(
    query: str,
    *,
    user_id: str,
    store: Any,
    llm: Any = None,
    search_provider: Any = None,
    fetcher: Optional[Callable[[str], Awaitable[Optional[bytes]]]] = None,
    extractor: Optional[Callable[[bytes, str], str]] = None,
    on_progress: Optional[Callable[[Dict[str, Any]], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    """
    End-to-end deep-research run. Stores the result as a `research`-kind
    document via the Q2#6 store and returns `{document_id, report, sources, sub_queries}`.

    `store` must implement `create_document(owner_id, title, kind, body)` —
    the project's SQLiteStore satisfies this.
    """
    if not query or not query.strip():
        raise ValueError("query is required")

    async def _emit(event: str, **kw):
        if on_progress is not None:
            try:
                await on_progress({"stage": event, **kw})
            except Exception:
                pass

    await _emit("decompose")
    sub_queries = await decompose_query(query, llm=llm)
    await _emit("decompose_done", sub_queries=sub_queries)

    await _emit("gather")
    candidates = await gather_sources(sub_queries, search_provider=search_provider)
    await _emit("gather_done", candidate_count=len(candidates))

    await _emit("fetch")
    fetched = await asyncio.gather(*[
        fetch_and_extract(src, fetcher=fetcher, extractor=extractor)
        for src in candidates
    ])
    # Drop sources we couldn't extract anything from at all.
    sources = [s for s in fetched if (s.get("text") or s.get("snippet"))]
    await _emit("fetch_done", source_count=len(sources))

    await _emit("synthesize")
    report = await synthesize(query, sources, llm=llm)
    await _emit("synthesize_done")

    title = (query.strip()[:80]) or "Research report"
    doc = await store.create_document(user_id, title, "research", report)
    await _emit("saved", document_id=doc["id"])

    return {
        "document_id": doc["id"],
        "report": report,
        "title": title,
        "sub_queries": sub_queries,
        "sources": [{"title": s.get("title"), "url": s.get("url")} for s in sources],
    }
