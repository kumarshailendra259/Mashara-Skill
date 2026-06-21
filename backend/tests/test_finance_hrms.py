"""Iteration-7: HRMS + Payroll + 3-stage reimbursement approval tests.

Covers:
- Staff CRUD with RBAC (admin/manager create/update, admin-only delete, all roles list)
- Attendance upsert by (staff_id, date) + range/staff filters
- Leaves create/list/decide
- Reimbursement 3-stage flow + L1 approver snapshot RBAC + transaction side-effect on pay
- Reimbursement list-scoping for non-elevated users (own + own staff_id + as L1)
- Payroll run (no dup, days_present math) + pay (status, side-effect txn, double-pay rejection)
"""
import os
import uuid
import time
import pytest
import requests


def _read_url():
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL"):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    return ""


BASE_URL = (os.environ.get("FINANCE_TEST_BASE_URL") or _read_url()).rstrip("/")
ADMIN_EMAIL = "admin@finance.app"
ADMIN_PASSWORD = "Admin@123"
TAG = uuid.uuid4().hex[:6]


def _s():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(email, password):
    s = _s()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return s


def _register(email, password, name, role="viewer"):
    s = _s()
    r = s.post(f"{BASE_URL}/api/auth/register",
               json={"email": email, "password": password, "name": name, "role": role})
    assert r.status_code in (200, 400), r.text
    # if already exists, just login
    if r.status_code == 400:
        return _login(email, password)
    return s


@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def users(admin):
    """Create 3 users: manager-user (L1 approver), employee-user (claimer), random-user."""
    mgr_email = f"TEST_mgr_{TAG}@x.com"
    emp_email = f"TEST_emp_{TAG}@x.com"
    rnd_email = f"TEST_rnd_{TAG}@x.com"
    acct_email = f"TEST_acct_{TAG}@x.com"
    pw = "Pass@1234"
    mgr_s = _register(mgr_email, pw, "TEST Manager")
    emp_s = _register(emp_email, pw, "TEST Employee")
    rnd_s = _register(rnd_email, pw, "TEST Random")
    acct_s = _register(acct_email, pw, "TEST Accountant")

    # fetch ids of these users (need /auth/me on each session)
    def me(s):
        r = s.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200, r.text
        return r.json()

    mgr_u = me(mgr_s); emp_u = me(emp_s); rnd_u = me(rnd_s); acct_u = me(acct_s)

    # Promote acct to accountant via admin PATCH
    r = admin.patch(f"{BASE_URL}/api/auth/users/{acct_u['id']}", json={"role": "accountant"})
    assert r.status_code == 200, r.text
    # re-login accountant to refresh cookie/role (cookie should still be valid; role check is per-request)
    acct_s = _login(acct_email, pw)

    return {
        "mgr": {"session": mgr_s, "user": mgr_u, "email": mgr_email, "pw": pw},
        "emp": {"session": emp_s, "user": emp_u, "email": emp_email, "pw": pw},
        "rnd": {"session": rnd_s, "user": rnd_u, "email": rnd_email, "pw": pw},
        "acct": {"session": acct_s, "user": acct_u, "email": acct_email, "pw": pw},
    }


@pytest.fixture(scope="module")
def staff(admin, users):
    """Create manager-staff (linked to mgr user) and employee-staff (reports_to mgr, linked to emp user)."""
    mgr_payload = {
        "name": f"TEST_MgrStaff_{TAG}",
        "designation": "Manager",
        "monthly_salary": 60000,
        "per_day_rate": 0,
        "joining_date": "2025-01-01",
        "user_id": users["mgr"]["user"]["id"],
    }
    r = admin.post(f"{BASE_URL}/api/staff", json=mgr_payload)
    assert r.status_code == 200, r.text
    mgr_staff = r.json()

    emp_payload = {
        "name": f"TEST_EmpStaff_{TAG}",
        "designation": "Engineer",
        "reports_to_id": mgr_staff["id"],
        "monthly_salary": 0,
        "per_day_rate": 1000,
        "joining_date": "2025-01-01",
        "user_id": users["emp"]["user"]["id"],
    }
    r = admin.post(f"{BASE_URL}/api/staff", json=emp_payload)
    assert r.status_code == 200, r.text
    emp_staff = r.json()
    return {"mgr": mgr_staff, "emp": emp_staff}


