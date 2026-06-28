"""Iter-25 backend tests:

Three things under test:
  1. BUG FIX (leaves)        POST /api/leaves now enriches doc with staff.center_id BEFORE
                             _attach_chain_to_request, so a center-bound chain wins over
                             the global default when staff.center_id == chain.center_id.
  2. BUG FIX (reimbursements) Same behaviour for POST /api/reimbursements.
  3. FEATURE /me/summary      Now returns `all_holidays` (full current year) + decorated
                             `leave_balances` (joined with leave_types name+color).
                             Also: empty-staff branch returns these as empty arrays.

Regression: global default chain still used when no center-bound chain exists.
"""
import os
import uuid
from datetime import datetime, timezone
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN_EMAIL = "admin@finance.app"
ADMIN_PASSWORD = "Admin@123"

RUN = uuid.uuid4().hex[:8]
YEAR = datetime.now(timezone.utc).year


# ---------------- session fixtures ----------------
@pytest.fixture(scope="session")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=20)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text[:200]}"
    return s


@pytest.fixture(scope="session")
def approver_user(admin_session):
    """An ephemeral user that we'll put as L1 approver on the center-bound chain."""
    email = f"TEST_iter25_apvr_{RUN}@example.com"
    pw = "Passw0rd!"
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/register",
               json={"email": email, "password": pw, "name": "T25Approver", "role": "manager"},
               timeout=20)
    assert r.status_code in (200, 201), r.text[:200]
    s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=20)
    me = s.get(f"{BASE_URL}/api/auth/me", timeout=20).json()
    return {"email": email, "session": s, "id": me["id"]}


@pytest.fixture(scope="session")
def fresh_admin_no_staff():
    """A fresh admin account that has NO staff link — used to verify /me/summary
    empty-staff branch contains the new array keys."""
    email = f"TEST_iter25_nostaff_{RUN}@example.com"
    pw = "Passw0rd!"
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/register",
               json={"email": email, "password": pw, "name": "T25NoStaff", "role": "admin"},
               timeout=20)
    assert r.status_code in (200, 201), r.text[:200]
    s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=20)
    return s


@pytest.fixture(scope="session")
def center_x(admin_session):
    """A fresh center created for this run."""
    body = {"name": f"T25Center_{RUN}"}
    r = admin_session.post(f"{BASE_URL}/api/entities/center", json=body, timeout=20)
    assert r.status_code in (200, 201), r.text[:200]
    return r.json()


@pytest.fixture(scope="session")
def staff_in_center(admin_session, center_x):
    """Staff in center_x with no user_id linkage (we only need it as a leave target)."""
    body = {"name": f"T25StaffC_{RUN}", "designation": "Trainer",
            "email": f"TEST_iter25_staffc_{RUN}@example.com",
            "center_id": center_x["id"],
            "monthly_salary": 0, "joining_date": "2024-01-01"}
    r = admin_session.post(f"{BASE_URL}/api/staff", json=body, timeout=20)
    assert r.status_code in (200, 201), r.text[:200]
    return r.json()


@pytest.fixture(scope="session")
def staff_no_center(admin_session):
    """Staff with center_id=None — should hit the global default chain."""
    body = {"name": f"T25StaffN_{RUN}", "designation": "Trainer",
            "email": f"TEST_iter25_staffn_{RUN}@example.com",
            "monthly_salary": 0, "joining_date": "2024-01-01"}
    r = admin_session.post(f"{BASE_URL}/api/staff", json=body, timeout=20)
    assert r.status_code in (200, 201), r.text[:200]
    return r.json()


@pytest.fixture(scope="session")
def center_leave_chain(admin_session, center_x, approver_user):
    """Active leave chain bound to center_x with approver_user as L1."""
    body = {
        "name": f"T25CenterLeaveChain_{RUN}", "type": "leave", "active": True,
        "center_id": center_x["id"],
        "steps": [{"level": 1, "kind": "user", "value": approver_user["id"]}],
    }
    r = admin_session.post(f"{BASE_URL}/api/approval-chains", json=body, timeout=20)
    assert r.status_code == 200, r.text[:200]
    return r.json()


