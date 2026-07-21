# =============================================================================
# providers/smart_home/device_registry.py
#
# Plain-English to Home Assistant entity ID mapping for River Song AI.
#
# The registry is a JSON file maintained by the user. It contains two sections:
#   "devices" - single entity mappings: "living room lights" -> "light.living_room"
#   "groups"  - named groups:           "all lights" -> ["light.living_room", ...]
#
# Resolution order for a spoken device name:
#   1. Exact match in "devices" (case-insensitive)
#   2. Exact match in "groups"  (case-insensitive)
#   3. Fuzzy match against "devices" using word-overlap scoring
#   4. Fuzzy match against "groups"
#   5. Returns None if nothing clears the minimum score threshold (0.5)
#
# The registry is loaded once and cached in memory. Call reload() to pick up
# changes to the JSON file without restarting the application.
#
# File format (see config_files/device_registry.example.json):
#   {
#     "devices": {
#       "living room lights": "light.living_room",
#       "kitchen lights":     "light.kitchen"
#     },
#     "groups": {
#       "all lights": ["light.living_room", "light.kitchen", "light.bedroom"]
#     }
#   }
# =============================================================================

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Dict, List, Optional, Union


logger = logging.getLogger(__name__)

# Minimum word-overlap score (0.0 - 1.0) to accept a fuzzy match.
_FUZZY_THRESHOLD = 0.5

# Type alias for what resolve() can return.
EntityOrGroup = Union[str, List[str]]


class DeviceRegistry:
    """
    Maps plain-English device names to Home Assistant entity IDs.

    Args:
        registry_path: Path to the device registry JSON file.

    Raises:
        FileNotFoundError: If the registry file does not exist.
        ValueError: If the JSON is malformed or missing required sections.
    """

    def __init__(self, registry_path: str) -> None:
        self._path = Path(registry_path)
        self._devices: Dict[str, str] = {}
        self._groups: Dict[str, List[str]] = {}
        self.load()

    # -------------------------------------------------------------------------
    # Public API
    # -------------------------------------------------------------------------

    def load(self) -> None:
        """
        Load (or reload) the registry from disk.

        Replaces in-memory data with the current file contents. Safe to call
        at runtime to pick up edits without restarting.

        Raises:
            FileNotFoundError: If the file does not exist.
            ValueError: If JSON parsing fails or required keys are missing.
        """
        if not self._path.exists():
            raise FileNotFoundError(
                f"Device registry not found: {self._path}\n"
                f"Copy config_files/device_registry.example.json to "
                f"{self._path} and fill in your HA entity IDs."
            )

        try:
            with self._path.open("r", encoding="utf-8") as fh:
                data = json.load(fh)
        except json.JSONDecodeError as exc:
            raise ValueError(
                f"Device registry JSON is malformed: {self._path}: {exc}"
            ) from exc

        devices = data.get("devices", {})
        groups = data.get("groups", {})

        if not isinstance(devices, dict):
            raise ValueError(
                f"Device registry 'devices' must be an object (dict), got {
                    type(devices)}"
            )
        if not isinstance(groups, dict):
            raise ValueError(
                f"Device registry 'groups' must be an object (dict), got {
                    type(groups)}"
            )

        self._devices = {k.lower(): v for k, v in devices.items()}
        self._groups = {k.lower(): v for k, v in groups.items()}

        logger.info(
            "Device registry loaded: %d device(s), %d group(s) from '%s'.",
            len(self._devices),
            len(self._groups),
            self._path,
        )

    async def resolve(self, name: str) -> Optional[EntityOrGroup]:
        """
        Resolve a spoken device name to a HA entity ID or list of entity IDs.
        Looks in synced SQLite ha_entities first, then legacy JSON fallback.
        """
        lower = name.lower().strip()
        
        try:
            from main import get_app
            app = get_app()
            if app:
                store = app.state.memory_manager._store
                
                # Check exact name or alias match
                # Also check compound area + domain e.g. "kitchen lights"
                # For simplicity, we just fetch all non-hidden and try matching in python
                entities = await store._fetch_all("SELECT entity_id, domain, name, area, aliases FROM ha_entities WHERE hidden = 0")
                
                # 1. Exact name match or alias
                for e in entities:
                    if e["name"].lower() == lower:
                        return e["entity_id"]
                    try:
                        aliases = json.loads(e["aliases"])
                        if lower in [a.lower() for a in aliases]:
                            return e["entity_id"]
                    except Exception:
                        pass
                        
                # 2. Exact compound match: "{area} {domain}s" e.g. "kitchen lights"
                for e in entities:
                    if not e["area"]:
                        continue
                    area_domain = f'{e["area"].lower()} {e["domain"].lower()}s'
                    if lower == area_domain:
                        # Find all entities in this area with this domain
                        return [x["entity_id"] for x in entities if x["area"] and x["area"].lower() == e["area"].lower() and x["domain"] == e["domain"]]

                # 3. Fuzzy match against synced entities
                names = {e["name"].lower(): e["entity_id"] for e in entities}
                best_key, best_score = _best_match(lower, names.keys())
                if best_score >= _FUZZY_THRESHOLD:
                    return names[best_key]

        except Exception as e:
            logger.error("Error resolving against ha_entities: %s", e)

        # Fallback to legacy JSON
        if lower in self._devices:
            return self._devices[lower]
        if lower in self._groups:
            return self._groups[lower]

        best_key, best_score = _best_match(lower, self._devices.keys())
        if best_score >= _FUZZY_THRESHOLD:
            return self._devices[best_key]

        best_key, best_score = _best_match(lower, self._groups.keys())
        if best_score >= _FUZZY_THRESHOLD:
            return self._groups[best_key]

        logger.warning("Device registry: no match found for '%s'.", name)
        return None

    async def all_names(self) -> List[str]:
        """
        Return all known plain-English device and group names.

        Useful for building debug output or populating intent trigger phrases.
        """
        return list(self._devices.keys()) + list(self._groups.keys())

    def is_group(self, name: str) -> bool:
        """Return True if the name resolves to a group (multiple entities)."""
        result = self.resolve(name)
        return isinstance(result, list)


