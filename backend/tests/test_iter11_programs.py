"""Iteration-11 backend tests: leave audit fields, role permissions, Programs (batches + batch_payments)."""
import os
import uuid
import requests
import pytest


def _read_url():
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL"):
                    return line.split("=", 1)[1].strip()
    except Exception:
        pass
    return ""


BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _read_url()).rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "admin@finance.app"
ADMIN_PWD = "Admin@123"
TAG = uuid.uuid4().hex[:6]


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return s


def _register(email, password, name, role="viewer"):
    s = requests.Session()
    r = s.post(f"{API}/auth/register", json={"email": email, "password": password, "name": name, "role": role}, timeout=15)
    return s, r


def _promote(admin_sess, user_id, role):
    r = admin_sess.patch(f"{API}/auth/users/{user_id}", json={"role": role}, timeout=15)
    assert r.status_code == 200, r.text


@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN_EMAIL, ADMIN_PWD)


@pytest.fixture(scope="module")
def admin_id(admin):
    r = admin.get(f"{API}/auth/me", timeout=10)
    assert r.status_code == 200
    return r.json()["id"]


def _make_user(admin, role, label):
    """Register a viewer then promote to target role (so seniors_manager etc. all consistent)."""
    email = f"TEST_{label}_{TAG}@x.com"
    s, r = _register(email, "Pass@1234", f"{label}_{TAG}", role="viewer")
    assert r.status_code == 200, r.text
    user = r.json()
    _promote(admin, user["id"], role)
    # re-login so cookie has new role baked into JWT (if needed)
    s2 = _login(email, "Pass@1234")
    return s2, user


@pytest.fixture(scope="module")
def hr_user(admin):
    return _make_user(admin, "hr", "hr")


@pytest.fixture(scope="module")
def sm_user(admin):
    return _make_user(admin, "senior_manager", "sm")


@pytest.fixture(scope="module")
def cs_user(admin):
    return _make_user(admin, "center_staff", "cs")


@pytest.fixture(scope="module")
def viewer_user(admin):
    email = f"TEST_view11_{TAG}@x.com"
    s, r = _register(email, "Pass@1234", f"View11_{TAG}", role="viewer")
    assert r.status_code == 200
    return s, r.json()


