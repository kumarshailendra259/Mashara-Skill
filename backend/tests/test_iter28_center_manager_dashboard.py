"""iter-28 — Center Manager operational dashboard.

Tests:
- GET /api/dashboard/center-ops returns ops KPIs scoped by role.
- Admin/HR/senior_manager/manager get ALL centers.
- center_manager gets ONLY assigned centers.
- Empty assigned_center_ids → zero KPIs, no crash.
- Counts work: 3 staff, 2 present + 1 absent → pct 66.7.
- REGRESSION: center_manager still gets 403 on finance endpoints.
"""
import os
import uuid
import requests
import pytest
from datetime import datetime, timezone

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
RUN = uuid.uuid4().hex[:6]
ADMIN_EMAIL = "admin@finance.app"
ADMIN_PASSWORD = "Admin@123"
TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _login(email, pwd):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pwd}, timeout=20)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


def _register_and_patch(admin_sess, label, role, assigned_center_ids=None):
    email = f"TEST_iter28_{label}_{RUN}@finance.app"
    pwd = "Test@1234"
    tmp = requests.Session()
    rr = tmp.post(f"{BASE_URL}/api/auth/register",
                  json={"email": email, "password": pwd, "name": f"T28 {label} {RUN}", "role": role},
                  timeout=20)
    assert rr.status_code in (200, 201), f"register {label}: {rr.status_code} {rr.text}"
    user = rr.json().get("user") or rr.json()
    uid = user.get("id")
    patch_body = {"role": role}
    if assigned_center_ids is not None:
        patch_body["assigned_center_ids"] = assigned_center_ids
    pr = admin_sess.patch(f"{BASE_URL}/api/auth/users/{uid}", json=patch_body, timeout=15)
    assert pr.status_code == 200, f"patch {label}: {pr.status_code} {pr.text}"
    sess = _login(email, pwd)
    return {"session": sess, "user_id": uid, "email": email}


@pytest.fixture(scope="module")
def seeded(admin):
    """Create center, 3 staff, attendance (2 present + 1 absent), a manager assigned."""
    # Create a dedicated center
    cr = admin.post(f"{BASE_URL}/api/entities/center",
                    json={"name": f"TEST_iter28_C_{RUN}", "city": "Pune", "state": "MH"},
                    timeout=15)
    assert cr.status_code in (200, 201), cr.text
    center_id = cr.json()["id"]

    # Create a 2nd center the manager is NOT assigned to (for scope isolation)
    cr2 = admin.post(f"{BASE_URL}/api/entities/center",
                     json={"name": f"TEST_iter28_OTHER_{RUN}", "city": "X", "state": "Y"},
                     timeout=15)
    assert cr2.status_code in (200, 201)
    other_center_id = cr2.json()["id"]

    # Create 3 staff at center_id
    staff_ids = []
    for i in range(3):
        s = admin.post(f"{BASE_URL}/api/staff",
                       json={
                           "name": f"TEST_iter28_S{i}_{RUN}",
                           "designation": "Teacher",
                           "monthly_salary": 10000,
                           "per_day_rate": 333,
                           "joining_date": "2025-01-01",
                           "center_id": center_id,
                       },
                       timeout=15)
        assert s.status_code in (200, 201), f"staff{i}: {s.status_code} {s.text}"
        staff_ids.append(s.json()["id"])

    # Create one staff at OTHER center (should NOT be in manager's KPI)
    sother = admin.post(f"{BASE_URL}/api/staff",
                        json={"name": f"TEST_iter28_OTHER_S_{RUN}", "designation": "Teacher",
                              "monthly_salary": 0, "per_day_rate": 0, "joining_date": "2025-01-01",
                              "center_id": other_center_id},
                        timeout=15)
    assert sother.status_code in (200, 201)

    # Mark attendance: 2 present, 1 absent for TODAY
    for i, sid in enumerate(staff_ids):
        status = "present" if i < 2 else "absent"
        ar = admin.post(f"{BASE_URL}/api/attendance",
                        json={"staff_id": sid, "date": TODAY, "status": status},
                        timeout=15)
        assert ar.status_code in (200, 201), f"att {i}: {ar.status_code} {ar.text}"

    # Create a center_manager user assigned to center_id
    cm = _register_and_patch(admin, "CM", "center_manager", [center_id])

    # Create a center_manager with empty assignments
    cm_empty = _register_and_patch(admin, "CMEMPTY", "center_manager", [])

    # Create a center_staff user (other ops role) assigned to center_id
    cs = _register_and_patch(admin, "CS", "center_staff", [center_id])

    return {
        "center_id": center_id,
        "other_center_id": other_center_id,
        "staff_ids": staff_ids,
        "cm": cm,
        "cm_empty": cm_empty,
        "cs": cs,
    }


# ---------------- Endpoint shape & scoping ----------------

