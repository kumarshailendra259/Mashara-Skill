# Phase 93 — HR Review → Submit for Approval workflow (payroll_finalise root-cause fix,
# finalise-preview, all-centers finalize-attendance, idempotency, rejected resubmit, paid guard)
import os
import uuid
import pytest
import requests
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

M1, Y1 = 5, 2096          # direct /payroll/finalise tests (seeded rows)
M2, Y2 = 6, 2096          # /payroll/finalize-attendance all-centers tests
TAG = uuid.uuid4().hex[:6]

C1 = f"TEST_p93_c1_{TAG}"
C2 = f"TEST_p93_c2_{TAG}"
S = {k: f"TEST_p93_{k}_{TAG}" for k in ["A", "B", "C", "Z", "D", "E", "P"]}


def _login():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": "admin@finance.app", "password": "Admin@123"})
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    s.headers.update({"X-CSRF-Token": s.cookies.get("csrf_token") or ""})
    return s


def _row(sid, name, present, net, **extra):
    d = {"id": f"TEST_pr_{sid}_{uuid.uuid4().hex[:4]}", "staff_id": sid, "staff_name": name,
         "month": M1, "year": Y1, "present_days": present, "days_present": present,
         "working_days": 26, "base_salary": 10000.0, "gross": max(net, 0), "deductions": 0.0,
         "net": net, "status": "draft", "txn_id": None, "paid_at": None}
    d.update(extra)
    return d


@pytest.fixture(scope="module")
def setup():
    # safety: test months must be empty of other data
    for m, y in [(M1, Y1), (M2, Y2)]:
        assert db.payroll.count_documents({"month": m, "year": y}) == 0, f"{m}/{y} not empty — refusing"
        assert db.payroll_batches.count_documents({"month": m, "year": y}) == 0
    for cid in (C1, C2):
        db.centers.insert_one({"id": cid, "type": "center", "name": cid, "center_status": "active"})
    staff_center = {"A": C1, "B": C1, "C": C1, "Z": C1, "D": C2, "E": C2, "P": C2}
    for k, sid in S.items():
        db.staff.insert_one({"id": sid, "name": sid, "monthly_salary": 26000.0, "per_day_rate": 1000.0,
                             "joining_date": "2025-01-01", "center_id": staff_center[k], "active": True})
    pre_batch = f"TEST_pb_{TAG}"
    rows = [
        _row(S["A"], S["A"], 20, 20000, batch_id=pre_batch, batch_status="pending_approval", locked=True),
        _row(S["B"], S["B"], 22, 22000),
        _row(S["C"], S["C"], 18, 18000),
        _row(S["Z"], S["Z"], 0, 0),
        _row(S["D"], S["D"], 25, 25000),
        _row(S["E"], S["E"], 0, 0),
        _row(S["P"], S["P"], 26, 26000, status="paid", batch_status="paid", batch_id=f"TEST_pbpaid_{TAG}"),
    ]
    db.payroll.insert_many([dict(r) for r in rows])
    db.payroll_batches.insert_one({"id": pre_batch, "month": M1, "year": Y1, "center_id": C1, "center_name": C1,
                                   "staff_count": 1, "payroll_ids": [rows[0]["id"]], "net_payable": 20000,
                                   "status": "pending_approval", "audit_log": [{"action": "finalised"}]})
    # M2: present attendance for B & D on all days of month; others get nothing (auto-LOP -> held)
    att = []
    for k in ("B", "D"):
        for d in range(1, 31):
            att.append({"id": f"TEST_att_{uuid.uuid4().hex}", "staff_id": S[k], "center_id": staff_center[k],
                        "date": f"{Y2:04d}-{M2:02d}-{d:02d}", "status": "present"})
    db.attendance.insert_many(att)
    yield {"rows": {k: r["id"] for k, r in zip(["A", "B", "C", "Z", "D", "E", "P"], rows)}, "pre_batch": pre_batch}
    # ---- cleanup (test-only months / ids) ----
    for m, y in [(M1, Y1), (M2, Y2)]:
        db.payroll.delete_many({"month": m, "year": y})
        db.payroll_batches.delete_many({"month": m, "year": y})
        db.attendance_locks.delete_many({"month": m, "year": y})
    db.attendance.delete_many({"date": {"$regex": f"^{Y2:04d}-{M2:02d}-"}})
    db.staff.delete_many({"id": {"$in": list(S.values())}})
    db.centers.delete_many({"id": {"$in": [C1, C2]}})


