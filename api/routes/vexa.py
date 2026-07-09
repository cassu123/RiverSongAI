"""
api/routes/vexa.py

River Vexa — voice-first driving companion (Android, motorcycle/car).

Vexa is the in-helmet / in-car satellite client (repo: cassu123/river-vexa).
This router follows the proven River Vector device pattern (see fleet.py):
admin claims a unit and receives a unit token; the device authenticates
every call with the X-Unit-Token header.

Surface:
  Admin (JWT, admin role):
    POST   /api/vexa/units/claim              {name}          → {unit_id, unit_token}
    GET    /api/vexa/units                                    → {units: [...]}
    DELETE /api/vexa/units/{unit_id}
    POST   /api/vexa/units/{unit_id}/command  {type, payload} → {command_id}
    GET    /api/vexa/units/{unit_id}/sessions                 → {sessions: [...]}
  Device (X-Unit-Token):
    POST   /api/vexa/session/start   {unit_id, rider_id, vehicle_type}
                                                  → {session_id, started_at}
    POST   /api/vexa/session/end     {session_id} → {ended_at, summary_ready}
    POST   /api/vexa/telemetry       {session_id, samples: [...]}
                                                  → {accepted: n}
    GET    /api/vexa/commands/poll?unit_id=...    → {commands: [...]}
    POST   /api/vexa/event           {unit_id, event_type, payload}
                                                  → {acknowledged: true}
    POST   /api/vexa/tts             {unit_id, text} → audio/wav bytes

The /event endpoint routes voice_task_request payloads to the matching
River Song tool (Google Tasks, reminders, shopping list, calendar) and
enqueues a spoken confirmation command for the unit to pick up on its
next poll. Safety events (sos, crash_detected, fuel_low) feed the
initiative engine like fleet alerts do.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel, Field

from core.auth import require_role
from core.webhook_tokens import constant_time_match, hash_token
from providers.memory.sqlite_store import SQLiteStore

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/vexa", tags=["vexa"])

_MAX_TELEMETRY_BATCH = 500
_MAX_TTS_CHARS = 800

_SCHEMA = """
CREATE TABLE IF NOT EXISTS vexa_units (
    unit_id           TEXT PRIMARY KEY,
    name              TEXT NOT NULL DEFAULT '',
    unit_token        TEXT NOT NULL,
    rider_id          TEXT,
    presence          TEXT NOT NULL DEFAULT 'idle',
    active_session_id TEXT,
    online            INTEGER NOT NULL DEFAULT 0,
    registered_at     TEXT,
    last_seen         TEXT
);
CREATE TABLE IF NOT EXISTS vexa_sessions (
    session_id   TEXT PRIMARY KEY,
    unit_id      TEXT NOT NULL,
    rider_id     TEXT NOT NULL,
    vehicle_type TEXT NOT NULL,
    started_at   TEXT NOT NULL,
    ended_at     TEXT,
    status       TEXT NOT NULL DEFAULT 'active',
    summary      TEXT
);
CREATE INDEX IF NOT EXISTS idx_vexa_sessions_unit
    ON vexa_sessions(unit_id, started_at);
