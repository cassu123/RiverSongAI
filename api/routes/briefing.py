"""
api/routes/briefing.py

Aggregate endpoint behind the Daily Briefing screen, plus the spoken briefing.

Why an aggregate: the page previously fired four independent requests and let
each fail silently into an empty card, so a single dead upstream (Google
disconnected, no saved weather location) rendered as a blank panel with no
explanation. Here every section is gathered concurrently and each one carries
its own ``status``, so the UI can distinguish "nothing scheduled" from
"calendar is not connected" from "calendar is down right now".

Nothing in this module raises on an upstream failure — a briefing that renders
four of five sections is worth far more than a 500.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Header, HTTPException, Request, Response
from pydantic import BaseModel, Field

from core.auth import decode_token
from core.timeutil import local_now, local_today_str

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/briefing", tags=["briefing"])

# Cap what we read aloud; a spoken briefing that runs for minutes is worse
# than one that gives you the headline and stops.
_SPEAK_MAX_AGENDA = 5
_SPEAK_MAX_REMINDERS = 5
_MAX_SPEAK_CHARS = 4000

# WMO weather code -> (Material Symbols icon, spoken/label description).
# Mirrors the mapping the frontend used to keep privately; single source now.
_WMO: Dict[int, tuple] = {
    0:  ("clear_day", "clear"),
    1:  ("partly_cloudy_day", "mostly clear"),
    2:  ("partly_cloudy_day", "partly cloudy"),
    3:  ("cloud", "overcast"),
    45: ("foggy", "foggy"),
    48: ("foggy", "freezing fog"),
    51: ("rainy_light", "light drizzle"),
    53: ("rainy_light", "drizzle"),
    55: ("rainy_light", "heavy drizzle"),
    56: ("weather_mix", "freezing drizzle"),
    57: ("weather_mix", "freezing drizzle"),
    61: ("rainy_light", "light rain"),
    63: ("rainy", "rain"),
    65: ("rainy_heavy", "heavy rain"),
    66: ("weather_mix", "freezing rain"),
    67: ("weather_mix", "freezing rain"),
    71: ("weather_snowy", "light snow"),
    73: ("weather_snowy", "snow"),
    75: ("snowing_heavy", "heavy snow"),
    77: ("weather_snowy", "snow grains"),
    80: ("rainy", "rain showers"),
    81: ("rainy", "rain showers"),
    82: ("rainy_heavy", "violent rain showers"),
    85: ("weather_snowy", "snow showers"),
    86: ("snowing_heavy", "heavy snow showers"),
    95: ("thunderstorm", "thunderstorms"),
    96: ("thunderstorm", "thunderstorms with hail"),
    99: ("thunderstorm", "thunderstorms with hail"),
}


# ---------------------------------------------------------------------------
# Auth helpers (mirrors api/routes/feeds.py)
# ---------------------------------------------------------------------------

async def _require_user(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(status_code=401,
                            detail="Invalid or expired token.")
    return payload["sub"]


def _store(request: Request):
    mm = getattr(request.app.state, "memory_manager", None)
    if mm is None:
        raise HTTPException(status_code=503,
                            detail="Memory manager not available.")
    return mm._store


def _greeting(hour: int) -> str:
    if hour < 12:
        return "Good morning"
    if hour < 18:
        return "Good afternoon"
    return "Good evening"


# ---------------------------------------------------------------------------
# Section builders — each returns {"status": ..., ...} and never raises
# ---------------------------------------------------------------------------

async def _section_weather(request: Request, user_id: str) -> Dict[str, Any]:
    """Current conditions. status: ok | unconfigured | unavailable"""
    try:
        from api.services.feed_service import FeedService
        data = await FeedService.get_weather(_store(request), user_id)
    except HTTPException as exc:
        if exc.status_code == 404:
            return {"status": "unconfigured"}
        return {"status": "unavailable"}
    except Exception as exc:
        logger.warning("Briefing weather failed for %s: %s", user_id, exc)
        return {"status": "unavailable"}

    try:
        current = (data or {}).get("current") or {}
        daily = (data or {}).get("daily") or {}
        code = current.get("weathercode")
        
        try:
            code_int = int(code) if code is not None else -1
        except (ValueError, TypeError):
            code_int = -1
            
        icon, description = _WMO.get(code_int, ("thermostat", "current conditions"))

        temp = current.get("temperature_2m")
        unit = "F" if (data or {}).get("unit") == "fahrenheit" else "C"

        def _first(seq):
            return seq[0] if isinstance(seq, list) and seq else None

        return {
            "status": "ok",
            "temperature": round(temp) if isinstance(temp, (int, float)) else None,
            "feels_like": (round(current.get("apparent_temperature"))
                           if isinstance(current.get("apparent_temperature"),
                                         (int, float)) else None),
            "unit": unit,
            "code": code,
            "icon": icon,
            "description": description,
            "high": (round(v) if isinstance(
                v := _first(daily.get("temperature_2m_max")), (int, float)) else None),
            "low": (round(v) if isinstance(
                v := _first(daily.get("temperature_2m_min")), (int, float)) else None),
        }
    except Exception as exc:
        logger.warning("Briefing weather parsing failed for %s: %s", user_id, exc)
        return {"status": "unavailable"}


async def _section_agenda(user_id: str) -> Dict[str, Any]:
    """Today's calendar. status: ok | disconnected | unavailable"""
    try:
        from config.settings import get_settings
        from providers.google.auth import GoogleAuth

        settings = get_settings()
        auth = GoogleAuth(
            client_secrets_path=settings.google_client_secrets_path,
            token_storage_path=settings.google_token_storage_path,
        )

        try:
            auth.get_credentials(user_id)
        except RuntimeError:
            return {"status": "disconnected", "events": []}

        from providers.google.calendar import GoogleCalendarProvider
        provider = GoogleCalendarProvider(auth, user_id)
        events = await provider.get_upcoming_events(days_ahead=1, max_results=10)

        return {"status": "ok", "events": [_norm_event(e) for e in (events or []) if isinstance(e, dict)]}
    except Exception as exc:
        logger.warning("Briefing agenda failed for %s: %s", user_id, exc)
        return {"status": "unavailable", "events": []}


