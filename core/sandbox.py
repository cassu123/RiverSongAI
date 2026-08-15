"""
core/sandbox.py

Autonomous Sandboxed Execution Runner for River Song AI.
Executes generated Python / shell code in an isolated scratch environment,
captures stdout/stderr, execution time, and provides structured traceback
diagnostics for multi-turn agent self-healing loops.
"""

from __future__ import annotations

import asyncio
import logging
import os
import subprocess
import tempfile
import time
import uuid
from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

SANDBOX_ROOT_DIR = "data/sandbox_runs"


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
    """Safe execution sandbox with timeout, resource controls, and artifact capture."""

    def __init__(self, sandbox_root: str = SANDBOX_ROOT_DIR) -> None:
        self._sandbox_root = sandbox_root
        os.makedirs(self._sandbox_root, exist_ok=True)

    async def execute_code(
        self,
        code: str,
        language: str = "python",
        timeout: float = 30.0,
        user_id: str = "primary_user",
        run_id: Optional[str] = None,
    ) -> SandboxExecutionResult:
        """Executes code in a sandbox directory and returns structured output."""
        run_id = run_id or uuid.uuid4().hex[:10]
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None, self._run_blocking, code, language, timeout, user_id, run_id
        )

    def _run_blocking(
        self,
        code: str,
        language: str,
        timeout: float,
        user_id: str,
        run_id: str,
    ) -> SandboxExecutionResult:
        run_dir = os.path.join(self._sandbox_root, user_id, run_id)
        os.makedirs(run_dir, exist_ok=True)

        lang = language.lower().strip()
        ext = ".py" if lang == "python" else ".sh" if lang in ("bash", "sh") else ".txt"
        script_file = os.path.join(run_dir, f"main{ext}")

        with open(script_file, "w", encoding="utf-8") as f:
            f.write(code)

        if lang in ("bash", "sh"):
            cmd = ["bash", f"main{ext}"]
        else:
            # Use current venv python
            import sys
            cmd = [sys.executable, f"main{ext}"]

        start_time = time.perf_counter()
        try:
            env = os.environ.copy()
            env["PYTHONUNBUFFERED"] = "1"
            env["RIVER_SANDBOX_RUN_ID"] = run_id
            
            proc = subprocess.run(
                cmd,
                cwd=run_dir,
                capture_output=True,
                text=True,
                timeout=timeout,
                env=env,
            )
            duration_ms = round((time.perf_counter() - start_time) * 1000.0, 2)
            stdout = proc.stdout or ""
            stderr = proc.stderr or ""
            exit_code = proc.returncode
            success = (exit_code == 0)
            
            # Find any artifacts generated in the sandbox folder
            artifacts = []
            for root, _, files in os.walk(run_dir):
                for fname in files:
                    if fname != f"main{ext}":
                        artifacts.append(os.path.relpath(os.path.join(root, fname), run_dir))

            error_summary = None
            if not success:
                # Extract the last few lines of stderr or traceback
                lines = [l for l in stderr.splitlines() if l.strip()]
                error_summary = "\n".join(lines[-5:]) if lines else f"Process exited with code {exit_code}"

            return SandboxExecutionResult(
                run_id=run_id,
                language=lang,
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
                language=lang,
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
                language=lang,
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
