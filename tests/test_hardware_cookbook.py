"""
tests/test_hardware_cookbook.py

Hardware Cookbook — pure logic + endpoint smoke.

The detection layer (nvidia-smi, /proc/meminfo, /proc/cpuinfo) is host-dependent
and intentionally tolerant, so we focus on the scoring logic and the
flag-gated route surface.
"""

from __future__ import annotations

import importlib

import pytest

from core.hardware_cookbook import (
    _score_one,
    score_models,
    build_cookbook,
    detect_hardware,
)
from config.settings import get_settings


# `main` is shadowed by a stdlib-adjacent site-packages module in some envs,
# and even when loadable, `main.get_app()` can return None in degraded test
# envs. Skip endpoint-surface tests in those cases — pure logic tests below
# stay valid regardless.
_main_mod = None
_PROJECT_APP = None
try:
    _main_mod = importlib.import_module("main")
    if hasattr(_main_mod, "get_app"):
        _PROJECT_APP = _main_mod.get_app()
except ImportError:
    pass
_ENDPOINT_TESTABLE = _PROJECT_APP is not None


# =============================================================================
# Pure scoring logic
# =============================================================================

class TestScoreOne:
    def test_unknown_when_vram_metadata_missing(self):
        status, reason = _score_one(None, gpu_free=10, gpu_total=10, ram_avail=64)
        assert status == "unknown"
        assert "no VRAM estimate" in reason

    def test_fits_when_within_85_percent_of_free_vram(self):
        # 3.0 GB model vs 4.0 GB free → 3.0 <= 4.0 * 0.85 = 3.4 → fits
        status, _ = _score_one(3.0, gpu_free=4.0, gpu_total=4.0, ram_avail=32)
        assert status == "fits"

    def test_tight_when_total_holds_but_free_does_not(self):
        # 3.0 GB model: too big for 0.5 GB free, but fits in 4 GB * 0.85 = 3.4 total → tight
        status, reason = _score_one(3.0, gpu_free=0.5, gpu_total=4.0, ram_avail=32)
        assert status == "tight"
        assert "release VRAM" in reason

    def test_ram_fallback_when_too_large_for_gpu(self):
        # 8 GB model, 4 GB GPU total, 32 GB RAM avail → ram_fallback
        status, reason = _score_one(8.0, gpu_free=0.5, gpu_total=4.0, ram_avail=32)
        assert status == "ram_fallback"
        assert "CPU+RAM" in reason

    def test_oom_when_neither_gpu_nor_ram_fits(self):
        # 64 GB model, 4 GB GPU, 8 GB RAM → oom
        status, reason = _score_one(64.0, gpu_free=0.5, gpu_total=4.0, ram_avail=8.0)
        assert status == "oom"
        assert "neither GPU" in reason

    def test_no_gpu_falls_straight_to_ram(self):
        # No GPU: 3 GB model, 32 GB RAM → ram_fallback (not "fits", because gpu_total=0)
        status, _ = _score_one(3.0, gpu_free=0.0, gpu_total=0.0, ram_avail=32.0)
        assert status == "ram_fallback"

    def test_safety_margin_blocks_models_just_over_threshold(self):
        # 3.5 GB model vs 4 GB free → 3.5 > 4 * 0.85 = 3.4 → not fits
        status, _ = _score_one(3.5, gpu_free=4.0, gpu_total=4.0, ram_avail=32)
        assert status != "fits"


# =============================================================================
# Whole-rig integration (uses the actual host)
# =============================================================================

class TestBuildCookbook:
    def test_detect_hardware_returns_required_shape(self):
        hw = detect_hardware()
        assert "gpus" in hw and isinstance(hw["gpus"], list)
        assert "ram_gb" in hw and "total_gb" in hw["ram_gb"]
        assert "cpu" in hw and "cores" in hw["cpu"]
        assert "detected_at" in hw

    def test_build_cookbook_scores_every_local_model(self):
        cb = build_cookbook()
        assert cb["summary"]["total"] == len(cb["models"])
        assert cb["summary"]["total"] > 0  # registry has local models
        # Summary buckets sum to total
        s = cb["summary"]
        assert s["fits"] + s["tight"] + s["ram_fallback"] + s["oom"] + s["unknown"] == s["total"]

    def test_models_sorted_with_fits_first(self):
        cb = build_cookbook()
        statuses = [m["status"] for m in cb["models"]]
        rank = {"fits": 0, "tight": 1, "ram_fallback": 2, "oom": 3, "unknown": 4}
        ranks = [rank[s] for s in statuses]
        assert ranks == sorted(ranks)

    def test_every_model_row_has_required_fields(self):
        cb = build_cookbook()
        required = {"provider", "model_id", "display_name", "vram_gb", "status", "reason"}
        for row in cb["models"]:
            assert required.issubset(row.keys()), f"missing fields in {row}"

    def test_score_models_consumes_detect_hardware_output(self):
        hw = detect_hardware()
        rows = score_models(hw)
        assert isinstance(rows, list)
        assert len(rows) > 0


# =============================================================================
# Endpoint surface (auth + flag gating)
# =============================================================================

class TestFlagDefault:
    def test_flag_defaults_off(self):
        """Anti-regression guardrail #1 — feature must be opt-in."""
        settings = get_settings()
        assert settings.hardware_cookbook_enabled is False


@pytest.mark.skipif(
    not _ENDPOINT_TESTABLE,
    reason="project app not constructable in this env (pre-existing get_app() returns None)",
)
class TestEndpoint:
    def test_endpoint_requires_auth(self):
        from fastapi.testclient import TestClient
        client = TestClient(_PROJECT_APP)
        response = client.get("/api/models/hardware")
        assert response.status_code == 401
