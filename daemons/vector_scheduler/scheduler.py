import asyncio
import logging
from datetime import datetime, timezone
import json
import uuid
import os
import httpx
from croniter import croniter

from daemons.base_daemon import BaseDaemon
from providers.memory.sqlite_store import SQLiteStore

logger = logging.getLogger(__name__)

class VectorSchedulerDaemon(BaseDaemon):
    name = "vector_scheduler"

    def __init__(self):
        super().__init__()
        self.store = SQLiteStore()

    async def _main_loop(self):
        logger.info("VectorSchedulerDaemon starting scheduler loop")
        await self.store.initialize()
        
        while self._running:
            try:
                await self._tick()
            except Exception as e:
                logger.error(f"Scheduler tick error: {e}")
            await asyncio.sleep(60)

    async def _wake_queue(self, unit_id: str):
        try:
            async with httpx.AsyncClient() as client:
                url = f"http://localhost:{self.settings.app_port}/api/vector/internal/wake/{unit_id}"
                headers = {"Authorization": f"Bearer {self.settings.daemon_internal_secret}"}
                await client.post(url, headers=headers, timeout=5.0)
        except Exception as e:
            logger.error(f"Failed to wake queue for {unit_id}: {e}")

    async def _tick(self):
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        schedules = await self.store.get_active_schedules()
        
        for s in schedules:
            next_run_str = s.get("next_run")
            if next_run_str:
                next_run_dt = datetime.fromisoformat(next_run_str)
                if next_run_dt <= now:
                    program = await self.store.execute_read_one_async("SELECT assigned_unit_id FROM vector_programs WHERE program_id=?", (s["program_id"],))
                    if program and program.get("assigned_unit_id"):
                        unit_id = program["assigned_unit_id"]
                        
                        idempotency_key = f"schedule:{s['schedule_id']}:{now.strftime('%Y%m%d%H%M')}"
                        existing = await self.store.execute_read_one_async("SELECT 1 FROM vector_commands WHERE idempotency_key=?", (idempotency_key,))
                        if not existing:
                            cmd_id = uuid.uuid4().hex
                            sql = "INSERT INTO vector_commands (command_id, unit_id, issued_by, issued_at, idempotency_key, action, params) VALUES (?, ?, ?, ?, ?, ?, ?)"
                            await self.store.execute_write_async(sql, (cmd_id, unit_id, f"schedule:{s['schedule_id']}", now.isoformat(), idempotency_key, "mow_start", json.dumps({"program_id": s["program_id"]})))
                            await self._wake_queue(unit_id)
                            
                    cron = croniter(s["cron_utc"], now)
                    new_next_run = cron.get_next(datetime)
                    await self.store.update_schedule(s["schedule_id"], now.isoformat(), new_next_run.isoformat())
                    
        if now.minute == 0:
            units = await self.store.get_vector_units()
            retention_days = int(os.getenv("VECTOR_TELEMETRY_RETENTION_DAYS", "90"))
            for u in units:
                await self.store.prune_telemetry(u["unit_id"], retention_days)
