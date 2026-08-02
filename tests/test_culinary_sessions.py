"""
tests/test_culinary_sessions.py

Cooking sessions: the state behind "we are on step 3".

The behaviours that matter are the ones that make a session worth having over
a step list — that the same session is visible from every device, that a step
carries the ingredients for that step only, that a timer survives a reboot,
and that a voice command and an HTTP call do the same thing.
"""

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from core.auth import create_access_token
from main import app

client = TestClient(app)

RECIPE = {
    "title": "Victoria Sponge",
    "servings": 4,
    "ingredients": [
        {"name": "plain flour", "qty": "200", "unit": "g"},
        {"name": "caster sugar", "qty": "200", "unit": "g"},
        {"name": "butter", "qty": "200", "unit": "g"},
        {"name": "eggs", "qty": "4", "unit": ""},
        {"name": "raspberry jam", "qty": "3", "unit": "tbsp"},
    ],
    "steps": [
        "Cream the butter and caster sugar until pale.",
        "Beat in the eggs, then fold in the flour.",
        "Bake for 25 minutes until risen and golden.",
        "Leave to cool, then spread with raspberry jam.",
    ],
}


@pytest.fixture(scope="module")
def headers():
    token = create_access_token("cook-test-user", "cook@test.local", "admin")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def recipe_id(headers):
    """
    The test recipe, created once and reused.

    Recipe titles are unique per household and the test database persists
    between runs, so a second run gets a 409 rather than a fresh row — look
    the existing one up instead of failing on it.
    """
    r = client.post("/api/culinary/recipes", json=RECIPE, headers=headers)
    if r.status_code in (200, 201):
        return r.json()["id"]
    assert r.status_code == 409, r.text

    existing = client.get("/api/culinary/recipes", headers=headers).json()
    match = next((x for x in existing if x["title"] == RECIPE["title"]), None)
    assert match, "recipe reported as a duplicate but is not in the library"
    return match["id"]


@pytest.fixture(autouse=True)
def _end_any_session(headers):
    """Sessions are singular per household; don't let one test leak into the next."""
    yield
    current = client.get("/api/culinary/sessions/current", headers=headers).json()
    if current.get("session"):
        client.post(f"/api/culinary/sessions/{current['session']['id']}/end",
                    headers=headers)