# -------------------------------------------------------------------------
# Fuzzy matching helpers
# -------------------------------------------------------------------------

def _word_overlap_score(query: str, candidate: str) -> float:
    """
    Compute a word-overlap similarity score between two strings.

    Score = (intersection of word sets) / (union of word sets).
    Ignores stop words that add noise without helping disambiguation.

    Args:
        query: Spoken input, already lowercased.
        candidate: Registry key, already lowercased.

    Returns:
        Float in [0.0, 1.0]. 1.0 means identical word sets.
    """
    _STOP_WORDS = {"the", "a", "an", "my", "all", "of", "in", "on", "at"}
    q_words = set(query.split()) - _STOP_WORDS
    c_words = set(candidate.split()) - _STOP_WORDS

    if not q_words or not c_words:
        return 0.0

    intersection = q_words & c_words
    union = q_words | c_words
    return len(intersection) / len(union)


def _best_match(query: str, candidates) -> tuple[str, float]:
    """
    Find the candidate with the highest word-overlap score.

    Args:
        query: Lowercased input string.
        candidates: Iterable of candidate strings (registry keys).

    Returns:
        Tuple of (best_candidate, best_score). best_score is 0.0 if there
        are no candidates.
    """
    best_key = ""
    best_score = 0.0
    for candidate in candidates:
        score = _word_overlap_score(query, candidate)
        if score > best_score:
            best_score = score
            best_key = candidate
    return best_key, best_score


# -----------------------------------------------------------------------------
# Module-level singleton
# -----------------------------------------------------------------------------

_registry: Optional[DeviceRegistry] = None


def get_device_registry() -> DeviceRegistry:
    """
    Return the module-level DeviceRegistry singleton.

    Initializes from settings.device_registry_path on first call.

    Returns:
        DeviceRegistry: Shared singleton instance.

    Raises:
        FileNotFoundError: If the registry file does not exist.
        ValueError: If the registry JSON is malformed.
    """
    global _registry
    if _registry is None:
        from config.settings import get_settings
        path = get_settings().device_registry_path
        _registry = DeviceRegistry(registry_path=path)
    return _registry
