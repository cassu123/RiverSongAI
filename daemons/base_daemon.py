import asyncio
import base64
import logging
from abc import ABC, abstractmethod
from datetime import datetime, timezone

import httpx
import uvicorn
from fastapi import FastAPI, Request
from pydantic import BaseModel

from config.settings import get_settings

logger = logging.getLogger(__name__)

class TaskRequest(BaseModel):
    action: str
    payload: dict = {}

class BaseDaemon(ABC):
    """
    Abstract base class for all River Song AI daemons.
    Provides heartbeat, task server, and main loop infrastructure.
    """
    name: str = "base"

    def __init__(self):
        self.settings = get_settings()
        self._running = False
        # Deriving port: settings.daemon_{name}_port
        attr_name = f"daemon_{self.name}_port"
        self.internal_port = getattr(self.settings, attr_name, 8010)

    async def start(self):
        """Starts the daemon loops concurrently."""
        self._running = True
        logger.info(f"Daemon '{self.name}' starting on internal port {self.internal_port}...")
        
        try:
            await asyncio.gather(
                self._heartbeat_loop(),
                self._task_server(),
                self._main_loop()
            )
        except asyncio.CancelledError:
            logger.info(f"Daemon '{self.name}' shutting down...")
        finally:
            self._running = False

    def stop(self):
        """Gracefully stops the daemon."""
        self._running = False

    async def _heartbeat_loop(self):
        """Sends periodic heartbeats to the main application."""
        while self._running:
            try:
                async with httpx.AsyncClient() as client:
                    payload = {
                        "name": self.name,
                        "status": "alive",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "port": self.internal_port
                    }
                    headers = {
                        "Authorization": f"Bearer {self.settings.daemon_internal_secret}"
                    }
                    # POST to main app's daemon heartbeat endpoint
                    url = f"http://127.0.0.1:{self.settings.app_port}/api/daemon/heartbeat"
                    await client.post(url, json=payload, headers=headers, timeout=5.0)
            except Exception as e:
                # Silently swallow all heartbeat exceptions
                logger.debug(f"Heartbeat failed for {self.name}: {e}")
            
            await asyncio.sleep(30)

    async def _task_server(self):
        """Runs a minimal internal FastAPI server for handling tasks."""
        app = FastAPI(title=f"River Song Daemon - {self.name}")

        @app.post("/task")
        async def task_handler(req: TaskRequest):
            return await self._handle_task(req.action, req.payload)

        config = uvicorn.Config(
            app, 
            host="127.0.0.1", 
            port=self.internal_port, 
            log_level="warning"
        )
        server = uvicorn.Server(config)
        
        # Run server while _running is True
        while self._running:
            await server.serve()
            if not self._running:
                break
            await asyncio.sleep(1)

    @abstractmethod
    async def _main_loop(self):
        """Core logic for the specific daemon. Overridden by subclasses."""
        while self._running:
            await asyncio.sleep(60)

    async def _handle_task(self, action: str, payload: dict) -> dict:
        """Handles incoming internal task requests. Overridden by subclasses."""
        return {"status": "unknown_action", "action": action}