@pytest.fixture(scope="module")
def client():
    return _login()


def _snapshot(m, y):
    return sorted([str(sorted(r.items())) for r in db.payroll.find({"month": m, "year": y}, {"_id": 0})])


class TestFinalise:
    def test_01_preview_single_center_counts_nonmutating(self, client, setup):
        before = _snapshot(M1, Y1)
        r = client.get(f"{BASE_URL}/api/payroll/finalise-preview", params={"month": M1, "year": Y1, "center_id": C1})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["total_centers"] == 1
        assert d["total_employees"] == 4
        assert d["already_approval_pending"] == 1
        assert d["remaining_hr_review"] == 2
        assert d["employees_with_issues"] == 1
        assert d["issues"][0]["staff_name"] == S["Z"]
        assert d["issues"][0]["center_name"] == C1
        assert "Zero attendance" in d["issues"][0]["reason"]
        assert _snapshot(M1, Y1) == before
        assert db.payroll_batches.count_documents({"month": M1, "year": Y1}) == 1

    def test_02_preview_all_centers(self, client, setup):
        r = client.get(f"{BASE_URL}/api/payroll/finalise-preview", params={"month": M1, "year": Y1})
        d = r.json()
        assert r.status_code == 200
        assert d["total_centers"] == 2
        assert d["total_employees"] == 7
        assert d["already_approval_pending"] == 1
        assert d["paid"] == 1
        assert d["remaining_hr_review"] == 3
        assert d["employees_with_issues"] == 2

    def test_03_finalise_center_with_existing_batch(self, client, setup):
        n_before = db.payroll.count_documents({"month": M1, "year": Y1})
        a_before = db.payroll.find_one({"id": setup["rows"]["A"]}, {"_id": 0})
        r = client.post(f"{BASE_URL}/api/payroll/finalise", json={"month": M1, "year": Y1, "center_id": C1})
        assert r.status_code == 200, r.text
        d = r.json()
        assert len(d["batches"]) == 1
        b = d["batches"][0]
        assert b["staff_count"] == 2
        assert b["center_name"] == C1
        assert round(b["net_payable"]) == 40000
        assert set(b["payroll_ids"]) == {setup["rows"]["B"], setup["rows"]["C"]}
        assert [h["payroll_id"] for h in d["held_for_issues"]] == [setup["rows"]["Z"]]
        assert d["held_for_issues"][0]["reason"] == "Zero attendance — no payable days this month"
        assert db.payroll.count_documents({"month": M1, "year": Y1}) == n_before
        assert db.payroll.find_one({"id": setup["rows"]["A"]}, {"_id": 0}) == a_before
        z = db.payroll.find_one({"id": setup["rows"]["Z"]})
        assert z.get("batch_id") is None and z["status"] == "draft"

    def test_04_finalise_idempotent(self, client, setup):
        nb = db.payroll_batches.count_documents({"month": M1, "year": Y1})
        r = client.post(f"{BASE_URL}/api/payroll/finalise", json={"month": M1, "year": Y1, "center_id": C1})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["batches"] == []
        assert len(d["held_for_issues"]) == 1
        assert db.payroll_batches.count_documents({"month": M1, "year": Y1}) == nb
        assert db.payroll.count_documents({"month": M1, "year": Y1}) == 7

    def test_05_batches_visible_with_audit(self, client, setup):
        r = client.get(f"{BASE_URL}/api/payroll-batches", params={"month": M1, "year": Y1})
        assert r.status_code == 200, r.text
        data = r.json()
        items = data if isinstance(data, list) else data.get("items") or data.get("batches") or []
        mine = [b for b in items if b.get("center_id") == C1 and b.get("id") != setup["pre_batch"]]
        assert len(mine) == 1, [b.get("center_id") for b in items]
        b = mine[0]
        assert b["staff_count"] == 2
        assert b["status"] in ("pending_approval", "pending_payment")
        detail = db.payroll_batches.find_one({"id": b["id"]})
        assert any(a.get("action") == "finalised" for a in detail["audit_log"])

    def test_06_payroll_list_status(self, client, setup):
        r = client.get(f"{BASE_URL}/api/payroll", params={"month": M1, "year": Y1})
        assert r.status_code == 200
        by = {p["id"]: p for p in r.json()}
        assert by[setup["rows"]["B"]]["batch_status"] in ("pending_approval", "pending_payment")
        assert by[setup["rows"]["C"]]["batch_status"] in ("pending_approval", "pending_payment")
        assert not by[setup["rows"]["Z"]].get("batch_status")

    def test_07_all_centers_finalise_skips_paid(self, client, setup):
        r = client.post(f"{BASE_URL}/api/payroll/finalise", json={"month": M1, "year": Y1})
        assert r.status_code == 200, r.text
        d = r.json()
        assert len(d["batches"]) == 1
        assert d["batches"][0]["center_id"] == C2
        assert d["batches"][0]["payroll_ids"] == [setup["rows"]["D"]]
        assert {h["payroll_id"] for h in d["held_for_issues"]} == {setup["rows"]["Z"], setup["rows"]["E"]}
        p = db.payroll.find_one({"id": setup["rows"]["P"]})
        assert p["batch_id"] == f"TEST_pbpaid_{TAG}"

    def test_08_rejected_rows_resubmittable(self, client, setup):
        rid = setup["rows"]["D"]
        bid = db.payroll.find_one({"id": rid})["batch_id"]
        db.payroll_batches.update_one({"id": bid}, {"$set": {"status": "rejected"}})
        db.payroll.update_one({"id": rid}, {"$set": {"batch_status": "rejected", "locked": False}})
        r = client.post(f"{BASE_URL}/api/payroll/finalise", json={"month": M1, "year": Y1, "center_id": C2})
        assert r.status_code == 200, r.text
        d = r.json()
        assert len(d["batches"]) == 1 and d["batches"][0]["payroll_ids"] == [rid]
        assert db.payroll.find_one({"id": rid})["batch_id"] != bid


