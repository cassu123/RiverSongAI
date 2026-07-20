import logging
import asyncio
from typing import Any, List, Dict, Callable

logger = logging.getLogger(__name__)

MAX_TOOL_STEPS = 6
TOOL_TIMEOUT = 30.0

async def run_agent_loop(
    llm: Any,
    history: List[Dict[str, Any]],
    active_tools: List[Dict[str, Any]],
    execute_tool_fn: Callable,
    on_event: Callable,
    append_history_fn: Callable,
    user_id: str,
    session_id: str = "",
    tool_system_prompt: str = "",
    tool_context: Dict[str, Any] = None
) -> str:
    """
    Runs the multi-step tool execution loop.
    Returns the final buffered text if the LLM provided it, so the caller can emit it.
    If no tools were run and the LLM doesn't buffer, returns an empty string.
    """
    if not hasattr(llm, "chat_with_tools"):
        return ""

    receipts = []
    
    def get_messages():
        msgs = history.copy()
        if msgs and msgs[0].get("role") == "system" and tool_system_prompt:
            msgs[0] = msgs[0].copy()
            msgs[0]["content"] += f"\n\n{tool_system_prompt}"
        return msgs
    
    for step in range(MAX_TOOL_STEPS):
        try:
            res = await llm.chat_with_tools(get_messages(), active_tools)
        except Exception as e:
            logger.error("LLM chat_with_tools failed: %s", e)
            break
            
        if res.get("type") != "tool_call":
            # If we used tools, or even if we didn't, we might have buffered content
            if receipts:
                await on_event({"type": "receipt", "items": receipts})
            return res.get("content", "")
            
        tool_name = res["tool_name"]
        tool_input = res["tool_input"]
        tool_id = res.get("tool_use_id")
        
        logger.info("Agent loop step %d: calling tool %s", step, tool_name)
        await on_event({"type": "tool_use", "tool": tool_name, "input": tool_input})
        
        ok = False
        try:
            ctx = {"user_id": user_id, "session_id": session_id}
            if tool_context:
                ctx.update(tool_context)
                
            result_text = await asyncio.wait_for(
                execute_tool_fn(tool_name, tool_input, ctx),
                timeout=TOOL_TIMEOUT
            )
            ok = True
        except asyncio.TimeoutError:
            result_text = f"Error: Tool {tool_name} timed out after {TOOL_TIMEOUT} seconds."
            logger.warning(result_text)
        except Exception as e:
            result_text = f"Error executing {tool_name}: {e}"
            logger.error(result_text)
            
        await on_event({"type": "tool_result", "tool": tool_name, "result": result_text})
        
        if llm.__class__.__name__ == "ClaudeAPILLM":
            await append_history_fn("assistant", [{"type": "tool_use", "id": tool_id, "name": tool_name, "input": tool_input}])
            await append_history_fn("user", [{"type": "tool_result", "tool_use_id": tool_id, "content": result_text}])
        else:
            await append_history_fn("assistant", "", {"tool_calls": [{"function": {"name": tool_name, "arguments": tool_input}}]})
            await append_history_fn("tool", result_text)
            
        receipts.append({"tool": tool_name, "summary": str(result_text)[:100], "ok": ok})

    if receipts:
        await on_event({"type": "receipt", "items": receipts})
        
    return ""
