"""
tests/test_recipe_adding.py

Getting a recipe into the library. Three routes in, and the important one is
the one that needs nothing else running.

The backend already accepted a manual POST and a PDF/URL ingest; what was
missing was a way to paste text, and any UI at all for creating one. The
paste route matters because it is what the other two fall back to — the
error for a bot-protected site literally tells you to copy the text and use
manual entry, advice that previously had nowhere to go.
"""

import io

import pytest
from fastapi.testclient import TestClient

from core.auth import create_access_token
from main import app

client = TestClient(app)


@pytest.fixture
def chef(app_store):
    return {
        "Authorization": f"Bearer {create_access_token('chef', 'chef@example.com', 'admin')}"
    }


def _unique(prefix):
    import uuid
    return f"{prefix} {uuid.uuid4().hex[:8]}"


# =============================================================================
# Manual entry — the route with no dependencies
# =============================================================================


def test_manual_recipe_is_created_and_listed(chef):
    title = _unique("Roast Chicken")
    r = client.post("/api/culinary/recipes", headers=chef, json={
        "title": title,
        "meal_type": "Dinner",
        "servings": 4,
        "ingredients": [{"name": "1 whole chicken"}, {"name": "2 lemons"}],
        "steps": ["Heat the oven.", "Roast for 80 minutes."],
        "equipment_needed": ["roasting tin"],
    })
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["title"] == title
    assert created["servings"] == 4

    listed = client.get("/api/culinary/recipes", headers=chef)
    assert listed.status_code == 200
    body = listed.json()
    rows = body if isinstance(body, list) else body.get("recipes", [])
    assert any(x["title"] == title for x in rows)


def test_manual_recipe_needs_no_ai_model(chef, monkeypatch):
    """Manual entry is the fallback the other two routes point at, so it must
    not quietly depend on Ollama being up."""
    import api.routes.culinary as culinary

    async def explode(*a, **k):
        raise AssertionError("manual entry must not call the model")

    monkeypatch.setattr(culinary, "_call_ollama", explode)
    r = client.post("/api/culinary/recipes", headers=chef, json={
        "title": _unique("No Model Needed"),
        "ingredients": [{"name": "salt"}],
        "steps": ["Season."],
    })
    assert r.status_code == 201, r.text


def test_a_recipe_with_only_a_title_is_accepted(chef):
    """Half-finished entry is normal — someone types the name and comes back
    to it. Requiring every field would push them to not bother."""
    r = client.post("/api/culinary/recipes", headers=chef,
                    json={"title": _unique("Stub")})
    assert r.status_code == 201, r.text


def test_duplicate_titles_are_refused(chef):
    title = _unique("Only Once")
    first = client.post("/api/culinary/recipes", headers=chef, json={"title": title})
    assert first.status_code == 201
    again = client.post("/api/culinary/recipes", headers=chef, json={"title": title})
    assert again.status_code == 409


def test_adding_a_recipe_requires_authentication():
    r = client.post("/api/culinary/recipes", json={"title": "Anonymous Stew"})
    assert r.status_code in (401, 403)


# =============================================================================
# Ingest — the source routing, which is what changed
# =============================================================================


def test_ingest_with_no_source_explains_all_three_options(chef):
    r = client.post("/api/culinary/recipes/ingest", headers=chef, data={})
    assert r.status_code == 400
    detail = r.json()["detail"].lower()
    assert "pdf" in detail and "source_url" in detail and "raw_text" in detail


def test_pasted_text_reaches_the_parser(chef, monkeypatch):
    """The new route. Ollama is stubbed — this asserts the wiring, not the
    model's parsing ability."""
    import api.routes.culinary as culinary

    seen = {}

    async def fake_ollama(prompt):
        seen["prompt"] = prompt
        return (
            '{"title": "Pasted Toast", "meal_type": "Breakfast", "servings": 1,'
            ' "ingredients": [{"name": "1 slice bread"}], "steps": ["Toast it."]}'
        )

    monkeypatch.setattr(culinary, "_call_ollama", fake_ollama)

    r = client.post(
        "/api/culinary/recipes/ingest",
        headers=chef,
        data={"raw_text": "Toast\n\n1 slice bread\n\nToast the bread."},
    )
    assert r.status_code == 201, r.text
    assert "1 slice bread" in seen["prompt"], "the pasted text must reach the model"


def test_pasted_text_that_yields_nothing_points_at_manual_entry(chef, monkeypatch):
    """When the local model is down this is the likely failure, and sending
    someone to re-check their paste instead of their daemon wastes their
    time."""
    import api.routes.culinary as culinary

    async def dead_ollama(prompt):
        raise RuntimeError("connection refused")

    monkeypatch.setattr(culinary, "_call_ollama", dead_ollama)

    r = client.post(
        "/api/culinary/recipes/ingest",
        headers=chef,
        data={"raw_text": "Some recipe text that cannot be parsed"},
    )
    assert r.status_code == 502
    assert "manual entry" in r.json()["detail"].lower()


def test_blank_pasted_text_is_not_treated_as_a_source(chef):
    r = client.post(
        "/api/culinary/recipes/ingest", headers=chef, data={"raw_text": "   "}
    )
    assert r.status_code == 400


def test_a_corrupt_pdf_is_a_clean_error_not_a_crash(chef):
    r = client.post(
        "/api/culinary/recipes/ingest",
        headers=chef,
        files={"file": ("notreally.pdf", io.BytesIO(b"this is not a pdf"), "application/pdf")},
    )
    assert r.status_code in (400, 500)
    assert r.status_code != 201


def test_oversized_paste_is_refused_before_any_model_call(chef, monkeypatch):
    """Each chunk is one sequential call to a single local model, so an
    unbounded paste is an unbounded queue — one user pasting a book keeps
    every other room's turn waiting behind it."""
    import api.routes.culinary as culinary

    async def explode(prompt):
        raise AssertionError("must reject before calling the model")

    monkeypatch.setattr(culinary, "_call_ollama", explode)

    r = client.post(
        "/api/culinary/recipes/ingest",
        headers=chef,
        data={"raw_text": "x" * (culinary._MAX_PASTED_RECIPE_CHARS + 1)},
    )
    assert r.status_code == 400
    assert "limit" in r.json()["detail"].lower()


def test_a_normal_length_paste_is_still_accepted(chef, monkeypatch):
    import api.routes.culinary as culinary

    async def fake(prompt):
        return '{"title": "Long But Fine", "ingredients": [], "steps": ["Cook."]}'

    monkeypatch.setattr(culinary, "_call_ollama", fake)
    r = client.post(
        "/api/culinary/recipes/ingest",
        headers=chef,
        data={"raw_text": "a recipe " * 500},
    )
    assert r.status_code == 201, r.text
