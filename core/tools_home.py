"""
core/tools_home.py

Voice authoring of device alerts — the last piece of phase H4 in
docs/smart-home-plan.md.

"When the garage door opens after 10pm, let me know" becomes a routine with
trigger="device" and a trigger_config the H4 evaluator already understands.

The natural language is parsed by the model filling in this tool's schema, not
by regex here. Phrasings for the same rule are unbounded — "if the garage is
still open ten minutes after I go to bed" — and a pattern list would cover the
sentences someone thought of and silently drop the rest. The model turns the
sentence into fields; this module's job is to validate them, store them, and
say back in plain language what it understood, so a misread is visible
immediately rather than the first time the alert fails to arrive.
"""

from __future__ import annotations

import logging
import uuid
from typing import Optional

logger = logging.getLogger(__name__)

# Sensor classes worth alerting on, with the wording people actually use.
DEVICE_CLASS_SYNONYMS = {
    "leak": "moisture", "water": "moisture", "flood": "moisture",
    "moisture": "moisture",
    "smoke": "smoke", "fire": "smoke",
    "gas": "gas", "co": "carbon_monoxide",
    "carbon monoxide": "carbon_monoxide", "carbon_monoxide": "carbon_monoxide",
    "door": "door", "garage": "garage_door", "garage door": "garage_door",
    "window": "window", "motion": "motion", "occupancy": "occupancy",
    "lock": "lock", "battery": "battery", "temperature": "temperature",
}


def _store():
    from main import get_app
    app = get_app()
    return app.state.memory_manager._store if app else None


def _norm_hhmm(value: Optional[str]) -> Optional[str]:
    """Accept '22:00', '10pm', '10 PM' — reject anything else rather than
    guessing, because a misread quiet window silences a real alert."""
    if not value:
        return None
    v = str(value).strip().lower().replace(" ", "")
    try:
        if v.endswith("am") or v.endswith("pm"):
            suffix, v = v[-2:], v[:-2]
            hh, mm = (v.split(":") + ["0"])[:2]
            hh, mm = int(hh), int(mm)
            if suffix == "pm" and hh != 12:
                hh += 12
            if suffix == "am" and hh == 12:
                hh = 0
        else:
            hh, mm = (v.split(":") + ["0"])[:2]
            hh, mm = int(hh), int(mm)
        if not (0 <= hh <= 23 and 0 <= mm <= 59):
            return None
        return f"{hh:02d}:{mm:02d}"
    except Exception:
        return None


def describe(config: dict, name: str = "", severity: str = "") -> str:
    """Say a rule back in the words someone would use.

    This is the confirmation the speaker hears, so it has to describe what was
    actually stored rather than echoing what was asked for.
    """
    what = (
        f"any {config['device_class'].replace('_', ' ')} sensor"
        if config.get("device_class") else
        config.get("entity_id") or
        (f"anything in {config['area']}" if config.get("area") else None) or
        (f"any {config['domain']}" if config.get("domain") else "nothing")
    )
    parts = [f"when {what}"]
    if config.get("to_state"):
        parts.append(f"turns {config['to_state']}")
    if config.get("for_seconds"):
        secs = config["for_seconds"]
        if secs < 60:
            # round() would confirm a 30-second hold as "0 minutes".
            n = int(secs)
            held = f"{n} second{'s' if n != 1 else ''}"
        else:
            mins = round(secs / 60)
            held = f"{mins} minute{'s' if mins != 1 else ''}"
        parts.append(f"and stays that way for {held}")
    w = config.get("time_window")
    if w:
        parts.append(f"between {w['start']} and {w['end']}")
    line = " ".join(parts)
    if severity == "critical":
        line += " — as a critical alert, which will reach you during quiet hours"
    return line


