"""
tests/test_cad_engine.py

Unit and integration tests for River Song AI Generative 3D CAD engine,
sandbox code execution runner, and CAD API routes.
"""

import os
import pytest
from httpx import ASGITransport, AsyncClient
from main import app
from providers.cad.cad_engine import CADEngine, get_cad_engine
from core.sandbox import SandboxRunner, get_sandbox_runner
from core.tools import execute_tool


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
async def test_sandbox_runner_python_success():
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


@pytest.mark.asyncio
async def test_sandbox_runner_python_error_traceback():
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
async def test_sandbox_tool_execution():
    context = {"user_id": "test_user"}
    result_text = await execute_tool(
        "run_sandbox_code",
        {"code": "print(40 + 2)", "language": "python"},
        context=context,
    )
    assert "✅ Success" in result_text
    assert "42" in result_text


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


@pytest.mark.asyncio
async def test_cad_api_endpoints():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Compile model via POST /api/cad/compile
        resp = await client.post(
            "/api/cad/compile",
            json={"name": "api_part", "scad_code": "sphere(r=10);"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "model_id" in data
        model_id = data["model_id"]
        assert data["volume_cm3"] > 0

        # Fetch STL via GET /api/cad/models/{model_id}/stl
        stl_resp = await client.get(f"/api/cad/models/{model_id}/stl")
        assert stl_resp.status_code == 200
        assert len(stl_resp.content) > 0

        # Fetch SCAD via GET /api/cad/models/{model_id}/scad
        scad_resp = await client.get(f"/api/cad/models/{model_id}/scad")
        assert scad_resp.status_code == 200
        assert "sphere(r=10);" in scad_resp.text

        # List models via GET /api/cad/models
        list_resp = await client.get("/api/cad/models")
        assert list_resp.status_code == 200
        models_data = list_resp.json()
        assert len(models_data["models"]) >= 1