def _start(headers, recipe_id, servings=4):
    r = client.post("/api/culinary/sessions",
                    json={"recipe_id": recipe_id, "target_servings": servings},
                    headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


# ---------------------------------------------------------------------------
# Starting
# ---------------------------------------------------------------------------

def test_session_starts_on_the_first_step(headers, recipe_id):
    session = _start(headers, recipe_id)
    assert session["is_active"] is True
    assert session["steps_total"] == 4
    assert session["step"]["index"] == 0
    assert session["step"]["number"] == 1
    assert session["step"]["is_first"] and not session["step"]["is_last"]
    assert "Cream the butter" in session["step"]["instruction"]


def test_step_carries_both_field_names(headers, recipe_id):
    """
    `instruction` is canonical and `text` is the device's tolerated alias.

    A mismatch here leaves River silent on every step of a recipe, which on a
    screenless unit is the entire feature — so both are always present and
    always equal.
    """
    session = _start(headers, recipe_id)
    step = session["step"]
    assert step["instruction"] == step["text"]
    assert step["instruction"]


def test_scaling_is_applied_at_start(headers, recipe_id):
    session = _start(headers, recipe_id, servings=8)
    assert session["servings"] == 8
    assert session["scale_factor"] == 2.0
    flour = next(i for i in session["ingredients"] if i["name"] == "plain flour")
    assert flour["qty"] == "400"


def test_starting_a_second_session_ends_the_first(headers, recipe_id):
    """Two live sessions would mean two answers to 'what step are we on'."""
    first = _start(headers, recipe_id)
    second = _start(headers, recipe_id)
    assert second["id"] != first["id"]

    stale = client.get(f"/api/culinary/sessions/{first['id']}",
                       headers=headers).json()
    assert stale["is_active"] is False

    current = client.get("/api/culinary/sessions/current", headers=headers).json()
    assert current["session"]["id"] == second["id"]


def test_no_session_is_not_an_error(headers):
    r = client.get("/api/culinary/sessions/current", headers=headers)
    assert r.status_code == 200
    assert r.json()["session"] is None


def test_sessions_require_auth(recipe_id):
    assert client.get("/api/culinary/sessions/current").status_code == 401
    assert client.post("/api/culinary/sessions",
                       json={"recipe_id": recipe_id}).status_code == 401


# ---------------------------------------------------------------------------
# Per-step content
# ---------------------------------------------------------------------------

def test_a_step_carries_only_its_own_ingredients(headers, recipe_id):
    session = _start(headers, recipe_id)
    sid = session["id"]

    def names(payload):
        return {i["name"] for i in payload["step"]["ingredients"]}

    assert names(session) == {"butter", "caster sugar"}

    step2 = client.post(f"/api/culinary/sessions/{sid}/step",
                        json={"action": "next"}, headers=headers).json()
    assert names(step2) == {"eggs", "plain flour"}

    step4 = client.post(f"/api/culinary/sessions/{sid}/step",
                        json={"action": "goto", "index": 3},
                        headers=headers).json()
    assert names(step4) == {"raspberry jam"}


def test_a_step_that_names_a_duration_suggests_a_timer(headers, recipe_id):
    session = _start(headers, recipe_id)
    sid = session["id"]

    assert session["step"]["suggested_timer"] is None

    baking = client.post(f"/api/culinary/sessions/{sid}/step",
                         json={"action": "goto", "index": 2},
                         headers=headers).json()
    timer = baking["step"]["suggested_timer"]
    assert timer == {"label": "Bake", "duration_seconds": 1500}


# ---------------------------------------------------------------------------
# Moving between steps
# ---------------------------------------------------------------------------

def test_step_navigation(headers, recipe_id):
    sid = _start(headers, recipe_id)["id"]

    def move(action, **kwargs):
        return client.post(f"/api/culinary/sessions/{sid}/step",
                           json={"action": action, **kwargs},
                           headers=headers).json()

    assert move("next")["step"]["index"] == 1
    assert move("next")["step"]["index"] == 2
    assert move("back")["step"]["index"] == 1
    assert move("goto", index=3)["step"]["index"] == 3
    assert move("repeat")["step"]["index"] == 3


def test_running_off_either_end_explains_itself(headers, recipe_id):
    """Not an error — a voice caller needs something to say."""
    sid = _start(headers, recipe_id)["id"]

    r = client.post(f"/api/culinary/sessions/{sid}/step",
                    json={"action": "back"}, headers=headers)
    assert r.status_code == 200
    assert r.json()["step"]["index"] == 0
    assert "first step" in r.json()["message"]

    client.post(f"/api/culinary/sessions/{sid}/step",
                json={"action": "goto", "index": 3}, headers=headers)
    r = client.post(f"/api/culinary/sessions/{sid}/step",
                    json={"action": "next"}, headers=headers)
    assert r.status_code == 200
    assert r.json()["step"]["index"] == 3
    assert "last step" in r.json()["message"]

    r = client.post(f"/api/culinary/sessions/{sid}/step",
                    json={"action": "goto", "index": 99}, headers=headers)
    assert "only 4 steps" in r.json()["message"]


def test_the_session_is_the_same_from_anywhere(headers, recipe_id):
    """
    Start in the browser, walk to the kitchen, same step.

    Two independent reads of the household's current session must agree —
    that is the whole reason a session is household-scoped rather than
    per-device.
    """
    sid = _start(headers, recipe_id)["id"]
    client.post(f"/api/culinary/sessions/{sid}/step",
                json={"action": "next"}, headers=headers)

    from_kitchen = client.get("/api/culinary/sessions/current",
                              headers=headers).json()["session"]
    by_id = client.get(f"/api/culinary/sessions/{sid}", headers=headers).json()

    assert from_kitchen["id"] == by_id["id"] == sid
    assert from_kitchen["step"]["index"] == by_id["step"]["index"] == 1


# ---------------------------------------------------------------------------
# Timers
# ---------------------------------------------------------------------------

def test_timer_stores_a_deadline_not_a_countdown(headers, recipe_id):
    """
    A countdown needs something running to decrement it, so it loses exactly
    the time a reboot takes. A deadline is true whenever it is next read.
    """
    sid = _start(headers, recipe_id)["id"]

    r = client.post(f"/api/culinary/sessions/{sid}/timer",
                    json={"seconds": 1500, "label": "Bake"}, headers=headers)
    assert r.status_code == 201, r.text
    timer = r.json()

    assert timer["label"] == "Bake"
    assert timer["duration_seconds"] == 1500
    assert timer["status"] == "running"
    assert 1490 <= timer["remaining_seconds"] <= 1500

    ends_at = datetime.fromisoformat(timer["ends_at"])
    expected = datetime.now(timezone.utc) + timedelta(seconds=1500)
    assert abs((ends_at - expected).total_seconds()) < 10


def test_a_timer_survives_the_process_that_started_it(headers, recipe_id):
    """
    Rewriting the stored deadline into the past is what a reboot looks like
    from the timer's point of view: nothing decremented it, and it is simply
    due when next read.
    """
    sid = _start(headers, recipe_id)["id"]
    timer_id = client.post(f"/api/culinary/sessions/{sid}/timer",
                           json={"seconds": 60, "label": "Rest"},
                           headers=headers).json()["id"]

    async def _backdate():
        from api.routes.culinary import _Session
        from culinary.models import CookingTimer

        db = _Session()
        try:
            timer = db.query(CookingTimer).filter_by(id=timer_id).first()
            timer.ends_at = datetime.now(timezone.utc) - timedelta(seconds=5)
            db.commit()
        finally:
            db.close()

    asyncio.run(_backdate())

    current = client.get("/api/culinary/sessions/current",
                         headers=headers).json()["session"]
    fired = [t for t in current["timers"] if t["id"] == timer_id]
    assert fired and fired[0]["status"] == "fired"
    assert fired[0]["remaining_seconds"] == 0


def test_timer_bound_to_the_step_that_started_it(headers, recipe_id):
    sid = _start(headers, recipe_id)["id"]
    client.post(f"/api/culinary/sessions/{sid}/step",
                json={"action": "goto", "index": 2}, headers=headers)

    timer = client.post(f"/api/culinary/sessions/{sid}/timer",
                        json={"seconds": 1500, "label": "Bake"},
                        headers=headers).json()
    assert timer["step_index"] == 2


def test_cancelling_a_timer(headers, recipe_id):
    sid = _start(headers, recipe_id)["id"]
    tid = client.post(f"/api/culinary/sessions/{sid}/timer",
                      json={"seconds": 300}, headers=headers).json()["id"]

    r = client.delete(f"/api/culinary/sessions/{sid}/timer/{tid}",
                      headers=headers)
    assert r.status_code == 200

    session = client.get(f"/api/culinary/sessions/{sid}", headers=headers).json()
    assert next(t for t in session["timers"] if t["id"] == tid)["status"] == "cancelled"


def test_ending_a_session_cancels_its_timers(headers, recipe_id):
    """A timer for a dish nobody is cooking must not go off later."""
    sid = _start(headers, recipe_id)["id"]
    client.post(f"/api/culinary/sessions/{sid}/timer",
                json={"seconds": 3000}, headers=headers)

    ended = client.post(f"/api/culinary/sessions/{sid}/end",
                        headers=headers).json()
    assert ended["is_active"] is False
    assert all(t["status"] == "cancelled" for t in ended["timers"])

    assert client.get("/api/culinary/sessions/current",
                      headers=headers).json()["session"] is None


def test_a_finished_session_refuses_further_moves(headers, recipe_id):
    sid = _start(headers, recipe_id)["id"]
    client.post(f"/api/culinary/sessions/{sid}/end", headers=headers)

    assert client.post(f"/api/culinary/sessions/{sid}/step",
                       json={"action": "next"},
                       headers=headers).status_code == 404
    assert client.post(f"/api/culinary/sessions/{sid}/timer",
                       json={"seconds": 60},
                       headers=headers).status_code == 404


# ---------------------------------------------------------------------------
# Voice
# ---------------------------------------------------------------------------

def test_voice_commands_parse():
    from core.intent_router import parse_cooking_command

    assert parse_cooking_command("next step") == ("next", "")
    assert parse_cooking_command("go back a step") == ("back", "")
    assert parse_cooking_command("repeat that") == ("repeat", "")
    assert parse_cooking_command("how much flour") == ("how_much", "flour")
    assert parse_cooking_command("set a timer for 10 minutes") == ("timer", "600")
    assert parse_cooking_command("how long left") == ("how_long", "")
    # Not cooking commands at all.
    assert parse_cooking_command("what's the weather") is None
    assert parse_cooking_command("play some jazz") is None


def test_spoken_durations():
    from core.intent_router import parse_spoken_duration

    assert parse_spoken_duration("for 10 minutes") == 600
    assert parse_spoken_duration("90 seconds") == 90
    assert parse_spoken_duration("1 hour 30 minutes") == 5400
    # No digits: better to ask than to guess a number someone cooks by.
    assert parse_spoken_duration("an hour and a half") == 0


def test_voice_and_http_move_the_same_session(headers, recipe_id):
    """
    "Next" over the microphone and "Next" tapped on a wall panel must be the
    same operation, not two implementations that drift.
    """
    from api.routes.culinary_sessions import voice_command

    sid = _start(headers, recipe_id)["id"]

    spoken = asyncio.run(voice_command("cook-test-user", "next"))
    assert "Step 2 of 4" in spoken
    assert "Beat in the eggs" in spoken

    session = client.get(f"/api/culinary/sessions/{sid}", headers=headers).json()
    assert session["step"]["index"] == 1

    # And an HTTP move is visible to the next voice command.
    client.post(f"/api/culinary/sessions/{sid}/step",
                json={"action": "goto", "index": 3}, headers=headers)
    spoken = asyncio.run(voice_command("cook-test-user", "repeat"))
    assert "Step 4 of 4" in spoken


def test_voice_answers_how_much(headers, recipe_id):
    from api.routes.culinary_sessions import voice_command

    _start(headers, recipe_id, servings=8)
    spoken = asyncio.run(voice_command("cook-test-user", "how_much", "flour"))
    assert "400" in spoken and "flour" in spoken


def test_voice_how_much_falls_through_for_non_recipe_questions(headers, recipe_id):
    """
    "How much do I owe you" is not a recipe question, even mid-cook.

    None sends it back to the LLM; answering it out of the ingredient list
    would be confidently wrong.
    """
    from api.routes.culinary_sessions import voice_command

    _start(headers, recipe_id)
    assert asyncio.run(
        voice_command("cook-test-user", "how_much", "do i owe you")) is None
    # A real ingredient that simply is not in this recipe still gets answered.
    assert "saffron" in asyncio.run(
        voice_command("cook-test-user", "how_much", "saffron"))


def test_voice_sets_and_reports_timers(headers, recipe_id):
    from api.routes.culinary_sessions import voice_command

    sid = _start(headers, recipe_id)["id"]
    client.post(f"/api/culinary/sessions/{sid}/step",
                json={"action": "goto", "index": 2}, headers=headers)

    spoken = asyncio.run(voice_command("cook-test-user", "timer", "1500"))
    assert "25 minutes" in spoken
    # The step's own verb names the timer.
    assert "Bake" in spoken

    spoken = asyncio.run(voice_command("cook-test-user", "how_long"))
    assert "Bake" in spoken and "minute" in spoken


def test_voice_is_silent_when_nobody_is_cooking():
    """No session means this was never a cooking command; the LLM takes it."""
    from api.routes.culinary_sessions import voice_command

    assert asyncio.run(voice_command("cook-test-user", "next")) is None


def test_cooking_intent_defers_to_the_llm_when_not_cooking():
    from core.intent_router import _handle_cooking

    # Empty string is the router's "use the LLM path" signal.
    assert asyncio.run(_handle_cooking("next step", "cook-test-user")) == ""
    assert asyncio.run(_handle_cooking("what's the weather", "cook-test-user")) == ""


# ---------------------------------------------------------------------------
# Vortex integration
# ---------------------------------------------------------------------------

def test_step_changes_reach_the_kitchen_screen(headers, recipe_id):
    """A step that only reached one of the three screens is the bug this fixes."""
    from core.vortex_surfaces import get_surface_publisher

    sid = _start(headers, recipe_id)["id"]
    client.post(f"/api/culinary/sessions/{sid}/step",
                json={"action": "next"}, headers=headers)

    card = asyncio.run(get_surface_publisher().find("cooking-step"))
    assert card is not None
    assert "Victoria Sponge" in card.title
    assert "step 2 of 4" in card.title
    assert "Beat in the eggs" in card.body
    # Screenless units exist; the card has to be speakable.
    assert card.speech and "Step 2" in card.speech


def test_ending_a_session_takes_the_card_down(headers, recipe_id):
    """A card left to expire is a card that stayed up after it stopped mattering."""
    from core.vortex_surfaces import get_surface_publisher

    sid = _start(headers, recipe_id)["id"]
    assert asyncio.run(get_surface_publisher().find("cooking-step")) is not None

    client.post(f"/api/culinary/sessions/{sid}/end", headers=headers)
    assert asyncio.run(get_surface_publisher().find("cooking-step")) is None
