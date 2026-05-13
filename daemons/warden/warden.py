import asyncio
from daemons.base_daemon import BaseDaemon

class WardenDaemon(BaseDaemon):
    name = "warden"

    async def _main_loop(self):
        while self._running:
            await asyncio.sleep(60)
