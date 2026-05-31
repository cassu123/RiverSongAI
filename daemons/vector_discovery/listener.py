import asyncio
import logging
import time
import socket
from typing import Dict, Tuple
from daemons.base_daemon import BaseDaemon
from providers.memory.sqlite_store import SQLiteStore
from zeroconf.asyncio import AsyncServiceBrowser, AsyncZeroconf
from zeroconf import ServiceStateChange

logger = logging.getLogger(__name__)

class VectorDiscoveryDaemon(BaseDaemon):
    name = "vector_discovery"

    def __init__(self):
        super().__init__()
        self.zeroconf = None
        self.browser = None
        self._discovered: Dict[str, Tuple[float, str, int]] = {}
        self.store = SQLiteStore()

    async def _handle_task(self, action: str, payload: dict) -> dict:
        if action == "get_discovered":
            await self.store.initialize()
            claimed_units = {u["unit_id"] for u in await self.store.get_vector_units()}
            res = []
            for uid, (ts, ip, proto) in self._discovered.items():
                if uid not in claimed_units:
                    res.append({"unit_id": uid, "last_seen_ts": ts, "ip_address": ip, "proto_version": proto})
            return {"discovered": res}
        return {"error": f"unknown action {action}"}

    def on_service_state_change(self, zeroconf, service_type, name, state_change):
        if state_change is ServiceStateChange.Added or state_change is ServiceStateChange.Updated:
            info = zeroconf.get_service_info(service_type, name)
            if info:
                props = {k.decode('utf-8'): v.decode('utf-8') for k, v in info.properties.items()}
                unit_id = props.get("unit_id")
                proto_version = int(props.get("proto_version", 1))
                if unit_id and info.parsed_addresses():
                    try:
                        ip_address = socket.inet_ntoa(info.parsed_addresses()[0])
                    except:
                        ip_address = "unknown"
                    self._discovered[unit_id] = (time.time(), ip_address, proto_version)

    async def _main_loop(self):
        logger.info("VectorDiscoveryDaemon starting mDNS listener")
        self.zeroconf = AsyncZeroconf()
        self.browser = AsyncServiceBrowser(self.zeroconf.zeroconf, "_rivervector._tcp.local.", handlers=[self.on_service_state_change])
        
        while self._running:
            now = time.time()
            expired = [uid for uid, (ts, _, _) in self._discovered.items() if now - ts > 60]
            for uid in expired:
                del self._discovered[uid]
            await asyncio.sleep(10)
        
        await self.browser.async_cancel()
        await self.zeroconf.async_close()
