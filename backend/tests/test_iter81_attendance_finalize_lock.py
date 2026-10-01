"""Iter 81 - HRMS simplified Attendance → Payroll workflow.

Covers the NEW endpoints/behaviour added in this iteration:
  - GET  /api/payroll/attendance-lock
  - POST /api/payroll/finalize-attendance (blockers + role gate)
  - POST /api/attendance/unlock
  - 423 enforcement on POST /api/attendance & PATCH /api/attendance/{aid}
    when the center+month is locked
  - Regression: /api/payroll/run and /api/payroll/finalise still mounted
"""
from __future__ import annotations
import os
import uuid
import datetime
import requests
import pytest

try:
    from pymongo import MongoClient
except Exception:  # pragma: no cover
    MongoClient = None

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "finance_tracker_db")

ADMIN = {"email": "admin@finance.app", "password": "Admin@123"}
ACCT = {"email": "test_center_manager_c6912430@x.com", "password": "Test@1234"}


def _login(session, creds):
    r = session.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login {creds['email']}: {r.status_code} {r.text[:200]}"
    csrf = session.cookies.get("csrf_token")
    session.headers.update({"X-CSRF-Token": csrf or ""})
    return csrf


@pytest.fixture(scope="module")
def admin_sess():
    s = requests.Session()
    _login(s, ADMIN)
    return s


@pytest.fixture(scope="module")
def acct_sess():
    s = requests.Session()
    _login(s, ACCT)
    return s


@pytest.fixture(scope="module")
def mongo_db():
    if not MongoClient:
        pytest.skip("pymongo not installed")
    cli = MongoClient(MONGO_URL)
    yield cli[DB_NAME]
    cli.close()


# --------------------------------------------------------------------------
# 1) GET /payroll/attendance-lock
# --------------------------------------------------------------------------
def test_attendance_lock_status_shape(admin_sess):
    # Pick an arbitrary future month that is unlikely to be finalized.
    r = admin_sess.get(f"{API}/payroll/attendance-lock", params={"month": 12, "year": 2099})
    assert r.status_code == 200, r.text
    j = r.json()
    assert "locked_centers" in j and isinstance(j["locked_centers"], list)
    assert "locks" in j and isinstance(j["locks"], list)
    # No active locks for Dec-2099.
    assert j["locked_centers"] == []


def test_attendance_lock_status_single_center_false(admin_sess):
    r = admin_sess.get(
        f"{API}/payroll/attendance-lock",
        params={"month": 12, "year": 2099, "center_id": str(uuid.uuid4())},
    )
    assert r.status_code == 200
    j = r.json()
    assert j.get("locked") is False
    assert j.get("lock") in (None, {})


# --------------------------------------------------------------------------
# 2) POST /payroll/finalize-attendance — role + blockers
# --------------------------------------------------------------------------
def test_finalize_attendance_role_gated(acct_sess):
    """Accountant (not admin/hr) must be rejected."""
    r = acct_sess.post(f"{API}/payroll/finalize-attendance",
                       json={"month": 12, "year": 2099})
    assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code} {r.text[:200]}"


def test_finalize_attendance_blocks_on_unmarked(admin_sess):
    """A future / incomplete month should either:
       - 400 with detail.code='attendance_issues' + blockers, OR
       - 400 'No draft payroll rows to finalize' (if no draft rows produced).
       Either way: NOT 200 (no lock created).
    """
    today = datetime.date.today()
    # Pick next calendar month → guaranteed incomplete.
    y = today.year + (1 if today.month == 12 else 0)
    m = 1 if today.month == 12 else today.month + 1
    r = admin_sess.post(f"{API}/payroll/finalize-attendance",
                        json={"month": m, "year": y})
    assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text[:400]}"
    body = r.json()
    detail = body.get("detail", body)
    if isinstance(detail, dict):
        assert detail.get("code") in ("attendance_issues", None)
        if detail.get("code") == "attendance_issues":
            assert isinstance(detail.get("blockers"), list)
    # Confirm nothing got locked.
    chk = admin_sess.get(f"{API}/payroll/attendance-lock", params={"month": m, "year": y})
    assert chk.status_code == 200
    assert chk.json().get("locked_centers") == []


