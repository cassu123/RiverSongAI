"""
providers/google/tasks.py

Google Tasks provider for River Song AI.
Uses the Google Tasks API v1 with OAuth 2.0 credentials.
"""

from __future__ import annotations

import logging
from typing import List, Optional, Dict, Any

from googleapiclient.discovery import build
from providers.google.auth import GoogleAuth

logger = logging.getLogger(__name__)

_TASKS_SCOPE = "https://www.googleapis.com/auth/tasks"


class GoogleTasksProvider:
    """
    Manages Google Tasks for a user.
    """

    def __init__(self, auth: GoogleAuth, user_id: str) -> None:
        self._auth = auth
        self._user_id = user_id
        self._service = None

    def _get_service(self):
        if self._service is None:
            # Note: We assume the token already has the tasks scope.
            # If not, the user needs to re-authorize.
            self._service = self._auth.build_service(self._user_id, "tasks", "v1")
        return self._service

    async def get_tasklists(self) -> List[Dict[str, Any]]:
        """Fetch all task lists for the user."""
        def _sync():
            service = self._get_service()
            results = service.tasklists().list().execute()
            return results.get("items", [])

        import asyncio
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, _sync)

    async def get_tasks(self, tasklist_id: str = "@default", show_completed: bool = False) -> List[Dict[str, Any]]:
        """Fetch tasks from a specific task list."""
        def _sync():
            service = self._get_service()
            results = service.tasks().list(
                tasklist=tasklist_id,
                showCompleted=show_completed,
                showHidden=False
            ).execute()
            return results.get("items", [])

        import asyncio
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, _sync)

    async def create_task(self, title: str, notes: Optional[str] = None, tasklist_id: str = "@default") -> Dict[str, Any]:
        """Create a new task."""
        def _sync():
            service = self._get_service()
            task = {
                "title": title,
                "notes": notes
            }
            return service.tasks().insert(tasklist=tasklist_id, body=task).execute()

        import asyncio
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, _sync)


# -----------------------------------------------------------------------------
# Factory
# -----------------------------------------------------------------------------

def build_tasks_provider(user_id: Optional[str] = None) -> GoogleTasksProvider:
    """
    Convenience factory that builds a GoogleTasksProvider using app settings.
    """
    from config.settings import get_settings
    from providers.google.auth import GoogleAuth
    s = get_settings()
    auth = GoogleAuth(
        client_secrets_path=s.google_client_secrets_path,
        token_storage_path=s.google_token_storage_path,
    )
    return GoogleTasksProvider(auth=auth, user_id=user_id or s.default_user_id)
