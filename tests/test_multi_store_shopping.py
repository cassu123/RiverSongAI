import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch
from main import app
from api.routes.culinary import _Session, get_db
from culinary.models import Household, ShoppingListItem, StoreMapping, WalmartMapping, ListSource
from core.tools import _exec_add_shopping_list, _exec_read_shopping_list

@pytest.fixture
def client():
    return TestClient(app)

@pytest.fixture(autouse=True)
def test_user_household():
    """Household for the test shopper, emptied before and after each test.

    autouse, because these tests run against the configured database rather
    than a throwaway one. Without the teardown every run left its rows behind,
    so the suite's own history became test input -- and the fixture only
    cleaned up for tests that asked for it by name, which none of them did.
    """
    user_id = "test_shopper_123"

    def _purge(db, household_id):
        db.query(ShoppingListItem).filter_by(household_id=household_id).delete()
        db.query(StoreMapping).filter_by(household_id=household_id).delete()
        db.query(WalmartMapping).filter_by(household_id=household_id).delete()
        db.commit()

    db = _Session()
    try:
        hh = db.query(Household).filter_by(owner_id=user_id).first()
        if not hh:
            hh = Household(owner_id=user_id)
            db.add(hh)
            db.commit()
            db.refresh(hh)
        household_id = hh.id
        _purge(db, household_id)
        yield user_id, household_id
    finally:
        try:
            _purge(db, household_id)
        finally:
            db.close()

def test_add_shopping_item_with_store(client, monkeypatch):
    monkeypatch.setattr("api.routes.culinary._get_user_id", AsyncMock(return_value="test_shopper_123"))
    
    # 1. Add item with explicit store
    res = client.post("/api/culinary/grocery", json={
        "name": "Organic Milk",
        "qty": "2",
        "unit": "gallons",
        "store": "Costco"
    })
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["store"] == "Costco"
    item_id = data["id"]

    # 2. Verify in grocery list
    res = client.get("/api/culinary/grocery")
    assert res.status_code == 200
    items = res.json()
    matched = next((i for i in items if i["id"] == item_id), None)
    assert matched is not None
    assert matched["name"] == "Organic Milk"
    assert matched["store"] == "Costco"

    # 3. Filter by store
    res_costco = client.get("/api/culinary/grocery?store=Costco")
    assert res_costco.status_code == 200
    assert any(i["id"] == item_id for i in res_costco.json())

    res_walmart = client.get("/api/culinary/grocery?store=Walmart")
    assert res_walmart.status_code == 200
    assert not any(i["id"] == item_id for i in res_walmart.json())

def test_store_mappings_and_cart_export(client, monkeypatch):
    monkeypatch.setattr("api.routes.culinary._get_user_id", AsyncMock(return_value="test_shopper_123"))

    # 1. Create Amazon mapping
    res = client.post("/api/culinary/store/mappings", json={
        "ingredient_name": "AA Batteries",
        "store": "amazon",
        "store_item_id": "https://www.amazon.com/dp/B00NTCH52W"
    })
    assert res.status_code == 201
    map_data = res.json()
    assert map_data["store_item_id"] == "B00NTCH52W"
    assert map_data["store"] == "amazon"

    # 2. Create Walmart mapping
    res = client.post("/api/culinary/store/mappings", json={
        "ingredient_name": "Eggs",
        "store": "walmart",
        "store_item_id": "https://www.walmart.com/ip/Great-Value-Eggs/14505111"
    })
    assert res.status_code == 201
    assert res.json()["store_item_id"] == "14505111"

    # 3. Add item without store — should auto-resolve from mapping!
    res = client.post("/api/culinary/grocery", json={
        "name": "AA Batteries",
        "qty": "1"
    })
    assert res.status_code == 200
    assert res.json()["store"] == "Amazon"

    # 4. Export Amazon. There is no Amazon cart URL to build -- the old
    # /gp/aws/cart/add.html Associates endpoint is retired, and a link that
    # always errors is worse than none. The mapped item still comes back with
    # a working per-item search link.
    export_res = client.post("/api/culinary/store/export?store=amazon&source=list", json={})
    assert export_res.status_code == 200
    exp_data = export_res.json()
    assert exp_data["store"] == "amazon"
    assert exp_data["cart_url"] is None
    batteries = next(
        (link for link in exp_data["search_links"] if link["name"] == "AA Batteries"),
        None,
    )
    assert batteries is not None
    assert batteries["mapped"] is True
    assert "amazon.com" in batteries["url"]

    # 5. Export Walmart Cart
    client.post("/api/culinary/grocery", json={"name": "Eggs", "qty": "2"})
    export_wm = client.post("/api/culinary/store/export?store=walmart&source=list", json={})
    assert export_wm.status_code == 200
    assert "14505111_2" in export_wm.json()["cart_url"]

@pytest.mark.asyncio
async def test_tools_add_and_read_shopping_list(test_user_household):
    user_id, hh_id = test_user_household

    # Add item with store cue in string
    reply = await _exec_add_shopping_list({"item": "Paper Towels from Costco", "quantity": "1"}, user_id)
    assert "Costco" in reply
    assert "Paper Towels" in reply

    # Read shopping list
    list_reply = await _exec_read_shopping_list({}, user_id)
    assert "Costco" in list_reply
    assert "Paper Towels" in list_reply

    # Read shopping list filtered by store
    costco_reply = await _exec_read_shopping_list({"store": "Costco"}, user_id)
    assert "Paper Towels" in costco_reply
