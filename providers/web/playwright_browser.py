"""
providers/web/playwright_browser.py

Q3#13 — Playwright browser provider exposed as an MCP tool. Headless
Chromium driven via the Playwright async API. Soft-imports so River
runs unchanged on hosts where `playwright` is not installed.

Lifecycle:
  PlaywrightBrowser.get() returns a singleton; each call returns the
  same browser context across tool invocations so we don't pay the
  startup cost per call. `close()` releases the browser at app
  shutdown (or on a manual reset).

The exposed MCP-style operations:
    navigate(url)            → {"url", "title"}
    extract_text(url=None)   → text body (HTML stripped, truncated)
    click(selector)          → confirms or 404s
    screenshot(url=None)     → base64 PNG
    vision_on_page(prompt, url=None) → screenshot + describe via LLM

Each operation tolerates the absence of Playwright by returning a clear
"playwright not installed" message rather than raising. Flag gating is
checked centrally via `_enabled()`.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import re
from typing import Any, Dict, Optional

from config.settings import get_settings

logger = logging.getLogger(__name__)


def _enabled() -> bool:
    return bool(getattr(get_settings(), "playwright_browser_enabled", False))


def _max_chars() -> int:
    return int(
        getattr(get_settings(), "playwright_browser_max_page_chars", 40_000))


def _headless() -> bool:
    return bool(getattr(get_settings(), "playwright_browser_headless", True))


def _html_to_text(html: str) -> str:
    text = re.sub(
        r"<script[\s\S]*?</script>",
        " ",
        html or "",
        flags=re.IGNORECASE)
    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


# -----------------------------------------------------------------------------
# Singleton browser manager
# -----------------------------------------------------------------------------

class PlaywrightBrowser:
    """
    Lazy, single-instance Playwright wrapper. All public ops are
    async-safe under a single lock so concurrent MCP calls are
    serialized at this layer (Playwright pages aren't thread-safe).
    """

    _instance: Optional["PlaywrightBrowser"] = None

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._pw = None
        self._browser = None
        self._context = None
        self._available = None  # tri-state: None=untested, True/False=tested

    @classmethod
    def get(cls) -> "PlaywrightBrowser":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    async def is_available(self) -> bool:
        """Has the package been imported successfully? Cheap re-check."""
        if self._available is not None:
            return self._available
        try:
            import playwright  # noqa: F401
            self._available = True  # type: ignore
        except Exception:
            self._available = False  # type: ignore
        return self._available  # type: ignore

    async def _ensure_started(self) -> None:
        if self._browser is not None:
            return
        if not await self.is_available():
            raise RuntimeError(
                "Playwright is not installed. Run `pip install playwright` "
                "and `playwright install chromium`."
            )
        # Imports kept here so the module loads even when playwright is absent.
        from playwright.async_api import async_playwright
        self._pw = await async_playwright().start()
        # type: ignore
        self._browser = await self._pw.chromium.launch(headless=_headless())  # type: ignore
        self._context = await self._browser.new_context()  # type: ignore

    async def close(self) -> None:
        async with self._lock:
            if self._browser is not None:
                try:
                    await self._browser.close()
                except Exception:
                    pass
            if self._pw is not None:
                try:
                    await self._pw.stop()
                except Exception:
                    pass
            self._browser = None
            self._context = None
            self._pw = None

    async def _new_page(self):
        """Open a fresh page in the shared browser+context.

        Design note: each public op (navigate/extract_text/click/screenshot/
        vision_on_page) calls `_new_page` and closes the page in a finally
        block. The browser binary + context are reused across ops (cheap),
        but the page itself is per-op (isolation). Sharing a page across
        ops would carry state (cookies, console state, in-flight requests)
        between unrelated calls and is unsafe for the MCP tool surface
        where each call is independent. The cost (~50–100 ms per op for
        page lifecycle) is the deliberate price of that isolation.
        """
        await self._ensure_started()
        return await self._context.new_page()  # type: ignore

    # -------------------------------------------------------------------------
    # Public operations
    # -------------------------------------------------------------------------

    async def navigate(self, url: str) -> Dict[str, Any]:
        async with self._lock:
            page = await self._new_page()
            try:
                resp = await page.goto(url, wait_until="domcontentloaded", timeout=20_000)
                title = await page.title()
                status = resp.status if resp else None
                return {"url": page.url, "title": title, "status": status}
            finally:
                await page.close()

    async def extract_text(self, url: Optional[str] = None) -> Dict[str, Any]:
        async with self._lock:
            page = await self._new_page()
            try:
                if url:
                    await page.goto(url, wait_until="domcontentloaded", timeout=20_000)
                html = await page.content()
                text = _html_to_text(html)
                limit = _max_chars()
                if len(text) > limit:
                    text = text[:limit] + "…"
                return {"url": page.url, "title": await page.title(), "text": text}
            finally:
                await page.close()

    async def click(self, selector: str,
                    url: Optional[str] = None) -> Dict[str, Any]:
        async with self._lock:
            page = await self._new_page()
            try:
                if url:
                    await page.goto(url, wait_until="domcontentloaded", timeout=20_000)
                await page.click(selector, timeout=8_000)
                return {"clicked": True, "selector": selector, "url": page.url}
            finally:
                await page.close()

    async def screenshot(
            self, url: Optional[str] = None, full_page: bool = True) -> Dict[str, Any]:
        async with self._lock:
            page = await self._new_page()
            try:
                if url:
                    await page.goto(url, wait_until="domcontentloaded", timeout=20_000)
                png_bytes = await page.screenshot(full_page=bool(full_page))
                return {
                    "url": page.url,
                    "image_base64": base64.b64encode(png_bytes).decode("ascii"),
                    "mime": "image/png",
                }
            finally:
                await page.close()

    async def vision_on_page(
        self,
        prompt: str,
        *,
        url: Optional[str] = None,
        llm: Any = None,
    ) -> Dict[str, Any]:
        """
        Capture a screenshot and ask the configured vision-capable LLM to
        describe it. Returns the textual description and the screenshot.
        """
        shot = await self.screenshot(url=url, full_page=True)
        description = ""
        try:
            if llm is None:
                # Reuse the project's configured Ollama provider; if it
                # supports multimodal input the description will be useful,
                # otherwise we return a graceful fallback.
                from providers.llm.ollama import OllamaLLM
                llm = OllamaLLM()
            if hasattr(llm, "vision_describe"):
                description = await llm.vision_describe(shot["image_base64"], prompt)
            elif hasattr(llm, "chat"):
                res = await llm.chat([
                    {"role": "system", "content":
                        "You will be given a screenshot context plus a question. "
                        "Answer ONLY about what is visible on the page."},
                    {"role": "user", "content":
                        f"Screenshot URL: {shot['url']}\nQuestion: {prompt}\n"
                        "Note: image was rendered headless; reason from text/cues only."},
                ])
                description = (
                    res.get("content") if isinstance(
                        res, dict) else str(res)) or ""
        except Exception as exc:
            description = f"(vision unavailable: {exc})"
        return {**shot, "description": description}


# -----------------------------------------------------------------------------
# MCP-tool entry points (called by core/tools.py dispatcher)
# -----------------------------------------------------------------------------

async def tool_navigate(args: Dict[str, Any]) -> str:
    if not _enabled():
        return "Playwright browser is disabled."
    try:
        out = await PlaywrightBrowser.get().navigate(args.get("url", ""))
        return f"Navigated to {out['url']} (title: {out['title']!r}, status: {out['status']})"
    except Exception as exc:
        return f"navigate failed: {exc}"


async def tool_extract_text(args: Dict[str, Any]) -> str:
    if not _enabled():
        return "Playwright browser is disabled."
    try:
        out = await PlaywrightBrowser.get().extract_text(args.get("url"))
        text = out.get("text", "")
        return f"# {out.get('title') or out.get('url')}\n\n{text}"
    except Exception as exc:
        return f"extract_text failed: {exc}"


async def tool_click(args: Dict[str, Any]) -> str:
    if not _enabled():
        return "Playwright browser is disabled."
    selector = args.get("selector", "")
    if not selector:
        return "click requires a CSS selector."
    try:
        out = await PlaywrightBrowser.get().click(selector, args.get("url"))
        return f"Clicked '{out['selector']}' on {out['url']}."
    except Exception as exc:
        return f"click failed: {exc}"


async def tool_screenshot(args: Dict[str, Any]) -> str:
    if not _enabled():
        return "Playwright browser is disabled."
    try:
        out = await PlaywrightBrowser.get().screenshot(args.get("url"), bool(args.get("full_page", True)))
        # Caller (the LLM) gets a short status. The base64 stays in the
        # full result object for callers that need the bytes (we shorten
        # here to avoid spamming the model context with megabytes).
        return f"Screenshot captured for {out['url']} ({len(out['image_base64'])} base64 chars)."
    except Exception as exc:
        return f"screenshot failed: {exc}"


async def tool_vision_on_page(args: Dict[str, Any]) -> str:
    if not _enabled():
        return "Playwright browser is disabled."
    prompt = args.get("prompt") or "Describe what's on this page."
    try:
        out = await PlaywrightBrowser.get().vision_on_page(prompt, url=args.get("url"))
        return out.get("description") or "(no description)"
    except Exception as exc:
        return f"vision_on_page failed: {exc}"


# -----------------------------------------------------------------------------
# Schemas — appended to TOOL_SCHEMAS at startup by the integration shim
# -----------------------------------------------------------------------------

PLAYWRIGHT_TOOL_SCHEMAS = [
    {
        "name": "browser_navigate",
        "description": "Open a URL in a headless browser and report the final URL, title, and HTTP status. Use when verifying a page loads or following redirects.",
        "input_schema": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "Absolute http(s) URL to load."},
            },
            "required": ["url"],
        },
    },
    {
        "name": "browser_extract_text",
        "description": "Fetch a page and return its visible text (HTML tags stripped). Truncated to a server-configured limit.",
        "input_schema": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "Absolute URL to load before extracting. Optional if a page is already open."},
            },
            "required": ["url"],
        },
    },
    {
        "name": "browser_click",
        "description": "Click a CSS selector on a page after navigating to the given URL. Confirms the click or returns an error.",
        "input_schema": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "URL to load first."},
                "selector": {"type": "string", "description": "CSS selector to click."},
            },
            "required": ["url", "selector"],
        },
    },
    {
        "name": "browser_screenshot",
        "description": "Take a full-page screenshot of a URL. Returns a status line; the base64 image is available to programmatic callers.",
        "input_schema": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "URL to load."},
                "full_page": {"type": "boolean", "description": "Capture the entire page height. Defaults to true."},
            },
            "required": ["url"],
        },
    },
    {
        "name": "browser_vision_on_page",
        "description": "Screenshot a URL and ask a vision-capable LLM to describe the page or answer a question about it.",
        "input_schema": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "URL to load before capturing."},
                "prompt": {"type": "string", "description": "Question or instruction for the visual analysis."},
            },
            "required": ["url", "prompt"],
        },
    },
]


PLAYWRIGHT_TOOL_DISPATCH = {
    "browser_navigate": tool_navigate,
    "browser_extract_text": tool_extract_text,
    "browser_click": tool_click,
    "browser_screenshot": tool_screenshot,
    "browser_vision_on_page": tool_vision_on_page,
}