# ============ Staff CRUD ============

class TestStaffCRUD:
    def test_create_requires_admin_or_manager(self, users):
        # viewer (rnd) cannot create
        r = users["rnd"]["session"].post(f"{BASE_URL}/api/staff",
            json={"name": "X", "designation": "Eng"})
        assert r.status_code == 403, r.text

    def test_list_allowed_for_any_authenticated(self, users, staff):
        r = users["rnd"]["session"].get(f"{BASE_URL}/api/staff")
        assert r.status_code == 200
        ids = [s["id"] for s in r.json()]
        assert staff["emp"]["id"] in ids and staff["mgr"]["id"] in ids

    def test_update_persists(self, admin, staff):
        sid = staff["emp"]["id"]
        new_payload = {
            "name": staff["emp"]["name"],
            "designation": "Senior Engineer",
            "reports_to_id": staff["emp"]["reports_to_id"],
            "monthly_salary": 0,
            "per_day_rate": 1200,
            "joining_date": "2025-01-01",
            "user_id": staff["emp"]["user_id"],
        }
        r = admin.put(f"{BASE_URL}/api/staff/{sid}", json=new_payload)
        assert r.status_code == 200, r.text
        assert r.json()["designation"] == "Senior Engineer"
        assert r.json()["per_day_rate"] == 1200

    def test_delete_requires_admin(self, admin, users):
        # create a throwaway staff to delete
        r = admin.post(f"{BASE_URL}/api/staff",
            json={"name": f"TEST_Del_{TAG}", "designation": "T"})
        sid = r.json()["id"]
        # manager-user cannot delete (they aren't admin role; they're 'viewer')
        r2 = users["mgr"]["session"].delete(f"{BASE_URL}/api/staff/{sid}")
        assert r2.status_code == 403
        # admin can
        r3 = admin.delete(f"{BASE_URL}/api/staff/{sid}")
        assert r3.status_code == 200, r3.text


# ============ Attendance ============

class TestAttendance:
    def test_upsert_and_filter(self, admin, staff):
        sid = staff["emp"]["id"]
        # mark present for 3 days, half 1 day, absent 1 day
        days = [
            ("2025-06-02", "present"),
            ("2025-06-03", "present"),
            ("2025-06-04", "present"),
            ("2025-06-05", "half"),
            ("2025-06-06", "absent"),
        ]
        for d, st in days:
            r = admin.post(f"{BASE_URL}/api/attendance",
                json={"staff_id": sid, "date": d, "status": st})
            assert r.status_code == 200, r.text

        # upsert same date with new status
        r = admin.post(f"{BASE_URL}/api/attendance",
            json={"staff_id": sid, "date": "2025-06-06", "status": "leave"})
        assert r.status_code == 200

        # filter by staff + range
        r = admin.get(f"{BASE_URL}/api/attendance",
            params={"staff_id": sid, "start": "2025-06-01", "end": "2025-06-30"})
        assert r.status_code == 200
        recs = r.json()
        assert len(recs) == 5  # upsert -> not duplicated
        statuses = {x["date"]: x["status"] for x in recs}
        assert statuses["2025-06-06"] == "leave"
        assert statuses["2025-06-05"] == "half"

    def test_rbac_random_cannot_mark(self, users, staff):
        r = users["rnd"]["session"].post(f"{BASE_URL}/api/attendance",
            json={"staff_id": staff["emp"]["id"], "date": "2025-06-10", "status": "present"})
        assert r.status_code == 403


# ============ Leaves ============