async def _exec_create_device_alert(args: dict, user_id: str) -> str:
    from core.family import is_feature_enabled_for
    if not await is_feature_enabled_for(user_id, "home"):
        return "Home control isn't enabled for you."

    store = _store()
    if not store:
        return "I can't reach the routine store right now."

    config: dict = {}
    raw_class = (args.get("device_class") or "").strip().lower()
    if raw_class:
        config["device_class"] = DEVICE_CLASS_SYNONYMS.get(raw_class, raw_class)
    if args.get("entity_id"):
        config["entity_id"] = args["entity_id"].strip()
    if args.get("area"):
        config["area"] = args["area"].strip()
    if args.get("domain"):
        config["domain"] = args["domain"].strip().lower()

    if not config:
        return ("I need to know what to watch — a kind of sensor (leak, smoke, "
                "door), a specific device, or a room.")

    config["to_state"] = (args.get("to_state") or "on").strip().lower()

    for_minutes = args.get("for_minutes")
    if for_minutes:
        try:
            config["for_seconds"] = max(0.0, float(for_minutes) * 60)
        except (TypeError, ValueError):
            return f"I didn't understand '{for_minutes}' as a number of minutes."

    start = _norm_hhmm(args.get("between_start"))
    end = _norm_hhmm(args.get("between_end"))
    if (args.get("between_start") or args.get("between_end")) and not (start and end):
        return ("I need both ends of the time window, like 'between 10pm and "
                "6am'. I'd rather ask than guess and silence the alert.")
    if start and end:
        config["time_window"] = {"start": start, "end": end}

    severity = (args.get("severity") or "warning").strip().lower()
    if severity not in ("info", "warning", "critical"):
        severity = "warning"

    name = (args.get("name") or "").strip() or f"Alert: {describe(config)}"[:60]

    try:
        await store.create_routine({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "name": name,
            "trigger": "device",
            "prompt": (args.get("action") or "").strip(),
            "type": "alert",
            "severity": severity,
            "enabled": True,
            "builtin": False,
            "trigger_config": config,
        })
    except Exception as e:
        logger.error("Could not create device alert: %s", e)
        return "Something went wrong saving that alert."

    return f"Done. I'll tell you {describe(config, name, severity)}."


async def _exec_list_device_alerts(args: dict, user_id: str) -> str:
    from core.family import is_feature_enabled_for
    if not await is_feature_enabled_for(user_id, "home"):
        return "Home control isn't enabled for you."
    store = _store()
    if not store:
        return "I can't reach the routine store right now."

    rules = [r for r in await store.list_routines(user_id)
             if r.get("trigger") == "device"]
    if not rules:
        return "You have no device alerts set up."

    # A filter, so "what happens when the garage opens?" is answerable.
    about = (args.get("about") or "").strip().lower()
    if about:
        key = DEVICE_CLASS_SYNONYMS.get(about, about)
        rules = [r for r in rules
                 if key in str(r.get("trigger_config") or {}).lower()
                 or about in r["name"].lower()]
        if not rules:
            return f"Nothing is watching for {about}."

    lines = []
    for r in rules:
        state = "" if r.get("enabled") else " (muted)"
        tag = " [built-in]" if r.get("builtin") else ""
        lines.append(
            f"- {r['name']}{state}{tag}: "
            f"{describe(r.get('trigger_config') or {}, severity=r.get('severity'))}")
    return "Your device alerts:\n" + "\n".join(lines)


async def _exec_set_device_alert(args: dict, user_id: str) -> str:
    """Mute, unmute or delete an alert by name."""
    from core.family import is_feature_enabled_for
    if not await is_feature_enabled_for(user_id, "home"):
        return "Home control isn't enabled for you."
    store = _store()
    if not store:
        return "I can't reach the routine store right now."

    wanted = (args.get("name") or "").strip().lower()
    action = (args.get("action") or "").strip().lower()
    if not wanted:
        return "Which alert? Tell me its name."

    rules = [r for r in await store.list_routines(user_id)
             if r.get("trigger") == "device"]
    matches = [r for r in rules if wanted in r["name"].lower()]
    if not matches:
        return f"I couldn't find an alert called '{args.get('name')}'."
    if len(matches) > 1:
        names = ", ".join(r["name"] for r in matches[:5])
        return f"That matches more than one: {names}. Which did you mean?"

    rule = matches[0]
    if action == "delete":
        if rule.get("builtin"):
            # Deleting a safety rule would look identical to it never having
            # existed. Muting is reversible and visible in the Home page.
            await store.update_routine(rule["id"], user_id, {"enabled": False})
            return (f"'{rule['name']}' is a built-in safety alert, so I muted "
                    f"it rather than deleting it. You can turn it back on any "
                    f"time.")
        await store.delete_routine(rule["id"], user_id)
        return f"Deleted '{rule['name']}'."

    # An unrecognised action used to fall through to enabled=False, so a typo
    # silently muted the alert — the one outcome nobody asks for by accident.
    if action in ("enable", "unmute", "on"):
        enable = True
    elif action in ("mute", "disable", "off"):
        enable = False
    else:
        return (f"I don't know how to '{action}' an alert. I can mute, "
                f"unmute, or delete it.")
    await store.update_routine(rule["id"], user_id, {"enabled": enable})
    return f"'{rule['name']}' is {'on' if enable else 'muted'}."
