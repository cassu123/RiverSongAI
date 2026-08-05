"""
core/vortex_surfaces.py

Deciding what a River Vortex ambient screen shows.

Vortex has a complete surface renderer and holds no opinion about what
deserves the screen — it draws seven card shapes and orders them by a priority
it is handed. Choosing what matters right now needs the room, the time, who is
home and what is cooking. All of that only exists here, so the opinion lives
here too.

Two things this module takes seriously:

**Priority is physical.** `high` wakes a panel from backlight-off and speaks
aloud; `critical` takes over the display over any page and cuts off playing
audio. In a bedroom at 3am that is a person waking up. Doorbells, smoke,
water — not deliveries. `SPEAKING_PRIORITIES` documents which levels the unit
will speak, and the publisher refuses a `critical` card without a reason
recorded in its `source`.

**Withdrawal.** A card left to expire is a card that stayed up after it
stopped mattering. Every publisher here has a matching withdraw, and TTLs are
a backstop rather than the mechanism.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional

from core.vortex_security import LoopLock

logger = logging.getLogger(__name__)

# The unit's four levels are the contract. This server does not invent a fifth
# or a numeric score — it picks from these.
PRIORITIES = ("ambient", "normal", "high", "critical")
_PRIORITY_ORDER = {p: i for i, p in enumerate(PRIORITIES)}

# Levels at which the unit speaks the card aloud even on a screened unit.
SPEAKING_PRIORITIES = frozenset({"high", "critical"})

KINDS = ("note", "list", "stat", "media", "image", "alert", "confirm")

_MAX_ITEMS = 8
_MAX_ACTIONS = 3
_DEFAULT_TTL = 900


class SurfaceError(ValueError):
    """A card that the renderer could not draw, rejected before it is sent."""


@dataclass
class Surface:
    """
    One card, as the unit's renderer expects it.

    `id` is stable and meaningful: pushing the same id replaces the card
    rather than stacking a second one. "garage" is a good id; a uuid is not,
    because the next garage update would then appear beside the first.
    """
    id: str
    kind: str = "note"
    priority: str = "normal"
    title: str = ""
    body: str = ""
    value: Optional[str] = None
    unit: Optional[str] = None
    items: List[str] = field(default_factory=list)
    image_url: Optional[str] = None
    icon: Optional[str] = None
    actions: List[Dict[str, Any]] = field(default_factory=list)
    ttl_seconds: int = _DEFAULT_TTL
    speech: Optional[str] = None
    challenge_id: Optional[str] = None
    # Server-side only: never sent, used for logging and audit of who raised
    # a card that woke someone up.
    source: str = ""
    expires_at: float = 0.0

    def to_wire(self) -> Dict[str, Any]:
        """The exact object the renderer consumes. Nothing extra, no None noise."""
        out: Dict[str, Any] = {
            "id": self.id,
            "kind": self.kind,
            "priority": self.priority,
            "title": self.title,
            "ttl_seconds": self.ttl_seconds,
        }
        for key in ("body", "value", "unit", "image_url", "icon", "speech",
                    "challenge_id"):
            value = getattr(self, key)
            if value:
                out[key] = value
        if self.items:
            out["items"] = self.items
        if self.actions:
            out["actions"] = self.actions
        return out


def build_surface(data: Dict[str, Any]) -> Surface:
    """
    Validate a card descriptor and return a Surface.

    Raises SurfaceError on anything the renderer cannot draw. Rejecting here
    is deliberate: a card with an unknown `kind` silently disappears on the
    unit, which looks exactly like a card that was never sent.
    """
    surface_id = str(data.get("id") or "").strip()
    if not surface_id:
        raise SurfaceError("Surface id is required and must be stable.")

    kind = str(data.get("kind") or "note").strip().lower()
    if kind not in KINDS:
        raise SurfaceError(f"Unknown surface kind '{kind}'. Valid: {', '.join(KINDS)}")

    priority = str(data.get("priority") or "normal").strip().lower()
    if priority not in PRIORITIES:
        raise SurfaceError(
            f"Unknown priority '{priority}'. Valid: {', '.join(PRIORITIES)}")

    items = [str(i) for i in (data.get("items") or [])][:_MAX_ITEMS]
    actions = [a for a in (data.get("actions") or []) if isinstance(a, dict)][:_MAX_ACTIONS]

    try:
        ttl = int(data.get("ttl_seconds") or _DEFAULT_TTL)
    except (TypeError, ValueError):
        ttl = _DEFAULT_TTL
    ttl = max(5, min(ttl, 86400))

    return Surface(
        id=surface_id,
        kind=kind,
        priority=priority,
        title=str(data.get("title") or ""),
        body=str(data.get("body") or ""),
        value=_opt_str(data.get("value")),
        unit=_opt_str(data.get("unit")),
        items=items,
        image_url=_opt_str(data.get("image_url")),
        icon=_opt_str(data.get("icon")),
        actions=actions,
        ttl_seconds=ttl,
        speech=_opt_str(data.get("speech")),
        challenge_id=_opt_str(data.get("challenge_id")),
        source=str(data.get("source") or ""),
    )


def _opt_str(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value)
    return text or None


def derive_speech(surface: Surface) -> str:
    """
    Build a spoken form of a card from its visible text.

    Roughly a third of units have no display, so a card without `speech` is
    invisible on them (invariant 7). Publishers should write real speech —
    this is the fallback that stops a screenless unit going silent when they
    forget.
    """
    parts = [surface.title.strip()]
    if surface.value:
        parts.append(f"{surface.value}{surface.unit or ''}".strip())
    if surface.body.strip():
        parts.append(surface.body.strip())
    if surface.items:
        parts.append(", ".join(surface.items))
    spoken = ". ".join(p for p in parts if p)
    return spoken


class SurfacePublisher:
    """
    Holds the current card set per unit and pushes changes over the hub.

    State is in-memory and per-unit. The kiosk re-reads
    `GET /api/vortex/v1/surfaces` on restart, and a unit that has been offline
    gets the current set replayed when it reconnects, so nothing needs to
    survive a server restart: a card is a statement about *now*, and after a
    restart this server does not yet know what is true.
    """

    def __init__(self) -> None:
        self._by_unit: Dict[str, Dict[str, Surface]] = {}
        self._lock = LoopLock()

    # -- reading ----------------------------------------------------------

    async def list_for_unit(self, unit_id: str) -> List[Dict[str, Any]]:
        """Current cards for a unit, highest priority first, expired ones dropped."""
        async with self._lock:
            self._purge(unit_id)
            surfaces = list(self._by_unit.get(unit_id, {}).values())
        surfaces.sort(
            key=lambda s: (-_PRIORITY_ORDER.get(s.priority, 1), s.expires_at))
        return [s.to_wire() for s in surfaces]

    def _purge(self, unit_id: str) -> None:
        now = time.monotonic()
        cards = self._by_unit.get(unit_id)
        if not cards:
            return
        for cid in [k for k, v in cards.items() if v.expires_at <= now]:
            cards.pop(cid, None)

    # -- writing ----------------------------------------------------------

    async def publish(self, data: Dict[str, Any],
                      unit_ids: Optional[Iterable[str]] = None,
                      *, room: Optional[str] = None) -> Dict[str, Any]:
        """
        Show or replace a card on one, some, or every unit.

        Args:
            data: Card descriptor (see build_surface).
            unit_ids: Explicit targets. None means "resolve from `room`, or
                every known unit if no room is given".
            room: Room name to target. The shopping list belongs on the
                kitchen unit, not the bedroom one.

        Returns:
            {"id", "targets": [...], "delivered": n}
        """
        surface = build_surface(data)
        targets = await self._resolve_targets(unit_ids, room)
        if not targets:
            logger.info("Surface '%s' had no target units (room=%s).",
                        surface.id, room)
            return {"id": surface.id, "targets": [], "delivered": 0}

        if surface.priority == "critical":
            logger.warning(
                "CRITICAL surface '%s' raised on %d unit(s) by '%s': %s. "
                "This takes over every display and cuts off playing audio.",
                surface.id, len(targets), surface.source or "unknown",
                surface.title,
            )

        from core.vortex_hub import get_vortex_hub
        hub = get_vortex_hub()

        delivered = 0
        for unit_id in targets:
            card = self._for_unit(surface, unit_id, hub)
            async with self._lock:
                self._by_unit.setdefault(unit_id, {})[card.id] = card
            if await hub.send(unit_id, "surface", card.to_wire()):
                delivered += 1

        logger.info(
            "Surface '%s' (%s/%s) published to %d unit(s), %d live.",
            surface.id, surface.kind, surface.priority, len(targets), delivered,
        )
        return {"id": surface.id, "targets": targets, "delivered": delivered}

    def _for_unit(self, surface: Surface, unit_id: str, hub: Any) -> Surface:
        """Copy a card and fill in what this particular unit needs."""
        from dataclasses import replace

        conn = hub.connection(unit_id)
        screenless = conn is not None and not conn.has_display
        speech = surface.speech
        if screenless and not speech:
            speech = derive_speech(surface)
            logger.info(
                "Surface '%s' had no speech and unit %s has no display; "
                "spoke the card text instead.", surface.id, unit_id,
            )
        return replace(surface, speech=speech,
                       expires_at=time.monotonic() + surface.ttl_seconds)

    async def withdraw(self, surface_id: str,
                       unit_ids: Optional[Iterable[str]] = None,
                       *, room: Optional[str] = None) -> Dict[str, Any]:
        """
        Take a card down because the fact it states stopped being true.

        This is the half that keeps the screen honest. Closing the garage
        should remove the garage card immediately, not leave it up for the
        remaining eleven minutes of its TTL.
        """
        targets = await self._resolve_targets(unit_ids, room)
        if unit_ids is None and room is None:
            async with self._lock:
                targets = [u for u, cards in self._by_unit.items()
                           if surface_id in cards]

        from core.vortex_hub import get_vortex_hub
        hub = get_vortex_hub()

        withdrawn = 0
        for unit_id in targets:
            async with self._lock:
                removed = self._by_unit.get(unit_id, {}).pop(surface_id, None)
            if removed is not None:
                withdrawn += 1
            await hub.send(unit_id, "surface_withdraw", {"id": surface_id})
        if withdrawn:
            logger.info("Surface '%s' withdrawn from %d unit(s).",
                        surface_id, withdrawn)
        return {"id": surface_id, "withdrawn": withdrawn}

    async def replay(self, unit_id: str) -> int:
        """
        Re-send the current card set to a unit that just reconnected.

        A Pi that rebooted mid-evening should come back to the same screen it
        had, without waiting for the next thing to happen.
        """
        cards = await self.list_for_unit(unit_id)
        if not cards:
            return 0
        from core.vortex_hub import get_vortex_hub
        hub = get_vortex_hub()
        sent = 0
        for card in cards:
            if await hub.send(unit_id, "surface", card):
                sent += 1
        return sent

    async def find(self, surface_id: str) -> Optional[Surface]:
        """Return a live card by id from any unit, for action re-validation."""
        async with self._lock:
            for cards in self._by_unit.values():
                if surface_id in cards:
                    return cards[surface_id]
        return None

    async def _resolve_targets(self, unit_ids: Optional[Iterable[str]],
                               room: Optional[str]) -> List[str]:
        if unit_ids is not None:
            return [u for u in unit_ids if u]
        if room:
            from core.vortex_units import resolve_room
            return await resolve_room(room)
        from core.vortex_units import list_profiles
        return [p["unit_id"] for p in await list_profiles()]

    async def reset(self) -> None:
        """Drop all cards. Test helper."""
        async with self._lock:
            self._by_unit.clear()


_publisher: Optional[SurfacePublisher] = None


def get_surface_publisher() -> SurfacePublisher:
    """Return the shared SurfacePublisher."""
    global _publisher
    if _publisher is None:
        _publisher = SurfacePublisher()
    return _publisher


# ---------------------------------------------------------------------------
# Ready-made publishers
# ---------------------------------------------------------------------------
#
# Each of these is a few lines here and requires nothing further on the device.
# They exist because the product feels alive exactly when these fire and dead
# when they do not.

async def publish_shopping_list(items: List[str], *, room: str = "kitchen"
                                ) -> Dict[str, Any]:
    """Put the shopping list on the kitchen unit and nowhere else."""
    return await get_surface_publisher().publish(
        {
            "id": "shopping-list",
            "kind": "list",
            "priority": "ambient",
            "title": "Shopping list",
            "items": items[:_MAX_ITEMS],
            "icon": "🛒",
            "ttl_seconds": 21600,
            "speech": (
                "On the shopping list: " + ", ".join(items[:_MAX_ITEMS])
                if items else "The shopping list is empty."
            ),
            "source": "shopping_list",
        },
        room=room,
    )


async def publish_reminder(text: str, *, surface_id: str,
                           room: Optional[str] = None,
                           ttl_seconds: int = 43200) -> Dict[str, Any]:
    """A plain reminder card, on one room's unit when a room is given."""
    return await get_surface_publisher().publish(
        {
            "id": surface_id,
            "kind": "note",
            "priority": "normal",
            "title": text,
            "icon": "📌",
            "ttl_seconds": ttl_seconds,
            "speech": text,
            "source": "reminder",
        },
        room=room,
    )


