# =============================================================================
# providers/smart_home/home_assistant.py
#
# Home Assistant REST API client for River Song AI.
#
# Wraps the HA REST API so the intent router can execute voice commands against
# any device HA manages -- lights, switches, fans, covers (garage/shades),
# locks, thermostats, scenes, and scripts -- without knowing which physical
# hub or integration backs each device.
#
# Authentication:
#   All requests use a long-lived access token sent as a Bearer token.
#   Generate one in HA: Profile -> Security -> Long-lived access tokens.
#
# API reference:
#   https://developers.home-assistant.io/docs/api/rest/
#
# Action semantics per domain:
#   light   - turn_on (with optional brightness_pct), turn_off, toggle, dim, brighten
#   switch  - turn_on, turn_off, toggle
#   fan     - turn_on, turn_off, toggle, set_speed (0-100)
#   cover   - open, close, set_position (0-100 pct)
#   lock    - lock, unlock
#   climate - set_temperature
#   scene   - activate
#   script  - run
#
# All public methods are async. The httpx.AsyncClient is created lazily on
# first use and reused across calls. Call close() when the application shuts
# down, or use the async context manager form.
# =============================================================================

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

import httpx


logger = logging.getLogger(__name__)

# Brightness step used for relative dim/brighten commands (out of 255).
_BRIGHTNESS_STEP = 64  # ~25%


