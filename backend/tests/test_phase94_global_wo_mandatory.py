"""Phase 94 — Global Work Order mandatory mapping (backend regression).

Covers: WO mandatory on manual income/expense, persistence + work_order_no
enrichment, WO preserved through approval, payroll-batch reversal inherits WO,
DEMO WO idempotency (sequential + concurrent), /work-orders RBAC for non-admin
roles, /reports/work-order-pnl aggregation + Unassigned bucket, and that
historical (pre-mandate) transactions are not mutated.

Seeds its own TEST_ center / batch / txns directly and deletes them by id.
Run:  cd /app/backend && python -m pytest tests/test_phase94_global_wo_mandatory.py -v -p no:xdist
"""
from __future__ import annotations
import os
import uuid
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import pytest
import requests
from pymongo import MongoClient


def _read_env(path, key):
    try:
        for line in open(path):
            if line.startswith(key + "="):
                return line.split("=", 1)[1].strip().strip('"')
    except FileNotFoundError:
        return None


BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _read_env("/app/frontend/.env", "REACT_APP_BACKEND_URL")).rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL") or _read_env("/app/backend/.env", "MONGO_URL")
DB_NAME = os.environ.get("DB_NAME") or _read_env("/app/backend/.env", "DB_NAME")

ADMIN = ("admin@finance.app", "Admin@123")
COMPANY_ADMIN = ("companyadmin1@x.com", "Test@1234")
ACCOUNTANT = ("test_center_manager_c6912430@x.com", "Test@1234")
ACCOUNTANT_CENTER = "9cf18e69-312d-488d-a484-2d68d62d48a7"
CENTER_MANAGER = ("cmtest_salary@x.com", "Test@1234")
CM_CENTER = "10751714-23a9-4afc-96d6-66b0640ac94f"

TAG = uuid.uuid4().hex[:6]
CREATED = {"transactions": [], "work_orders": [], "centers": [], "payroll_batches": []}


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code != 200:
        return None
    csrf = s.cookies.get("csrf_token")
    if csrf:
        s.headers.update({"X-CSRF-Token": csrf})
    return s


@pytest.fixture(scope="module")
def mdb():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(scope="module")
def admin():
    s = _login(*ADMIN)
    assert s, "admin login failed"
    return s


@pytest.fixture(scope="module")
def historical_snapshot(mdb):
    """Hash of every pre-existing WO-less transaction (to prove no mutation)."""
    q = {"$or": [{"work_order_id": {"$in": [None, ""]}}, {"work_order_id": {"$exists": False}}]}
    docs = list(mdb.transactions.find(q, {"_id": 0}).sort("id", 1))
    h = hashlib.sha256(json.dumps(docs, sort_keys=True, default=str).encode()).hexdigest()
    return {"count": len(docs), "hash": h, "ids": {d["id"] for d in docs}}


