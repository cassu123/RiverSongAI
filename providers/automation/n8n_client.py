# SETUP: Run n8n via Docker on the server:
# docker run -d --restart unless-stopped \
#   --name n8n \
#   -p 5678:5678 \
#   -e N8N_BASIC_AUTH_ACTIVE=true \
#   -e N8N_BASIC_AUTH_USER=riversong \
#   -e N8N_BASIC_AUTH_PASSWORD=<your_password> \
#   -e N8N_WEBHOOK_URL=http://localhost:5678/ \
#   -v /mnt/data/river-song/n8n:/home/node/.n8n \
#   n8nio/n8n
# Then get API key from n8n UI → Settings → API → Create API Key
# Set N8N_API_KEY and N8N_WEBHOOK_SECRET in .env

import logging
import httpx
from typing import List, Dict, Any, Optional
from config.settings import get_settings

logger = logging.getLogger(__name__)

class N8NClient:
    """
    Client for interacting with a local n8n instance.
    """
    def __init__(self):
        settings = get_settings()
        self.url = settings.n8n_url.rstrip("/")
        self.api_key = settings.n8n_api_key
        self.enabled = settings.n8n_enabled
        self.headers = {"X-N8N-API-KEY": self.api_key} if self.api_key else {}

    async def is_available(self) -> bool:
        if not self.enabled:
            return False
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                resp = await client.get(f"{self.url}/healthz")
                return resp.status_code == 200
        except Exception:
            return False

    async def list_workflows(self) -> List[Dict[str, Any]]:
        if not self.enabled or not self.api_key:
            return []
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{self.url}/api/v1/workflows", headers=self.headers)
                resp.raise_for_status()
                return resp.json().get("data", [])
        except Exception as exc:
            logger.error("Failed to list n8n workflows: %s", exc)
            return []

    async def trigger_workflow(self, workflow_id: str, data: Dict[str, Any] = None) -> bool:
        if not self.enabled or not self.api_key:
            return False
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    f"{self.url}/api/v1/workflows/{workflow_id}/execute",
                    headers=self.headers,
                    json=data or {}
                )
                resp.raise_for_status()
                return True
        except Exception as exc:
            logger.error("Failed to trigger n8n workflow %s: %s", workflow_id, exc)
            return False

def build_n8n_client() -> N8NClient:
    return N8NClient()
