"""
core/sandbox.py

Resource-Limited Python Process Runner for River Song AI.

Executes generated Python code in an isolated temporary directory with:
  1. Strict Environment Allowlist — Zero leakage via environment variables.
     Host process secrets, tokens, API keys, and database credentials are
     never present in the child environment.
  2. POSIX Resource Limits (rlimits) — CPU time, virtual memory, file sizes,
     and open descriptors are hard-capped via a child bootstrap before user code runs.
     If limit setup fails, execution fails closed immediately.
  3. Process Group Isolation & Orphan Reaping — Child processes are launched in
     their own session/process group (`start_new_session=True`). On timeout,
     `os.killpg` reaps the entire process group to prevent background orphans.
  4. Python-Only Execution — Shell/bash scripts are rejected.
  5. Hard Safety Gate — SANDBOX_ENABLED env flag (defaults to False).

⚠️ Security Boundary Note:
  Subprocesses execute as the host server's OS user. While environment secrets
  are scrubbed, CPU/RAM/file sizes are restricted, and process groups are reaped,
  this runner does NOT provide kernel containerization, filesystem jail, or
  network namespace isolation.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import signal
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
MAX_MEMORY_MB = 512
MAX_FILE_SIZE_MB = 10

_BOOTSTRAP_CODE = """# Auto-generated resource-limiting bootstrap
import resource
import runpy
import sys

# 1. Parse and apply hard resource limits.
# If any call fails, this script raises and terminates immediately (fail closed).
cpu_sec = int(sys.argv[1])
mem_mb = int(sys.argv[2])
fsize_mb = int(sys.argv[3])

# CPU time limit (seconds)
resource.setrlimit(resource.RLIMIT_CPU, (cpu_sec, cpu_sec + 1))

# Virtual memory limit (Address Space)
mem_bytes = mem_mb * 1024 * 1024
resource.setrlimit(resource.RLIMIT_AS, (mem_bytes, mem_bytes))

# Max output file size (bytes)
fsize_bytes = fsize_mb * 1024 * 1024
resource.setrlimit(resource.RLIMIT_FSIZE, (fsize_bytes, fsize_bytes))

# Max open file descriptors
resource.setrlimit(resource.RLIMIT_NOFILE, (32, 32))

# 2. Shift sys.argv so user script sees clean arguments
sys.argv = ["main.py"]

# 3. Execute target script
runpy.run_path("main.py", run_name="__main__")
"""


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
        """Executes Python code under child-enforced rlimits and clean environment."""
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
        bootstrap_file = os.path.join(run_dir, "_bootstrap.py")

        with open(script_file, "w", encoding="utf-8") as f:
            f.write(code)

        with open(bootstrap_file, "w", encoding="utf-8") as f:
            f.write(_BOOTSTRAP_CODE)

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
        # 2. Child Bootstrap Execution (Process Group Leader + Timeout Reaping)
        # ---------------------------------------------------------------------
        cmd = [
            sys.executable,
            "_bootstrap.py",
            str(max(1, int(timeout))),
            str(MAX_MEMORY_MB),
            str(MAX_FILE_SIZE_MB),
        ]

        start_time = time.perf_counter()
        proc: Optional[subprocess.Popen] = None
        stdout, stderr = "", ""
        exit_code = -1
        timed_out = False

        try:
            proc = subprocess.Popen(
                cmd,
                cwd=run_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=clean_env,
                start_new_session=True,  # Creates a distinct process group for clean subtree reaping
            )
            stdout, stderr = proc.communicate(timeout=timeout + 1.0)
            exit_code = proc.returncode
        except subprocess.TimeoutExpired:
            timed_out = True
            # Kill the process group FIRST so pipes close immediately and communicate returns partial output without blocking
            if proc is not None:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    pass
            try:
                out_bytes, err_bytes = proc.communicate(timeout=2.0)
                stdout = out_bytes or ""
                stderr = err_bytes or f"Execution timed out after {timeout} seconds."
            except Exception:
                stdout, stderr = "", f"Execution timed out after {timeout} seconds."
        except Exception as exc:
            stderr = str(exc)
        finally:
            # Symmetrically reap the entire process group across all exit paths (success, timeout, error)
            if proc is not None:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    pass

        duration_ms = round((time.perf_counter() - start_time) * 1000.0, 2)
        stdout = stdout or ""
        stderr = stderr or ""

        if timed_out:
            return SandboxExecutionResult(
                run_id=run_id,
                language="python",
                code=code,
                exit_code=-1,
                stdout=stdout,
                stderr=stderr,
                duration_ms=duration_ms,
                success=False,
                artifacts=[],
                error_summary=f"TimeoutExpired: Execution exceeded {timeout}s limit.",
            )

        success = (exit_code == 0)

        # Discover generated artifacts (excluding script and bootstrap files)
        artifacts = []
        for root, _, files in os.walk(run_dir):
            for fname in files:
                if fname not in ("main.py", "_bootstrap.py"):
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


_DEFAULT_SANDBOX_RUNNER: Optional[SandboxRunner] = None


def get_sandbox_runner() -> SandboxRunner:
    global _DEFAULT_SANDBOX_RUNNER
    if _DEFAULT_SANDBOX_RUNNER is None:
        _DEFAULT_SANDBOX_RUNNER = SandboxRunner()
    return _DEFAULT_SANDBOX_RUNNER
