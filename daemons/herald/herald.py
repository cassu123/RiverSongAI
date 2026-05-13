import asyncio
import logging
import base64
import io
import httpx
import numpy as np
from typing import List, Dict

from daemons.base_daemon import BaseDaemon

logger = logging.getLogger(__name__)

class HeraldDaemon(BaseDaemon):
    """
    Manages casting River Song kiosk to Google Home Hubs and computes lip-sync.
    """
    name = "herald"

    async def _main_loop(self) -> None:
        if not self.settings.herald_enabled:
            logger.info("Herald: disabled in settings. Idle loop started.")
            while self._running:
                await asyncio.sleep(60)
            return

        logger.info("Herald: starting. Managing %d hub(s).", len(self._get_hub_entities()))
        while self._running:
            await self._ensure_hubs_casting()
            await asyncio.sleep(45)   # check every 45s

    def _get_hub_entities(self) -> list[str]:
        import json
        try:
            return json.loads(self.settings.hub_entities)
        except Exception:
            return []

    async def _ensure_hubs_casting(self) -> None:
        """
        For each Hub media_player entity, check if it's showing our kiosk URL.
        If not (or if idle/off), re-cast the kiosk URL.
        """
        hubs = self._get_hub_entities()
        if not hubs:
            return

        from providers.smart_home.home_assistant import HomeAssistantClient
        s = self.settings
        if not s.home_assistant_token:
            logger.warning("Herald: HOME_ASSISTANT_TOKEN not set.")
            return

        client = HomeAssistantClient(s.home_assistant_url, s.home_assistant_token)
        try:
            for entity_id in hubs:
                try:
                    state = await client.get_state(entity_id)
                    media_url = state.get("attributes", {}).get("media_content_id", "")
                    is_casting_kiosk = s.kiosk_url in media_url
                    is_idle = state.get("state") in ("idle", "off", "unavailable", "standby")
                    
                    if is_idle or not is_casting_kiosk:
                        logger.info("Herald: recasting kiosk to %s", entity_id)
                        await self._cast_to_hub(client, entity_id)
                except Exception as e:
                    logger.warning("Herald: failed to check %s: %s", entity_id, e)
        finally:
            await client.close()

    async def _cast_to_hub(self, client: "HomeAssistantClient", entity_id: str) -> None:
        """Attempt to cast kiosk URL to a Google Home Hub."""
        try:
            await client.call_service(
                domain="media_player",
                service="play_media",
                entity_id=entity_id,
                media_content_id=self.settings.kiosk_url,
                media_content_type="url",
            )
        except Exception as e:
            logger.warning("Herald: cast failed for %s: %s", entity_id, e)

    async def _handle_task(self, action: str, payload: dict) -> dict:
        if action == "lip_sync":
            """
            Receives audio bytes (base64), computes lip sync timing,
            broadcasts to all kiosk WebSocket clients.
            """
            audio_b64 = payload.get("audio_b64", "")
            audio_fmt = payload.get("format", "wav")
            if audio_b64:
                audio_bytes = base64.b64decode(audio_b64)
                timings = self._compute_lip_sync(audio_bytes, audio_fmt)
                await self._broadcast_lip_sync(timings)
                return {"status": "broadcast", "frames": len(timings)}
            return {"status": "no_audio"}
        
        if action == "recast_now":
            await self._ensure_hubs_casting()
            return {"status": "recasted"}
            
        return await super()._handle_task(action, payload)

    def _compute_lip_sync(self, audio_bytes: bytes, fmt: str) -> list[dict]:
        """
        Compute mouth-open values per 20ms frame from audio amplitude.
        Returns: [{"t": 0.00, "open": 0.0}, {"t": 0.02, "open": 0.8}, ...]
        """
        pcm = np.array([], dtype=np.float32)
        sr = 22050 # fallback

        if fmt == "mp3":
            try:
                # Decode MP3 to raw PCM via ffmpeg (available on server alongside Piper)
                import subprocess, tempfile, os
                with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp_in:
                    tmp_in.write(audio_bytes)
                    tmp_in_path = tmp_in.name
                tmp_out_path = tmp_in_path.replace(".mp3", ".wav")
                try:
                    subprocess.run(
                        ["ffmpeg", "-y", "-i", tmp_in_path,
                         "-ar", "22050", "-ac", "1", "-f", "wav", tmp_out_path],
                        capture_output=True, timeout=10, check=True,
                    )
                    with open(tmp_out_path, "rb") as fh:
                        wav_bytes = fh.read()
                    pcm = np.frombuffer(wav_bytes[44:], dtype=np.int16).astype(np.float32)
                    sr = 22050
                finally:
                    os.unlink(tmp_in_path)
                    if os.path.exists(tmp_out_path):
                        os.unlink(tmp_out_path)
            except Exception:
                # Fallback: fixed-length frames with moderate mouth opening
                total_frames = max(1, len(audio_bytes) // 200)
                return [{"t": round(i * 0.02, 3), "open": 0.5} for i in range(total_frames)]
        else:
            # WAV: skip 44-byte header
            try:
                pcm = np.frombuffer(audio_bytes[44:], dtype=np.int16).astype(np.float32)
                sr = 22050  # Piper default
            except Exception:
                return []

        # RMS per 20ms frame
        frame_size = int(sr * 0.02)
        if frame_size == 0 or len(pcm) == 0:
            return []
            
        frames = [pcm[i:i+frame_size] for i in range(0, len(pcm) - frame_size, frame_size)]
        timings = []
        for i, f in enumerate(frames):
            rms = float(np.sqrt(np.mean(f ** 2))) if len(f) > 0 else 0.0
            # Normalize to 0.0–1.0 (typical speech RMS ~5000 out of 32767)
            open_val = min(rms / 8000.0, 1.0)
            timings.append({"t": round(i * 0.02, 3), "open": round(open_val, 3)})
        return timings

    async def _broadcast_lip_sync(self, timings: list[dict]) -> None:
        """POST lip_sync event to River Song's internal broadcast endpoint."""
        payload = {
            "type": "lip_sync",
            "timings": timings,
        }
        headers = {"Authorization": f"Bearer {self.settings.daemon_internal_secret}"}
        try:
            async with httpx.AsyncClient() as client:
                await client.post(
                    f"http://127.0.0.1:{self.settings.app_port}/api/broadcast/lip_sync",
                    json=payload,
                    headers=headers,
                    timeout=5.0,
                )
        except Exception as e:
            logger.debug("Herald: broadcast failed: %s", e)
