# =============================================================================
# core/hardware_cookbook.py
#
# File Purpose:
#   Detect the host's compute hardware (GPU/RAM/CPU) and score every local
#   model in LLMRegistry as a fit for that hardware. Powers the admin-only
#   Hardware Cookbook section in Settings (gated by
#   settings.hardware_cookbook_enabled).
#
#   No new dependencies. Linux stdlib only:
#     - GPU via subprocess `nvidia-smi --query-gpu=... --format=csv`
#     - RAM via /proc/meminfo
#     - CPU via platform + /proc/cpuinfo
#
# Key Functions:
#   detect_hardware() -> dict
#       Returns: {"gpus": [...], "ram_gb": {...}, "cpu": {...}, "detected_at": "..."}
#
#   score_models(hw: dict) -> list[dict]
#       Iterates LLMRegistry.list_local() and scores each model against the
#       detected hardware. Returns a list of dicts ready for the API.
#
#   build_cookbook() -> dict
#       Top-level convenience: detect + score in one call.
#
# Fit categories per model:
#   "fits"          GPU has enough free VRAM right now
#   "tight"         GPU has total VRAM but not enough free (depends on what's loaded)
#   "ram_fallback"  No GPU room; will run on CPU+RAM (slow but works)
#   "oom"           Neither GPU nor RAM can hold this model
#   "unknown"       Model has no vram_gb metadata
#
# Safety margin: 0.85 of advertised capacity to leave room for runtime overhead.
# =============================================================================

from __future__ import annotations

import logging
import os
import platform
import re
import shutil
import subprocess
from datetime import datetime, timezone
from typing import Optional

from providers.llm.registry import LLMRegistry


logger = logging.getLogger(__name__)


# Reserve 15% headroom over the model's advertised VRAM for runtime overhead
# (KV cache, activation, framework). Same convention Ollama itself uses.
_SAFETY_MARGIN = 0.85


# =============================================================================
# GPU
# =============================================================================