@pytest.fixture(scope="session")
def center_reimb_chain(admin_session, center_x, approver_user):
    body = {
        "name": f"T25CenterReimbChain_{RUN}", "type": "reimbursement", "active": True,
        "center_id": center_x["id"],
        "steps": [{"level": 1, "kind": "user", "value": approver_user["id"]}],
    }
    r = admin_session.post(f"{BASE_URL}/api/approval-chains", json=body, timeout=20)
    assert r.status_code == 200, r.text[:200]
    return r.json()


# ============================================================
# BUG FIX 1: leaves route to center-bound chain
# ============================================================
class TestLeaveCenterRouting:

    def test_leave_with_center_staff_picks_center_chain(
            self, admin_session, staff_in_center, center_x,
            center_leave_chain, approver_user):
        body = {"staff_id": staff_in_center["id"],
                "start_date": "2026-07-01", "end_date": "2026-07-01",
                "reason": "iter25 center-bound routing"}
        r = admin_session.post(f"{BASE_URL}/api/leaves", json=body, timeout=20)
        assert r.status_code in (200, 201), r.text[:200]
        leave = r.json()

        # Doc must carry center_id from staff
        assert leave.get("center_id") == center_x["id"], \
            f"leave doc missing center enrichment: center_id={leave.get('center_id')}"

        # Chain must be the center-bound one (NOT global default)
        assert leave.get("chain_id") == center_leave_chain["id"], (
            f"expected center-bound chain {center_leave_chain['id']}, "
            f"got {leave.get('chain_id')}"
        )
        assert leave.get("current_level") == 1
        snap = leave.get("chain_snapshot") or []
        assert len(snap) > 0, "chain_snapshot should be non-empty"
        assert snap[0]["value"] == approver_user["id"]

        # And the approver should now see this in /approvals/pending
        pending = approver_user["session"].get(
            f"{BASE_URL}/api/approvals/pending", timeout=20).json()
        ids = {p.get("request_id") for p in pending if isinstance(p, dict)}
        assert leave["id"] in ids, (
            f"leave {leave['id']} not found in approver's pending list — got {len(ids)} items"
        )

    def test_leave_without_center_picks_global_default(self, admin_session, staff_no_center):
        """Regression: staff with center_id=None must still get routed to the global
        default leave chain (not skipped)."""
        body = {"staff_id": staff_no_center["id"],
                "start_date": "2026-07-05", "end_date": "2026-07-05",
                "reason": "iter25 global default"}
        r = admin_session.post(f"{BASE_URL}/api/leaves", json=body, timeout=20)
        assert r.status_code in (200, 201), r.text[:200]
        leave = r.json()

        # Should have SOME chain attached (the global default)
        assert leave.get("chain_id") is not None, \
            "global default chain should still be picked when staff has no center"
        assert leave.get("current_level") == 1
        assert (leave.get("chain_snapshot") or []), "chain_snapshot should be non-empty"
        # Confirm it's NOT the center-bound chain by checking the chain doc's center_id
        chain_doc = admin_session.get(
            f"{BASE_URL}/api/approval-chains", timeout=20).json()
        chosen = next((c for c in chain_doc if c["id"] == leave["chain_id"]), None)
        assert chosen is not None
        assert chosen.get("center_id") in (None, ""), \
            f"expected global chain (center_id None), got {chosen.get('center_id')}"