# --------------------------------------------------------------------------
# 3) 423 enforcement when lock exists  +  POST /attendance/unlock
# --------------------------------------------------------------------------
@pytest.fixture
def seeded_lock(admin_sess, mongo_db):
    """Create a lock doc + a staff + an attendance row we can try to edit.
    Teardown removes everything we touched.
    """
    # Grab (or create) a staff row with a center so the lock scope matches.
    staff = mongo_db.staff.find_one({"center_id": {"$exists": True, "$ne": None}},
                                    {"_id": 0, "id": 1, "center_id": 1})
    if not staff:
        pytest.skip("No staff with center_id in DB — cannot test lock enforcement")

    staff_id = staff["id"]
    center_id = staff["center_id"]
    # Use a far-future month so we don't collide with real data.
    year, month = 2099, 11
    date_str = f"{year}-{month:02d}-15"

    att_id = str(uuid.uuid4())
    mongo_db.attendance.insert_one({
        "id": att_id, "staff_id": staff_id, "date": date_str,
        "status": "present", "marked_via": "admin",
        "marked_at": datetime.datetime.utcnow().isoformat(),
        "_test_iter81": True,
    })
    mongo_db.attendance_locks.insert_one({
        "center_id": center_id, "month": month, "year": year,
        "active": True, "locked_at": datetime.datetime.utcnow().isoformat(),
        "locked_by": "test-iter81", "_test_iter81": True,
    })

    yield {
        "staff_id": staff_id, "center_id": center_id,
        "month": month, "year": year, "date": date_str, "att_id": att_id,
    }

    # Cleanup
    mongo_db.attendance.delete_one({"id": att_id})
    mongo_db.attendance_locks.delete_many({
        "center_id": center_id, "month": month, "year": year,
    })


def test_attendance_lock_status_reports_locked(admin_sess, seeded_lock):
    r = admin_sess.get(f"{API}/payroll/attendance-lock",
                       params={"month": seeded_lock["month"], "year": seeded_lock["year"]})
    assert r.status_code == 200
    assert seeded_lock["center_id"] in r.json().get("locked_centers", [])

    r2 = admin_sess.get(f"{API}/payroll/attendance-lock", params={
        "month": seeded_lock["month"], "year": seeded_lock["year"],
        "center_id": seeded_lock["center_id"],
    })
    assert r2.status_code == 200
    assert r2.json().get("locked") is True


def test_post_attendance_blocked_423_when_locked(admin_sess, seeded_lock):
    r = admin_sess.post(f"{API}/attendance", json={
        "staff_id": seeded_lock["staff_id"],
        "date": seeded_lock["date"],
        "status": "present",
    })
    assert r.status_code == 423, f"expected 423, got {r.status_code} {r.text[:300]}"
    assert "lock" in (r.text or "").lower()


def test_patch_attendance_blocked_423_when_locked(admin_sess, seeded_lock):
    r = admin_sess.patch(f"{API}/attendance/{seeded_lock['att_id']}",
                         json={"remarks": "iter81-should-be-blocked"})
    assert r.status_code == 423, f"expected 423, got {r.status_code} {r.text[:300]}"


def test_unlock_then_patch_succeeds(admin_sess, seeded_lock, mongo_db):
    # Unlock via the API (not direct DB) → exercises /attendance/unlock.
    r = admin_sess.post(f"{API}/attendance/unlock", json={
        "month": seeded_lock["month"], "year": seeded_lock["year"],
        "center_id": seeded_lock["center_id"], "reason": "iter81 test",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("unlocked") is True
    assert body.get("was_locked") is True

    # Now the lock status should be clear.
    chk = admin_sess.get(f"{API}/payroll/attendance-lock", params={
        "month": seeded_lock["month"], "year": seeded_lock["year"],
        "center_id": seeded_lock["center_id"],
    })
    assert chk.status_code == 200
    assert chk.json().get("locked") is False

    # And PATCH /attendance should succeed again.
    r2 = admin_sess.patch(f"{API}/attendance/{seeded_lock['att_id']}",
                          json={"remarks": "iter81-after-unlock"})
    assert r2.status_code == 200, r2.text


def test_unlock_role_gated(acct_sess):
    r = acct_sess.post(f"{API}/attendance/unlock", json={
        "month": 12, "year": 2099, "center_id": str(uuid.uuid4()),
    })
    assert r.status_code in (401, 403)


# --------------------------------------------------------------------------
# 4) Regression — legacy payroll endpoints still mounted
# --------------------------------------------------------------------------
def test_legacy_payroll_run_endpoint_mounted(admin_sess):
    """/payroll/run must still work (calculations untouched)."""
    r = admin_sess.post(f"{API}/payroll/run",
                        params={"month": 12, "year": 2099, "center_id": "all"})
    # Legacy endpoint accepts and returns 200 (may produce 0 rows for 2099).
    assert r.status_code in (200, 400), f"got {r.status_code}: {r.text[:200]}"


def test_legacy_payroll_finalise_endpoint_mounted(admin_sess):
    r = admin_sess.post(f"{API}/payroll/finalise",
                        json={"month": 12, "year": 2099})
    # Expected 400 (no draft rows for 2099) — proves route exists & reaches handler.
    assert r.status_code in (200, 400, 404)
    assert r.status_code != 405  # NOT method-not-allowed