def _detect_nvidia_gpus() -> list[dict]:
    """Query nvidia-smi for installed NVIDIA GPUs. Empty list on any failure."""
    if shutil.which("nvidia-smi") is None:
        return []

    query = "name,memory.total,memory.free,memory.used,driver_version,compute_cap"
    try:
        result = subprocess.run(
            ["nvidia-smi", f"--query-gpu={query}",
                "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (subprocess.TimeoutExpired, OSError) as exc:
        logger.warning("nvidia-smi failed: %s", exc)
        return []

    if result.returncode != 0:
        logger.info(
            "nvidia-smi returned %s: %s",
            result.returncode,
            result.stderr.strip())
        return []

    gpus: list[dict] = []
    for idx, line in enumerate(result.stdout.strip().splitlines()):
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 6:
            continue
        try:
            gpus.append({
                "index": idx,
                "name": parts[0],
                "vram_total_gb": round(float(parts[1]) / 1024.0, 2),
                "vram_free_gb": round(float(parts[2]) / 1024.0, 2),
                "vram_used_gb": round(float(parts[3]) / 1024.0, 2),
                "driver_version": parts[4],
                "compute_capability": parts[5],
            })
        except (ValueError, IndexError) as exc:
            logger.warning("Could not parse nvidia-smi row %r: %s", line, exc)
            continue
    return gpus


# =============================================================================
# RAM
# =============================================================================

def _detect_ram() -> dict:
    """Parse /proc/meminfo for total and available RAM. Zeros on failure."""
    info: dict[str, float] = {"total_gb": 0.0, "available_gb": 0.0}
    try:
        with open("/proc/meminfo", "r", encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("MemTotal:"):
                    info["total_gb"] = round(
                        int(line.split()[1]) / (1024 * 1024), 2)
                elif line.startswith("MemAvailable:"):
                    info["available_gb"] = round(
                        int(line.split()[1]) / (1024 * 1024), 2)
                if info["total_gb"] and info["available_gb"]:
                    break
    except (OSError, ValueError, IndexError) as exc:
        logger.warning("Could not read /proc/meminfo: %s", exc)
    return info


# =============================================================================
# CPU
# =============================================================================

def _detect_cpu() -> dict:
    """Best-effort CPU model name + core count via /proc/cpuinfo and stdlib."""
    cpu = {
        "model": platform.processor() or "unknown",
        "arch": platform.machine(),
        "cores": os.cpu_count() or 0,
        "threads": os.cpu_count() or 0,
    }
    try:
        with open("/proc/cpuinfo", "r", encoding="utf-8") as fh:
            text = fh.read()
        m = re.search(r"^model name\s*:\s*(.+)$", text, re.MULTILINE)
        if m:
            cpu["model"] = m.group(1).strip()
        physical_ids = set(
            re.findall(
                r"^physical id\s*:\s*(\d+)$",
                text,
                re.MULTILINE))
        core_counts = re.findall(
            r"^cpu cores\s*:\s*(\d+)$", text, re.MULTILINE)
        if physical_ids and core_counts:
            cpu["cores"] = int(core_counts[0]) * len(physical_ids)
    except (OSError, ValueError) as exc:
        logger.debug("Could not enrich CPU info from /proc/cpuinfo: %s", exc)
    return cpu


# =============================================================================
# Public API
# =============================================================================

def detect_hardware() -> dict:
    """
    Snapshot the host's compute hardware.

    Returns a dict with keys: gpus, ram_gb, cpu, detected_at.
    All keys are always present; sub-fields are populated best-effort.
    """
    return {
        "gpus": _detect_nvidia_gpus(),
        "ram_gb": _detect_ram(),
        "cpu": _detect_cpu(),
        "detected_at": datetime.now(timezone.utc).isoformat(),
    }


def _score_one(vram_gb: Optional[float], gpu_free: float,
               gpu_total: float, ram_avail: float) -> tuple[str, str]:
    """
    Decide a fit category + human reason for one model.

    Returns (status, reason). Status is one of:
      fits | tight | ram_fallback | oom | unknown
    """
    if vram_gb is None:
        return "unknown", "Model has no VRAM estimate in the registry."

    if gpu_total > 0 and vram_gb <= gpu_free * _SAFETY_MARGIN:
        return "fits", f"GPU has {gpu_free:.1f} GB free; model needs ~{vram_gb:.1f} GB."

    if gpu_total > 0 and vram_gb <= gpu_total * _SAFETY_MARGIN:
        return "tight", (
            f"GPU has {
                gpu_total:.1f} GB total but only {
                gpu_free:.1f} GB free; "
            "another process must release VRAM first."
        )

    if vram_gb <= ram_avail * _SAFETY_MARGIN:
        return "ram_fallback", (
            f"Too large for GPU; will run on CPU+RAM ({
                ram_avail:.1f} GB available). "
            "Expect ~2–10 tokens/s."
        )

    return "oom", (
        f"Model needs ~{vram_gb:.1f} GB; neither GPU ({gpu_total:.1f} GB) "
        f"nor RAM ({ram_avail:.1f} GB) can hold it."
    )


def score_models(hw: dict) -> list[dict]:
    """
    Score every local LLMRegistry entry against the detected hardware.

    Sorted by status (fits → tight → ram_fallback → oom → unknown), then by
    the model's existing registry priority. Each row is JSON-friendly.
    """
    gpus = hw.get("gpus") or []
    gpu_total = max((g["vram_total_gb"] for g in gpus), default=0.0)
    gpu_free = max((g["vram_free_gb"] for g in gpus), default=0.0)
    ram_avail = float((hw.get("ram_gb") or {}).get("available_gb") or 0.0)

    rank = {"fits": 0, "tight": 1, "ram_fallback": 2, "oom": 3, "unknown": 4}

    rows: list[dict] = []
    for entry in LLMRegistry.list_local():
        status, reason = _score_one(
            entry.vram_gb, gpu_free, gpu_total, ram_avail)
        rows.append({
            "provider": entry.provider,
            "model_id": entry.model_id,
            "display_name": entry.display_name,
            "vram_gb": entry.vram_gb,
            "context_window": entry.context_window,
            "status": status,
            "reason": reason,
            "priority": entry.priority,
        })

    rows.sort(key=lambda r: (rank.get(r["status"], 99), r["priority"]))
    return rows


def build_cookbook() -> dict:
    """One-shot: detect hardware and score every local model against it."""
    hw = detect_hardware()
    rows = score_models(hw)
    summary = {
        "fits": sum(1 for r in rows if r["status"] == "fits"),
        "tight": sum(1 for r in rows if r["status"] == "tight"),
        "ram_fallback": sum(1 for r in rows if r["status"] == "ram_fallback"),
        "oom": sum(1 for r in rows if r["status"] == "oom"),
        "unknown": sum(1 for r in rows if r["status"] == "unknown"),
        "total": len(rows),
    }
    return {
        "hardware": hw,
        "models": rows,
        "summary": summary,
    }
