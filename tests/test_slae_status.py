"""
SLAE's Recent Activity reads "idle" before anything has run, not
"not_configured": there is nothing to configure, it has just been quiet.
"""
import os
import sys
import types

# Load only the SLAE route; api/routes/__init__.py imports every provider SDK.
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for _name, _path in (("api.routes", "api/routes"), ("api.routes.ai", "api/routes/ai")):
    if _name not in sys.modules:
        _pkg = types.ModuleType(_name)
        _pkg.__path__ = [os.path.join(_ROOT, _path)]
        sys.modules[_name] = _pkg

import api.routes.ai.slae as slae  # noqa: E402


class _EmptyRegistry:
    def all_last_invocations(self):
        return {}


class _EmptyGraphiti:
    def stats(self):
        return {"recent_episodes": []}


def test_no_activity_reads_idle(monkeypatch):
    monkeypatch.setattr(slae, "get_role_registry", lambda: _EmptyRegistry())
    monkeypatch.setattr(slae, "get_graphiti_provider", lambda: _EmptyGraphiti())
    section = slae._recent_activity_section()
    assert section["status"] == "idle"
    assert section["events"] == []
