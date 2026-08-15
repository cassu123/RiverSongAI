"""
tests/test_admin_chat_tools.py

Test suite for Admin Chat & Voice Tools Management Matrix.
"""

import pytest
from httpx import ASGITransport, AsyncClient
from main import app
from core.auth import create_access_token


@pytest.mark.asyncio
async def test_admin_chat_tools_list_and_update(app_store):
    admin_token = create_access_token("admin_user", "admin@test.com", "admin")
    user_token = create_access_token("regular_user", "user@test.com", "user")
    
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Non-admin should be rejected (403)
        res = await client.get(
            "/api/admin/chat-tools",
            headers={"Authorization": f"Bearer {user_token}"},
        )
        assert res.status_code == 403

        # Admin fetches tools matrix
        res = await client.get(
            "/api/admin/chat-tools",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert res.status_code == 200
        data = res.json()
        assert "tools" in data
        assert "disabled_tools" in data
        assert len(data["tools"]) > 10

        # Check CAD and Sandbox tools exist
        tool_names = [t["name"] for t in data["tools"]]
        assert "design_3d_model" in tool_names
        assert "run_sandbox_code" in tool_names
        assert "render_diagram" in tool_names
        assert "web_search" in tool_names

        # Disable a tool (e.g. mow_command)
        update_res = await client.put(
            "/api/admin/chat-tools",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"disabled_tools": ["mow_command", "browser_click"]},
        )
        assert update_res.status_code == 200
        assert update_res.json()["disabled_tools"] == ["mow_command", "browser_click"]

        # Re-fetch and verify disabled state is reflected
        res2 = await client.get(
            "/api/admin/chat-tools",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert res2.status_code == 200
        data2 = res2.json()
        assert "mow_command" in data2["disabled_tools"]
        mow_tool = next(t for t in data2["tools"] if t["name"] == "mow_command")
        assert mow_tool["enabled"] is False

        # Clean up: restore enabled state
        await client.put(
            "/api/admin/chat-tools",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"disabled_tools": []},
        )