class TestLeaves:
    def test_create_and_decide(self, admin, staff):
        r = admin.post(f"{BASE_URL}/api/leaves",
            json={"staff_id": staff["emp"]["id"], "start_date": "2025-07-01",
                  "end_date": "2025-07-03", "reason": "vacation"})
        assert r.status_code == 200, r.text
        lid = r.json()["id"]
        assert r.json()["status"] == "pending"

        r = admin.patch(f"{BASE_URL}/api/leaves/{lid}", params={"decision": "approved"})
        assert r.status_code == 200
        assert r.json()["status"] == "approved"

        r = admin.get(f"{BASE_URL}/api/leaves", params={"staff_id": staff["emp"]["id"]})
        assert r.status_code == 200
        assert any(x["id"] == lid and x["status"] == "approved" for x in r.json())


# ============ Reimbursements ============

class TestReimbursementFlow:
    def test_submit_snapshots_l1(self, users, staff):
        # employee submits
        r = users["emp"]["session"].post(f"{BASE_URL}/api/reimbursements",
            json={"staff_id": staff["emp"]["id"], "amount": 500, "date": "2025-06-10",
                  "category": "travel", "description": f"cab_{TAG}"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "submitted"
        assert body["l1_approver_id"] == staff["mgr"]["id"]
        pytest.reimb_id = body["id"]
        pytest.reimb_amount = body["amount"]

    def test_random_cannot_l1_approve(self, users):
        r = users["rnd"]["session"].patch(
            f"{BASE_URL}/api/reimbursements/{pytest.reimb_id}/l1-approve")
        assert r.status_code == 403

    def test_l1_approve_by_mapped_manager(self, users):
        r = users["mgr"]["session"].patch(
            f"{BASE_URL}/api/reimbursements/{pytest.reimb_id}/l1-approve")
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "l1_approved"

    def test_double_l1_approve_rejected(self, users):
        r = users["mgr"]["session"].patch(
            f"{BASE_URL}/api/reimbursements/{pytest.reimb_id}/l1-approve")
        assert r.status_code == 400

    def test_accountant_approve_blocks_non_accountant(self, users):
        r = users["rnd"]["session"].patch(
            f"{BASE_URL}/api/reimbursements/{pytest.reimb_id}/accountant-approve")
        assert r.status_code == 403

    def test_accountant_approve(self, users):
        r = users["acct"]["session"].patch(
            f"{BASE_URL}/api/reimbursements/{pytest.reimb_id}/accountant-approve")
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "accountant_approved"

    def test_pay_creates_expense_txn(self, users, admin):
        # count expense txns before
        before = admin.get(f"{BASE_URL}/api/transactions", params={"type": "expense"}).json()
        before_ids = {t["id"] for t in before}

        r = users["acct"]["session"].patch(
            f"{BASE_URL}/api/reimbursements/{pytest.reimb_id}/pay")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "paid"
        assert body.get("txn_id"), "txn_id should be set after pay"

        # verify new expense txn exists with correct amount
        after = admin.get(f"{BASE_URL}/api/transactions", params={"type": "expense"}).json()
        new_txns = [t for t in after if t["id"] not in before_ids]
        match = [t for t in new_txns if t["id"] == body["txn_id"]]
        assert len(match) == 1, f"side-effect txn not found: {new_txns}"
        assert match[0]["amount"] == pytest.reimb_amount
        assert match[0]["status"] == "approved"
        assert match[0]["type"] == "expense"

    def test_double_pay_rejected(self, users):
        r = users["acct"]["session"].patch(
            f"{BASE_URL}/api/reimbursements/{pytest.reimb_id}/pay")
        assert r.status_code == 400


class TestReimbursementScopingAndReject:
    def test_list_scoping_for_non_elevated(self, admin, users, staff):
        # employee submits another
        r = users["emp"]["session"].post(f"{BASE_URL}/api/reimbursements",
            json={"staff_id": staff["emp"]["id"], "amount": 200, "date": "2025-06-12",
                  "description": f"scope_{TAG}"})
        rid = r.json()["id"]

        # random user list -> should NOT see this one
        r = users["rnd"]["session"].get(f"{BASE_URL}/api/reimbursements")
        assert r.status_code == 200
        assert all(x["id"] != rid for x in r.json()), "random user should not see others' reimbs"

        # manager (L1 approver) should see it
        r = users["mgr"]["session"].get(f"{BASE_URL}/api/reimbursements")
        ids = [x["id"] for x in r.json()]
        assert rid in ids

        # employee (creator + own staff_id) should see it
        r = users["emp"]["session"].get(f"{BASE_URL}/api/reimbursements")
        ids = [x["id"] for x in r.json()]
        assert rid in ids

        pytest.reimb_scope_id = rid

    def test_l1_can_reject_before_approve(self, users):
        r = users["mgr"]["session"].patch(
            f"{BASE_URL}/api/reimbursements/{pytest.reimb_scope_id}/reject",
            json={"reason": "not valid"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "rejected"

    def test_random_cannot_reject(self, users, staff):
        r = users["emp"]["session"].post(f"{BASE_URL}/api/reimbursements",
            json={"staff_id": staff["emp"]["id"], "amount": 100, "date": "2025-06-13"})
        rid = r.json()["id"]
        r = users["rnd"]["session"].patch(f"{BASE_URL}/api/reimbursements/{rid}/reject",
            json={"reason": "x"})
        assert r.status_code == 403


# ============ Payroll ============

class TestPayroll:
    def test_run_generates_rows(self, admin, staff):
        r = admin.post(f"{BASE_URL}/api/payroll/run", params={"month": 6, "year": 2025})
        assert r.status_code == 200, r.text
        body = r.json()
        # find emp's payroll row
        r = admin.get(f"{BASE_URL}/api/payroll", params={"month": 6, "year": 2025})
        assert r.status_code == 200
        rows = r.json()
        emp_row = next((x for x in rows if x["staff_id"] == staff["emp"]["id"]), None)
        assert emp_row is not None, "payroll row missing for emp"
        # 3 present + 1 half = 3.5 days (leave/absent excluded)
        assert emp_row["days_present"] == 3.5, f"got {emp_row['days_present']}"
        # gross = 3.5 * 1200 (per_day_rate after update) = 4200
        assert emp_row["gross"] == 4200.0, f"got {emp_row['gross']}"
        assert emp_row["status"] == "draft"
        pytest.payroll_id = emp_row["id"]
        pytest.payroll_net = emp_row["net"]

    def test_run_idempotent_no_duplicate(self, admin, staff):
        r = admin.post(f"{BASE_URL}/api/payroll/run", params={"month": 6, "year": 2025})
        assert r.status_code == 200
        # all rows for emp in 6/2025
        rows = admin.get(f"{BASE_URL}/api/payroll", params={"month": 6, "year": 2025}).json()
        emp_rows = [x for x in rows if x["staff_id"] == staff["emp"]["id"]]
        assert len(emp_rows) == 1, f"duplicated: {emp_rows}"

    def test_pay_creates_expense_txn_and_marks_paid(self, admin, users):
        before = admin.get(f"{BASE_URL}/api/transactions", params={"type": "expense"}).json()
        before_ids = {t["id"] for t in before}

        r = users["acct"]["session"].patch(f"{BASE_URL}/api/payroll/{pytest.payroll_id}/pay")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "paid"
        assert body.get("txn_id")

        after = admin.get(f"{BASE_URL}/api/transactions", params={"type": "expense"}).json()
        match = [t for t in after if t["id"] == body["txn_id"]]
        assert len(match) == 1
        assert match[0]["amount"] == pytest.payroll_net
        assert match[0]["type"] == "expense"
        assert match[0]["status"] == "approved"

    def test_double_pay_rejected(self, users):
        r = users["acct"]["session"].patch(f"{BASE_URL}/api/payroll/{pytest.payroll_id}/pay")
        assert r.status_code == 400
