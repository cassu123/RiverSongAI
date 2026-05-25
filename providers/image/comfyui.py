# providers/image/comfyui.py
from __future__ import annotations
import logging, os, time, json, uuid, asyncio
from typing import Any
import httpx

logger = logging.getLogger(__name__)

_BASE  = os.getenv("COMFYUI_URL", "http://localhost:8188")
_WORKFLOW_DIR = "providers/image/workflows"

def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(base_url=_BASE, timeout=60)

async def generate(prompt: str, workflow: str = "portrait", seed: int | None = None) -> bytes | None:
    """
    Generate an image using ComfyUI.
    Loads a JSON workflow, substitutes parameters, and polls for result.
    """
    workflow_path = os.path.join(_WORKFLOW_DIR, f"{workflow}.json")
    if not os.path.exists(workflow_path):
        logger.warning("Workflow %s not found", workflow_path)
        return None

    with open(workflow_path, "r") as f:
        wf = json.load(f)

    # Substitutions (naive - depends on workflow structure)
    # Usually you look for the CLIPTextEncode and KSampler nodes
    for node_id, node in wf.items():
        if node.get("class_type") == "CLIPTextEncode":
            if "text" in node.get("inputs", {}):
                node["inputs"]["text"] = prompt
        if node.get("class_type") == "KSampler":
            if seed is not None:
                node["inputs"]["seed"] = seed
            else:
                node["inputs"]["seed"] = uuid.uuid4().int >> 64

    async with _client() as c:
        try:
            # 1. Queue prompt
            client_id = str(uuid.uuid4())
            r = await c.post("/prompt", json={"prompt": wf, "client_id": client_id})
            r.raise_for_status()
            prompt_id = r.json()["prompt_id"]

            # 2. Poll for history
            for _ in range(30): # 30 attempts, 2s each
                await asyncio.sleep(2)
                r = await c.get(f"/history/{prompt_id}")
                r.raise_for_status()
                history = r.json()
                if prompt_id in history:
                    # 3. Get output filename
                    outputs = history[prompt_id].get("outputs", {})
                    for node_id, node_output in outputs.items():
                        if "images" in node_output:
                            filename = node_output["images"][0]["filename"]
                            subfolder = node_output["images"][0].get("subfolder", "")
                            
                            # 4. Download image
                            r = await c.get("/view", params={"filename": filename, "subfolder": subfolder, "type": "output"})
                            r.raise_for_status()
                            return r.content
            return None
        except Exception as exc:
            logger.warning("ComfyUI generation failed: %s", exc)
            return None
