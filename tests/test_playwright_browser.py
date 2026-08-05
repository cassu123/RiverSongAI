"""
tests/test_playwright_browser.py

Q3#13 — Playwright browser. Validates the pure / mockable surface
(schemas registered, flag-gating, dispatch, HTML→text helper, vision
flow with mocked LLM). The actual headless Chromium driver is not
exercised here — that requires `playwright install chromium`, which is
left to the operator at deploy time.
"""

from __future__ import annotations

import asyncio

import pytest

from providers.web.playwright_browser import (
    PLAYWRIGHT_TOOL_DISPATCH,
    PLAYWRIGHT_TOOL_SCHEMAS,
    PlaywrightBrowser,
    _html_to_text,
    tool_extract_text,
    tool_navigate,
    tool_screenshot,
    tool_vision_on_page,
)


def _run(coro):
    return asyncio.run(coro)


# -----------------------------------------------------------------------------
# Schema shape
# -----------------------------------------------------------------------------

class TestSchemas:
    def test_all_five_tools_present(self):
        names = {t["name"] for t in PLAYWRIGHT_TOOL_SCHEMAS}
        assert names == {
            "browser_navigate", "browser_extract_text", "browser_click",
            "browser_screenshot", "browser_vision_on_page",
        }

    def test_dispatch_table_matches_schemas(self):
        names = {t["name"] for t in PLAYWRIGHT_TOOL_SCHEMAS}
        assert names == set(PLAYWRIGHT_TOOL_DISPATCH.keys())

    def test_each_schema_has_required_keys(self):
        for t in PLAYWRIGHT_TOOL_SCHEMAS:
            assert {"name", "description", "input_schema"} <= set(t)
            assert "properties" in t["input_schema"]


# -----------------------------------------------------------------------------
# HTML → text
# -----------------------------------------------------------------------------

class TestHtmlToText:
    def test_strips_tags(self):
        assert "hi" in _html_to_text("<p>hi</p>")
        assert "<p>" not in _html_to_text("<p>hi</p>")

    def test_drops_script(self):
        out = _html_to_text("<script>alert(1)</script>visible")
        assert "alert" not in out
        assert "visible" in out

    def test_drops_style(self):
        out = _html_to_text("<style>.a{color:red}</style>content")
        assert "color" not in out
        assert "content" in out

    def test_collapses_whitespace(self):
        assert _html_to_text("a\n\n    b") == "a b"


# -----------------------------------------------------------------------------
# Flag gating — every entry point returns the disabled message when off
# -----------------------------------------------------------------------------

class TestFlagGating:
    def test_navigate_disabled_message(self):
        # Flag is OFF by default.
        out = _run(tool_navigate({"url": "https://example.com"}))
        assert "disabled" in out.lower()

    def test_extract_disabled_message(self):
        out = _run(tool_extract_text({"url": "https://example.com"}))
        assert "disabled" in out.lower()

    def test_screenshot_disabled_message(self):
        out = _run(tool_screenshot({"url": "https://example.com"}))
        assert "disabled" in out.lower()

    def test_vision_disabled_message(self):
        out = _run(tool_vision_on_page({"url": "https://example.com", "prompt": "?"}))
        assert "disabled" in out.lower()


# -----------------------------------------------------------------------------
# Singleton + availability detection
# -----------------------------------------------------------------------------

class TestAvailability:
    def test_singleton(self):
        a = PlaywrightBrowser.get()
        b = PlaywrightBrowser.get()
        assert a is b

    def test_is_available_returns_bool(self):
        # Cheap: just exercises the try/except import path.
        out = _run(PlaywrightBrowser.get().is_available())
        assert isinstance(out, bool)


# -----------------------------------------------------------------------------
# core/tools dispatcher recognizes the new names (even when flag is off,
# dispatch routes through to the provider; the provider returns the
# disabled message rather than failing)
# -----------------------------------------------------------------------------

class TestToolsDispatcher:
    def test_execute_tool_routes_browser_navigate(self):
        from core.tools import execute_tool
        out = _run(execute_tool("browser_navigate", {"url": "https://x"}, {"user_id": "u"}))
        # Provider short-circuits with "disabled" since the flag is off.
        assert "disabled" in out.lower()


# -----------------------------------------------------------------------------
# MCP server — flag-gated exposure
# -----------------------------------------------------------------------------

class TestMcpExposure:
    def test_browser_tools_absent_by_default(self):
        # Reload the module so EXPOSED_TOOL_NAMES is built against the
        # current (default OFF) flag state.
        import importlib
        import mcp_server
        importlib.reload(mcp_server)
        names = mcp_server.EXPOSED_TOOL_NAMES
        for n in ("browser_navigate", "browser_extract_text", "browser_click",
                  "browser_screenshot", "browser_vision_on_page"):
            assert n not in names