class TestCenterOpsEndpoint:
    def test_shape_for_center_manager(self, seeded):
        r = seeded["cm"]["session"].get(f"{BASE_URL}/api/dashboard/center-ops", timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        # Required top-level keys
        for k in ("as_of", "center_ids", "kpi", "upcoming_holidays",
                  "my_pending_approvals", "recent_leaves", "my_centers"):
            assert k in body, f"missing key {k}: {list(body.keys())}"
        # KPI keys
        kpi = body["kpi"]
        for k in ("staff_total", "attendance_present", "attendance_absent",
                  "attendance_pct", "leaves_pending", "regularisations_pending",
                  "batches_active", "asset_total"):
            assert k in kpi, f"missing kpi key {k}: {list(kpi.keys())}"

    def test_counts_correct_for_assigned_manager(self, seeded):
        r = seeded["cm"]["session"].get(f"{BASE_URL}/api/dashboard/center-ops", timeout=20)
        assert r.status_code == 200, r.text
        kpi = r.json()["kpi"]
        assert kpi["staff_total"] == 3, f"expected 3 got {kpi['staff_total']}"
        assert kpi["attendance_present"] == 2, f"expected 2 got {kpi['attendance_present']}"
        assert kpi["attendance_absent"] == 1, f"expected 1 got {kpi['attendance_absent']}"
        # 2/3 = 66.666… rounded to 66.7
        assert abs(kpi["attendance_pct"] - 66.7) < 0.05, f"expected ~66.7 got {kpi['attendance_pct']}"

    def test_center_scope_only_assigned(self, seeded):
        r = seeded["cm"]["session"].get(f"{BASE_URL}/api/dashboard/center-ops", timeout=20)
        body = r.json()
        assert seeded["center_id"] in body["center_ids"]
        assert seeded["other_center_id"] not in body["center_ids"], \
            f"manager leaked other center: {body['center_ids']}"
        # my_centers should match
        mc_ids = {c["id"] for c in body["my_centers"]}
        assert seeded["center_id"] in mc_ids
        assert seeded["other_center_id"] not in mc_ids

    def test_empty_assigned_returns_zero(self, seeded):
        r = seeded["cm_empty"]["session"].get(f"{BASE_URL}/api/dashboard/center-ops", timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["center_ids"] == []
        assert body["my_centers"] == []
        assert body["recent_leaves"] == []
        assert body["upcoming_holidays"] == []
        assert body["my_pending_approvals"] == 0
        # KPI may be {} (empty) when no centers — that's the explicit empty branch
        kpi = body["kpi"]
        if kpi:
            assert kpi.get("staff_total", 0) == 0
            assert kpi.get("attendance_present", 0) == 0

    def test_center_staff_ops_role_works(self, seeded):
        r = seeded["cs"]["session"].get(f"{BASE_URL}/api/dashboard/center-ops", timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        # center_staff also goes through assigned_center_ids branch
        assert seeded["center_id"] in body["center_ids"]
        assert seeded["other_center_id"] not in body["center_ids"]
        assert body["kpi"]["staff_total"] == 3

    def test_admin_sees_all_centers(self, admin, seeded):
        r = admin.get(f"{BASE_URL}/api/dashboard/center-ops", timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        # Admin sees ALL — at least both our seeded centers
        assert seeded["center_id"] in body["center_ids"]
        assert seeded["other_center_id"] in body["center_ids"]
        # Staff count >= 4 (3 + 1 OTHER staff)
        assert body["kpi"]["staff_total"] >= 4


# ---------------- REGRESSION: finance endpoints still 403 for center_manager ----------------

class TestFinanceGateRegression:
    FINANCE_ENDPOINTS = [
        "/api/dashboard/summary",
        "/api/transactions",
        "/api/batches",
        "/api/batch-payments",
        "/api/reports/tds-register",
        "/api/dashboard/milestone-income",
        "/api/dashboard/fooding-income",
        "/api/dashboard/settlement",
    ]

    @pytest.mark.parametrize("path", FINANCE_ENDPOINTS)
    def test_center_manager_403_on_finance(self, seeded, path):
        r = seeded["cm"]["session"].get(f"{BASE_URL}{path}", timeout=20)
        assert r.status_code in (401, 403), \
            f"FINANCE LEAK: {path} returned {r.status_code} to center_manager (expected 403). Body: {r.text[:200]}"


# ---------------- iter-19..27 quick regression smoke ----------------

class TestPriorIterationSmoke:
    def test_iter27_partner_centers_endpoint_still_present(self, admin):
        # Just confirm 404 for a bogus partner doesn't break; admin role passes gate.
        r = admin.get(f"{BASE_URL}/api/partners/nonexistent-id/centers", timeout=15)
        assert r.status_code in (200, 404), f"unexpected: {r.status_code}"

    def test_iter26_regularisation_chain_default(self, admin):
        r = admin.get(f"{BASE_URL}/api/approval-chains?type=regularisation", timeout=15)
        assert r.status_code == 200
        chains = r.json()
        assert any(c.get("active") for c in chains), "Regularisation default chain missing"

    def test_iter24_me_summary_leave_balances(self, admin):
        r = admin.get(f"{BASE_URL}/api/me/summary", timeout=15)
        assert r.status_code in (200, 404)
        if r.status_code == 200:
            body = r.json()
            assert "leave_balances" in body or "all_holidays" in body
