"""Phase 90 — Work Order linkage on Quotation -> Payment -> Transaction, txn WO filter, reports by_work_order."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
CENTER_WITH_WO = "4d7fc745-c28c-4298-baab-58c63dbe8734"
WO_ID = "6631bff3-9ec2-4662-8766-5c23aac63f0f"
WO_NO = "WO-BG-SEED-01"
DESC = "TEST_IT90 WO quote"


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, r.text
    s.headers.update({"X-CSRF-Token": s.cookies.get("csrf_token")})
    return s


@pytest.fixture(scope="module")
def admin():
    return _login("admin@finance.app", "Admin@123")


@pytest.fixture(scope="module")
def state():
    return {}


# --- Work Orders lookup by center
def test_work_orders_for_center(admin):
    r = admin.get(f"{API}/work-orders", params={"center_id": CENTER_WITH_WO})
    assert r.status_code == 200
    ids = [w["id"] for w in r.json()]
    assert WO_ID in ids


# --- Quotation create validations
class TestQuotationValidation:
    def test_expense_without_wo_400(self, admin):
        r = admin.post(f"{API}/quotations", json={"center_id": CENTER_WITH_WO, "category": "expense",
                                                 "vendor_name": "TEST_V", "estimated_amount": 10, "description": DESC})
        assert r.status_code == 400
        assert "Work Order" in r.json()["detail"]

    def test_bogus_wo_400(self, admin):
        r = admin.post(f"{API}/quotations", json={"center_id": CENTER_WITH_WO, "category": "expense",
                                                 "vendor_name": "TEST_V", "estimated_amount": 10, "description": DESC,
                                                 "work_order_id": "nope"})
        assert r.status_code == 400

    def test_cross_center_wo_400(self, admin):
        centers = admin.get(f"{API}/centers").json()
        other = next(c["id"] for c in centers if c["id"] != CENTER_WITH_WO)
        r = admin.post(f"{API}/quotations", json={"center_id": other, "category": "expense",
                                                 "vendor_name": "TEST_V", "estimated_amount": 10, "description": DESC,
                                                 "work_order_id": WO_ID})
        assert r.status_code == 400
        assert "does not belong" in r.json()["detail"]


# --- E2E: quotation (WO) -> approve -> payment -> approve -> expense txn carries WO
class TestE2E:
    def test_create_quotation(self, admin, state):
        r = admin.post(f"{API}/quotations", json={"center_id": CENTER_WITH_WO, "category": "expense",
                                                 "vendor_name": "TEST_V_IT90", "estimated_amount": 123,
                                                 "description": DESC, "work_order_id": WO_ID})
        assert r.status_code == 200, r.text
        q = r.json()
        assert q["work_order_id"] == WO_ID and q["work_order_no"] == WO_NO
        state["qid"] = q["id"]
        lst = admin.get(f"{API}/quotations").json()
        row = next(x for x in lst if x["id"] == q["id"])
        assert row["work_order_no"] == WO_NO

    def test_approve_quotation(self, admin, state):
        for _ in range(8):
            q = next(x for x in admin.get(f"{API}/quotations").json() if x["id"] == state["qid"])
            if q["status"] == "approved":
                break
            r = admin.post(f"{API}/approvals/act", json={"request_type": "quotation", "request_id": state["qid"],
                                                        "action": "approve", "remarks": "ok by test"})
            assert r.status_code == 200, r.text
        assert q["status"] == "approved"
        assert q.get("qrn")

    def test_raise_payment(self, admin, state):
        r = admin.post(f"{API}/payments", json={"quotation_id": state["qid"], "actual_amount": 123,
                                               "payment_mode": "cash"})
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["work_order_id"] == WO_ID and p["work_order_no"] == WO_NO
        state["pid"] = p["id"]

    def test_approve_payment_creates_txn_with_wo(self, admin, state):
        banks = admin.get(f"{API}/bank-accounts").json()
        bank = next((b["id"] for b in banks if b.get("is_active", True)), None) if isinstance(banks, list) else None
        txn_id = None
        for _ in range(8):
            r = admin.post(f"{API}/approvals/act", json={
                "request_type": "payment", "request_id": state["pid"], "action": "approve", "remarks": "ok by test",
                "paid_by_name": "Admin", "txn_center_id": CENTER_WITH_WO, "bank_account_id": bank})
            assert r.status_code == 200, r.text
            pays = admin.get(f"{API}/payments").json()
            p = next(x for x in pays if x["id"] == state["pid"])
            if p.get("txn_id"):
                txn_id = p["txn_id"]
                break
        assert txn_id
        state["txn_id"] = txn_id
        txns = admin.get(f"{API}/transactions", params={"work_order_id": WO_ID}).json()
        t = next((x for x in txns if x["id"] == txn_id), None)
        assert t is not None, "txn not found via work_order_id filter"
        assert t["work_order_id"] == WO_ID
        assert t.get("work_order_no") == WO_NO
        assert t["type"] == "expense"
        # filter excludes other WO
        assert all(x.get("work_order_id") == WO_ID for x in txns)

    def test_reports_by_work_order(self, admin):
        r = admin.get(f"{API}/dashboard/summary")
        assert r.status_code == 200
        bw = r.json()["by_work_order"]
        assert isinstance(bw, list)
        assert any(WO_NO in str(x) for x in bw)