class TestFinalizeAttendanceAllCenters:
    def test_10_preview_then_finalize_attendance_all(self, client, setup):
        r = client.post(f"{BASE_URL}/api/payroll/finalize-attendance", json={"month": M2, "year": Y2})
        assert r.status_code == 200, r.text
        d = r.json()
        my_centers = {b["center_id"]: b for b in d["batches"] if b["center_id"] in (C1, C2)}
        assert set(my_centers) == {C1, C2}, d["batches"]
        held_names = {h["staff_name"] for h in d["held_for_issues"]}
        for k in ("A", "C", "Z", "E", "P"):
            assert S[k] in held_names
        for k in ("B", "D"):
            assert S[k] not in held_names
        for b in my_centers.values():
            assert b["status"] in ("pending_approval", "pending_payment")
        assert C1 in d["locked_centers"] and C2 in d["locked_centers"]

    def test_11_finalize_attendance_rerun_idempotent(self, client, setup):
        nb = db.payroll_batches.count_documents({"month": M2, "year": Y2})
        nr = db.payroll.count_documents({"month": M2, "year": Y2})
        r = client.post(f"{BASE_URL}/api/payroll/finalize-attendance", json={"month": M2, "year": Y2})
        print("rerun:", r.status_code, r.text[:300])
        assert r.status_code in (200, 400)
        if r.status_code == 200:
            assert r.json()["batches"] == []
        assert db.payroll_batches.count_documents({"month": M2, "year": Y2}) == nb
        assert db.payroll.count_documents({"month": M2, "year": Y2}) == nr

    def test_12_rerun_does_not_modify_batched_rows(self, client, setup):
        """Submitted rows (in an active batch) must NOT be recalculated by a re-run."""
        row = db.payroll.find_one({"month": M2, "year": Y2, "staff_id": S["B"]}, {"_id": 0})
        assert row["batch_status"] in ("pending_approval", "pending_payment")
        batch = db.payroll_batches.find_one({"id": row["batch_id"]})
        # change attendance after submission: mark 5 days absent
        db.attendance.update_many({"staff_id": S["B"], "date": {"$in": [f"{Y2}-{M2:02d}-{d:02d}" for d in range(1, 6)]}},
                                  {"$set": {"status": "absent"}})
        client.post(f"{BASE_URL}/api/payroll/finalize-attendance", json={"month": M2, "year": Y2, "center_id": C1})
        after = db.payroll.find_one({"id": row["id"]}, {"_id": 0})
        print("net before", row["net"], "after", after["net"], "batch net", batch["net_payable"])
        assert after["net"] == row["net"], "Batched (submitted) payroll row was recalculated -> batch total stale"