def _norm_event(event: Dict[str, Any]) -> Dict[str, Any]:
    """
    Flatten a Google event into what the card needs.
    """
    start = event.get("start") or {}
    all_day = bool(start.get("date") and not start.get("dateTime"))
    return {
        "id": event.get("id"),
        "title": event.get("summary") or "Untitled event",
        "start": start.get("dateTime") or start.get("date"),
        "all_day": all_day,
        "location": event.get("location"),
    }


async def _section_reminders(user_id: str) -> Dict[str, Any]:
    """Open Google Tasks. status: ok | disconnected | unavailable"""
    try:
        from providers.google.tasks import build_tasks_provider
        provider = build_tasks_provider(user_id)
        tasks = await provider.get_tasks(tasklist_id="@default")
        
        items = [
            {
                "id": t.get("id"),
                "title": t.get("title") or "Untitled",
                "due": t.get("due"),
                "notes": t.get("notes"),
            }
            for t in (tasks or []) if isinstance(t, dict)
            if isinstance(t.get("title"), str) and t.get("title").strip()
        ]
        return {"status": "ok", "items": items}
    except Exception as exc:
        logger.warning("Briefing reminders failed for %s: %s", user_id, exc)
        return {"status": "unavailable", "items": []}


async def _section_updates(request: Request, user_id: str) -> Dict[str, Any]:
    """
    Undelivered proactive notifications — the "important stuff" the system
    surfaced while the user was away.
    """
    try:
        store = _store(request)
        rows = await store.execute_read_async(
            "SELECT kind, severity, title, body, created_at "
            "FROM proactive_log WHERE user_id = ? AND delivered = 0 "
            "ORDER BY created_at DESC LIMIT 20",
            (user_id,),
        )

        return {
            "status": "ok",
            "items": [
                {
                    "kind": r["kind"],
                    "severity": r["severity"],
                    "title": r["title"],
                    "body": r["body"],
                    "created_at": r["created_at"],
                }
                for r in (rows or [])
            ],
        }
    except Exception as exc:
        logger.warning("Briefing updates failed for %s: %s", user_id, exc)
        return {"status": "unavailable", "items": []}


