"""
providers/cad/cad_engine.py

Autonomous Generative 3D CAD & Hardware Prototyping Engine for River Song AI.
Compiles parametric OpenSCAD code to binary STL, analyzes 3D geometry
(volume, bounding box, surface area, estimated mass and print time),
and integrates with the Chronos Vault and interactive 3D viewports.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import subprocess
import tempfile
import uuid
from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Optional

try:
    import trimesh
except ImportError:                                  # pragma: no cover
    # Optional. It is used for mesh *analysis* — volume, extents, print time —
    # and nothing here needs it to compile a model.
    #
    # Guarded because this module is imported by api/routes/__init__.py at
    # startup, so a bare import made one optional dependency fatal to the
    # entire application: a missing 3D mesh library took down auth, culinary,
    # CSRF and eleven other unrelated test modules with it.
    trimesh = None

logger = logging.getLogger(__name__)

CAD_STORAGE_DIR = "data/cad_models"
OPENSCAD_BINARY_PATHS = [
    "/home/riversong/RiverSongAI/bin/openscad-dist/AppRun",
    "/home/riversong/RiverSongAI/bin/openscad",
    shutil.which("openscad") or "",
]


def _find_openscad_binary() -> str:
    for path in OPENSCAD_BINARY_PATHS:
        if path and os.path.isfile(path) and os.access(path, os.X_OK):
            return path
    return ""


@dataclass
class CADModelResult:
    model_id: str
    name: str
    scad_code: str
    stl_path: str
    scad_path: str
    volume_cm3: float
    dimensions_mm: List[float]  # [width, depth, height]
    surface_area_cm2: float
    estimated_mass_grams: float  # assuming standard PLA density ~1.24 g/cm3
    estimated_print_time_minutes: int
    is_watertight: bool
    created_at: str
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class CADEngine:
    """Headless 3D CAD compilation, mesh verification, and telemetry engine."""

    def __init__(self, storage_dir: str = CAD_STORAGE_DIR) -> None:
        self._storage_dir = storage_dir
        os.makedirs(self._storage_dir, exist_ok=True)
        self._openscad_bin = _find_openscad_binary()
        if self._openscad_bin:
            logger.info("CADEngine initialized with OpenSCAD binary: %s", self._openscad_bin)
        else:
            logger.warning("CADEngine: OpenSCAD binary not found. Standard binary fallback active.")

    async def compile_scad(
        self,
        scad_code: str,
        name: str = "3d_part",
        user_id: str = "primary_user",
        model_id: Optional[str] = None,
    ) -> CADModelResult:
        """Compiles OpenSCAD code to binary STL and extracts geometric metrics."""
        model_id = model_id or uuid.uuid4().hex[:10]
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None, self._compile_blocking, scad_code, name, user_id, model_id
        )

    def _compile_blocking(
        self,
        scad_code: str,
        name: str,
        user_id: str,
        model_id: str,
    ) -> CADModelResult:
        from datetime import datetime, timezone
        import json
        import re

        # Clean model_id and user_id to prevent any directory traversal
        safe_model_id = re.sub(r"[^a-zA-Z0-9_-]", "", model_id) or uuid.uuid4().hex[:10]
        safe_user_id = re.sub(r"[^a-zA-Z0-9_-]", "", user_id) or "primary_user"
        clean_name = re.sub(r"[^a-zA-Z0-9_\- ]", "", name).strip() or "3d_part"

        now_iso = datetime.now(timezone.utc).isoformat()
        user_cad_dir = os.path.join(self._storage_dir, safe_user_id, safe_model_id)
        os.makedirs(user_cad_dir, exist_ok=True)

        scad_path = os.path.join(user_cad_dir, "model.scad")
        stl_path = os.path.join(user_cad_dir, "model.stl")
        meta_path = os.path.join(user_cad_dir, "meta.json")

        with open(scad_path, "w", encoding="utf-8") as f:
            f.write(scad_code)

        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump({"model_id": safe_model_id, "name": clean_name, "created_at": now_iso}, f)

        if not self._openscad_bin:
            self._openscad_bin = _find_openscad_binary()

        if not self._openscad_bin:
            return CADModelResult(
                model_id=safe_model_id,
                name=clean_name,
                scad_code=scad_code,
                stl_path="",
                scad_path=scad_path,
                volume_cm3=0.0,
                dimensions_mm=[0.0, 0.0, 0.0],
                surface_area_cm2=0.0,
                estimated_mass_grams=0.0,
                estimated_print_time_minutes=0,
                is_watertight=False,
                created_at=now_iso,
                error="OpenSCAD compiler binary not found on server.",
            )

        cmd = [self._openscad_bin, "-o", stl_path, scad_path]
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            if res.returncode != 0:
                err_msg = res.stderr or res.stdout or "OpenSCAD compilation failed."
                logger.error("OpenSCAD error for %s: %s", clean_name, err_msg)
                return CADModelResult(
                    model_id=safe_model_id,
                    name=clean_name,
                    scad_code=scad_code,
                    stl_path="",
                    scad_path=scad_path,
                    volume_cm3=0.0,
                    dimensions_mm=[0.0, 0.0, 0.0],
                    surface_area_cm2=0.0,
                    estimated_mass_grams=0.0,
                    estimated_print_time_minutes=0,
                    is_watertight=False,
                    created_at=now_iso,
                    error=f"CAD Compilation error: {err_msg[:400]}",
                )
        except subprocess.TimeoutExpired:
            return CADModelResult(
                model_id=safe_model_id,
                name=clean_name,
                scad_code=scad_code,
                stl_path="",
                scad_path=scad_path,
                volume_cm3=0.0,
                dimensions_mm=[0.0, 0.0, 0.0],
                surface_area_cm2=0.0,
                estimated_mass_grams=0.0,
                estimated_print_time_minutes=0,
                is_watertight=False,
                created_at=now_iso,
                error="OpenSCAD compilation timed out after 60s (geometry may be too complex).",
            )
        except Exception as exc:
            return CADModelResult(
                model_id=safe_model_id,
                name=clean_name,
                scad_code=scad_code,
                stl_path="",
                scad_path=scad_path,
                volume_cm3=0.0,
                dimensions_mm=[0.0, 0.0, 0.0],
                surface_area_cm2=0.0,
                estimated_mass_grams=0.0,
                estimated_print_time_minutes=0,
                is_watertight=False,
                created_at=now_iso,
                error=f"Subprocess failure: {exc}",
            )

        # Analyze compiled STL mesh with trimesh
        volume_cm3 = 0.0
        dimensions_mm = [0.0, 0.0, 0.0]
        surface_area_cm2 = 0.0
        estimated_mass_g = 0.0
        estimated_print_mins = 0
        watertight = False

        if trimesh is None:
            logger.info(
                "trimesh is not installed; the STL compiled but its volume, "
                "dimensions and print estimate are unavailable.")
        elif os.path.exists(stl_path) and os.path.getsize(stl_path) > 0:
            try:
                mesh = trimesh.load(stl_path)
                if isinstance(mesh, trimesh.Scene):
                    mesh = mesh.dump(concatenate=True)
                
                if hasattr(mesh, "volume") and mesh.volume is not None:
                    volume_cm3 = round(float(abs(mesh.volume)) / 1000.0, 2)
                
                if hasattr(mesh, "extents") and mesh.extents is not None:
                    dimensions_mm = [round(float(x), 2) for x in mesh.extents]
                
                if hasattr(mesh, "area") and mesh.area is not None:
                    surface_area_cm2 = round(float(mesh.area) / 100.0, 2)
                    
                watertight = bool(getattr(mesh, "is_watertight", False))
                
                effective_density = 1.24 * 0.40
                estimated_mass_g = round(volume_cm3 * effective_density, 1)
                estimated_print_mins = max(5, int(3 + volume_cm3 * 2.5))
            except Exception as exc:
                logger.warning("Could not analyze 3D STL mesh with trimesh: %s", exc)

        return CADModelResult(
            model_id=safe_model_id,
            name=clean_name,
            scad_code=scad_code,
            stl_path=stl_path,
            scad_path=scad_path,
            volume_cm3=volume_cm3,
            dimensions_mm=dimensions_mm,
            surface_area_cm2=surface_area_cm2,
            estimated_mass_grams=estimated_mass_g,
            estimated_print_time_minutes=estimated_print_mins,
            is_watertight=watertight,
            created_at=now_iso,
        )


_DEFAULT_CAD_ENGINE: Optional[CADEngine] = None


def get_cad_engine() -> CADEngine:
    global _DEFAULT_CAD_ENGINE
    if _DEFAULT_CAD_ENGINE is None:
        _DEFAULT_CAD_ENGINE = CADEngine()
    return _DEFAULT_CAD_ENGINE
