"""The agent loop reports whether each tool call actually worked."""
import asyncio

from core.agent_loop import run_agent_loop
from core.tool_outcome import ToolFailure


class OneToolThenAnswer:
    """An LLM that calls one tool, then answers."""

    def __init__(self, tool):
        self.tool = tool
        self.calls = 0

    async def chat_with_tools(self, messages, tools):
        self.calls += 1
        if self.calls == 1:
            return {"type": "tool_call", "tool_name": self.tool, "tool_input": {"q": 1}}
        return {"type": "text", "content": "done"}


def run(result_or_exc, tool="get_weather"):
    events, receipts_seen = [], []

    async def execute(name, args, ctx):
        if isinstance(result_or_exc, Exception):
            raise result_or_exc
        return result_or_exc

    async def on_event(evt):
        events.append(evt)

    async def append_history(*a, **k):
        pass

    _, receipts = asyncio.run(run_agent_loop(
        OneToolThenAnswer(tool), [], [], execute, on_event, append_history, "u1"))
    result = next(e for e in events if e["type"] == "tool_result")
    return result, receipts


def test_a_tool_that_worked_is_ok():
    result, receipts = run("It is 18°C and clear.")
    assert result["ok"] is True
    assert receipts[0]["ok"] is True


def test_a_tool_that_caught_its_own_error_is_not_ok():
    text = ToolFailure("I tried to check the weather for 'Leeds', but encountered an issue: 503")
    result, receipts = run(text)
    assert result["ok"] is False
    assert receipts[0]["ok"] is False
    # The model and the UI still get exactly the same words.
    assert result["result"] == str(text)


def test_a_tool_that_raised_is_not_ok():
    result, _ = run(RuntimeError("boom"))
    assert result["ok"] is False
    assert result["result"].startswith("Error executing get_weather")


def test_a_failure_is_still_plain_text_to_every_caller():
    import json
    text = ToolFailure("Home Assistant isn't reachable right now.")
    assert isinstance(text, str)
    assert text == "Home Assistant isn't reachable right now."
    assert json.loads(json.dumps({"result": text}))["result"] == text


# --- The registry marks its own caught failures ------------------------------

def _stub_module(monkeypatch, name, **attrs):
    import sys
    import types
    mod = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(mod, k, v)
    monkeypatch.setitem(sys.modules, name, mod)


def test_weather_that_cannot_reach_its_provider_is_a_failure(monkeypatch):
    from core.tools import registry

    class DownMaps:
        async def geocode(self, _):
            raise ConnectionError("503 from geocoder")

    _stub_module(monkeypatch, "providers.google.maps", build_maps_provider=lambda: DownMaps())
    _stub_module(monkeypatch, "providers.feeds.weather", get_weather_report=None)

    out = asyncio.run(registry._exec_get_weather({"location": "Leeds"}, "u1"))
    assert isinstance(out, ToolFailure)
    assert "encountered an issue" in out   # same words the model always got


def test_weather_that_finds_nowhere_is_an_answer_not_a_failure(monkeypatch):
    from core.tools import registry

    class NoPlace:
        async def geocode(self, _):
            return None

    _stub_module(monkeypatch, "providers.google.maps", build_maps_provider=lambda: NoPlace())
    _stub_module(monkeypatch, "providers.feeds.weather", get_weather_report=None)

    out = asyncio.run(registry._exec_get_weather({"location": "Atlantis"}, "u1"))
    assert not isinstance(out, ToolFailure)


def test_an_unknown_tool_is_a_failure():
    from core.tools import registry
    out = asyncio.run(registry.execute_tool("no_such_tool", {}, {"user_id": "u1", "disabled_tools": []}))
    assert isinstance(out, ToolFailure)
