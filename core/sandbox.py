"""
core/sandbox.py

Resource-Limited Python Process Runner for River Song AI.

Executes generated Python code in an isolated temporary directory with:
  1. Strict Environment Allowlist — ZERO inheritance from server os.environ.
     Secrets, tokens, API keys, and database credentials are never accessible.
  2. POSIX Resource Limits (rlimits) — CPU time, virtual memory, process count,
     file sizes, and open descriptors are hard-capped per execution.
  3. Python-Only Execution — Shell/bash scripts are rejected.
  4. Hard Safety Gate — SANDBOX_ENABLED env flag (defaults to False).
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import resource
import subprocess
import sys
import time
import uuid
from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Optional

from config.settings import get_settings

logger = logging.getLogger(__name__)

SANDBOX_ROOT_DIR = "data/sandbox_runs"
MAX_TIMEOUT_SECONDS = 30.0
MAX_MEMORY_MB = 256
MAX_FILE_SIZE_MB = 5


def _is_enabled() -> bool:
    """Hard kill switch. Defaults to False."""
    settings = get_settings()
    return bool(getattr(settings, "sandbox_enabled", False))


@dataclass
class SandboxExecutionResult:
    run_id: str
    language: str
    code: str
    exit_code: int
    stdout: str
    stderr: str
    duration_ms: float
    success: bool
    artifacts: List[str]
    error_summary: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class SandboxRunner:
    """Resource-limited Python subprocess runner with strict environment scrubbing."""

    def __init__(self, sandbox_root: str = SANDBOX_ROOT_DIR) -> None:
        self._sandbox_root = sandbox_root
        os.makedirs(self._sandbox_root, exist_ok=True)

    async def execute_code(
        self,
        code: str,
        language: str = "python",
        timeout: float = 10.0,
        user_id: str = "primary_user",
        run_id: Optional[str] = None,
    ) -> SandboxExecutionResult:
        """Executes Python code under rlimits and clean environment."""
        if not _is_enabled():
            return SandboxExecutionResult(
                run_id=run_id or uuid.uuid4().hex[:10],
                language=language,
                code=code,
                exit_code=-1,
                stdout="",
                stderr="Sandbox code execution is disabled. Set SANDBOX_ENABLED=true in .env or Admin Settings to enable.",
                duration_ms=0.0,
                success=False,
                artifacts=[],
                error_summary="Sandbox execution disabled by administrator policy.",
            )

        lang = language.lower().strip()
        if lang not in ("python", "python3", "py"):
            return SandboxExecutionResult(
                run_id=run_id or uuid.uuid4().hex[:10],
                language=language,
                code=code,
                exit_code=-1,
                stdout="",
                stderr=f"Unsupported language '{language}'. Only Python is permitted under resource controls.",
                duration_ms=0.0,
                success=False,
                artifacts=[],
                error_summary="Rejected: non-Python execution not permitted.",
            )

        safe_run_id = re.sub(r"[^a-zA-Z0-9_-]", "", run_id or uuid.uuid4().hex[:10])
        safe_user_id = re.sub(r"[^a-zA-Z0-9_-]", "", user_id) or "primary_user"
        bounded_timeout = max(1.0, min(float(timeout), MAX_TIMEOUT_SECONDS))

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None,
            self._run_blocking,
            code,
            bounded_timeout,
            safe_user_id,
            safe_run_id,
        )

    def _run_blocking(
        self,
        code: str,
        timeout: float,
        user_id: str,
        run_id: str,
    ) -> SandboxExecutionResult:
        run_dir = os.path.join(self._sandbox_root, user_id, run_id)
        os.makedirs(run_dir, exist_ok=True)

        script_file = os.path.join(run_dir, "main.py")
        with open(script_file, "w", encoding="utf-8") as f:
            f.write(code)

        # ---------------------------------------------------------------------
        # 1. Environment Scrubbing (Strict Allowlist — ZERO host secrets)
        # ---------------------------------------------------------------------
        clean_env = {
            "PATH": "/usr/local/bin:/usr/bin:/bin",
            "LANG": "en_US.UTF-8",
            "LC_ALL": "en_US.UTF-8",
            "TMPDIR": run_dir,
            "HOME": run_dir,
            "PYTHONUNBUFFERED": "1",
            "PYTHONDONTWRITEBYTECODE": "1",
            "RIVER_SANDBOX_RUN_ID": run_id,
        }

        # ---------------------------------------------------------------------
        # 2. POSIX Resource Limits (rlimits)
        # ---------------------------------------------------------------------
        def _apply_rlimits():
            try:
                # CPU time limit in seconds
                cpu_sec = max(1, int(timeout))
                resource.setrlimit(resource.RLIMIT_CPU, (cpu_sec, cpu_sec + 1))
                
                # Max virtual memory (Address Space)
                mem_bytes = MAX_MEMORY_MB * 1024 * 1024
                resource.setrlimit(resource.RLIMIT_AS, (mem_bytes, mem_bytes))
                
                # Max output file size
                fsize_bytes = MAX_FILE_SIZE_MB * 1024 * 1024
                resource.setrlimit(resource.RLIMIT_FSIZE, (fsize_bytes, fsize_bytes))
                
                # Max open file descriptors
                resource.setrlimit(resource.RLIMIT_NOFILE, (32, 32))
                
                # Max child processes / threads
                resource.setrlimit(resource.RLIMIT_NPROC, (16, 16))
            except Exception as e:
                logger.warning("Could not set rlimits for sandbox run %s: %s", run_id, e)

        start_time = time.perf_counter()
        try:
            proc = subprocess.run(
                [sys.executable, "main.py"],
                cwd=run_dir,
                capture_output=True,
                text=True,
                timeout=timeout,
                env=clean_env,
                preexec_fn=_apply_rlimits,
            )
            duration_ms = round((time.perf_counter() - start_time) * 1000.0, 2)
            stdout = proc.stdout or ""
            stderr = proc.stderr or ""
            exit_code = proc.returncode
            success = (exit_code == 0)

            # Discover generated artifacts (excluding script file)
            artifacts = []
            for root, _, files in os.walk(run_dir):
                for fname in files:
                    if fname != "main.py":
                        artifacts.append(os.path.relpath(os.path.join(root, fname), run_dir))

            error_summary = None
            if not success:
                lines = [l for l in stderr.splitlines() if l.strip()]
                error_summary = "\n".join(lines[-5:]) if lines else f"Process exited with code {exit_code}"

            return SandboxExecutionResult(
                run_id=run_id,
                language="python",
                code=code,
                exit_code=exit_code,
                stdout=stdout,
                stderr=stderr,
                duration_ms=duration_ms,
                success=success,
                artifacts=artifacts,
                error_summary=error_summary,
            )
        except subprocess.TimeoutExpired as exc:
            duration_ms = round((time.perf_counter() - start_time) * 1000.0, 2)
            return SandboxExecutionResult(
                run_id=run_id,
                language="python",
                code=code,
                exit_code=-1,
                stdout=exc.stdout or "",
                stderr=exc.stderr or f"Execution timed out after {timeout} seconds.",
                duration_ms=duration_ms,
                success=False,
                artifacts=[],
                error_summary=f"TimeoutExpired: Execution exceeded {timeout}s limit.",
            )
        except Exception as exc:
            duration_ms = round((time.perf_counter() - start_time) * 1000.0, 2)
            return SandboxExecutionResult(
                run_id=run_id,
                language="python",
                code=code,
                exit_code=-1,
                stdout="",
                stderr=str(exc),
                duration_ms=duration_ms,
                success=False,
                artifacts=[],
                error_summary=f"Execution error: {exc}",
            )


_DEFAULT_SANDBOX_RUNNER: Optional[SandboxRunner] = None


def get_sandbox_runner() -> SandboxRunner:
    global _DEFAULT_SANDBOX_RUNNER
    if _DEFAULT_SANDBOX_RUNNER is None:
        _DEFAULT_SANDBOX_RUNNER = SandboxRunner()
    return _DEFAULT_SANDBOX_RUNNER
