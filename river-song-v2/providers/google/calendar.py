# =============================================================================
# providers/google/calendar.py
#
# Google Calendar provider for River Song AI.
#
# Responsibilities:
#   - Fetch upcoming events for a user (today + N days ahead).
#   - Create new calendar events from spoken intent data.
#   - Format event lists into natural-language strings suitable for TTS.
#
# All methods are async-compatible. The Google API client is synchronous, so
# blocking calls are dispatched to a ThreadPoolExecutor to avoid blocking the
# FastAPI event loop.
#
# Required OAuth scope: https://www.googleapis.com/auth/calendar
# =============================================================================

from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from providers.google.auth import GoogleAuth


logger = logging.getLogger(__name__)

# Module-level thread pool for offloading synchronous Google API calls.
_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="gcal")


class GoogleCalendarProvider:
    """
    Provides Google Calendar read and write access for a single user.

    Args:
        auth: Initialized GoogleAuth instance with valid stored credentials.
        user_id: The user whose OAuth token is used for all API calls.
    """

    def __init__(self, auth: GoogleAuth, user_id: str) -> None:
        self._auth = auth
        self._user_id = user_id

    # -------------------------------------------------------------------------
    # Public API
    # -------------------------------------------------------------------------

    async def get_upcoming_events(
        self,
        days_ahead: int = 7,
        max_results: int = 10,
        calendar_id: str = "primary",
    ) -> List[Dict[str, Any]]:
        """
        Fetch upcoming calendar events starting from now.

        Args:
            days_ahead: How many days into the future to query.
            max_results: Maximum number of events to return.
            calendar_id: Calendar to query. 'primary' uses the user's main calendar.

        Returns:
            List of event dicts as returned by the Calendar API. Each dict
            contains at minimum: 'summary', 'start', 'end', 'id'.

        Raises:
            RuntimeError: If no stored token is found for this user.
            googleapiclient.errors.HttpError: On API errors (quota, permissions).
        """
        now_utc = datetime.now(timezone.utc)
        time_min = now_utc.isoformat()
        time_max = (now_utc + timedelta(days=days_ahead)).isoformat()

        def _fetch() -> List[Dict[str, Any]]:
            service = self._auth.build_service(self._user_id, "calendar", "v3")
            result = (
                service.events()
                .list(
                    calendarId=calendar_id,
                    timeMin=time_min,
                    timeMax=time_max,
                    maxResults=max_results,
                    singleEvents=True,
                    orderBy="startTime",
                )
                .execute()
            )
            return result.get("items", [])

        loop = asyncio.get_running_loop()
        events = await loop.run_in_executor(_executor, _fetch)
        logger.info(
            "Fetched %d upcoming events for user '%s'.", len(events), self._user_id
        )
        return events

    async def create_event(
        self,
        summary: str,
        start_dt: datetime,
        end_dt: Optional[datetime] = None,
        description: str = "",
        calendar_id: str = "primary",
    ) -> Dict[str, Any]:
        """
        Create a new event on the user's calendar.

        Args:
            summary: Event title shown in the calendar.
            start_dt: Start time (timezone-aware recommended).
            end_dt: End time. Defaults to start_dt + 1 hour.
            description: Optional event body text.
            calendar_id: Calendar to write to. 'primary' uses the main calendar.

        Returns:
            The created event dict from the Calendar API, containing 'id',
            'htmlLink', 'summary', 'start', and 'end'.

        Raises:
            RuntimeError: If no stored token is found for this user.
            googleapiclient.errors.HttpError: On API errors.
        """
        if end_dt is None:
            end_dt = start_dt + timedelta(hours=1)

        # Format datetimes for the API. Use dateTime for timed events.
        def _fmt(dt: datetime) -> str:
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.isoformat()

        event_body: Dict[str, Any] = {
            "summary": summary,
            "description": description,
            "start": {"dateTime": _fmt(start_dt)},
            "end": {"dateTime": _fmt(end_dt)},
        }

        def _create() -> Dict[str, Any]:
            service = self._auth.build_service(self._user_id, "calendar", "v3")
            created = (
                service.events()
                .insert(calendarId=calendar_id, body=event_body)
                .execute()
            )
            return created

        loop = asyncio.get_running_loop()
        created_event = await loop.run_in_executor(_executor, _create)
        logger.info(
            "Created event '%s' (id=%s) for user '%s'.",
            summary,
            created_event.get("id"),
            self._user_id,
        )
        return created_event

    # -------------------------------------------------------------------------
    # Natural-language formatting helpers
    # -------------------------------------------------------------------------

    @staticmethod
    def format_events_for_speech(events: List[Dict[str, Any]]) -> str:
        """
        Convert a list of event dicts into a TTS-friendly string.

        Args:
            events: Event dicts as returned by get_upcoming_events().

        Returns:
            A plain-text summary of the events, suitable for speaking aloud.
            Returns "You have no upcoming events." if the list is empty.
        """
        if not events:
            return "You have no upcoming events."

        lines: List[str] = [f"You have {len(events)} upcoming event(s)."]
        for event in events:
            summary = event.get("summary", "Untitled event")
            start_raw = event.get("start", {})

            # Calendar events can be all-day (date) or timed (dateTime).
            if "dateTime" in start_raw:
                try:
                    dt = datetime.fromisoformat(start_raw["dateTime"])
                    time_str = dt.strftime("%A %B %-d at %-I:%M %p")
                except ValueError:
                    time_str = start_raw["dateTime"]
            elif "date" in start_raw:
                try:
                    dt = datetime.fromisoformat(start_raw["date"])
                    time_str = dt.strftime("all day on %A %B %-d")
                except ValueError:
                    time_str = start_raw["date"]
            else:
                time_str = "unknown time"

            lines.append(f"{summary}, {time_str}.")

        return " ".join(lines)


# -----------------------------------------------------------------------------
# Factory
# -----------------------------------------------------------------------------

def build_calendar_provider(user_id: Optional[str] = None) -> GoogleCalendarProvider:
    """
    Convenience factory that builds a GoogleCalendarProvider using app settings.

    Args:
        user_id: User ID override. Falls back to settings.default_user_id.

    Returns:
        Configured GoogleCalendarProvider instance.
    """
    from config.settings import get_settings
    s = get_settings()
    auth = GoogleAuth(
        client_secrets_path=s.google_client_secrets_path,
        token_storage_path=s.google_token_storage_path,
    )
    return GoogleCalendarProvider(auth=auth, user_id=user_id or s.default_user_id)
