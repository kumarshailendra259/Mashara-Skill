"""Mess & Inventory Management module - comprehensive test suite (Phase 1 MVP)."""
import os
import io
import pytest
import requests
from datetime import date as _date

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://invest-analytics-24.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
TODAY = _date.today().isoformat()


# -------- Session / Auth helpers --------
def _login(email, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    csrf = s.cookies.get("csrf_token")
    s.headers.update({"X-CSRF-Token": csrf or ""})
    return s, r.json()


@pytest.fixture(scope="module")
def admin():
    s, me = _login("admin@finance.app", "Admin@123")
    return s, me


@pytest.fixture(scope="module")
def partner():
    try:
        s, me = _login("kumarshailendra259@gmail.com", "Test@1234")
        # Select partner company if membership selector required
        # Try fetching /auth/me to confirm role
        r = s.get(f"{API}/auth/me")
        return s, me
    except Exception as e:
        pytest.skip(f"partner login failed: {e}")


@pytest.fixture(scope="module")
def center_manager():
    try:
        s, me = _login("cmtest_salary@x.com", "Test@1234")
        return s, me
    except Exception:
        return None, None


# -------- Item Master --------
class TestItemMaster:
    def test_seeded_items_count(self, admin):
        s, _ = admin
        r = s.get(f"{API}/mess/items")
        assert r.status_code == 200
        items = r.json()
        names = [i["name"] for i in items]
        assert len(items) >= 16, f"expected >=16 seeded items, got {len(items)}: {names}"
        for required in ["Rice", "Wheat Flour (Atta)", "Toor Dal", "LPG Cylinder"]:
            assert required in names, f"missing seeded item {required}"

    def test_create_item_admin(self, admin):
        s, _ = admin
        import time
        name = f"TEST_Item_{int(time.time())}"
        r = s.post(f"{API}/mess/items", json={
            "name": name, "category": "TestCat", "base_unit": "kg",
            "purchase_unit": "bag", "conversion_factor": 10,
            "min_stock": 5, "reorder_level": 10, "avg_cost": 0, "active": True,
        })
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["name"] == name
        assert doc["conversion_factor"] == 10
        # cleanup is skipped (keep for traceability) but mark TEST_ prefix
        pytest.item_id_created = doc["id"]

    def test_duplicate_name_409(self, admin):
        s, _ = admin
        r = s.post(f"{API}/mess/items", json={
            "name": "Rice", "category": "G", "base_unit": "kg",
            "purchase_unit": "kg", "conversion_factor": 1,
        })
        assert r.status_code == 409, f"expected 409 got {r.status_code}: {r.text}"

    def test_conversion_factor_zero_400(self, admin):
        s, _ = admin
        r = s.post(f"{API}/mess/items", json={
            "name": "TEST_bad_conv", "category": "G", "base_unit": "kg",
            "purchase_unit": "bag", "conversion_factor": 0,
        })
        assert r.status_code == 400, f"expected 400 got {r.status_code}"

    def test_partner_cannot_create_item(self, partner):
        s, _ = partner
        r = s.post(f"{API}/mess/items", json={
            "name": "TEST_partner_item", "category": "X",
            "base_unit": "kg", "purchase_unit": "kg", "conversion_factor": 1,
        })
        assert r.status_code == 403, f"partner should get 403 got {r.status_code}: {r.text}"

    def test_edit_item_admin(self, admin):
        s, _ = admin
        items = s.get(f"{API}/mess/items").json()
        tgt = next((i for i in items if i["name"].startswith("TEST_Item_")), None)
        if not tgt:
            pytest.skip("no test item")
        r = s.put(f"{API}/mess/items/{tgt['id']}", json={
            "name": tgt["name"], "category": "UpdatedCat", "base_unit": "kg",
            "purchase_unit": "bag", "conversion_factor": 20,
            "min_stock": 10, "reorder_level": 15,
        })
        assert r.status_code == 200
        assert r.json()["category"] == "UpdatedCat"
        assert r.json()["conversion_factor"] == 20


# -------- Receipt / Approval / Stock --------
@pytest.fixture(scope="module")
def admin_center(admin):
    s, _ = admin
    r = s.get(f"{API}/centers")
    assert r.status_code == 200
    centers = r.json()
    assert centers, "no centers found"
    # Use the known smoke-test center if present
    smoke = next((c for c in centers if c["id"] == "668de8a2-1a5a-44cc-9553-25d64befd16a"), None)
    return (smoke or centers[0])["id"]


@pytest.fixture(scope="module")
def rice_item(admin):
    s, _ = admin
    items = s.get(f"{API}/mess/items").json()
    rice = next((i for i in items if i["name"] == "Rice"), None)
    assert rice, "Rice item not seeded"
    return rice


class TestReceiptLifecycle:
    def _unique_inv(self, prefix="TEST"):
        import time
        return f"{prefix}-{int(time.time()*1000)}"

    def test_receipt_approve_stock_and_single_expense(self, admin, admin_center, rice_item):
        s, _ = admin
        inv = self._unique_inv("APPROVE")
        # Record stock before
        pre = s.get(f"{API}/mess/stock", params={"center_id": admin_center}).json()
        pre_rice = next((x for x in pre if x["item_id"] == rice_item["id"]), None)
        pre_qty = float(pre_rice["qty"]) if pre_rice else 0.0

        payload = {
            "center_id": admin_center, "supplier_name": "TEST_Supplier",
            "invoice_no": inv, "invoice_date": TODAY,
            "lines": [{"item_id": rice_item["id"], "qty": 2, "unit": "bag",
                       "unit_price": 1250, "accepted_qty": 2, "rejected_qty": 0}],
        }
        r = s.post(f"{API}/mess/receipts", json=payload)
        assert r.status_code == 200, r.text
        rec = r.json()
        assert rec["status"] == "pending"
        assert rec["total_amount"] == 2500.0
        rid = rec["id"]

        # Approve
        r = s.post(f"{API}/mess/receipts/{rid}/approve")
        assert r.status_code == 200, r.text
        txn_id = r.json()["expense_txn_id"]
        assert txn_id

        # Stock increases by accepted_qty * conversion_factor (Rice conv=25) → 2*25=50kg
        conv = float(rice_item.get("conversion_factor") or 1)
        expected_delta = 2 * conv
        post = s.get(f"{API}/mess/stock", params={"center_id": admin_center}).json()
        post_rice = next((x for x in post if x["item_id"] == rice_item["id"]), None)
        assert post_rice is not None
        post_qty = float(post_rice["qty"])
        assert abs(post_qty - (pre_qty + expected_delta)) < 0.01, \
            f"stock delta expected {expected_delta}, got {post_qty - pre_qty}"

        # Verify finance expense exists & source=mess_purchase (match by invoice in description)
        tx = s.get(f"{API}/transactions", params={"source": "mess_purchase"}).json()
        rows = tx if isinstance(tx, list) else tx.get("transactions") or tx.get("items") or []
        found = [t for t in rows if inv in (t.get("description") or "")]
        assert len(found) == 1, f"expected 1 mess expense txn for inv={inv}, got {len(found)}"
        assert found[0].get("source") == "mess_purchase"
        assert float(found[0]["amount"]) == 2500.0

        # Re-approve should 400
        r = s.post(f"{API}/mess/receipts/{rid}/approve")
        assert r.status_code == 400, f"re-approve should 400 got {r.status_code}"

        # Still only one expense
        tx2 = s.get(f"{API}/transactions", params={"source": "mess_purchase"}).json()
        rows2 = tx2 if isinstance(tx2, list) else tx2.get("transactions") or tx2.get("items") or []
        found2 = [t for t in rows2 if inv in (t.get("description") or "")]
        assert len(found2) == 1, "re-approve produced duplicate expense"

    def test_rejected_qty_not_added_to_stock(self, admin, admin_center, rice_item):
        s, _ = admin
        pre = s.get(f"{API}/mess/stock", params={"center_id": admin_center}).json()
        pre_rice = next((x for x in pre if x["item_id"] == rice_item["id"]), None)
        pre_qty = float(pre_rice["qty"]) if pre_rice else 0.0

        inv = self._unique_inv("REJ")
        r = s.post(f"{API}/mess/receipts", json={
            "center_id": admin_center, "supplier_name": "TEST_Supplier2",
            "invoice_no": inv, "invoice_date": TODAY,
            "lines": [{"item_id": rice_item["id"], "qty": 10, "unit": "kg",
                       "unit_price": 60, "accepted_qty": 8, "rejected_qty": 2}],
        })
        assert r.status_code == 200
        rid = r.json()["id"]
        r = s.post(f"{API}/mess/receipts/{rid}/approve")
        assert r.status_code == 200

        post = s.get(f"{API}/mess/stock", params={"center_id": admin_center}).json()
        post_rice = next((x for x in post if x["item_id"] == rice_item["id"]), None)
        post_qty = float(post_rice["qty"])
        # qty entered in kg (base unit), conversion not applied — base qty = 8
        assert abs(post_qty - (pre_qty + 8)) < 0.01, f"expected +8 only (accepted), got +{post_qty - pre_qty}"

    def test_duplicate_invoice_409(self, admin, admin_center, rice_item):
        s, _ = admin
        inv = self._unique_inv("DUP")
        payload = {
            "center_id": admin_center, "supplier_name": "TEST_DupSup",
            "invoice_no": inv, "invoice_date": TODAY,
            "lines": [{"item_id": rice_item["id"], "qty": 1, "unit": "kg",
                       "unit_price": 50, "accepted_qty": 1}],
        }
        r1 = s.post(f"{API}/mess/receipts", json=payload)
        assert r1.status_code == 200
        r2 = s.post(f"{API}/mess/receipts", json=payload)
        assert r2.status_code == 409, f"expected 409 got {r2.status_code}: {r2.text}"


# -------- Weighted average costing --------
class TestWeightedAverage:
    def test_weighted_avg_cost(self, admin, admin_center):
        s, _ = admin
        # Create a fresh test item in a fresh test center to avoid pollution
        import time
        name = f"TEST_WAvg_{int(time.time())}"
        r = s.post(f"{API}/mess/items", json={
            "name": name, "category": "T", "base_unit": "kg",
            "purchase_unit": "kg", "conversion_factor": 1,
        })
        assert r.status_code == 200
        item_id = r.json()["id"]

        # Receipt A: 100kg @ 50
        inv_a = f"WA-A-{int(time.time()*1000)}"
        r = s.post(f"{API}/mess/receipts", json={
            "center_id": admin_center, "supplier_name": "WASUP",
            "invoice_no": inv_a, "invoice_date": TODAY,
            "lines": [{"item_id": item_id, "qty": 100, "unit": "kg",
                       "unit_price": 50, "accepted_qty": 100}],
        })
        assert r.status_code == 200
        s.post(f"{API}/mess/receipts/{r.json()['id']}/approve")

        # Receipt B: 100kg @ 70
        inv_b = f"WA-B-{int(time.time()*1000)}"
        r = s.post(f"{API}/mess/receipts", json={
            "center_id": admin_center, "supplier_name": "WASUP2",
            "invoice_no": inv_b, "invoice_date": TODAY,
            "lines": [{"item_id": item_id, "qty": 100, "unit": "kg",
                       "unit_price": 70, "accepted_qty": 100}],
        })
        assert r.status_code == 200
        s.post(f"{API}/mess/receipts/{r.json()['id']}/approve")

        stock = s.get(f"{API}/mess/stock", params={"center_id": admin_center}).json()
        row = next((x for x in stock if x["item_id"] == item_id), None)
        assert row is not None
        assert abs(float(row["qty"]) - 200) < 0.01
        assert abs(float(row["avg_cost"]) - 60.0) < 0.5, f"expected avg ~60 got {row['avg_cost']}"


# -------- Consumption / Wastage / Insufficient --------
class TestConsumption:
    def test_consumption_decrements_stock(self, admin, admin_center, rice_item):
        s, _ = admin
        pre = s.get(f"{API}/mess/stock", params={"center_id": admin_center}).json()
        pre_rice = next((x for x in pre if x["item_id"] == rice_item["id"]), None)
        assert pre_rice and float(pre_rice["qty"]) >= 20, "pre-condition fails: need >=20kg rice"
        pre_qty = float(pre_rice["qty"])

        r = s.post(f"{API}/mess/consumption", json={
            "center_id": admin_center, "date": TODAY, "meals_served": 50,
            "lines": [{"item_id": rice_item["id"], "qty": 10, "unit": "kg", "kind": "consumption"}],
        })
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["consumption_cost"] > 0

        post = s.get(f"{API}/mess/stock", params={"center_id": admin_center}).json()
        post_rice = next((x for x in post if x["item_id"] == rice_item["id"]), None)
        assert abs(float(post_rice["qty"]) - (pre_qty - 10)) < 0.01

    def test_insufficient_stock_400_no_negative(self, admin, admin_center, rice_item):
        s, _ = admin
        r = s.post(f"{API}/mess/consumption", json={
            "center_id": admin_center, "date": TODAY, "meals_served": 1,
            "lines": [{"item_id": rice_item["id"], "qty": 999999, "unit": "kg", "kind": "consumption"}],
        })
        assert r.status_code == 400, r.text
        stock = s.get(f"{API}/mess/stock", params={"center_id": admin_center}).json()
        for row in stock:
            assert float(row["qty"]) >= 0, f"negative stock detected on {row.get('item_name')}"

    def test_multi_line_rollback_on_insufficient(self, admin, admin_center, rice_item):
        s, _ = admin
        # Find another item with any stock
        stock = s.get(f"{API}/mess/stock", params={"center_id": admin_center}).json()
        other = next((x for x in stock if x["item_id"] != rice_item["id"] and float(x["qty"]) >= 1), None)
        if not other:
            pytest.skip("no second stocked item")
        pre_other = float(other["qty"])
        r = s.post(f"{API}/mess/consumption", json={
            "center_id": admin_center, "date": TODAY, "meals_served": 1,
            "lines": [
                {"item_id": other["item_id"], "qty": 1, "unit": other.get("base_unit", "kg"), "kind": "consumption"},
                {"item_id": rice_item["id"], "qty": 999999, "unit": "kg", "kind": "consumption"},
            ],
        })
        assert r.status_code == 400
        # Verify other item's qty unchanged (rollback)
        stock2 = s.get(f"{API}/mess/stock", params={"center_id": admin_center}).json()
        other2 = next((x for x in stock2 if x["item_id"] == other["item_id"]), None)
        assert abs(float(other2["qty"]) - pre_other) < 0.001, "partial posting detected (no rollback)"

    def test_wastage_separates_from_consumption(self, admin, admin_center, rice_item):
        s, _ = admin
        r = s.post(f"{API}/mess/consumption", json={
            "center_id": admin_center, "date": TODAY, "meals_served": 0,
            "lines": [{"item_id": rice_item["id"], "qty": 1, "unit": "kg", "kind": "wastage"}],
        })
        assert r.status_code == 200
        d = r.json()
        assert d["wastage_cost"] > 0
        assert d["consumption_cost"] == 0


# -------- Dashboard --------
class TestDashboard:
    def test_dashboard_fields_and_cost_per_person(self, admin, admin_center):
        s, _ = admin
        r = s.get(f"{API}/mess/dashboard", params={"center_id": admin_center, "date": TODAY})
        assert r.status_code == 200
        d = r.json()
        for k in ["opening_value", "today_received_value", "today_consumption_cost",
                  "closing_value", "today_mess_expenses", "meals_served",
                  "cost_per_person", "low_stock_count", "pending_bills"]:
            assert k in d, f"missing {k}"
        # cost_per_person must be consumption/meals (not purchases) OR null
        if d["meals_served"] and d["meals_served"] > 0:
            expected = round(d["today_consumption_cost"] / d["meals_served"], 2)
            assert abs(d["cost_per_person"] - expected) < 0.01

    def test_cost_per_person_null_when_zero_meals(self, admin):
        s, _ = admin
        # Use a date far in past where no meals are logged
        r = s.get(f"{API}/mess/dashboard", params={"date": "2000-01-01"})
        assert r.status_code == 200
        d = r.json()
        assert d["meals_served"] == 0
        assert d["cost_per_person"] is None


# -------- RBAC / Center isolation --------
class TestRBAC:
    def test_partner_sees_only_mapped_centers(self, partner, admin):
        s_p, _ = partner
        # Partner's stock listing
        stock = s_p.get(f"{API}/mess/stock").json()
        receipts = s_p.get(f"{API}/mess/receipts").json()
        # Collect centers in response
        pcs = {r.get("center_id") for r in stock if r.get("center_id")}
        pcs |= {r.get("center_id") for r in receipts if r.get("center_id")}
        # Expected mapped: Birsa Kairo + Palojori Deoghar (names given)
        s_a, _ = admin
        centers = s_a.get(f"{API}/centers").json()
        allowed = {c["id"] for c in centers if c["name"] in ("Birsa Kairo", "Palojori Deoghar")}
        # Partner data must be subset of allowed (if any data)
        for cid in pcs:
            assert cid in allowed, f"partner saw unauthorized center {cid}; allowed={allowed}"

    def test_partner_cross_center_403(self, partner, admin):
        s_p, _ = partner
        s_a, _ = admin
        centers = s_a.get(f"{API}/centers").json()
        allowed_names = ("Birsa Kairo", "Palojori Deoghar")
        outside = next((c for c in centers if c["name"] not in allowed_names), None)
        if not outside:
            pytest.skip("no outside center available")
        r = s_p.get(f"{API}/mess/stock", params={"center_id": outside["id"]})
        assert r.status_code == 403, f"expected 403 got {r.status_code} / {r.text[:200]}"
        r = s_p.get(f"{API}/mess/receipts", params={"center_id": outside["id"]})
        assert r.status_code == 403
        r = s_p.get(f"{API}/mess/dashboard", params={"center_id": outside["id"]})
        assert r.status_code == 403

    def test_unauthorized_role_403(self):
        # Spec example: "hr" role. The current `hr@finance.app` account has role=manager
        # (which IS allowed in MESS_VIEW_ROLES), so skip unless we find a user with an
        # actually unauthorized role. No such user is seeded today.
        pytest.skip("No seeded user with a role outside MESS_VIEW_ROLES available for testing")


# -------- Excel export --------
class TestExcelExport:
    def test_export_xlsx(self, admin, admin_center):
        s, _ = admin
        r = s.get(f"{API}/mess/ledger/export.xlsx", params={"center_id": admin_center})
        assert r.status_code == 200
        ct = r.headers.get("content-type", "")
        assert "spreadsheetml" in ct, f"wrong content-type: {ct}"
        assert r.content[:4] == b"PK\x03\x04", "not a valid xlsx (zip) file"


# -------- Regression: existing modules --------
class TestNoRegression:
    def test_transactions(self, admin):
        s, _ = admin
        r = s.get(f"{API}/transactions")
        assert r.status_code == 200

    def test_payroll_batches(self, admin):
        s, _ = admin
        r = s.get(f"{API}/payroll-batches")
        assert r.status_code == 200

    def test_approvals_pending(self, admin):
        s, _ = admin
        r = s.get(f"{API}/approvals/pending")
        assert r.status_code == 200
