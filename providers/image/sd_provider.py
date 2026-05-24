"""
providers/image/sd_provider.py

Stable Diffusion image generation provider with on-demand lifecycle management.
Optimized for 4GB VRAM hardware.
"""

import asyncio
import logging
import subprocess
import time
import base64
import httpx
from typing import Optional

logger = logging.getLogger(__name__)

class SDProvider:
    def __init__(self):
        from config.settings import get_settings
        self.settings = get_settings()
        self._process: Optional[subprocess.Popen] = None

    async def _ensure_running(self) -> bool:
        """Check if SD is running; if not, start it on-demand."""
        # Even if not on_demand, verify connectivity
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.get(f"{self.settings.sd_api_url}/sdapi/v1/options", timeout=1.5)
                if resp.status_code == 200:
                    return True
            except (httpx.RequestError, httpx.HTTPStatusError):
                pass

        if not self.settings.sd_on_demand:
            logger.error("Stable Diffusion API not reachable at %s", self.settings.sd_api_url)
            return False

        import os
        exec_path = self.settings.sd_executable_path
        if not exec_path or not os.path.exists(exec_path):
            raise RuntimeError(f"Stable Diffusion executable not found at '{exec_path}'. Set SD_EXECUTABLE_PATH in .env to your A1111/Forge executable.")

        logger.info("Starting Stable Diffusion on-demand to save VRAM...")
        
        # Attempt to unload Ollama LLM to free VRAM for SD
        try:
            async with httpx.AsyncClient() as client:
                await client.post(
                    f"{self.settings.ollama_base_url}/api/generate",
                    json={"model": self.settings.llm_model, "keep_alive": 0},
                    timeout=2.0
                )
        except Exception:
            pass

        # Start the SD process
        port = self.settings.sd_api_url.split(":")[-1].strip("/")
        cmd = [
            exec_path,
            "--api",
            "--nowebui",
            "--listen",
            "--port", port,
            "--skip-torch-cuda-test", # Some environments need this
            "--precision", "full",    # for 1050 Ti stability if needed
            "--no-half"               # for 1050 Ti stability if needed
        ]
        
        self._process = subprocess.Popen(
            cmd,
            cwd=self.settings.sd_working_dir or None,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )

        # Poll until API is ready
        start_time = time.time()
        while time.time() - start_time < 60: # 60 seconds timeout
            try:
                async with httpx.AsyncClient() as client:
                    resp = await client.get(f"{self.settings.sd_api_url}/sdapi/v1/options", timeout=1.0)
                    if resp.status_code == 200:
                        logger.info("Stable Diffusion process is ready.")
                        return True
            except Exception:
                pass
            await asyncio.sleep(3)
        
        await self._cleanup() # Kill the process if it timed out
        raise RuntimeError("Stable Diffusion failed to start within 60 seconds.")

    async def _cleanup(self):
        """Kill the SD process to free VRAM immediately after use."""
        if self.settings.sd_on_demand and self._process:
            logger.info("Shutting down Stable Diffusion to reclaim VRAM...")
            self._process.terminate()
            try:
                # Give it a few seconds to exit gracefully
                await asyncio.get_running_loop().run_in_executor(None, self._process.wait, 10)
            except Exception:
                self._process.kill()
            self._process = None

    async def generate(self, prompt: str, negative_prompt: str = "", width: int = 512, height: int = 512, steps: int = 20) -> bytes:
        """
        Generate an image using the Stable Diffusion API.
        
        Args:
            prompt: Text describing what to generate.
            negative_prompt: Text describing what to avoid.
            width: Image width in pixels.
            height: Image height in pixels.
            steps: Number of sampling steps.
            
        Returns:
            bytes: Raw PNG image data.
        """
        if not await self._ensure_running():
            raise RuntimeError("Stable Diffusion provider is not available.")

        try:
            logger.info("Requesting image generation: '%s'", prompt[:50])
            async with httpx.AsyncClient() as client:
                payload = {
                    "prompt": prompt,
                    "negative_prompt": negative_prompt,
                    "steps": steps,
                    "width": width,
                    "height": height,
                    "sampler_name": "Euler a",
                    "cfg_scale": 7
                }
                resp = await client.post(
                    f"{self.settings.sd_api_url}/sdapi/v1/txt2img",
                    json=payload,
                    timeout=300.0 # 5 minutes for generation
                )
                
                if resp.status_code != 200:
                    raise RuntimeError(f"Stable Diffusion API returned error {resp.status_code}: {resp.text}")
                
                result = resp.json()
                img_b64 = result["images"][0]
                return base64.b64decode(img_b64)
        finally:
            await self._cleanup()