# ============================================================
# BUG FIX 2: reimbursements route to center-bound chain
# ============================================================
class TestReimbursementCenterRouting:

    def test_reimb_with_center_staff_picks_center_chain(
            self, admin_session, staff_in_center, center_x,
            center_reimb_chain, approver_user):
        body = {"staff_id": staff_in_center["id"],
                "amount": 350, "description": "iter25 reimb center-bound",
                "category": "travel",
                "date": "2026-07-02"}
        r = admin_session.post(f"{BASE_URL}/api/reimbursements", json=body, timeout=20)
        assert r.status_code in (200, 201), r.text[:200]
        reimb = r.json()

        assert reimb.get("center_id") == center_x["id"], \
            f"reimb doc missing center enrichment: center_id={reimb.get('center_id')}"

        assert reimb.get("chain_id") == center_reimb_chain["id"], (
            f"expected center-bound reimb chain {center_reimb_chain['id']}, "
            f"got {reimb.get('chain_id')}"
        )
        assert reimb.get("current_level") == 1
        assert len(reimb.get("chain_snapshot") or []) > 0

        # Approver should see this in their pending list too
        pending = approver_user["session"].get(
            f"{BASE_URL}/api/approvals/pending", timeout=20).json()
        ids = {p.get("request_id") for p in pending if isinstance(p, dict)}
        assert reimb["id"] in ids, f"reimb not in approver pending — got {len(ids)} items"


# ============================================================
# FEATURE: /me/summary
# ============================================================
class TestMeSummary:

    REQUIRED_KEYS = {"staff", "today", "month_stats", "pending_counts",
                     "upcoming_holidays", "all_holidays", "leave_balances"}

    def test_me_summary_no_staff_branch_has_new_keys(self, fresh_admin_no_staff):
        """The bug just fixed: empty-staff branch was missing the 3 new array keys."""
        r = fresh_admin_no_staff.get(f"{BASE_URL}/api/me/summary", timeout=20)
        assert r.status_code == 200, r.text[:200]
        data = r.json()

        missing = self.REQUIRED_KEYS - set(data.keys())
        assert not missing, f"/me/summary (no-staff) missing keys: {missing}"

        assert data["staff"] is None
        # The three new arrays — must be present AND be lists (empty is fine)
        for k in ("upcoming_holidays", "all_holidays", "leave_balances"):
            assert isinstance(data[k], list), f"{k} should be a list, got {type(data[k]).__name__}"
            assert data[k] == [], f"{k} should be empty for non-staff user, got {data[k]}"

    @pytest.fixture(scope="class")
    def staff_linked_user(self, admin_session):
        """Register a user, create a staff row linked to that user, and return both."""
        email = f"TEST_iter25_sa_{RUN}@example.com"
        pw = "Passw0rd!"
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/auth/register",
                   json={"email": email, "password": pw, "name": "T25Staffer", "role": "manager"},
                   timeout=20)
        assert r.status_code in (200, 201), r.text[:200]
        s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=20)
        me = s.get(f"{BASE_URL}/api/auth/me", timeout=20).json()

        # Create staff linked to this user
        sbody = {"name": f"T25LinkedStaff_{RUN}", "designation": "Officer",
                 "email": email, "user_id": me["id"],
                 "monthly_salary": 0, "joining_date": "2024-01-01"}
        sr = admin_session.post(f"{BASE_URL}/api/staff", json=sbody, timeout=20)
        assert sr.status_code in (200, 201), sr.text[:200]
        staff = sr.json()
        return {"session": s, "user_id": me["id"], "staff": staff, "email": email}

    def test_me_summary_with_staff_includes_new_keys(self, staff_linked_user):
        r = staff_linked_user["session"].get(f"{BASE_URL}/api/me/summary", timeout=20)
        assert r.status_code == 200, r.text[:200]
        data = r.json()
        missing = self.REQUIRED_KEYS - set(data.keys())
        assert not missing, f"/me/summary (with staff) missing keys: {missing}"
        assert data["staff"] is not None
        assert data["staff"]["id"] == staff_linked_user["staff"]["id"]
        for k in ("upcoming_holidays", "all_holidays", "leave_balances"):
            assert isinstance(data[k], list), f"{k} should be a list"
        # upcoming_holidays must be <= 3
        assert len(data["upcoming_holidays"]) <= 3

    def test_me_summary_leave_balances_decorated_with_type_meta(
            self, admin_session, staff_linked_user):
        """After allocating CL to the staff, /me/summary's leave_balances row must
        include leave_type_name + leave_type_color (joined from leave_types)."""
        # Find CL type id
        types = admin_session.get(f"{BASE_URL}/api/leave-types", timeout=20).json()
        cl = next((t for t in types if t["code"] == "CL"), None)
        assert cl is not None, "default CL leave type missing"

        # Allocate 12 days CL for current year
        ra = admin_session.post(
            f"{BASE_URL}/api/leave-balances/allocate",
            json={"leave_type_id": cl["id"], "year": YEAR, "days": 12,
                  "staff_ids": [staff_linked_user["staff"]["id"]], "mode": "set"},
            timeout=20,
        )
        assert ra.status_code == 200, ra.text[:200]

        r = staff_linked_user["session"].get(f"{BASE_URL}/api/me/summary", timeout=20)
        assert r.status_code == 200
        data = r.json()
        balances = data["leave_balances"]
        assert isinstance(balances, list) and len(balances) >= 1, (
            f"expected >=1 leave balance row, got {balances}"
        )
        cl_row = next((b for b in balances if b.get("leave_type_id") == cl["id"]), None)
        assert cl_row is not None, "CL balance not present in /me/summary leave_balances"
        assert cl_row.get("allocated") == 12
        # Decoration check
        assert cl_row.get("leave_type_name") == cl["name"], (
            f"leave_type_name not joined: row={cl_row}"
        )
        assert "leave_type_color" in cl_row, "leave_type_color key missing"

    def test_me_summary_all_holidays_filtered_to_current_year(self, staff_linked_user):
        """all_holidays should only contain holidays whose date starts with this year."""
        r = staff_linked_user["session"].get(f"{BASE_URL}/api/me/summary", timeout=20)
        assert r.status_code == 200
        data = r.json()
        prefix = str(YEAR)
        for h in data["all_holidays"]:
            assert str(h.get("date", "")).startswith(prefix), (
                f"holiday outside current year leaked in: {h}"
            )