async def _section_headlines(request: Request, user_id: str) -> Dict[str, Any]:
    """Top news headlines. status: ok | unavailable"""
    try:
        from api.services.feed_service import FeedService
        # Returns a flat list of articles (empty when no sources are chosen).
        articles = await FeedService.get_news(_store(request), user_id)

        return {
            "status": "ok",
            "items": [
                {
                    "title": a.get("title"),
                    "source": a.get("source"),
                    "url": a.get("url"),
                    "image_url": a.get("image_url"),
                }
                for a in (articles or [])[:6] if isinstance(a, dict)
                if isinstance(a.get("title"), str) and a.get("title").strip()
            ],
        }
    except Exception as exc:
        logger.warning("Briefing headlines failed for %s: %s", user_id, exc)
        return {"status": "unavailable", "items": []}


# ---------------------------------------------------------------------------
# Spoken script
# ---------------------------------------------------------------------------

def _fmt_event_time(ev: Dict[str, Any]) -> str:
    if ev.get("all_day"):
        return "All day"
    raw = ev.get("start")
    if not raw:
        return ""
    try:
        from datetime import datetime
        return datetime.fromisoformat(
            raw.replace("Z", "+00:00")).astimezone(
                local_now().tzinfo).strftime("%-I:%M %p")
    except Exception:
        return ""


def build_script(payload: Dict[str, Any]) -> str:
    """Compose the human-readable briefing that River reads aloud."""
    parts: List[str] = []
    name = payload.get("name") or ""
    parts.append(f"{payload.get('greeting', 'Hello')}{', ' + name if name else ''}.")

    wx = payload.get("weather") or {}
    if wx.get("status") == "ok" and wx.get("temperature") is not None:
        line = f"It's {wx['temperature']} degrees and {wx.get('description', 'current conditions')}"
        if wx.get("high") is not None and wx.get("low") is not None:
            line += f", with a high of {wx['high']} and a low of {wx['low']}"
        parts.append(line + ".")

    agenda = (payload.get("agenda") or {}).get("events") or []
    if agenda:
        count = len(agenda)
        parts.append(
            f"You have {count} event{'s' if count != 1 else ''} today.")
        for ev in agenda[:_SPEAK_MAX_AGENDA]:
            when = _fmt_event_time(ev)
            parts.append(f"{when}, {ev['title']}." if when else f"{ev['title']}.")
    elif (payload.get("agenda") or {}).get("status") == "ok":
        parts.append("Your calendar is clear today.")

    reminders = (payload.get("reminders") or {}).get("items") or []
    if reminders:
        count = len(reminders)
        parts.append(
            f"{count} open reminder{'s' if count != 1 else ''}.")
        for item in reminders[:_SPEAK_MAX_REMINDERS]:
            parts.append(f"{item['title']}.")

    updates = (payload.get("updates") or {}).get("items") or []
    if updates:
        count = len(updates)
        parts.append(
            f"And {count} update{'s' if count != 1 else ''} while you were away.")
        for item in updates[:3]:
            if item.get("title"):
                parts.append(f"{item['title']}.")

    return " ".join(p for p in parts if p)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/summary")