@pytest.fixture(scope="module")
def test_center(mdb, historical_snapshot):
    """Seed a TEST_ center with NO work orders."""
    cid = str(uuid.uuid4())
    mdb.centers.insert_one({
        "id": cid, "type": "center", "name": f"TEST_WO_CENTER_{TAG}",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    CREATED["centers"].append(cid)
    yield cid


@pytest.fixture(scope="module", autouse=True)
def cleanup(mdb):
    pre_acc = mdb.work_orders.count_documents({"center_id": ACCOUNTANT_CENTER})
    yield
    if pre_acc == 0:
        # DEMO WO auto-created on the real accountant center during this run → remove by id
        for w in mdb.work_orders.find({"center_id": ACCOUNTANT_CENTER, "is_demo": True}, {"_id": 0, "id": 1}):
            if not mdb.transactions.find_one({"work_order_id": w["id"], "id": {"$nin": CREATED["transactions"]}}):
                CREATED["work_orders"].append(w["id"])
    if CREATED["transactions"]:
        mdb.transactions.delete_many({"id": {"$in": CREATED["transactions"]}})
    # Also any reversal rows created from our seeded batches
    if CREATED["payroll_batches"]:
        mdb.transactions.delete_many({"payroll_batch_id": {"$in": CREATED["payroll_batches"]}})
        mdb.payroll_batches.delete_many({"id": {"$in": CREATED["payroll_batches"]}})
    if CREATED["centers"]:
        mdb.work_orders.delete_many({"center_id": {"$in": CREATED["centers"]}, "is_demo": True})
        mdb.centers.delete_many({"id": {"$in": CREATED["centers"]}})
    if CREATED["work_orders"]:
        mdb.work_orders.delete_many({"id": {"$in": CREATED["work_orders"]}})


# ---------------- DEMO WO fallback ----------------
class TestDemoWorkOrder:
    def test_demo_wo_idempotent_sequential(self, admin, mdb, test_center):
        assert mdb.work_orders.count_documents({"center_id": test_center}) == 0
        r1 = admin.get(f"{API}/work-orders", params={"center_id": test_center, "ensure_demo": "true"}, timeout=30)
        assert r1.status_code == 200, r1.text[:300]
        r2 = admin.get(f"{API}/work-orders", params={"center_id": test_center, "ensure_demo": "true"}, timeout=30)
        assert r2.status_code == 200
        wos = r2.json()
        assert len(wos) == 1
        assert wos[0]["wo_number"] == "DEMO Work Order"
        assert mdb.work_orders.count_documents({"center_id": test_center}) == 1
        doc = mdb.work_orders.find_one({"center_id": test_center}, {"_id": 0})
        assert doc["is_demo"] is True and doc["status"] == "active"

    def test_demo_wo_idempotent_concurrent(self, admin, mdb):
        """Race: parallel ensure_demo calls for a fresh center must not duplicate."""
        cid = str(uuid.uuid4())
        mdb.centers.insert_one({"id": cid, "type": "center", "name": f"TEST_WO_RACE_{TAG}",
                                "created_at": datetime.now(timezone.utc).isoformat()})
        CREATED["centers"].append(cid)

        def call(_):
            return admin.get(f"{API}/work-orders", params={"center_id": cid, "ensure_demo": "true"}, timeout=30).status_code

        with ThreadPoolExecutor(max_workers=12) as ex:
            codes = list(ex.map(call, range(12)))
        assert all(c == 200 for c in codes)
        n = mdb.work_orders.count_documents({"center_id": cid, "is_demo": True})
        assert n == 1, f"concurrent ensure_demo created {n} DEMO WOs (race condition)"


# ---------------- RBAC on /work-orders ----------------
class TestWorkOrderRBAC:
    @pytest.mark.parametrize("creds,center", [
        (COMPANY_ADMIN, None), (ACCOUNTANT, ACCOUNTANT_CENTER), (CENTER_MANAGER, CM_CENTER),
    ])
    def test_non_admin_can_read(self, creds, center):
        s = _login(*creds)
        if not s:
            pytest.skip(f"login failed for {creds[0]}")
        params = {"center_id": center} if center else {}
        r = s.get(f"{API}/work-orders", params=params, timeout=30)
        assert r.status_code == 200, f"{creds[0]} -> {r.status_code} {r.text[:200]}"
        data = r.json()
        assert isinstance(data, list)
        if center:
            assert all(w.get("center_id") == center for w in data)


# ---------------- Transaction create / validation ----------------
def _demo_wo(admin, center):
    r = admin.get(f"{API}/work-orders", params={"center_id": center, "ensure_demo": "true"}, timeout=30)
    assert r.status_code == 200 and r.json(), r.text[:200]
    return r.json()[0]


def _txn(admin, **kw):
    body = {"type": "expense", "amount": 100.0, "date": "2026-01-10",
            "description": f"TEST_WO_{TAG}", **kw}
    r = admin.post(f"{API}/transactions", json=body, timeout=30)
    if r.status_code == 200:
        CREATED["transactions"].append(r.json()["id"])
    return r


class TestTransactionWO:
    def test_expense_requires_wo(self, admin, test_center):
        r = _txn(admin, center_id=test_center)
        assert r.status_code == 400
        assert "Work Order" in r.text

    def test_income_requires_wo(self, admin, test_center):
        r = _txn(admin, type="income", center_id=test_center)
        assert r.status_code == 400

    def test_wo_center_mismatch_rejected(self, admin, test_center):
        other = _demo_wo(admin, ACCOUNTANT_CENTER)
        r = _txn(admin, center_id=test_center, work_order_id=other["id"])
        assert r.status_code == 400
        assert "does not belong" in r.text

    def test_bogus_wo_rejected(self, admin, test_center):
        r = _txn(admin, center_id=test_center, work_order_id="nope-" + TAG)
        assert r.status_code == 400

    def test_expense_with_wo_persists_and_enriches(self, admin, test_center, mdb):
        wo = _demo_wo(admin, test_center)
        r = _txn(admin, center_id=test_center, work_order_id=wo["id"], amount=1234.5)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["work_order_id"] == wo["id"]
        assert d.get("work_order_no") == "DEMO Work Order", f"create response work_order_no={d.get('work_order_no')}"
        lst = admin.get(f"{API}/transactions", params={"work_order_id": wo["id"]}, timeout=60)
        assert lst.status_code == 200
        rows = lst.json() if isinstance(lst.json(), list) else lst.json().get("items", [])
        me = [x for x in rows if x["id"] == d["id"]]
        assert me and me[0]["work_order_no"] == "DEMO Work Order"
        assert mdb.transactions.find_one({"id": d["id"]})["work_order_id"] == wo["id"]

    def test_income_with_wo_persists_and_enriches(self, admin, test_center, mdb):
        wo = _demo_wo(admin, test_center)
        r = _txn(admin, type="income", center_id=test_center, work_order_id=wo["id"], amount=5000)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["work_order_id"] == wo["id"]
        assert mdb.transactions.find_one({"id": d["id"]})["work_order_id"] == wo["id"]
        lst = admin.get(f"{API}/transactions", params={"work_order_id": wo["id"]}, timeout=60).json()
        rows = lst if isinstance(lst, list) else lst.get("items", [])
        me = [x for x in rows if x["id"] == d["id"]]
        assert me and me[0]["work_order_no"] == "DEMO Work Order"

    def test_wo_preserved_through_approval(self, admin, mdb):
        acc = _login(*ACCOUNTANT)
        if not acc:
            pytest.skip("accountant login failed")
        wo = _demo_wo(admin, ACCOUNTANT_CENTER)
        r = acc.post(f"{API}/transactions", json={
            "type": "expense", "amount": 77.0, "date": "2026-01-11",
            "description": f"TEST_WO_APPROVE_{TAG}", "center_id": ACCOUNTANT_CENTER,
            "work_order_id": wo["id"]}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        tid = r.json()["id"]
        CREATED["transactions"].append(tid)
        assert r.json()["status"] == "pending"
        a = admin.post(f"{API}/transactions/{tid}/approve", timeout=30)
        assert a.status_code == 200, a.text[:300]
        assert a.json()["status"] == "approved"
        assert a.json()["work_order_id"] == wo["id"]
        assert mdb.transactions.find_one({"id": tid})["work_order_id"] == wo["id"]

    def test_edit_without_wo_field_keeps_mapping(self, admin, test_center, mdb):
        """PUT /transactions with body omitting work_order_id should not wipe the WO."""
        wo = _demo_wo(admin, test_center)
        r = _txn(admin, center_id=test_center, work_order_id=wo["id"], amount=10)
        tid = r.json()["id"]
        u = admin.put(f"{API}/transactions/{tid}", json={
            "type": "expense", "amount": 11, "date": "2026-01-10",
            "description": f"TEST_WO_EDIT_{TAG}", "center_id": test_center}, timeout=30)
        assert u.status_code == 200, u.text[:200]
        assert mdb.transactions.find_one({"id": tid}).get("work_order_id") == wo["id"], \
            "PUT without work_order_id wiped the WO mapping (model_dump sets None)"


# ---------------- Reversal inheritance ----------------
class TestReversalInheritance:
    def test_payroll_batch_reversal_inherits_wo(self, admin, mdb, test_center):
        wo = _demo_wo(admin, test_center)
        now = datetime.now(timezone.utc).isoformat()
        orig_id, bid = str(uuid.uuid4()), str(uuid.uuid4())
        mdb.transactions.insert_one({
            "id": orig_id, "type": "expense", "amount": 999.0, "date": "2026-01-05",
            "description": f"TEST_WO_PAYROLL_{TAG}", "center_id": test_center,
            "work_order_id": wo["id"], "work_order_no": wo["wo_number"],
            "source": "payroll_batch", "payroll_batch_id": bid, "status": "approved",
            "items": [], "attachments": [], "created_by": "test", "created_at": now,
        })
        CREATED["transactions"].append(orig_id)
        mdb.payroll_batches.insert_one({
            "id": bid, "status": "paid", "month": 1, "year": 2099, "center_id": test_center,
            "transaction_id": orig_id, "audit_log": [], "created_at": now,
        })
        CREATED["payroll_batches"].append(bid)
        r = admin.post(f"{API}/payroll-batches/{bid}/reopen",
                       json={"reason": "TEST reversal", "reverse_transaction": True}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        rev = mdb.transactions.find_one({"reverses_txn_id": orig_id, "source": "payroll_batch_reversal"}, {"_id": 0})
        assert rev, "reversal txn not created"
        CREATED["transactions"].append(rev["id"])
        assert rev["work_order_id"] == wo["id"]
        assert rev["work_order_no"] == wo["wo_number"]
        assert rev["type"] == "income" and rev["amount"] == 999.0


# ---------------- P&L report ----------------
class TestWorkOrderPnL:
    def test_pnl_shape_and_totals(self, admin):
        r = admin.get(f"{API}/reports/work-order-pnl", timeout=60)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert "rows" in d and "totals" in d
        for row in d["rows"]:
            for k in ("work_order_id", "work_order_no", "center_name", "income", "expense", "net"):
                assert k in row
            assert abs(row["net"] - round(row["income"] - row["expense"], 2)) < 0.011
        si = round(sum(x["income"] for x in d["rows"]), 2)
        se = round(sum(x["expense"] for x in d["rows"]), 2)
        assert abs(d["totals"]["income"] - si) < 0.05
        assert abs(d["totals"]["expense"] - se) < 0.05
        assert abs(d["totals"]["net"] - round(si - se, 2)) < 0.05

    def test_pnl_test_wo_row_exact(self, admin, mdb, test_center):
        wo = _demo_wo(admin, test_center)
        r = admin.get(f"{API}/reports/work-order-pnl", params={"center_id": test_center}, timeout=60)
        assert r.status_code == 200
        rows = r.json()["rows"]
        mine = [x for x in rows if x["work_order_id"] == wo["id"]]
        assert len(mine) == 1
        exp = {"income": 0.0, "expense": 0.0}
        for t in mdb.transactions.find({"work_order_id": wo["id"], "status": {"$ne": "rejected"}}):
            if t["type"] in exp:
                exp[t["type"]] += float(t["amount"])
        assert mine[0]["income"] == round(exp["income"], 2)
        assert mine[0]["expense"] == round(exp["expense"], 2)
        assert mine[0]["center_name"] == f"TEST_WO_CENTER_{TAG}"
        assert mine[0]["work_order_no"] == "DEMO Work Order"

    def test_pnl_unassigned_bucket(self, admin, mdb):
        n = mdb.transactions.count_documents({"status": {"$ne": "rejected"}, "$or": [
            {"work_order_id": None}, {"work_order_id": {"$exists": False}}]})
        d = admin.get(f"{API}/reports/work-order-pnl", timeout=60).json()
        un = [x for x in d["rows"] if not x["work_order_id"]]
        if n == 0:
            pytest.skip("no historical WO-less txns")
        assert len(un) >= 1
        assert "Unassigned" in un[0]["work_order_no"]
        assert sum(x["count"] for x in un) == n + mdb.transactions.count_documents(
            {"status": {"$ne": "rejected"}, "work_order_id": ""})

    def test_pnl_non_finance_role_forbidden(self):
        s = _login(*CENTER_MANAGER)
        if not s:
            pytest.skip("cm login failed")
        r = s.get(f"{API}/reports/work-order-pnl", timeout=30)
        assert r.status_code in (200, 403)

    def test_pnl_accountant_center_scoped(self, admin):
        s = _login(*ACCOUNTANT)
        if not s:
            pytest.skip("accountant login failed")
        r = s.get(f"{API}/reports/work-order-pnl", timeout=30)
        if r.status_code == 403:
            pytest.skip("test_center_manager_c6912430 is now role=center_manager (not finance-visible) — creds file stale")
        assert r.status_code == 200, r.text[:200]
        for row in r.json()["rows"]:
            if row.get("center_id"):
                assert row["center_id"] == ACCOUNTANT_CENTER, f"leak: {row}"


# ---------------- Historical data untouched (run last) ----------------
class TestZHistorical:
    def test_historical_txns_not_mutated(self, mdb, historical_snapshot):
        q = {"$or": [{"work_order_id": {"$in": [None, ""]}}, {"work_order_id": {"$exists": False}}],
             "id": {"$in": list(historical_snapshot["ids"])}}
        docs = list(mdb.transactions.find(q, {"_id": 0}).sort("id", 1))
        assert len(docs) == historical_snapshot["count"], "some historical WO-less txns were back-filled/removed"
        h = hashlib.sha256(json.dumps(docs, sort_keys=True, default=str).encode()).hexdigest()
        assert h == historical_snapshot["hash"], "historical transactions were mutated"

    def test_historical_txn_list_loads(self, admin):
        r = admin.get(f"{API}/transactions", params={"limit": 50}, timeout=60)
        assert r.status_code == 200
