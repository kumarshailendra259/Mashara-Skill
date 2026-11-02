"""Phase 92: Work Order mandatory on income, DEMO WO auto-create, milestone receive WO
propagation, admin bulk-assign (only-empty fill) + RBAC."""
import os
import uuid

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    for line in open("/app/frontend/.env"):
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
API = f"{BASE_URL}/api"


def _env_from_file(k):
    for line in open("/app/backend/.env"):
        if line.startswith(k + "="):
            return line.split("=", 1)[1].strip().strip('"')


def _db():
    return MongoClient(os.environ.get("MONGO_URL") or _env_from_file("MONGO_URL"))[
        os.environ.get("DB_NAME") or _env_from_file("DB_NAME")]


def _login(email, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    csrf = s.cookies.get("csrf_token")
    if csrf:
        s.headers.update({"X-CSRF-Token": csrf})
    return s


@pytest.fixture(scope="module")
def admin():
    return _login("admin@finance.app", "Admin@123")


@pytest.fixture(scope="module")
def cadmin():
    return _login("companyadmin1@x.com", "Test@1234")


@pytest.fixture(scope="module")
def seed():
    """Fresh center with NO work order + a batch with a pending 2nd milestone."""
    db = _db()
    tag = uuid.uuid4().hex[:8]
    ids = {"center_id": f"TEST_ctr-{tag}", "batch_id": f"TEST_batch-{tag}", "bp_id": f"TEST_bp-{tag}",
           "project_id": f"TEST_proj-{tag}", "company_id": f"TEST_comp-{tag}", "txn_ids": []}
    db.projects.insert_one({"id": ids["project_id"], "type": "project", "name": f"TEST_P {tag}", "created_at": "2026-01-01T00:00:00+00:00"})
    db.companies.insert_one({"id": ids["company_id"], "type": "company", "name": f"TEST_C {tag}", "created_at": "2026-01-01T00:00:00+00:00"})
    db.centers.insert_one({"id": ids["center_id"], "type": "center", "name": f"TEST_CT {tag}", "created_at": "2026-01-01T00:00:00+00:00"})
    db.batches.insert_one({
        "id": ids["batch_id"], "project_id": ids["project_id"], "center_id": ids["center_id"],
        "company_id": ids["company_id"], "partner_ids": [], "name": f"TEST_B {tag}",
        "job_roles": [], "partner_share_percent": 0, "closed": False, "created_at": "2026-01-01T00:00:00+00:00",
    })
    db.batch_payments.insert_one({
        "id": ids["bp_id"], "batch_id": ids["batch_id"], "milestone": "2nd", "amount": 50000,
        "status": "pending", "description": f"TEST seed {tag}", "expected_date": "2026-01-15",
        "uniform_amount": 0, "recovery_amount": 5000, "assessment_fee_total": 2000,
        "assessment_fee_per_candidate": 1000, "company_id": ids["company_id"],
        "created_at": "2026-01-01T00:00:00+00:00",
    })
    yield ids
    db.transactions.delete_many({"$or": [{"id": {"$in": ids["txn_ids"]}}, {"batch_id": ids["batch_id"]},
                                         {"center_id": ids["center_id"]}]})
    db.batch_payments.delete_many({"batch_id": ids["batch_id"]})
    db.batches.delete_many({"id": ids["batch_id"]})
    db.work_orders.delete_many({"center_id": ids["center_id"]})
    db.centers.delete_many({"id": ids["center_id"]})
    db.projects.delete_many({"id": ids["project_id"]})
    db.companies.delete_many({"id": ids["company_id"]})


# --- DEMO work order (ensure_demo) ---
class TestEnsureDemo:
    def test_no_wo_without_flag(self, admin, seed):
        r = admin.get(f"{API}/work-orders", params={"center_id": seed["center_id"]})
        assert r.status_code == 200
        assert r.json() == []

    def test_ensure_demo_creates_and_idempotent(self, admin, seed):
        r1 = admin.get(f"{API}/work-orders", params={"center_id": seed["center_id"], "ensure_demo": "true"})
        r2 = admin.get(f"{API}/work-orders", params={"center_id": seed["center_id"], "ensure_demo": "true"})
        assert r1.status_code == 200 and r2.status_code == 200
        l1, l2 = r1.json(), r2.json()
        assert len(l1) == 1 and len(l2) == 1
        assert l1[0]["wo_number"] == "DEMO Work Order"
        assert l1[0]["id"] == l2[0]["id"]
        seed["demo_wo"] = l1[0]["id"]


# --- Income mandatory WO ---
class TestIncomeWO:
    def _payload(self, seed, **kw):
        p = {"type": "income", "amount": 111, "date": "2026-01-10", "category": "Other",
             "description": "TEST_income_wo", "center_id": seed["center_id"]}
        p.update(kw)
        return p

    def test_income_without_wo_400(self, admin, seed):
        r = admin.post(f"{API}/transactions", json=self._payload(seed))
        assert r.status_code == 400, r.text
        assert "Work Order is required" in r.text

    def test_expense_without_wo_400(self, admin, seed):
        r = admin.post(f"{API}/transactions", json=self._payload(seed, type="expense"))
        assert r.status_code == 400, r.text

    def test_income_with_wo_ok(self, admin, seed):
        r = admin.post(f"{API}/transactions", json=self._payload(seed, work_order_id=seed["demo_wo"]))
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        seed["txn_ids"].append(tid)
        seed["income_txn"] = tid
        lst = admin.get(f"{API}/transactions", params={"center_id": seed["center_id"]}).json()
        items = lst["items"] if isinstance(lst, dict) else lst
        row = next(t for t in items if t["id"] == tid)
        assert row.get("work_order_id") == seed["demo_wo"]
        assert row.get("work_order_no") == "DEMO Work Order"

    def test_income_wo_wrong_center_400(self, admin, seed):
        other = _db().work_orders.find_one({"center_id": {"$ne": seed["center_id"], "$nin": [None, ""]}}, {"_id": 0, "id": 1})
        if not other:
            pytest.skip("no other WO")
        r = admin.post(f"{API}/transactions", json=self._payload(seed, work_order_id=other["id"]))
        assert r.status_code == 400


# --- Milestone receive propagates WO ---
class TestMilestoneReceiveWO:
    def test_receive_wrong_center_wo_400_and_rollback(self, admin, seed):
        other = _db().work_orders.find_one({"center_id": {"$ne": seed["center_id"], "$nin": [None, ""]}}, {"_id": 0, "id": 1})
        if not other:
            pytest.skip("no other WO")
        r = admin.patch(f"{API}/batch-payments/{seed['bp_id']}/receive",
                        json={"tds_percent": 10, "work_order_id": other["id"]})
        assert r.status_code == 400, r.text
        bp = _db().batch_payments.find_one({"id": seed["bp_id"]})
        assert bp["status"] == "pending"
        assert _db().transactions.count_documents({"batch_id": seed["batch_id"]}) == 0

    def test_receive_with_wo_stamps_all(self, admin, seed):
        r = admin.patch(f"{API}/batch-payments/{seed['bp_id']}/receive",
                        json={"tds_percent": 10, "work_order_id": seed["demo_wo"], "company_id": seed["company_id"]})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "received"
        txns = list(_db().transactions.find({"batch_id": seed["batch_id"]}, {"_id": 0}))
        sources = sorted(t.get("source") or t.get("type") for t in txns)
        print("generated:", sources)
        assert len(txns) >= 4, sources
        for t in txns:
            assert t.get("work_order_id") == seed["demo_wo"], t
            assert t.get("work_order_no") == "DEMO Work Order"


# --- Bulk assign ---
class TestBulkAssign:
    def test_only_empty_fill(self, admin, seed):
        db = _db()
        partners = admin.get(f"{API}/entities/partner").json()
        assert len(partners) >= 2
        p_existing, p_new = partners[0]["id"], partners[1]["id"]
        a, b = f"TEST_bulk_a_{uuid.uuid4().hex[:6]}", f"TEST_bulk_b_{uuid.uuid4().hex[:6]}"
        base = {"type": "expense", "amount": 1, "date": "2026-01-10", "category": "Other",
                "center_id": seed["center_id"], "source": "test", "status": "pending",
                "created_at": "2026-01-10T00:00:00+00:00"}
        db.transactions.insert_one({**base, "id": a, "partner_id": None, "work_order_id": ""})
        db.transactions.insert_one({**base, "id": b, "partner_id": p_existing, "work_order_id": seed["demo_wo"]})
        seed["txn_ids"] += [a, b]
        r = admin.post(f"{API}/transactions/bulk-assign",
                       json={"ids": [a, b], "partner_id": p_new, "work_order_id": seed["demo_wo"]})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["updated"] == 1 and d["by_field"]["partner_id"] == 1 and d["by_field"]["work_order_id"] == 1
        ra, rb = db.transactions.find_one({"id": a}), db.transactions.find_one({"id": b})
        assert ra["partner_id"] == p_new and ra["work_order_no"] == "DEMO Work Order"
        assert rb["partner_id"] == p_existing

    def test_validation(self, admin, seed):
        assert admin.post(f"{API}/transactions/bulk-assign", json={"ids": [], "partner_id": "x"}).status_code == 400
        assert admin.post(f"{API}/transactions/bulk-assign", json={"ids": ["x"]}).status_code == 400
        assert admin.post(f"{API}/transactions/bulk-assign", json={"ids": ["x"], "work_order_id": "nope"}).status_code == 400

    def test_company_admin_403(self, cadmin):
        r = cadmin.post(f"{API}/transactions/bulk-assign", json={"ids": ["x"], "partner_id": "y"})
        assert r.status_code == 403, r.text

    def test_unauth_401(self):
        r = requests.post(f"{API}/transactions/bulk-assign", json={"ids": ["x"], "partner_id": "y"})
        assert r.status_code in (401, 403)
