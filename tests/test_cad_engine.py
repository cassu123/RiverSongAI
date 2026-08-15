"""
tests/test_cad_engine.py

Unit and integration tests for River Song AI Generative 3D CAD engine,
resource-limited Python process runner, and CAD API routes.
"""

import os
import pytest
from httpx import ASGITransport, AsyncClient
from main import app
from config.settings import get_settings
from providers.cad.cad_engine import (
    CADEngine,
    _find_openscad_binary,
    get_cad_engine,
    trimesh,
)
from core.auth import create_access_token
from core.sandbox import SandboxRunner, get_sandbox_runner
from core.tools import execute_tool

# OpenSCAD is a system binary and trimesh an optional package; neither is
# installed in CI. Tests that assert a real compiled mesh need both, and
# asserting `res.error is None` without them fails on the environment rather
# than on the code.
needs_openscad = pytest.mark.skipif(
    not _find_openscad_binary(),
    reason="OpenSCAD binary not installed",
)
needs_mesh = pytest.mark.skipif(
    not _find_openscad_binary() or trimesh is None,
    reason="OpenSCAD binary and trimesh both required for mesh metrics",
)


@needs_mesh
@pytest.mark.asyncio
async def test_cad_engine_compilation_and_metrics():
    engine = get_cad_engine()
    scad_sample = """
    $fn = 32;
    difference() {
        cube([20, 30, 10], center=true);
        cylinder(r=3, h=15, center=true);
    }
    """
    res = await engine.compile_scad(
        scad_code=scad_sample,
        name="test_bracket",
        user_id="test_user",
    )
    
    assert res.error is None
    assert res.model_id is not None
    assert os.path.exists(res.stl_path)
    assert os.path.getsize(res.stl_path) > 0
    assert res.volume_cm3 > 0.0
    assert len(res.dimensions_mm) == 3
    assert res.dimensions_mm[0] >= 19.0  # ~20mm
    assert res.dimensions_mm[1] >= 29.0  # ~30mm
    assert res.dimensions_mm[2] >= 9.0   # ~10mm
    assert res.estimated_mass_grams > 0.0
    assert res.estimated_print_time_minutes >= 5


@needs_openscad
@pytest.mark.asyncio
async def test_cad_engine_path_traversal_sanitization():
    engine = get_cad_engine()
    # Malicious path traversal attempt in name
    res = await engine.compile_scad(
        scad_code="cube([10, 10, 10]);",
        name="../../../malicious_file",
        user_id="test_user",
    )
    assert res.error is None
    # Verify the file is safely confined to the model_id folder
    assert ".." not in res.stl_path
    assert "model.stl" in res.stl_path
    assert os.path.exists(res.stl_path)


@needs_openscad
@pytest.mark.asyncio
async def test_cad_engine_invalid_syntax_error():
    engine = get_cad_engine()
    bad_scad = "cube([10, 20;"  # syntax error
    res = await engine.compile_scad(
        scad_code=bad_scad,
        name="bad_model",
        user_id="test_user",
    )
    assert res.error is not None
    assert "CAD Compilation error" in res.error


@pytest.mark.asyncio
async def test_sandbox_runner_default_disabled():
    settings = get_settings()
    settings.sandbox_enabled = False
    runner = get_sandbox_runner()
    res = await runner.execute_code(code="print('hi')", language="python", user_id="test_user")
    assert res.success is False
    assert "Sandbox code execution is disabled" in res.stderr


@pytest.mark.asyncio
async def test_sandbox_runner_rejects_bash():
    settings = get_settings()
    settings.sandbox_enabled = True
    runner = get_sandbox_runner()
    res = await runner.execute_code(code="echo 'hi'", language="bash", user_id="test_user")
    assert res.success is False
    assert "Only Python is permitted" in res.stderr
    settings.sandbox_enabled = False


@pytest.mark.asyncio
async def test_sandbox_runner_python_success():
    settings = get_settings()
    settings.sandbox_enabled = True
    runner = get_sandbox_runner()
    code = """
import sys
print("Hello from sandbox!")
sys.stdout.flush()
"""
    res = await runner.execute_code(code=code, language="python", user_id="test_user")
    assert res.success is True
    assert res.exit_code == 0
    assert "Hello from sandbox!" in res.stdout
    assert res.error_summary is None
    settings.sandbox_enabled = False


@pytest.mark.asyncio
async def test_sandbox_runner_python_error_traceback():
    settings = get_settings()
    settings.sandbox_enabled = True
    runner = get_sandbox_runner()
    code = """
def broken():
    raise ValueError("Test error in sandbox")
broken()
"""
    res = await runner.execute_code(code=code, language="python", user_id="test_user")
    assert res.success is False
    assert res.exit_code != 0
    assert "ValueError: Test error in sandbox" in res.stderr
    assert "ValueError" in (res.error_summary or "")
    settings.sandbox_enabled = False


