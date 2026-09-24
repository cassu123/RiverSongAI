"""
TurnRunner: one conversation turn at a time, cancellable as a whole.

The voice socket used to start spoken turns as untracked background tasks,
and "interrupt" only cancelled the LLM generation inside them. A stop that
arrived while speech was still being transcribed, or before the reply
started, was ignored, and River answered anyway. Typed turns were worse:
they ran inline in the socket's receive loop, so an interrupt was not even
read until the reply had finished.

Every turn now runs here. cancel() stops the whole turn (transcription,
routing, generation, speech) and waits for it to unwind; starting a new turn
cancels any turn still running.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable, Coroutine, Optional

logger = logging.getLogger(__name__)


class TurnRunner:
    def __init__(
        self,
        send: Callable[[dict], Awaitable[Any]],
        streaming_enabled: Callable[[], bool],
        on_cancel: Callable[[], None] = lambda: None,
    ) -> None:
        self._send = send
        self._streaming_enabled = streaming_enabled
        self._on_cancel = on_cancel
        self._task: Optional[asyncio.Task] = None
        self._turn: Optional[Coroutine[Any, Any, Any]] = None

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    async def start(self, turn: Coroutine[Any, Any, Any]) -> asyncio.Task:
        """Run `turn`, first stopping any turn still in progress."""
        await self.cancel()
        self._turn = turn
        self._task = asyncio.create_task(self._run(turn))
        return self._task

    async def _run(self, turn: Coroutine[Any, Any, Any]) -> None:
        try:
            await turn
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.error("Turn failed: %s", exc)
        if self._streaming_enabled():
            await self._send({"type": "stream_done"})

    async def cancel(self) -> None:
        """Stop the running turn, if any, and wait until it has stopped."""
        self._on_cancel()
        task, self._task = self._task, None
        turn, self._turn = self._turn, None
        if task is not None and not task.done():
            task.cancel()
            # asyncio.wait, not `await task`: a task cancelled before it
            # started re-raises CancelledError, which would cancel the caller.
            await asyncio.wait({task})
        if turn is not None:
            # A turn cancelled before it ever ran would otherwise be reported
            # as "coroutine was never awaited". Closing a finished one is a
            # no-op.
            turn.close()