# ============================================================
# REGRESSION (sample of iter-19..24 features)
# ============================================================
class TestRegression:

    def test_auth_users_200(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/auth/users", timeout=20)
        assert r.status_code == 200

    def test_default_chains_present(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/approval-chains", timeout=20)
        assert r.status_code == 200
        types = {c.get("type") for c in r.json()}
        for must in ("leave", "reimbursement", "transaction", "asset_purchase",
                     "employee_transfer"):
            assert must in types, f"default chain for {must} missing — present={types}"

    def test_leave_allocate_smoke(self, admin_session, staff_no_center):
        types = admin_session.get(f"{BASE_URL}/api/leave-types", timeout=20).json()
        cl = next(t for t in types if t["code"] == "CL")
        r = admin_session.post(
            f"{BASE_URL}/api/leave-balances/allocate",
            json={"leave_type_id": cl["id"], "year": YEAR, "days": 5,
                  "staff_ids": [staff_no_center["id"]], "mode": "set"},
            timeout=20,
        )
        assert r.status_code == 200, r.text[:200]

    def test_finance_gate_center_staff_403(self):
        s = requests.Session()
        email = f"TEST_iter25_cs_{RUN}@example.com"
        pw = "Passw0rd!"
        r = s.post(f"{BASE_URL}/api/auth/register",
                   json={"email": email, "password": pw, "name": "CS25", "role": "center_staff"},
                   timeout=20)
        assert r.status_code in (200, 201)
        s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=20)
        assert s.get(f"{BASE_URL}/api/transactions", timeout=20).status_code == 403
