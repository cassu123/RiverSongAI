# core/code_interpreter.py
#
# Open-Interpreter wrapper, exposed to the LLM as the `code_interpreter` tool.
#
# Two hard safety gates layered on top of Open-Interpreter's own confirmation:
#
#   1. CODE_INTERPRETER_ENABLED env flag — defaults to FALSE. The tool refuses
#      to execute anything until the operator flips this on explicitly. Keeps
#      the surface area dead on a fresh install.
#
#   2. interpreter.model is pinned to the local Ollama instance at boot. This
#      prevents Open-Interpreter from silently falling back to its library
#      default ("gpt-4" against OpenAI's paid API) and charging you for every
#      tool call. The pin is rebuilt on every invocation so settings changes
#      take effect without a server restart.
#
# Open-Interpreter's own auto_run=False prompt is kept as belt-and-suspenders,
# but is unreliable in a backend context (no TTY), which is why gate #1 above
# is the real guarantee.
from __future__ import annotations

import asyncio
import logging
import os

from config.settings import get_settings

logger = logging.getLogger(__name__)


def _is_enabled() -> bool:
    """Hard kill switch. Defaults to off."""
    settings = get_settings()
    if getattr(settings, "code_interpreter_enabled", None) is not None:
        return bool(settings.code_interpreter_enabled)
    return os.getenv("CODE_INTERPRETER_ENABLED",
                     "false").strip().lower() in ("1", "true", "yes")


async def run_code(code: str) -> str:
    """Run Python via Open-Interpreter against the local Ollama instance."""
    if not _is_enabled():
        return (
            "code_interpreter is disabled. Set CODE_INTERPRETER_ENABLED=true in .env "
            "to opt in. While disabled, no code is executed and no LLM is called."
        )

    try:
        from interpreter import interpreter
    except ImportError:
        return "Error: open-interpreter is not installed."

    settings = get_settings()
    ollama_base = getattr(
        settings,
        "ollama_base_url",
        "http://localhost:11434")
    local_model = getattr(settings, "llm_model", "llama3.2:3b")

    # Pin to local Ollama every call so a settings reload propagates without
    # requiring a server restart, AND so we never inherit a stale paid-model
    # config from a prior import.
    interpreter.auto_run = False
    interpreter.offline = True
    interpreter.llm.model = f"ollama/{local_model}"
    interpreter.llm.api_base = ollama_base
    interpreter.llm.api_key = "ollama"  # placeholder; Ollama ignores it

    def _run() -> str:
        try:
            result = interpreter.chat(code)
        except Exception as exc:
            return f"Error executing code: {exc}"
        output = ""
        for msg in result:
            if msg.get("role") == "computer" and msg.get("content"):
                output += msg["content"] + "\n"
        return output.strip() or "Code executed (no output)."

    try:
        return await asyncio.to_thread(_run)
    except Exception as exc:
        logger.error("Open Interpreter failed: %s", exc)
        return f"Error executing code: {exc}"
