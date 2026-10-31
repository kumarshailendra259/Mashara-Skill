# Mess Unit Conversion Engine — regression tests (engine unit tests + API)
import os
import sys
import time
import pytest
import requests

sys.path.insert(0, "/app/backend")
import unit_conversion as uc  # noqa: E402

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    for line in open("/app/frontend/.env"):
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip()
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"

RICE = {"name": "Rice", "base_unit": "kg", "purchase_unit": "bag", "conversion_factor": 25}
BREAD = {"name": "Bread", "base_unit": "packet", "purchase_unit": "packet", "conversion_factor": 1}
EGGS = {"name": "Eggs", "base_unit": "piece", "purchase_unit": "dozen", "conversion_factor": 12}


# --- Engine (pure python) ---
class TestEngine:
    def test_gram_to_kg(self):
        assert uc.to_base_qty(RICE, 500, "gram") == pytest.approx(0.5)

    def test_bag_to_kg(self):
        assert uc.to_base_qty(RICE, 2, "bag") == pytest.approx(50)

    def test_quintal_ton_mg(self):
        assert uc.to_base_qty(RICE, 1, "quintal") == pytest.approx(100)
        assert uc.to_base_qty(RICE, 1, "ton") == pytest.approx(1000)
        assert uc.to_base_qty(RICE, 1000, "mg") == pytest.approx(0.001)

    def test_incompatible_raises(self):
        with pytest.raises(uc.UnitError):
            uc.to_base_factor(RICE, "litre")
        with pytest.raises(uc.UnitError):
            uc.to_base_factor(BREAD, "gram")

    def test_compatible_units(self):
        assert uc.compatible_units(RICE) == ["kg", "gram", "mg", "quintal", "ton", "bag"]
        assert uc.compatible_units(BREAD) == ["packet"]
        assert uc.compatible_units(EGGS) == ["piece", "dozen", "pair"]


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    r = sess.post(f"{API}/auth/login", json={"email": "admin@finance.app", "password": "Admin@123"})
    if r.status_code != 200:
        pytest.skip("login failed")
    sess.headers["X-CSRF-Token"] = sess.cookies.get("csrf_token", "")
    return sess


@pytest.fixture(scope="module")
def ctx(s):
    items = {i["name"]: i for i in s.get(f"{API}/mess/items").json()}
    vendors = s.get(f"{API}/vendors").json()
    centers = s.get(f"{API}/centers").json()
    centers = centers if isinstance(centers, list) else centers.get("centers", [])
    return {"items": items, "vendor": vendors[0], "center": "668de8a2-1a5a-44cc-9553-25d64befd16a"}


def _receipt(ctx, inv, lines, att=True):
    return {"center_id": ctx["center"], "invoice_no": inv, "invoice_date": "2026-01-15",
            "supplier_id": ctx["vendor"]["id"], "supplier_name": ctx["vendor"]["name"],
            "lines": lines, "attachments": [{"filename": "b.png", "url": "/x"}] if att else []}


# --- API ---
class TestAPI:
    def test_unit_review_readonly(self, s):
        before = {r["id"]: r["total_amount"] for r in s.get(f"{API}/mess/receipts").json()}
        r = s.get(f"{API}/mess/receipts/unit-review")
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d["flagged"], list) and d["count"] == len(d["flagged"])
        after = {r["id"]: r["total_amount"] for r in s.get(f"{API}/mess/receipts").json()}
        assert before == after

    def test_receipt_requires_attachment(self, s, ctx):
        rice = ctx["items"]["Rice"]
        r = s.post(f"{API}/mess/receipts", json=_receipt(ctx, f"TEST-UE-NOATT-{time.time()}",
                   [{"item_id": rice["id"], "qty": 1, "unit": "kg", "unit_price": 1, "accepted_qty": 1}], att=False))
        assert r.status_code == 400

    def test_receipt_incompatible_unit_400(self, s, ctx):
        rice = ctx["items"]["Rice"]
        r = s.post(f"{API}/mess/receipts", json=_receipt(ctx, f"TEST-UE-BAD-{time.time()}",
                   [{"item_id": rice["id"], "qty": 1, "unit": "litre", "unit_price": 1, "accepted_qty": 1}]))
        assert r.status_code == 400
        assert "not compatible" in r.text

    def test_receipt_gram_and_bag(self, s, ctx):
        rice = ctx["items"]["Rice"]
        conv = float(rice["conversion_factor"])
        r = s.post(f"{API}/mess/receipts", json=_receipt(ctx, f"TEST-UE-OK-{int(time.time())}", [
            {"item_id": rice["id"], "qty": 500, "unit": "gram", "unit_price": 400, "accepted_qty": 500},
            {"item_id": rice["id"], "qty": 2, "unit": "bag", "unit_price": 400, "accepted_qty": 2},
        ]))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["lines"][0]["line_total"] == 200
        assert d["lines"][0]["qty_base"] == 0.5
        assert d["lines"][1]["line_total"] == round(2 * conv * 400, 2)
        assert d["total_amount"] == round(200 + 2 * conv * 400, 2)
        # cleanup via reject
        s.post(f"{API}/mess/receipts/{d['id']}/reject", json={"remarks": "TEST cleanup"})

    def test_item_fields_persist(self, s):
        name = f"TEST_UE_Item_{int(time.time())}"
        r = s.post(f"{API}/mess/items", json={"name": name, "category": "T", "base_unit": "kg",
                   "purchase_unit": "bag", "conversion_factor": 10, "consumption_unit": "gram", "allow_decimal": False})
        assert r.status_code in (200, 201), r.text
        it = [i for i in s.get(f"{API}/mess/items").json() if i["name"] == name][0]
        assert it["consumption_unit"] == "gram"
        assert it["allow_decimal"] is False

    def test_item_incompatible_consumption_unit_rejected(self, s):
        # EXPECTED: consumption_unit must be compatible with base_unit
        name = f"TEST_UE_BadCons_{int(time.time())}"
        r = s.post(f"{API}/mess/items", json={"name": name, "category": "T", "base_unit": "kg",
                   "purchase_unit": "bag", "conversion_factor": 10, "consumption_unit": "litre"})
        assert r.status_code == 400, f"accepted incompatible consumption_unit: {r.status_code}"
