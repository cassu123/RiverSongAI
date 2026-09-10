"""
api/routes/cad.py

REST API routes for Generative 3D CAD modeling, STL binary asset streaming,
and sandboxed code execution in River Song AI.
"""

from __future__ import annotations

import os
import re
from typing import List, Optional

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from core.auth import decode_token
from core.sandbox import get_sandbox_runner
from providers.cad.cad_engine import CAD_STORAGE_DIR, CADModelResult, get_cad_engine

router = APIRouter(prefix="/api/cad", tags=["cad"])


async def _require_user(
    request: Optional[Request] = None,
    authorization: Optional[str] = Header(default=None),
) -> str:
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        parts = authorization.split(" ", 1)
        if len(parts) > 1:
            token = parts[1].strip()
    if not token and request:
        token = request.cookies.get("access_token")
    # No token in the query string. A ?token= fallback here would cover every
    # route on this router, including POST /api/cad/sandbox/run, which
    # executes Python -- and query strings land in access logs, browser
    # history and Referer headers. The viewer does not need it: the STL URL
    # is same-origin, login sets access_token as a cookie, and STLViewer
    # sends a Bearer header and downloads through a Blob it already fetched.
    #
    # No anonymous fallback either. A helper called _require_user that hands
    # an unauthenticated caller the primary user's identity is not a weaker
    # check, it is no check.
    #
    # decode_token returns None for a *revoked* token, a suspended user and
    # one invalidated by a forced logout. All three must land here, not in
    # the same branch as "no token at all", or a suspended user gets in.
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required.")
    payload = await decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token carries no subject.")
    return user_id


# Deliberately absent: a helper that searches every user's directory for a
# model_id. Model dirs are resolved from the caller's own id and nowhere else.
# A model_id is a short hex string that appears in every STL URL the assistant
# emits, so a cross-user lookup means anyone who has seen (or guessed) one
# reads somebody else's model. If shared household models are wanted, they
# need an explicit sharing record, not a directory scan.


class CADCompileRequest(BaseModel):
    scad_code: str = Field(..., description="Parametric OpenSCAD source code")
    name: str = Field("3d_model", description="Model name identifier")


class SandboxRunRequest(BaseModel):
    code: str = Field(..., description="Code to execute")
    language: str = Field("python", description="Language: python, bash, sh")
    timeout: float = Field(30.0, ge=1.0, le=120.0, description="Execution timeout in seconds")


@router.post("/compile")
async def compile_cad_model(
    body: CADCompileRequest,
    request: Request,
    authorization: Optional[str] = Header(default=None),
) -> dict:
    """Compile OpenSCAD source code into a 3D STL mesh with physical telemetry."""
    user_id = await _require_user(request, authorization)
    engine = get_cad_engine()
    res: CADModelResult = await engine.compile_scad(
        scad_code=body.scad_code,
        name=body.name,
        user_id=user_id,
    )
    data = res.to_dict()
    data["download_url"] = f"/api/cad/models/{res.model_id}/stl"
    data["scad_url"] = f"/api/cad/models/{res.model_id}/scad"
    return data


@router.get("/models/{model_id}/stl")
async def get_model_stl(
    model_id: str,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """Stream binary STL file for 3D viewport rendering or slicer download."""
    if not re.match(r"^[a-zA-Z0-9_-]{1,64}$", model_id):
        raise HTTPException(status_code=400, detail="Invalid model ID format.")
    user_id = await _require_user(request, authorization)
    safe_user_id = re.sub(r"[^a-zA-Z0-9_-]", "", user_id) or "primary_user"
    # Only ever this caller's own directory -- 404 rather than reaching into
    # anyone else's. See the note above _find_model_dir's former home.
    user_dir = os.path.join(CAD_STORAGE_DIR, safe_user_id, model_id)
    if not os.path.isdir(user_dir):
        raise HTTPException(status_code=404, detail="CAD Model not found.")

    stl_path = os.path.join(user_dir, "model.stl")
    if not os.path.isfile(stl_path):
        # Fallback to any .stl
        stl_files = [f for f in os.listdir(user_dir) if f.endswith(".stl")]
        if not stl_files:
            raise HTTPException(status_code=404, detail="STL file not generated for this model.")
        stl_path = os.path.join(user_dir, stl_files[0])

    return FileResponse(
        stl_path,
        media_type="model/stl",
        filename=f"model_{model_id}.stl",
    )


@router.get("/models/{model_id}/scad")
async def get_model_scad(
    model_id: str,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """Retrieve the OpenSCAD source code for a model."""
    if not re.match(r"^[a-zA-Z0-9_-]{1,64}$", model_id):
        raise HTTPException(status_code=400, detail="Invalid model ID format.")
    user_id = await _require_user(request, authorization)
    safe_user_id = re.sub(r"[^a-zA-Z0-9_-]", "", user_id) or "primary_user"
    # Only ever this caller's own directory -- 404 rather than reaching into
    # anyone else's. See the note above _find_model_dir's former home.
    user_dir = os.path.join(CAD_STORAGE_DIR, safe_user_id, model_id)
    if not os.path.isdir(user_dir):
        raise HTTPException(status_code=404, detail="CAD Model not found.")

    scad_path = os.path.join(user_dir, "model.scad")
    if not os.path.isfile(scad_path):
        scad_files = [f for f in os.listdir(user_dir) if f.endswith(".scad")]
        if not scad_files:
            raise HTTPException(status_code=404, detail="SCAD source not found.")
        scad_path = os.path.join(user_dir, scad_files[0])

    with open(scad_path, "r", encoding="utf-8") as f:
        content = f.read()
    return Response(content=content, media_type="text/plain")


@router.get("/models")
async def list_cad_models(
    request: Request,
    authorization: Optional[str] = Header(default=None),
) -> dict:
    """List all 3D CAD models generated for this user."""
    import json
    user_id = await _require_user(request, authorization)
    safe_user_id = re.sub(r"[^a-zA-Z0-9_-]", "", user_id) or "primary_user"
    user_dir = os.path.join(CAD_STORAGE_DIR, safe_user_id)
    if not os.path.isdir(user_dir):
        return {"models": []}

    models = []
    for model_id in os.listdir(user_dir):
        if not re.match(r"^[a-zA-Z0-9_-]{1,64}$", model_id):
            continue
        m_dir = os.path.join(user_dir, model_id)
        if not os.path.isdir(m_dir):
            continue
        name = model_id
        meta_file = os.path.join(m_dir, "meta.json")
        if os.path.isfile(meta_file):
            try:
                with open(meta_file, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                    name = meta.get("name", model_id)
            except Exception:
                pass
        models.append({
            "model_id": model_id,
            "name": name,
            "stl_url": f"/api/cad/models/{model_id}/stl",
            "scad_url": f"/api/cad/models/{model_id}/scad",
        })
    return {"models": models}


@router.post("/sandbox/run")
async def run_sandbox(
    body: SandboxRunRequest,
    request: Request,
    authorization: Optional[str] = Header(default=None),
) -> dict:
    """Execute code in an isolated sandbox environment and return logs/artifacts."""
    user_id = await _require_user(request, authorization)
    runner = get_sandbox_runner()
    res = await runner.execute_code(
        code=body.code,
        language=body.language,
        timeout=body.timeout,
        user_id=user_id,
    )
    return res.to_dict()
