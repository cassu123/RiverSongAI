import asyncio
import logging
from typing import Optional
from datetime import datetime, timezone

from daemons.base_daemon import BaseDaemon

logger = logging.getLogger(__name__)

class MechanicDaemon(BaseDaemon):
    """
    MAVLink telemetry daemon for the ArduRover lawn mower.
    """
    name = "mechanic"

    def __init__(self):
        super().__init__()
        self._telemetry: dict = {
            "lat": None, "lon": None,
            "battery_v": None, "battery_pct": None,
            "mode": "UNKNOWN", "armed": False,
            "speed_ms": 0.0, "heading": 0.0,
            "mission_current": 0, "mission_total": 0,
            "last_heartbeat": None,
        }
        self._mav = None

    async def _main_loop(self) -> None:
        if not self.settings.mechanic_enabled:
            logger.info("Mechanic: disabled in settings. Idle loop started.")
            while self._running:
                await asyncio.sleep(60)
            return

        logger.info("Mechanic: connecting to MAVLink on %s @ %d baud",
                    self.settings.mavlink_serial_port, self.settings.mavlink_baud_rate)
        
        while self._running:
            try:
                await self._mavlink_loop()
            except Exception as e:
                logger.warning("Mechanic: MAVLink loop crashed (%s). Reconnecting in 10s.", e)
                await asyncio.sleep(10)

    async def _mavlink_loop(self) -> None:
        from pymavlink import mavutil
        import asyncio
        
        loop = asyncio.get_running_loop()
        
        # Connect in executor (blocking)
        mav = await loop.run_in_executor(
            None,
            lambda: mavutil.mavlink_connection(
                self.settings.mavlink_serial_port,
                baud=self.settings.mavlink_baud_rate,
            )
        )
        
        # Wait for first heartbeat
        await loop.run_in_executor(None, lambda: mav.wait_heartbeat(timeout=30))
        logger.info("Mechanic: MAVLink heartbeat received. Vehicle connected.")
        self._mav = mav
        
        while self._running:
            msg = await loop.run_in_executor(
                None, lambda: mav.recv_match(blocking=True, timeout=1.0)
            )
            if msg:
                await self._handle_mavlink_msg(msg)

    async def _handle_mavlink_msg(self, msg) -> None:
        t = msg.get_type()
        if t == "HEARTBEAT":
            self._telemetry["armed"] = bool(msg.base_mode & 0x80)
            self._telemetry["mode"] = self._decode_mode(msg.custom_mode)
            self._telemetry["last_heartbeat"] = datetime.now(timezone.utc).isoformat()
        elif t == "GPS_RAW_INT":
            self._telemetry["lat"] = msg.lat / 1e7
            self._telemetry["lon"] = msg.lon / 1e7
        elif t == "SYS_STATUS":
            v = msg.voltage_battery
            self._telemetry["battery_v"] = round(v / 1000, 2) if v > 0 else None
            r = msg.battery_remaining
            self._telemetry["battery_pct"] = r if r >= 0 else None
        elif t == "VFR_HUD":
            self._telemetry["speed_ms"] = round(msg.groundspeed, 2)
            self._telemetry["heading"] = msg.heading
        elif t == "MISSION_CURRENT":
            self._telemetry["mission_current"] = msg.seq
        elif t == "MISSION_COUNT":
            self._telemetry["mission_total"] = msg.count
            
        # Push telemetry to River Song every update
        await self._push_telemetry()

    def _decode_mode(self, custom_mode: int) -> str:
        # ArduRover mode mapping
        ROVER_MODES = {
            0: "MANUAL", 1: "ACRO", 3: "STEERING", 4: "HOLD",
            5: "LOITER", 6: "FOLLOW", 10: "AUTO", 11: "RTL",
            12: "SMART_RTL", 15: "GUIDED", 16: "INITIALISING",
        }
        return ROVER_MODES.get(custom_mode, f"MODE_{custom_mode}")

    async def _push_telemetry(self) -> None:
        """POST current telemetry to River Song's internal telemetry endpoint."""
        import httpx
        headers = {"Authorization": f"Bearer {self.settings.daemon_internal_secret}"}
        try:
            async with httpx.AsyncClient() as client:
                await client.post(
                    f"http://127.0.0.1:{self.settings.app_port}/api/rover/telemetry",
                    json=self._telemetry,
                    headers=headers,
                    timeout=3.0,
                )
        except Exception:
            pass  # Never crash on telemetry push failure

    async def _handle_task(self, action: str, payload: dict) -> dict:
        if action == "telemetry":
            return self._telemetry
        if action == "arm":
            await self._send_arm_command(True)
            return {"status": "arm_sent"}
        if action == "disarm":
            await self._send_arm_command(False)
            return {"status": "disarm_sent"}
        if action == "set_mode":
            mode_name = payload.get("mode", "HOLD")
            await self._set_mode(mode_name)
            return {"status": f"mode_set_{mode_name}"}
        return await super()._handle_task(action, payload)

    async def _send_arm_command(self, arm: bool) -> None:
        if not self._mav: return
        # MAVLink command to arm/disarm
        # 400 = MAV_CMD_COMPONENT_ARM_DISARM
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, lambda: self._mav.mav.command_long_send(
            self._mav.target_system, self._mav.target_component,
            400, 0, 1 if arm else 0, 0, 0, 0, 0, 0, 0
        ))

    async def _set_mode(self, mode_name: str) -> None:
        if not self._mav: return
        # Set ArduRover mode
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, lambda: self._mav.set_mode(mode_name))