async def publish_weather_alert(alert: Dict[str, Any]) -> Dict[str, Any]:
    """
    A severe weather warning, on every unit.

    `high` rather than `critical`: a wall panel is exactly the right place for
    a severe weather warning, but it should not cut off whatever is playing.
    """
    title = str(alert.get("event") or alert.get("title") or "Weather warning")
    body = str(alert.get("description") or alert.get("body") or "")[:400]
    return await get_surface_publisher().publish(
        {
            "id": f"weather-alert:{alert.get('id') or title.lower().replace(' ', '-')}",
            "kind": "alert",
            "priority": "high",
            "title": title,
            "body": body,
            "icon": "⚠",
            "ttl_seconds": int(alert.get("ttl_seconds") or 3600),
            "speech": f"Weather warning. {title}. {body[:200]}",
            "source": "weather_alerts",
        },
    )


async def publish_doorbell(*, image_url: Optional[str] = None,
                           caption: str = "Someone at the door"
                           ) -> Dict[str, Any]:
    """
    Someone at the door: `critical`, on every screen in the house.

    This is the takeover case the surface renderer was built around, and one
    of the very few things that earns it.
    """
    return await get_surface_publisher().publish(
        {
            "id": "doorbell",
            "kind": "image" if image_url else "alert",
            "priority": "critical",
            "title": caption,
            "image_url": image_url,
            "icon": "🔔",
            "ttl_seconds": 120,
            "speech": caption,
            "source": "doorbell",
            "actions": [
                {"label": "Dismiss", "intent": "surface.dismiss.doorbell",
                 "style": "secondary"},
            ],
        },
    )