@pytest.mark.asyncio
async def test_sandbox_runner_timeout():
    settings = get_settings()
    settings.sandbox_enabled = True
    runner = get_sandbox_runner()
    code = """
import time, sys
print("Step 1: In progress...")
sys.stdout.flush()
time.sleep(10)
"""
    res = await runner.execute_code(code=code, language="python", timeout=1.0, user_id="test_user")
    assert res.success is False
    assert res.exit_code == -1
    assert "TimeoutExpired" in (res.error_summary or "")
    assert "Step 1: In progress..." in res.stdout
    settings.sandbox_enabled = False


@pytest.mark.asyncio
async def test_sandbox_runner_reaps_detached_daemon():
    settings = get_settings()
    settings.sandbox_enabled = True
    runner = get_sandbox_runner()
    # Code that spawns a detached background subprocess and exits 0 immediately
    code = """
import subprocess, sys
p = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print(f"Spawned:{p.pid}")
"""
    res = await runner.execute_code(code=code, language="python", timeout=5.0, user_id="test_user")
    assert res.success is True
    assert "Spawned:" in res.stdout
    spawned_pid = int(res.stdout.split("Spawned:")[1].strip().split()[0])
    
    import time, errno
    time.sleep(0.1)
    is_alive = False
    try:
        os.kill(spawned_pid, 0)
        is_alive = True
    except OSError as err:
        is_alive = (err.errno == errno.EPERM)
    assert not is_alive, f"Detached daemon PID {spawned_pid} survived success execution path!"
    settings.sandbox_enabled = False


@needs_openscad
@pytest.mark.asyncio
async def test_cad_tool_execution():
    context = {"user_id": "test_user"}
    scad_code = "cube([15, 15, 15], center=true);"
    result_text = await execute_tool(
        "design_3d_model",
        {"name": "test_cube", "scad_code": scad_code},
        context=context,
    )
    assert "Successfully designed and compiled 3D CAD Model: **test_cube**" in result_text
    assert "```stl" in result_text
    assert "Estimated PLA Mass" in result_text


@pytest.mark.asyncio
async def test_diagram_tool_execution():
    context = {"user_id": "test_user"}
    mermaid = "graph TD; A-->B; B-->C;"
    result_text = await execute_tool(
        "render_diagram",
        {"title": "Mower State Machine", "mermaid_code": mermaid},
        context=context,
    )
    assert "Mower State Machine" in result_text
    assert "```mermaid" in result_text
    assert "graph TD; A-->B; B-->C;" in result_text


@needs_mesh
@pytest.mark.asyncio
async def test_cad_api_endpoints(app_store):
    """The happy path, with credentials.

    It used to send none, which meant it was asserting that anonymous
    compile, read and list all succeed — the exact behaviour that made
    /api/cad/sandbox/run reachable without a token.
    """
    token = create_access_token("cad_owner", "owner@test.com", "user")
    auth = {"Authorization": f"Bearer {token}"}
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/api/cad/compile",
            json={"name": "api_part", "scad_code": "sphere(r=10);"},
            headers=auth,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "model_id" in data
        model_id = data["model_id"]
        assert data["volume_cm3"] > 0

        stl_resp = await client.get(f"/api/cad/models/{model_id}/stl", headers=auth)
        assert stl_resp.status_code == 200
        assert len(stl_resp.content) > 0

        scad_resp = await client.get(f"/api/cad/models/{model_id}/scad", headers=auth)
        assert scad_resp.status_code == 200
        assert "sphere(r=10);" in scad_resp.text

        list_resp = await client.get("/api/cad/models", headers=auth)
        assert list_resp.status_code == 200
        assert len(list_resp.json()["models"]) >= 1

        bad_id_resp = await client.get("/api/cad/models/bad$id/stl", headers=auth)
        assert bad_id_resp.status_code == 400

        missing_resp = await client.get(
            "/api/cad/models/missing_model_123/stl", headers=auth)
        assert missing_resp.status_code == 404

        # Another account must not reach this model. The handler used to fall
        # back to primary_user's directory when the caller's own was missing,
        # so any authenticated user who guessed a model_id read someone
        # else's STL — and the id is in every STL URL.
        other = create_access_token("cad_stranger", "stranger@test.com", "user")
        stranger = await client.get(
            f"/api/cad/models/{model_id}/stl",
            headers={"Authorization": f"Bearer {other}"},
        )
        assert stranger.status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize("method,path,payload", [
    ("post", "/api/cad/compile", {"name": "x", "scad_code": "cube(1);"}),
    ("post", "/api/cad/sandbox/run", {"code": "print(1)"}),
    ("get", "/api/cad/models", None),
    ("get", "/api/cad/models/abc123/stl", None),
    ("get", "/api/cad/models/abc123/scad", None),
])
async def test_cad_routes_reject_anonymous_callers(method, path, payload):
    """_require_user used to return "primary_user" for a missing or invalid
    token, so every route here accepted anonymous requests — including the
    one that executes Python.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        call = getattr(client, method)
        resp = await (call(path, json=payload) if payload else call(path))
        assert resp.status_code == 401, f"{method.upper()} {path} allowed anonymous access"

        forged = await (
            call(path, json=payload, headers={"Authorization": "Bearer not-a-token"})
            if payload else
            call(path, headers={"Authorization": "Bearer not-a-token"})
        )
        assert forged.status_code == 401, f"{method.upper()} {path} accepted a junk token"