CREATE TABLE IF NOT EXISTS vexa_telemetry (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    unit_id    TEXT NOT NULL,
    ts         TEXT NOT NULL,
    lat        REAL,
    lon        REAL,
    speed_mph  REAL,
    payload    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vexa_telemetry_session
    ON vexa_telemetry(session_id, ts);
CREATE TABLE IF NOT EXISTS vexa_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_id    TEXT NOT NULL,
    session_id TEXT,
    timestamp  TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload    TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_vexa_events_unit
    ON vexa_events(unit_id, timestamp);
CREATE TABLE IF NOT EXISTS vexa_commands (
    command_id   TEXT PRIMARY KEY,
    unit_id      TEXT NOT NULL,
    type         TEXT NOT NULL,
    payload      TEXT NOT NULL DEFAULT '{}',
    status       TEXT NOT NULL DEFAULT 'pending',
    issued_at    TEXT NOT NULL,
    delivered_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_vexa_commands_pending
    ON vexa_commands(unit_id, status, issued_at);
"""

_schema_ready = False


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _ensure_schema(store: SQLiteStore) -> None:
    global _schema_ready
    if _schema_ready:
        return
    for statement in _SCHEMA.split(";"):
        if statement.strip():
            await store.execute_write_async(statement, ())
    _schema_ready = True


async def _verify_unit(store: SQLiteStore, unit_id: str,
                       token: Optional[str]) -> dict:
    unit = await store.execute_read_one_async(
        "SELECT * FROM vexa_units WHERE unit_id=?", (unit_id,))
    # unit_token stores sha256(token); hash the presented token and compare in
    # constant time. Legacy plaintext rows (pre-hashing) will fail here and must
    # be re-claimed — intended, since no real hardware is deployed yet.
    if not unit or not token or not constant_time_match(
            unit["unit_token"], hash_token(token)):
        raise HTTPException(status_code=401, detail="Invalid unit credentials")
    return unit


async def _touch_unit(store: SQLiteStore, unit_id: str) -> None:
    await store.execute_write_async(
        "UPDATE vexa_units SET online=1, last_seen=? WHERE unit_id=?",
        (_now(), unit_id),
    )


async def _enqueue_command(store: SQLiteStore, unit_id: str,
                           command_type: str, payload: Dict[str, Any]) -> str:
    command_id = uuid.uuid4().hex
    await store.execute_write_async(
        "INSERT INTO vexa_commands (command_id, unit_id, type, payload, issued_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (command_id, unit_id, command_type, json.dumps(payload), _now()),
    )
    return command_id


# ---------------------------------------------------------------------------
# voice_task_request → River Song tool → confirmation command
# ---------------------------------------------------------------------------

# kind → (River Song tool name, confirmation command type, payload key)
_VOICE_TASK_ROUTES = {
    "task": ("add_google_task", "task_created", "title"),
    "reminder": ("set_reminder", "reminder_created", "title"),
    "shopping_item": ("add_shopping_list_item", "shopping_item_added", "item"),
    "calendar_event": ("create_calendar_event", "calendar_event_created", "title"),
}

_TOOL_FAILURE_MARKERS = ("encountered an error", "encountered an issue",
                         "Unknown tool")


def _tool_failed(result: str) -> bool:
    # execute_tool() reports failures as prose for the LLM, never raises,
    # so failure has to be detected from the message itself.
    return any(marker in result for marker in _TOOL_FAILURE_MARKERS)


def _build_tool_input(kind: str, text: str, due_at: Optional[str]) -> dict:
    if kind == "task":
        return {"title": text}
    if kind == "reminder":
        return {"message": text, "datetime_str": due_at}
    if kind == "shopping_item":
        return {"item": text, "quantity": 1}
    # calendar_event — the tool takes a split date/time, not a timestamp
    dt = datetime.fromisoformat(str(due_at).replace("Z", "+00:00"))
    return {"title": text,
            "date": dt.strftime("%Y-%m-%d"),
            "time": dt.strftime("%H:%M")}


async def _handle_voice_task_request(store: SQLiteStore, unit: dict,
                                     payload: Dict[str, Any]) -> None:
    unit_id = unit["unit_id"]
    kind = payload.get("kind")
    text = str(payload.get("text") or "").strip()
    due_at = payload.get("due_at")

    if kind not in _VOICE_TASK_ROUTES or not text:
        await _enqueue_command(store, unit_id, "speak", {
            "text": "Sorry, I couldn't tell what you wanted me to add."})
        return

    if kind in ("reminder", "calendar_event") and not due_at:
        noun = "reminder" if kind == "reminder" else "calendar event"
        await _enqueue_command(store, unit_id, "speak", {
            "text": f"I need a time for that {noun}. Try again with a time."})
        return

    tool_name, confirm_type, payload_key = _VOICE_TASK_ROUTES[kind]
    try:
        tool_input = _build_tool_input(kind, text, due_at)
    except ValueError:
        await _enqueue_command(store, unit_id, "speak", {
            "text": "I couldn't understand the time on that one."})
        return

    from core.tools import execute_tool
    rider = unit.get("rider_id") or "primary_user"
    result = await execute_tool(tool_name, tool_input, {"user_id": rider})

    if _tool_failed(result):
        logger.warning("Vexa voice task (%s) failed for unit %s: %s",
                       kind, unit_id, result[:200])
        await _enqueue_command(store, unit_id, "speak", {
            "text": f"Sorry, that didn't go through. {result[:200]}"})
        return

    confirm_payload: Dict[str, Any] = {payload_key: text}
    if kind == "reminder" and due_at:
        confirm_payload["due_at"] = due_at
    await _enqueue_command(store, unit_id, confirm_type, confirm_payload)


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------

class ClaimBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class SessionStartBody(BaseModel):
    unit_id: str
    rider_id: str
    vehicle_type: Literal["motorcycle", "car"]


class SessionEndBody(BaseModel):
    session_id: str


class TelemetrySample(BaseModel):
    ts: str
    lat: Optional[float] = None
    lon: Optional[float] = None
    speed_mph: Optional[float] = None
    imu: Optional[Dict[str, Any]] = None
    obd: Optional[Dict[str, Any]] = None  # Verano (car) only; null on the bike


class TelemetryBody(BaseModel):
    session_id: str
    samples: List[TelemetrySample]


class EventBody(BaseModel):
    unit_id: str
    event_type: str
    payload: Dict[str, Any] = {}


class TtsBody(BaseModel):
    unit_id: str
    text: str = Field(min_length=1, max_length=_MAX_TTS_CHARS)


class CommandBody(BaseModel):
    type: str = Field(min_length=1, max_length=64)
    payload: Dict[str, Any] = {}


# ---------------------------------------------------------------------------
# Admin surface (JWT)
# ---------------------------------------------------------------------------

@router.post("/units/claim", dependencies=[Depends(require_role("admin"))])
async def claim_unit(body: ClaimBody):
    store = SQLiteStore()
    await _ensure_schema(store)
    unit_id = uuid.uuid4().hex[:12]
    unit_token = uuid.uuid4().hex + uuid.uuid4().hex
    # Store only the hash; the plaintext is returned to the admin once, here.
    await store.execute_write_async(
        "INSERT INTO vexa_units (unit_id, name, unit_token, registered_at) "
        "VALUES (?, ?, ?, ?)",
        (unit_id, body.name, hash_token(unit_token), _now()),
    )
    logger.info("Vexa: claimed unit %s (%s)", unit_id, body.name)
    return {"unit_id": unit_id, "unit_token": unit_token}


@router.get("/units", dependencies=[Depends(require_role("admin"))])
async def list_units():
    store = SQLiteStore()
    await _ensure_schema(store)
    rows = await store.execute_read_async(
        "SELECT unit_id, name, rider_id, presence, active_session_id, online, "
        "registered_at, last_seen FROM vexa_units ORDER BY registered_at",
        (),
    )
    return {"units": rows}


@router.delete("/units/{unit_id}",
               dependencies=[Depends(require_role("admin"))])
async def delete_unit(unit_id: str):
    store = SQLiteStore()
    await _ensure_schema(store)
    await store.execute_write_async(
        "DELETE FROM vexa_units WHERE unit_id=?", (unit_id,))
    return {"status": "ok"}


@router.post("/units/{unit_id}/command",
             dependencies=[Depends(require_role("admin"))])
async def queue_command(unit_id: str, body: CommandBody):
    store = SQLiteStore()
    await _ensure_schema(store)
    unit = await store.execute_read_one_async(
        "SELECT unit_id FROM vexa_units WHERE unit_id=?", (unit_id,))
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")
    command_id = await _enqueue_command(store, unit_id, body.type, body.payload)
    return {"command_id": command_id}


@router.get("/units/{unit_id}/sessions",
            dependencies=[Depends(require_role("admin"))])
async def list_sessions(unit_id: str, limit: int = 20):
    store = SQLiteStore()
    await _ensure_schema(store)
    rows = await store.execute_read_async(
        "SELECT * FROM vexa_sessions WHERE unit_id=? "
        "ORDER BY started_at DESC LIMIT ?",
        (unit_id, max(1, min(limit, 200))),
    )
    for r in rows:
        try:
            r["summary"] = json.loads(r["summary"]) if r.get("summary") else None
        except ValueError:
            r["summary"] = None
    return {"sessions": rows}


# ---------------------------------------------------------------------------
# Device surface (X-Unit-Token)
# ---------------------------------------------------------------------------

@router.post("/session/start")
async def session_start(body: SessionStartBody,
                        x_unit_token: Optional[str] = Header(default=None)):
    store = SQLiteStore()
    await _ensure_schema(store)
    await _verify_unit(store, body.unit_id, x_unit_token)

    session_id = uuid.uuid4().hex
    started_at = _now()
    await store.execute_write_async(
        "INSERT INTO vexa_sessions (session_id, unit_id, rider_id, vehicle_type, "
        "started_at, status) VALUES (?, ?, ?, ?, ?, 'active')",
        (session_id, body.unit_id, body.rider_id, body.vehicle_type, started_at),
    )
    # Presence flip: the rider is on the road — notification routing and
    # initiative delivery can key off presence='driving'.
    await store.execute_write_async(
        "UPDATE vexa_units SET presence='driving', active_session_id=?, "
        "rider_id=?, online=1, last_seen=? WHERE unit_id=?",
        (session_id, body.rider_id, started_at, body.unit_id),
    )
    logger.info("Vexa: session %s started on %s (%s, rider=%s)",
                session_id, body.unit_id, body.vehicle_type, body.rider_id)
    return {"session_id": session_id, "started_at": started_at}


@router.post("/session/end")
async def session_end(body: SessionEndBody,
                      x_unit_token: Optional[str] = Header(default=None)):
    store = SQLiteStore()
    await _ensure_schema(store)
    session = await store.execute_read_one_async(
        "SELECT * FROM vexa_sessions WHERE session_id=?", (body.session_id,))
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    await _verify_unit(store, session["unit_id"], x_unit_token)

    if session.get("ended_at"):
        return {"ended_at": session["ended_at"],
                "summary_ready": bool(session.get("summary"))}

    ended_at = _now()
    # Trip summary from ingested telemetry. Basic aggregates for now —
    # richer analytics (lean angles, fuel burn, route map) is a follow-up.
    stats = await store.execute_read_one_async(
        "SELECT COUNT(*) AS samples, MAX(speed_mph) AS max_speed_mph, "
        "AVG(speed_mph) AS avg_speed_mph, MIN(ts) AS first_ts, MAX(ts) AS last_ts "
        "FROM vexa_telemetry WHERE session_id=?",
        (body.session_id,),
    )
    samples = (stats or {}).get("samples") or 0
    summary = None
    if samples:
        summary = json.dumps({
            "samples": samples,
            "max_speed_mph": stats["max_speed_mph"],
            "avg_speed_mph": stats["avg_speed_mph"],
            "first_sample_ts": stats["first_ts"],
            "last_sample_ts": stats["last_ts"],
            "started_at": session["started_at"],
            "ended_at": ended_at,
        })

    await store.execute_write_async(
        "UPDATE vexa_sessions SET ended_at=?, status='completed', summary=? "
        "WHERE session_id=?",
        (ended_at, summary, body.session_id),
    )
    await store.execute_write_async(
        "UPDATE vexa_units SET presence='idle', active_session_id=NULL, "
        "last_seen=? WHERE unit_id=?",
        (ended_at, session["unit_id"]),
    )
    return {"ended_at": ended_at, "summary_ready": summary is not None}


@router.post("/telemetry")
async def post_telemetry(body: TelemetryBody,
                         x_unit_token: Optional[str] = Header(default=None)):
    store = SQLiteStore()
    await _ensure_schema(store)
    session = await store.execute_read_one_async(
        "SELECT unit_id FROM vexa_sessions WHERE session_id=?",
        (body.session_id,))
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    await _verify_unit(store, session["unit_id"], x_unit_token)
    if len(body.samples) > _MAX_TELEMETRY_BATCH:
        raise HTTPException(
            status_code=413,
            detail=f"Batch size limit exceeded (max {_MAX_TELEMETRY_BATCH})")

    # Closed sessions still accept samples — the client batches offline and
    # may flush after the ride ends.
    for sample in body.samples:
        await store.execute_write_async(
            "INSERT INTO vexa_telemetry (session_id, unit_id, ts, lat, lon, "
            "speed_mph, payload) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (body.session_id, session["unit_id"], sample.ts, sample.lat,
             sample.lon, sample.speed_mph, json.dumps(sample.model_dump())),
        )
    await _touch_unit(store, session["unit_id"])
    return {"accepted": len(body.samples)}


@router.get("/commands/poll")
async def poll_commands(unit_id: str,
                        x_unit_token: Optional[str] = Header(default=None)):
    store = SQLiteStore()
    await _ensure_schema(store)
    await _verify_unit(store, unit_id, x_unit_token)
    rows = await store.execute_read_async(
        "SELECT command_id, type, payload FROM vexa_commands "
        "WHERE unit_id=? AND status='pending' ORDER BY issued_at ASC",
        (unit_id,),
    )
    now = _now()
    commands = []
    for row in rows:
        await store.execute_write_async(
            "UPDATE vexa_commands SET status='delivered', delivered_at=? "
            "WHERE command_id=?",
            (now, row["command_id"]),
        )
        try:
            payload = json.loads(row["payload"] or "{}")
        except ValueError:
            payload = {}
        commands.append({"command_id": row["command_id"],
                         "type": row["type"],
                         "payload": payload})
    await _touch_unit(store, unit_id)
    return {"commands": commands}


@router.post("/event")
async def post_event(body: EventBody,
                     x_unit_token: Optional[str] = Header(default=None)):
    store = SQLiteStore()
    await _ensure_schema(store)
    unit = await _verify_unit(store, body.unit_id, x_unit_token)
    await store.execute_write_async(
        "INSERT INTO vexa_events (unit_id, session_id, timestamp, event_type, "
        "payload) VALUES (?, ?, ?, ?, ?)",
        (body.unit_id, unit.get("active_session_id"), _now(),
         body.event_type, json.dumps(body.payload)),
    )

    if body.event_type == "voice_task_request":
        await _handle_voice_task_request(store, unit, body.payload)
    elif body.event_type in ("sos", "crash_detected", "fuel_low"):
        from core.initiative import InitiativeEvent, get_initiative_engine
        severity = "warning" if body.event_type == "fuel_low" else "critical"
        await get_initiative_engine().submit(InitiativeEvent(
            kind="device_alert",
            title=f"Vexa unit {unit.get('name') or body.unit_id}",
            message=f"{body.event_type}: {json.dumps(body.payload)[:300]}",
            severity=severity,
            key=f"vexa:{body.unit_id}:{body.event_type}",
        ))

    await _touch_unit(store, body.unit_id)
    return {"acknowledged": True}


# ---------------------------------------------------------------------------
# One-shot Piper TTS for short announcements
# ---------------------------------------------------------------------------

_tts_provider = None


def _get_tts():
    """Lazy module-level PiperTTS — shares the voice configured in .env."""
    global _tts_provider
    if _tts_provider is None:
        from providers.tts.piper import PiperTTS
        _tts_provider = PiperTTS()
    return _tts_provider


@router.post("/tts")
async def tts(body: TtsBody,
              x_unit_token: Optional[str] = Header(default=None)):
    store = SQLiteStore()
    await _ensure_schema(store)
    await _verify_unit(store, body.unit_id, x_unit_token)
    try:
        provider = _get_tts()
        wav = await provider.synthesize(body.text)
    except (RuntimeError, FileNotFoundError, ValueError) as exc:
        logger.error("Vexa TTS failed: %s", exc)
        raise HTTPException(status_code=503, detail="TTS engine unavailable")
    return Response(content=wav, media_type="audio/wav")
