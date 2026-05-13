import asyncio
import logging
from daemons.base_daemon import BaseDaemon

logger = logging.getLogger(__name__)

class SifterDaemon(BaseDaemon):
    name = "sifter"

    async def _main_loop(self) -> None:
        if not self.settings.sifter_enabled:
            while self._running:
                await asyncio.sleep(60)
            return
        
        while self._running:
            await asyncio.sleep(60)