class HomeAssistantClient:
    """
    Async REST client for the Home Assistant API.

    Args:
        base_url: URL of the HA instance (e.g., "http://homeassistant.local:8123").
        token: Long-lived access token. Required for all API calls.
        timeout: HTTP request timeout in seconds. Default 10.
    """

    def __init__(
        self,
        base_url: str,
        token: str,
        timeout: float = 10.0,
    ) -> None:
        if not token:
            raise ValueError(
                "HOME_ASSISTANT_TOKEN is not set. "
                "Generate one in HA: Profile -> Security -> Long-lived access tokens."
            )
        self._base = base_url.rstrip("/") + "/api"
        self._headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        self._timeout = timeout
        self._client: Optional[httpx.AsyncClient] = None

    # -------------------------------------------------------------------------
    # Context manager / lifecycle
    # -------------------------------------------------------------------------

    async def __aenter__(self) -> "HomeAssistantClient":
        await self._ensure_client()
        return self

    async def __aexit__(self, *_) -> None:
        await self.close()

    async def close(self) -> None:
        """Close the underlying HTTP client and release connections."""
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    # -------------------------------------------------------------------------
    # Low-level API primitives
    # -------------------------------------------------------------------------

    async def get_state(self, entity_id: str) -> Dict[str, Any]:
        """
        Fetch the current state of a single entity.

        Args:
            entity_id: HA entity ID, e.g. "light.living_room".

        Returns:
            State dict with keys: 'entity_id', 'state', 'attributes',
            'last_changed', 'last_updated'.

        Raises:
            httpx.HTTPStatusError: If HA returns a non-2xx response.
            httpx.RequestError: On connection failures.
        """
        client = await self._ensure_client()
        resp = await client.get(f"{self._base}/states/{entity_id}")
        resp.raise_for_status()
        return resp.json()

    async def get_all_states(self) -> List[Dict[str, Any]]:
        """
        Fetch current state for all entities in HA.

        Returns:
            List of state dicts. Useful for building or validating a device registry.
        """
        client = await self._ensure_client()
        resp = await client.get(f"{self._base}/states")
        resp.raise_for_status()
        return resp.json()

    async def call_service(
        self,
        domain: str,
        service: str,
        **service_data: Any,
    ) -> List[Dict[str, Any]]:
        """
        Call a Home Assistant service.

        Args:
            domain: Service domain, e.g. "light", "switch", "homeassistant".
            service: Service name, e.g. "turn_on", "turn_off", "toggle".
            **service_data: Keyword arguments passed as the service data payload.
                Common keys: entity_id, brightness_pct, temperature, position.

        Returns:
            List of state dicts for entities affected by the service call.

        Raises:
            httpx.HTTPStatusError: If HA returns a non-2xx response.
        """
        client = await self._ensure_client()
        resp = await client.post(
            f"{self._base}/services/{domain}/{service}",
            json=service_data,
        )
        resp.raise_for_status()
        logger.debug("Called %s.%s with %s -> %s", domain, service, service_data, resp.status_code)
        return resp.json()

    async def ping(self) -> bool:
        """
        Check connectivity to the HA instance.

        Returns:
            True if HA responds with a valid API message, False otherwise.
        """
        try:
            client = await self._ensure_client()
            resp = await client.get(f"{self._base}/")
            return resp.status_code == 200
        except Exception:
            return False

    # -------------------------------------------------------------------------
    # High-level action dispatcher
    # -------------------------------------------------------------------------

    async def execute_action(
        self,
        entity_id: str,
        action: str,
        value: Optional[int] = None,
    ) -> bool:
        """
        Execute a parsed smart-home action against a single entity.

        Handles domain-specific service calls internally so callers only need
        the entity ID and a plain action string.

        Args:
            entity_id: HA entity ID, e.g. "light.living_room".
            action: One of: turn_on, turn_off, toggle, set_brightness, dim,
                brighten, lock, unlock, open, close, set_position, activate,
                run, set_temperature.
            value: Numeric parameter for actions that require one:
                set_brightness (0-100 pct), set_position (0-100 pct),
                set_temperature (degrees), set_speed (0-100 pct).

        Returns:
            True if the service call succeeded, False on error.
        """
        domain = entity_id.split(".")[0]
        try:
            await self._dispatch(domain, entity_id, action, value)
            logger.info(
                "Action '%s' on '%s'%s succeeded.",
                action,
                entity_id,
                f" (value={value})" if value is not None else "",
            )
            return True
        except Exception as exc:
            logger.error(
                "Action '%s' on '%s' failed: %s", action, entity_id, exc
            )
            return False

    async def execute_action_on_many(
        self,
        entity_ids: List[str],
        action: str,
        value: Optional[int] = None,
    ) -> bool:
        """
        Execute the same action on a list of entity IDs.

        Args:
            entity_ids: List of HA entity IDs.
            action: Action string (see execute_action).
            value: Optional numeric parameter.

        Returns:
            True if ALL calls succeeded, False if any failed.
        """
        results = []
        for eid in entity_ids:
            ok = await self.execute_action(eid, action, value)
            results.append(ok)
        return all(results)

    # -------------------------------------------------------------------------
    # Internal dispatch
    # -------------------------------------------------------------------------

    async def _dispatch(
        self,
        domain: str,
        entity_id: str,
        action: str,
        value: Optional[int],
    ) -> None:
        """
        Translate (domain, action, value) into the correct HA service call.

        Raises:
            ValueError: If the action is not supported for this domain.
            httpx.HTTPStatusError: On API errors.
        """
        if action == "turn_on":
            if domain == "light" and value is not None:
                await self.call_service(
                    "light", "turn_on",
                    entity_id=entity_id, brightness_pct=value,
                )
            elif domain == "fan" and value is not None:
                await self.call_service(
                    "fan", "turn_on",
                    entity_id=entity_id, percentage=value,
                )
            else:
                await self.call_service(
                    "homeassistant", "turn_on", entity_id=entity_id
                )

        elif action == "turn_off":
            await self.call_service(
                "homeassistant", "turn_off", entity_id=entity_id
            )

        elif action == "toggle":
            await self.call_service(
                "homeassistant", "toggle", entity_id=entity_id
            )

        elif action == "set_brightness":
            if domain != "light":
                raise ValueError(
                    f"set_brightness is only valid for light entities, got '{domain}'"
                )
            pct = max(0, min(100, value or 0))
            await self.call_service(
                "light", "turn_on",
                entity_id=entity_id, brightness_pct=pct,
            )

        elif action == "dim":
            if domain != "light":
                raise ValueError(
                    f"dim is only valid for light entities, got '{domain}'"
                )
            state = await self.get_state(entity_id)
            current = int(state.get("attributes", {}).get("brightness", 128))
            new_brightness = max(0, current - _BRIGHTNESS_STEP)
            await self.call_service(
                "light", "turn_on",
                entity_id=entity_id, brightness=new_brightness,
            )

        elif action == "brighten":
            if domain != "light":
                raise ValueError(
                    f"brighten is only valid for light entities, got '{domain}'"
                )
            state = await self.get_state(entity_id)
            current = int(state.get("attributes", {}).get("brightness", 128))
            new_brightness = min(255, current + _BRIGHTNESS_STEP)
            await self.call_service(
                "light", "turn_on",
                entity_id=entity_id, brightness=new_brightness,
            )

        elif action == "lock":
            await self.call_service("lock", "lock", entity_id=entity_id)

        elif action == "unlock":
            await self.call_service("lock", "unlock", entity_id=entity_id)

        elif action == "open":
            await self.call_service("cover", "open_cover", entity_id=entity_id)

        elif action == "close":
            await self.call_service("cover", "close_cover", entity_id=entity_id)

        elif action == "set_position":
            pct = max(0, min(100, value or 0))
            await self.call_service(
                "cover", "set_cover_position",
                entity_id=entity_id, position=pct,
            )

        elif action == "activate":
            await self.call_service("scene", "turn_on", entity_id=entity_id)

        elif action == "run":
            await self.call_service("script", "turn_on", entity_id=entity_id)

        elif action == "set_temperature":
            if domain != "climate":
                raise ValueError(
                    f"set_temperature is only valid for climate entities, got '{domain}'"
                )
            await self.call_service(
                "climate", "set_temperature",
                entity_id=entity_id, temperature=value,
            )

        else:
            raise ValueError(
                f"Unknown action '{action}' for domain '{domain}'. "
                "Supported: turn_on, turn_off, toggle, set_brightness, dim, "
                "brighten, lock, unlock, open, close, set_position, activate, "
                "run, set_temperature."
            )

    # -------------------------------------------------------------------------
    # Internal helpers
    # -------------------------------------------------------------------------

    async def _ensure_client(self) -> httpx.AsyncClient:
        """Create the AsyncClient on first use."""
        if self._client is None:
            self._client = httpx.AsyncClient(
                headers=self._headers,
                timeout=self._timeout,
            )
        return self._client


# -----------------------------------------------------------------------------
# Factory
# -----------------------------------------------------------------------------

def build_ha_client() -> HomeAssistantClient:
    """
    Convenience factory that builds a HomeAssistantClient using app settings.

    Returns:
        Configured HomeAssistantClient instance.

    Raises:
        ValueError: If HOME_ASSISTANT_TOKEN is not set.
    """
    from config.settings import get_settings
    s = get_settings()
    return HomeAssistantClient(
        base_url=s.home_assistant_url,
        token=s.home_assistant_token,
    )
