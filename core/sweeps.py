import asyncio
import logging
import random
from datetime import datetime, timezone
from typing import Callable, Coroutine, Any, Dict, List
from pydantic import BaseModel

logger = logging.getLogger(__name__)

class SweepDefinition(BaseModel):
    name: str
    interval_seconds: int
    func: Callable[[], Coroutine[Any, Any, Any]]

_REGISTRY: Dict[str, SweepDefinition] = {}
_RUNNING_TASK = None

def register_sweep(name: str, interval_seconds: int, func: Callable[[], Coroutine[Any, Any, Any]]):
    if name in _REGISTRY:
        logger.warning(f"Sweep {name} is already registered. Overwriting.")
    _REGISTRY[name] = SweepDefinition(name=name, interval_seconds=interval_seconds, func=func)

async def _sweep_loop(sweep: SweepDefinition, store):
    """Loop for an individual sweep."""
    # Staggered start jitter
    await asyncio.sleep(random.uniform(1.0, 10.0))
    
    while True:
        logger.info(f"Running sweep {sweep.name}")
        now_str = datetime.now(timezone.utc).isoformat()
        try:
            await sweep.func()
            # Update success state
            await store._execute(
                "INSERT INTO sweeps_state (name, last_run_at, last_error) VALUES (?, ?, ?) "
                "ON CONFLICT(name) DO UPDATE SET last_run_at=excluded.last_run_at, last_error=excluded.last_error",
                (sweep.name, now_str, None)
            )
        except asyncio.CancelledError:
            logger.info(f"Sweep {sweep.name} cancelled.")
            break
        except Exception as e:
            logger.error(f"Sweep {sweep.name} failed: {e}", exc_info=True)
            # Update error state
            await store._execute(
                "INSERT INTO sweeps_state (name, last_run_at, last_error) VALUES (?, ?, ?) "
                "ON CONFLICT(name) DO UPDATE SET last_run_at=excluded.last_run_at, last_error=excluded.last_error",
                (sweep.name, now_str, str(e))
            )
        
        # Sleep with 10% jitter to prevent thundering herd
        base_sleep = sweep.interval_seconds
        jitter = random.uniform(-0.1 * base_sleep, 0.1 * base_sleep)
        await asyncio.sleep(base_sleep + jitter)

async def start_sweeps(app):
    """Start all registered sweeps."""
    global _RUNNING_TASK
    if _RUNNING_TASK is not None:
        logger.warning("Sweeps are already running.")
        return
        
    store = app.state.memory_manager._store
    tasks = []
    
    for name, sweep in _REGISTRY.items():
        task = asyncio.create_task(_sweep_loop(sweep, store), name=f"sweep_{name}")
        tasks.append(task)
        
    # We create a dummy task to hold them all. Alternatively, we could just return the list of tasks.
    async def _runner():
        try:
            await asyncio.gather(*tasks)
        except asyncio.CancelledError:
            for t in tasks:
                t.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            
    _RUNNING_TASK = asyncio.create_task(_runner(), name="sweep_runner")
    return _RUNNING_TASK

async def stop_sweeps():
    """Stop all sweeps."""
    global _RUNNING_TASK
    if _RUNNING_TASK:
        _RUNNING_TASK.cancel()
        try:
            await _RUNNING_TASK
        except asyncio.CancelledError:
            pass
        _RUNNING_TASK = None

def get_registry() -> List[SweepDefinition]:
    return list(_REGISTRY.values())