async def publish_motion_snapshot(*, camera_name: str, image_url: str,
                                  room: Optional[str] = None) -> Dict[str, Any]:
    """Motion seen: `high`, with the snapshot as the image."""
    title = f"Motion — {camera_name}"
    return await get_surface_publisher().publish(
        {
            "id": f"motion:{camera_name.lower().replace(' ', '-')}",
            "kind": "image",
            "priority": "high",
            "title": title,
            "image_url": image_url,
            "icon": "👁",
            "ttl_seconds": 300,
            "speech": f"Motion detected at the {camera_name}.",
            "source": "motion_snapshot",
        },
        room=room,
    )


async def publish_cooking_step(*, step: Dict[str, Any], recipe_title: str,
                               room: str = "kitchen") -> Dict[str, Any]:
    """The current recipe step, on the kitchen unit."""
    index = int(step.get("index", 0))
    total = int(step.get("total", 0))
    instruction = str(step.get("instruction") or step.get("text") or "")
    ingredients = [
        f"{i.get('qty', '')} {i.get('unit', '')} {i.get('name', '')}".strip()
        for i in (step.get("ingredients") or [])
    ]
    return await get_surface_publisher().publish(
        {
            "id": "cooking-step",
            "kind": "list" if ingredients else "note",
            "priority": "normal",
            "title": f"{recipe_title} — step {index + 1} of {total}",
            "body": instruction,
            "items": ingredients,
            "icon": "🍳",
            "ttl_seconds": 7200,
            "speech": f"Step {index + 1}. {instruction}",
            "source": "cooking_session",
        },
        room=room,
    )
