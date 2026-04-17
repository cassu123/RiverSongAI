# =============================================================================
# providers/google/maps.py
#
# Google Maps provider for River Song AI.
#
# Responsibilities:
#   - Geocode addresses and place names to coordinates.
#   - Reverse-geocode coordinates to human-readable addresses.
#   - Get turn-by-turn directions between two locations.
#   - Format directions and location info as TTS-friendly strings.
#
# All methods are async-compatible. The googlemaps client is synchronous so
# blocking calls are dispatched to a ThreadPoolExecutor.
#
# Required:
#   GOOGLE_MAPS_API_KEY in .env (no OAuth -- uses an API key directly).
#   pip install googlemaps
# =============================================================================

from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional, Tuple

import googlemaps


logger = logging.getLogger(__name__)

_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="gmaps")


class GoogleMapsProvider:
    """
    Provides geocoding, reverse geocoding, and directions via the Google Maps API.

    Args:
        api_key: Google Maps Platform API key. Must have Maps, Geocoding, and
            Directions APIs enabled in Google Cloud Console.
    """

    def __init__(self, api_key: str) -> None:
        if not api_key:
            raise ValueError(
                "GOOGLE_MAPS_API_KEY is not set. "
                "Set it in .env before using the Maps provider."
            )
        self._client = googlemaps.Client(key=api_key)
        logger.info("GoogleMapsProvider initialized.")

    # -------------------------------------------------------------------------
    # Public API
    # -------------------------------------------------------------------------

    async def geocode(self, address: str) -> Optional[Dict[str, Any]]:
        """
        Convert an address or place name to coordinates.

        Args:
            address: Human-readable address or place name.

        Returns:
            The first geocoding result dict from the Maps API, or None if not
            found. Contains 'formatted_address', 'geometry.location' (lat/lng),
            and 'place_id' at minimum.
        """
        def _fetch() -> Optional[Dict[str, Any]]:
            results = self._client.geocode(address)
            return results[0] if results else None

        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(_executor, _fetch)
        if result:
            logger.debug("Geocoded '%s' to %s.", address, result.get("formatted_address"))
        else:
            logger.warning("No geocode results for '%s'.", address)
        return result

    async def reverse_geocode(
        self, lat: float, lng: float
    ) -> Optional[Dict[str, Any]]:
        """
        Convert coordinates to a human-readable address.

        Args:
            lat: Latitude.
            lng: Longitude.

        Returns:
            The first reverse geocoding result dict, or None if not found.
        """
        def _fetch() -> Optional[Dict[str, Any]]:
            results = self._client.reverse_geocode((lat, lng))
            return results[0] if results else None

        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(_executor, _fetch)
        if result:
            logger.debug(
                "Reverse geocoded (%.6f, %.6f) to '%s'.",
                lat,
                lng,
                result.get("formatted_address"),
            )
        return result

    async def get_directions(
        self,
        origin: str,
        destination: str,
        mode: str = "driving",
    ) -> Optional[Dict[str, Any]]:
        """
        Get directions from origin to destination.

        Args:
            origin: Starting address or place name.
            destination: Ending address or place name.
            mode: Travel mode. Valid values: 'driving', 'walking', 'transit',
                'bicycling'.

        Returns:
            The first route dict from the Directions API, or None if no route
            is found. Contains 'legs' with step-by-step instructions,
            'summary', and 'warnings'.
        """
        def _fetch() -> Optional[Dict[str, Any]]:
            results = self._client.directions(origin, destination, mode=mode)
            return results[0] if results else None

        loop = asyncio.get_running_loop()
        route = await loop.run_in_executor(_executor, _fetch)
        if route:
            legs = route.get("legs", [])
            total_dist = legs[0].get("distance", {}).get("text", "?") if legs else "?"
            total_dur = legs[0].get("duration", {}).get("text", "?") if legs else "?"
            logger.info(
                "Directions from '%s' to '%s' (%s): %s, %s.",
                origin,
                destination,
                mode,
                total_dist,
                total_dur,
            )
        else:
            logger.warning(
                "No directions found from '%s' to '%s' via %s.",
                origin,
                destination,
                mode,
            )
        return route

    async def get_location_info(self, place_name: str) -> str:
        """
        High-level helper: geocode a place and return a speech-ready description.

        Args:
            place_name: Place name or address to look up.

        Returns:
            Plain-text description of the location suitable for TTS.
        """
        result = await self.geocode(place_name)
        if not result:
            return f"Sorry, I could not find any information about {place_name}."
        formatted = result.get("formatted_address", place_name)
        loc = result.get("geometry", {}).get("location", {})
        lat = loc.get("lat", 0.0)
        lng = loc.get("lng", 0.0)
        return (
            f"{formatted} is located at latitude {lat:.4f}, "
            f"longitude {lng:.4f}."
        )

    # -------------------------------------------------------------------------
    # Natural-language formatting helpers
    # -------------------------------------------------------------------------

    @staticmethod
    def format_directions_for_speech(route: Dict[str, Any]) -> str:
        """
        Convert a Directions API route dict into a TTS-friendly string.

        Reads only the first leg of the route (single destination assumed).
        Step HTML instructions are stripped to plain text.

        Args:
            route: A route dict from get_directions().

        Returns:
            Plain-text turn-by-turn directions suitable for speaking aloud.
        """
        legs = route.get("legs", [])
        if not legs:
            return "No route steps available."

        leg = legs[0]
        total_dist = leg.get("distance", {}).get("text", "unknown distance")
        total_dur = leg.get("duration", {}).get("text", "unknown duration")
        start_addr = leg.get("start_address", "your location")
        end_addr = leg.get("end_address", "your destination")

        steps = leg.get("steps", [])
        step_texts: List[str] = []
        for step in steps:
            html = step.get("html_instructions", "")
            plain = _strip_html(html)
            dist = step.get("distance", {}).get("text", "")
            step_texts.append(f"{plain}{', ' + dist if dist else ''}.")

        intro = (
            f"Directions from {start_addr} to {end_addr}. "
            f"Total distance: {total_dist}. Estimated time: {total_dur}. "
        )
        return intro + " ".join(step_texts)


# -------------------------------------------------------------------------
# Internal helpers
# -------------------------------------------------------------------------

def _strip_html(text: str) -> str:
    """
    Remove HTML tags from a string.

    Args:
        text: HTML string from a Google Maps step instruction.

    Returns:
        Plain-text string with tags removed.
    """
    import re
    return re.sub(r"<[^>]+>", " ", text).strip()


# -----------------------------------------------------------------------------
# Factory
# -----------------------------------------------------------------------------

def build_maps_provider() -> GoogleMapsProvider:
    """
    Convenience factory that builds a GoogleMapsProvider using app settings.

    Returns:
        Configured GoogleMapsProvider instance.

    Raises:
        ValueError: If GOOGLE_MAPS_API_KEY is not set in .env.
    """
    from config.settings import get_settings
    s = get_settings()
    return GoogleMapsProvider(api_key=s.google_maps_api_key)