async def get_briefing_summary(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """
    Everything the Daily Briefing screen renders, in one round trip.

    Sections are fetched concurrently and degrade independently.
    """
    user_id = await _require_user(authorization)
    now = local_now()

    results = await asyncio.gather(
        _section_weather(request, user_id),
        _section_agenda(user_id),
        _section_reminders(user_id),
        _section_updates(request, user_id),
        _section_headlines(request, user_id),
        return_exceptions=True
    )

    def _safe_res(res, fallback):
        return fallback if isinstance(res, Exception) else res

    weather = _safe_res(results[0], {"status": "unavailable"})
    agenda = _safe_res(results[1], {"status": "unavailable", "events": []})
    reminders = _safe_res(results[2], {"status": "unavailable", "items": []})
    updates = _safe_res(results[3], {"status": "unavailable", "items": []})
    headlines = _safe_res(results[4], {"status": "unavailable", "items": []})

    name = ""
    try:
        row = await _store(request).execute_read_one_async(
            "SELECT display_name FROM users WHERE id = ?", (user_id,))
        if row:
            name = (row["display_name"] or "").split(" ")[0]
    except Exception:
        pass

    payload: Dict[str, Any] = {
        "greeting": _greeting(now.hour),
        "name": name,
        "date": local_today_str(),
        "date_label": now.strftime("%A, %b %-d"),
        "weather": weather,
        "agenda": agenda,
        "reminders": reminders,
        "updates": updates,
        "headlines": headlines,
    }
    payload["script"] = build_script(payload)
    return payload


class SpeakBody(BaseModel):
    text: Optional[str] = Field(
        default=None,
        description="Override text. When omitted the live briefing is composed "
                    "server-side so the spoken and on-screen briefing agree.",
    )


@router.post("/speak")
async def speak_briefing(
    request: Request,
    body: SpeakBody,
    authorization: Optional[str] = Header(default=None),
):
    """
    Synthesize the briefing in River's configured voice and return WAV audio.
    """
    user_id = await _require_user(authorization)

    text = (body.text or "").strip()
    if not text:
        summary = await get_briefing_summary(request, authorization)
        
        # Try to generate script via LLM
        try:
            from core.conversation_loop import _instantiate_llm
            store = _store(request)
            llm_settings = await store.get_llm_settings(user_id)
            provider = getattr(llm_settings, "provider", "ollama")
            model = getattr(llm_settings, "model", "llama3.2:3b")
            llm = _instantiate_llm(provider, model)
            
            prompt = (
                "You are an AI assistant giving a daily briefing to the user. "
                "You will receive a JSON payload with today's weather, agenda, reminders, "
                "updates, and news headlines. Synthesize this data into a conversational, "
                "friendly, and concise audio script meant to be read aloud (about 1 minute long). "
                "Do NOT use markdown. Write exactly what you will say. Keep it smooth and professional.\n\n"
                f"Data: {json.dumps(summary)}"
            )
            
            messages = [
                {"role": "system", "content": "You are a helpful, conversational AI assistant."},
                {"role": "user", "content": prompt}
            ]
            text = await llm.chat(messages)
            text = (text or "").strip()
            if not text:
                # Treat empty LLM response as missing, use fallback
                text = summary.get("script") or ""
        except Exception as exc:
            logger.error("LLM generation for briefing script failed: %s", exc)
            # Fallback to the hardcoded script
            text = summary.get("script") or ""
            
    if not text:
        raise HTTPException(status_code=422,
                            detail="Nothing to read for this briefing.")
    text = text[:_MAX_SPEAK_CHARS]

    try:
        from core.conversation_loop import _build_tts_provider
        provider = _build_tts_provider()
        wav = await provider.synthesize(text)
    except (RuntimeError, FileNotFoundError, ValueError) as exc:
        logger.error("Briefing TTS failed for %s: %s", user_id, exc)
        raise HTTPException(status_code=503,
                            detail="Voice engine unavailable.")
    except Exception as exc:
        logger.error("Briefing TTS failed for %s: %s", user_id, exc)
        raise HTTPException(status_code=503,
                            detail="Voice engine unavailable.")

    if not wav:
        raise HTTPException(status_code=503,
                            detail="Voice engine produced no audio.")

    return Response(content=wav, media_type="audio/wav")