# ---------- Leave Audit Fields ----------
class TestLeaveAudit:
    def _create_leave_for_user(self, admin, applicant_id):
        body = {"staff_id": applicant_id, "leave_type": "casual", "start_date": "2026-02-01",
                "end_date": "2026-02-02", "reason": f"audit_{TAG}"}
        r = admin.post(f"{API}/leaves", json=body, timeout=15)
        assert r.status_code == 200, r.text
        return r.json()["id"]

    def test_admin_decides_leave_sets_audit(self, admin, admin_id):
        # Need a staff to put in staff_id; create one via admin
        sbody = {"name": f"TEST_stf_leave_{TAG}", "designation": "Test", "monthly_salary": 1000,
                 "joining_date": "2025-01-01"}
        sr = admin.post(f"{API}/staff", json=sbody, timeout=15)
        assert sr.status_code == 200, sr.text
        sid = sr.json()["id"]
        lid = self._create_leave_for_user(admin, sid)
        r = admin.patch(f"{API}/leaves/{lid}?decision=approved", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "approved"
        assert data.get("decided_by") == admin_id
        assert data.get("decided_at"), "decided_at missing"
        # store for next test
        TestLeaveAudit._approved_lid = lid

    def test_approval_log_shows_by_name_for_leave(self, admin):
        r = admin.get(f"{API}/approval-log?type_filter=leave", timeout=15)
        assert r.status_code == 200, r.text
        rows = r.json()
        assert isinstance(rows, list)
        # find our row
        ours = [x for x in rows if x.get("ref_id") == getattr(TestLeaveAudit, "_approved_lid", None)]
        assert ours, "Decided leave not surfaced in approval-log"
        assert ours[0]["by"] not in ("—", "", None), f"Expected non-dash 'by', got {ours[0]['by']}"


# ---------- Role Permissions ----------
class TestRolePermissions:
    def test_hr_can_create_and_update_staff(self, hr_user):
        s, _ = hr_user
        body = {"name": f"TEST_hrstaff_{TAG}", "designation": "Lead", "monthly_salary": 5000,
                "joining_date": "2025-01-01"}
        r = s.post(f"{API}/staff", json=body, timeout=15)
        assert r.status_code == 200, r.text
        sid = r.json()["id"]
        r2 = s.put(f"{API}/staff/{sid}", json={**body, "monthly_salary": 6000}, timeout=15)
        assert r2.status_code == 200, r2.text
        assert r2.json()["monthly_salary"] == 6000

    def test_hr_can_run_and_pay_payroll(self, hr_user, admin):
        s, _ = hr_user
        # Need at least one staff – ensure a staff exists
        body = {"name": f"TEST_payhr_{TAG}", "designation": "X", "monthly_salary": 4000,
                "joining_date": "2025-01-01"}
        sr = admin.post(f"{API}/staff", json=body, timeout=15)
        assert sr.status_code == 200
        r = s.post(f"{API}/payroll/run?year=2026&month=1", timeout=20)
        assert r.status_code == 200, r.text
        # find a payroll row and try pay
        plist = admin.get(f"{API}/payroll?year=2026&month=1", timeout=15).json()
        target = next((x for x in plist if x.get("status") != "paid"), None)
        if target:
            r2 = s.patch(f"{API}/payroll/{target['id']}/pay", timeout=15)
            assert r2.status_code in (200, 400), r2.text  # 400 if status already final

    def test_hr_can_decide_leave(self, hr_user, admin):
        s, hu = hr_user
        sbody = {"name": f"TEST_stfhr_lv_{TAG}", "designation": "Test", "monthly_salary": 1000,
                 "joining_date": "2025-01-01"}
        sr = admin.post(f"{API}/staff", json=sbody, timeout=15)
        sid = sr.json()["id"]
        lr = admin.post(f"{API}/leaves", json={"staff_id": sid, "leave_type": "casual",
                                                "start_date": "2026-03-01", "end_date": "2026-03-02",
                                                "reason": "hr-test"}, timeout=15)
        lid = lr.json()["id"]
        r = s.patch(f"{API}/leaves/{lid}?decision=approved", timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("decided_by") == hu["id"]

    def test_sm_can_approve_reject_bulk(self, sm_user, admin):
        s, _ = sm_user
        # create a pending txn as admin then test approve via senior_manager
        body = {"type": "expense", "amount": 50, "date": "2026-01-15", "description": f"sm_{TAG}", "items": []}
        r = admin.post(f"{API}/transactions", json=body, timeout=15)
        tid = r.json()["id"]
        # admin auto-approves; create one as a non-admin to remain pending? Use viewer? Viewer cannot.
        # Instead, reject endpoint should still respond 200 if status was approved? Actually reject only works on pending.
        # Use a manager-created txn to get a pending one – use hr as proxy? Easiest: register a manager.
        memail = f"TEST_mgrsm_{TAG}@x.com"
        ms, mr = _register(memail, "Pass@1234", "MgrSM", role="viewer")
        assert mr.status_code == 200
        _promote(admin, mr.json()["id"], "manager")
        ms = _login(memail, "Pass@1234")
        rr = ms.post(f"{API}/transactions", json=body, timeout=15)
        assert rr.status_code == 200
        ptid = rr.json()["id"]
        # senior_manager approves
        ar = s.post(f"{API}/transactions/{ptid}/approve", timeout=15)
        assert ar.status_code == 200, ar.text
        # bulk
        rr2 = ms.post(f"{API}/transactions", json=body, timeout=15)
        ptid2 = rr2.json()["id"]
        br = s.post(f"{API}/transactions/bulk-approve", json={"ids": [ptid2]}, timeout=15)
        assert br.status_code == 200, br.text
        # reject path
        rr3 = ms.post(f"{API}/transactions", json=body, timeout=15)
        ptid3 = rr3.json()["id"]
        rej = s.post(f"{API}/transactions/{ptid3}/reject", json={"reason": "no"}, timeout=15)
        assert rej.status_code == 200, rej.text

    def test_center_staff_can_mark_attendance(self, cs_user, admin):
        s, _ = cs_user
        sbody = {"name": f"TEST_csstf_{TAG}", "designation": "X", "monthly_salary": 1000,
                 "joining_date": "2025-01-01"}
        sr = admin.post(f"{API}/staff", json=sbody, timeout=15)
        sid = sr.json()["id"]
        r = s.post(f"{API}/attendance", json={"staff_id": sid, "date": "2026-01-15", "status": "present"}, timeout=15)
        assert r.status_code == 200, r.text

    def test_viewer_forbidden(self, viewer_user):
        s, _ = viewer_user
        # cannot post staff
        r = s.post(f"{API}/staff", json={"name": "x", "designation": "x", "monthly_salary": 1, "joining_date": "2025-01-01"}, timeout=15)
        assert r.status_code == 403
        # cannot run payroll
        r2 = s.post(f"{API}/payroll/run?year=2026&month=1", timeout=15)
        assert r2.status_code == 403
        # cannot mark attendance
        r3 = s.post(f"{API}/attendance", json={"staff_id": "x", "date": "2026-01-15", "status": "present"}, timeout=15)
        assert r3.status_code == 403
        # cannot bulk approve
        r4 = s.post(f"{API}/transactions/bulk-approve", json={"ids": ["x"]}, timeout=15)
        assert r4.status_code == 403


# ---------- Programs: Batches ----------
@pytest.fixture(scope="module")
def project_id(admin):
    r = admin.post(f"{API}/entities/project", json={"name": f"TEST_proj_{TAG}"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.fixture(scope="module")
def center_id(admin):
    r = admin.post(f"{API}/entities/center", json={"name": f"TEST_center_{TAG}"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["id"]


class TestBatches:
    def test_create_batch_admin(self, admin, project_id, center_id):
        body = {"project_id": project_id, "center_id": center_id, "name": f"BATCH_{TAG}",
                "start_date": "2026-01-01", "end_date": "2026-06-30",
                "total_beneficiaries": 50, "description": "test batch"}
        r = admin.post(f"{API}/batches", json=body, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["name"] == body["name"]
        assert d["project_id"] == project_id
        TestBatches._bid = d["id"]

    def test_list_filter_by_project(self, admin, project_id):
        r = admin.get(f"{API}/batches?project_id={project_id}", timeout=15)
        assert r.status_code == 200
        rows = r.json()
        assert any(x["id"] == TestBatches._bid for x in rows)
        assert all(x["project_id"] == project_id for x in rows)

    def test_list_filter_by_center(self, admin, center_id):
        r = admin.get(f"{API}/batches?center_id={center_id}", timeout=15)
        assert r.status_code == 200
        assert any(x["id"] == TestBatches._bid for x in r.json())

    def test_update_batch(self, admin, project_id, center_id):
        body = {"project_id": project_id, "center_id": center_id, "name": f"BATCH_{TAG}_v2",
                "start_date": "2026-01-01", "end_date": "2026-06-30",
                "total_beneficiaries": 75, "description": "updated"}
        r = admin.put(f"{API}/batches/{TestBatches._bid}", json=body, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["name"] == body["name"]
        assert r.json()["total_beneficiaries"] == 75

    def test_viewer_cannot_create_batch(self, viewer_user, project_id):
        s, _ = viewer_user
        r = s.post(f"{API}/batches", json={"project_id": project_id, "name": "x"}, timeout=15)
        assert r.status_code == 403

    def test_sm_can_create_batch(self, sm_user, project_id):
        s, _ = sm_user
        r = s.post(f"{API}/batches", json={"project_id": project_id, "name": f"sm_batch_{TAG}"}, timeout=15)
        assert r.status_code == 200, r.text

    def test_viewer_cannot_delete_batch(self, viewer_user):
        s, _ = viewer_user
        r = s.delete(f"{API}/batches/{TestBatches._bid}", timeout=15)
        assert r.status_code == 403

    def test_sm_cannot_delete_batch(self, sm_user):
        # delete is admin-only per spec
        s, _ = sm_user
        r = s.delete(f"{API}/batches/{TestBatches._bid}", timeout=15)
        assert r.status_code == 403


# ---------- Programs: Batch Payments ----------
class TestBatchPayments:
    def test_create_three_milestones(self, admin):
        bid = TestBatches._bid
        for m, amt in [("1st", 10000), ("2nd", 20000), ("3rd", 30000)]:
            r = admin.post(f"{API}/batch-payments",
                           json={"batch_id": bid, "milestone": m, "amount": amt,
                                 "expected_date": "2026-03-15", "description": f"{m} payment"}, timeout=15)
            assert r.status_code == 200, r.text
            d = r.json()
            assert d["milestone"] == m
            assert d["status"] == "pending"
            setattr(TestBatchPayments, f"_pid_{m}", d["id"])

    def test_duplicate_milestone_rejected(self, admin):
        bid = TestBatches._bid
        r = admin.post(f"{API}/batch-payments",
                       json={"batch_id": bid, "milestone": "1st", "amount": 1, "description": "dup"}, timeout=15)
        assert r.status_code == 400

    def test_list_by_batch(self, admin):
        r = admin.get(f"{API}/batch-payments?batch_id={TestBatches._bid}", timeout=15)
        assert r.status_code == 200
        rows = r.json()
        miles = {x["milestone"] for x in rows}
        assert {"1st", "2nd", "3rd"}.issubset(miles)

    def test_update_payment(self, admin):
        pid = TestBatchPayments._pid_2nd
        r = admin.put(f"{API}/batch-payments/{pid}",
                      json={"batch_id": TestBatches._bid, "milestone": "2nd", "amount": 25000,
                            "expected_date": "2026-04-01", "description": "updated"}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["amount"] == 25000

    def test_receive_creates_txn(self, admin, admin_id, project_id, center_id):
        pid = TestBatchPayments._pid_1st
        r = admin.patch(f"{API}/batch-payments/{pid}/receive", timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "received"
        assert d["received_date"]
        assert d["received_by"] == admin_id
        assert d["txn_id"]
        # verify txn via list (no per-id GET endpoint exists)
        tr = admin.get(f"{API}/transactions", timeout=15)
        assert tr.status_code == 200, tr.text
        txns = tr.json()
        match = next((x for x in txns if x.get("id") == d["txn_id"]), None)
        assert match, f"Created txn {d['txn_id']} not found in list"
        t = match
        assert t["type"] == "income"
        assert t["amount"] == 10000
        assert t["status"] == "approved"
        assert t["center_id"] == center_id
        assert t["project_id"] == project_id

    def test_double_receive_400(self, admin):
        pid = TestBatchPayments._pid_1st
        r = admin.patch(f"{API}/batch-payments/{pid}/receive", timeout=15)
        assert r.status_code == 400
        assert "Already received" in r.text or "already" in r.text.lower()

    def test_hr_cannot_receive(self, hr_user):
        s, _ = hr_user
        pid = TestBatchPayments._pid_2nd
        r = s.patch(f"{API}/batch-payments/{pid}/receive", timeout=15)
        assert r.status_code == 403

    def test_sm_can_receive(self, sm_user):
        s, _ = sm_user
        pid = TestBatchPayments._pid_2nd
        r = s.patch(f"{API}/batch-payments/{pid}/receive", timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "received"


# ---------- Cascade Delete ----------
class TestCascade:
    def test_delete_batch_cascades_payments(self, admin, project_id):
        # Create a new batch for delete (avoid disturbing TestBatches._bid)
        br = admin.post(f"{API}/batches",
                        json={"project_id": project_id, "name": f"DEL_BATCH_{TAG}"}, timeout=15)
        assert br.status_code == 200
        bid = br.json()["id"]
        pr = admin.post(f"{API}/batch-payments",
                        json={"batch_id": bid, "milestone": "1st", "amount": 100, "description": "to-cascade"},
                        timeout=15)
        assert pr.status_code == 200
        pid = pr.json()["id"]
        dr = admin.delete(f"{API}/batches/{bid}", timeout=15)
        assert dr.status_code == 200, dr.text
        # payments should be gone
        lr = admin.get(f"{API}/batch-payments?batch_id={bid}", timeout=15)
        assert lr.status_code == 200
        assert lr.json() == []
        # individual payment also gone (via list)
        all_pay = admin.get(f"{API}/batch-payments", timeout=15).json()
        assert not any(x["id"] == pid for x in all_pay)


# ---------- Unauthenticated ----------
class TestUnauth:
    def test_unauth_batches(self):
        r = requests.get(f"{API}/batches", timeout=10)
        assert r.status_code == 401

    def test_unauth_payments(self):
        r = requests.get(f"{API}/batch-payments", timeout=10)
        assert r.status_code == 401
