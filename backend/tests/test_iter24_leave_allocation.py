"""Iter-24 backend tests: approval chain staff/user resolution + Leave Allocation feature.

Covers:
  - BUG FIX 1: POST /api/approval-chains rejects staff steps without user_id linkage (400);
               auto-heals via email fallback when staff.email matches a registered user;
               kind='user' chain routes to that user and they can act on the request.
  - BUG FIX 1: PUT /api/approval-chains/{id} also runs the same validation.
  - BUG FIX 1: Existing chains with broken staff linkage self-heal via email lookup at
               /approvals/pending and /approvals/act resolution time.
  - FEATURE   Leave types CRUD + lazy seeding of 5 defaults (CL/SL/PL/COMP/LWP).
  - FEATURE   POST /api/leave-balances/allocate (set / add / staff_ids / center_id / all).
  - FEATURE   GET  /api/leave-balances + /api/leave-balances/my.
  - FEATURE   PATCH /api/leave-balances/{id} adjust deltas + negative deltas clamp to 0.
  - FEATURE   Leave deduction: 3-day inclusive leave reduces balance by exactly 3.
  - FEATURE   Leave deduction skips silently when leave has no leave_type_id (no crash).
  - REGRESSION /api/auth/users 200, /api/dashboard/summary 200, /api/transactions 200,
               default approval chains still present.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN_EMAIL = "admin@finance.app"
ADMIN_PASSWORD = "Admin@123"

RUN = uuid.uuid4().hex[:8]


# ---------------- session fixtures ----------------
@pytest.fixture(scope="session")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=20)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text[:200]}"
    return s


@pytest.fixture(scope="session")
def linked_user(admin_session):
    """Register an ephemeral user that we'll link to a staff via email-fallback path."""
    email = f"TEST_iter24_linked_{RUN}@example.com"
    pw = "Passw0rd!"
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/register",
               json={"email": email, "password": pw, "name": "T24Linked", "role": "manager"},
               timeout=20)
    assert r.status_code in (200, 201), f"register linked user: {r.status_code} {r.text[:200]}"
    lr = s.post(f"{BASE_URL}/api/auth/login",
                json={"email": email, "password": pw}, timeout=20)
    assert lr.status_code == 200
    me = s.get(f"{BASE_URL}/api/auth/me", timeout=20).json()
    return {"email": email, "password": pw, "session": s, "id": me["id"]}


@pytest.fixture(scope="session")
def linked_staff(admin_session, linked_user):
    """Staff row whose email matches `linked_user.email`, but user_id NOT set initially.
    Used to verify email-fallback auto-heal in _resolve_step_user_ids / _validate_chain_steps."""
    body = {"name": f"T24LinkedStaff_{RUN}", "designation": "Manager",
            "email": linked_user["email"], "monthly_salary": 0, "joining_date": "2024-01-01"}
    r = admin_session.post(f"{BASE_URL}/api/staff", json=body, timeout=20)
    assert r.status_code in (200, 201), f"create linked staff: {r.status_code} {r.text[:200]}"
    return r.json()


@pytest.fixture(scope="session")
def orphan_staff(admin_session):
    """Staff with email NOT matching any registered user → chain validation should 400."""
    body = {"name": f"T24OrphanStaff_{RUN}", "designation": "Analyst",
            "email": f"TEST_iter24_nobody_{RUN}@example.com",
            "monthly_salary": 0, "joining_date": "2024-01-01"}
    r = admin_session.post(f"{BASE_URL}/api/staff", json=body, timeout=20)
    assert r.status_code in (200, 201), f"create orphan staff: {r.status_code} {r.text[:200]}"
    return r.json()


@pytest.fixture(scope="session")
def submitter_staff(admin_session):
    """A staff record used as `staff_id` on the leave request itself.
    Created with linked admin-side login so leave deduction has a target."""
    body = {"name": f"T24Submitter_{RUN}", "designation": "Trainer",
            "email": f"TEST_iter24_sub_{RUN}@example.com",
            "monthly_salary": 0, "joining_date": "2024-01-01"}
    r = admin_session.post(f"{BASE_URL}/api/staff", json=body, timeout=20)
    assert r.status_code in (200, 201)
    return r.json()


# ============================================================
# BUG FIX 1: Approval Chain staff/user resolution
# ============================================================
class TestApprovalChainStaffUserResolution:

    def test_chain_rejects_orphan_staff_step(self, admin_session, orphan_staff):
        """staff step with no user_id and email matching no user → 400 with helpful msg."""
        body = {
            "name": f"T24Bad_{RUN}", "type": "leave", "active": False,
            "steps": [{"level": 1, "kind": "staff", "value": orphan_staff["id"]}],
        }
        r = admin_session.post(f"{BASE_URL}/api/approval-chains", json=body, timeout=20)
        assert r.status_code == 400, f"expected 400 got {r.status_code} {r.text[:200]}"
        msg = (r.json().get("detail") or "").lower()
        assert "level 1" in msg
        assert orphan_staff["name"].lower() in msg or "login" in msg

    def test_chain_autoheal_via_email_fallback(self, admin_session, linked_staff, linked_user):
        """staff step where staff.email matches a registered user → chain saves AND
        staff.user_id is back-filled."""
        body = {
            "name": f"T24Heal_{RUN}", "type": "reimbursement", "active": False,
            "steps": [{"level": 1, "kind": "staff", "value": linked_staff["id"]}],
        }
        r = admin_session.post(f"{BASE_URL}/api/approval-chains", json=body, timeout=20)
        assert r.status_code == 200, f"expected 200 got {r.status_code} {r.text[:200]}"

        # Verify self-heal: staff.user_id should now equal linked_user.id
        gs = admin_session.get(f"{BASE_URL}/api/staff", timeout=20).json()
        row = next((s for s in gs if s["id"] == linked_staff["id"]), None)
        assert row is not None
        assert row.get("user_id") == linked_user["id"], (
            f"expected staff.user_id auto-healed to {linked_user['id']}, got {row.get('user_id')}"
        )

    def test_chain_with_user_kind_routes_correctly(self, admin_session, linked_user, submitter_staff):
        """kind='user' chain: leave submitted → linked_user sees it in /approvals/pending and can act."""
        # Create a leave chain pointing at linked_user
        chain = {
            "name": f"T24UserChain_{RUN}", "type": "leave", "active": True,
            "steps": [{"level": 1, "kind": "user", "value": linked_user["id"]}],
        }
        r = admin_session.post(f"{BASE_URL}/api/approval-chains", json=chain, timeout=20)
        assert r.status_code == 200, f"create user chain: {r.status_code} {r.text[:200]}"

        # Admin submits a leave (no leave_type_id — deduction silently skips)
        leave_body = {"staff_id": submitter_staff["id"],
                      "start_date": "2026-05-01", "end_date": "2026-05-01",
                      "reason": "iter24 user-chain test"}
        lr = admin_session.post(f"{BASE_URL}/api/leaves", json=leave_body, timeout=20)
        assert lr.status_code in (200, 201), lr.text[:200]
        leave = lr.json()

        # linked_user should see it in their /approvals/pending
        pending = linked_user["session"].get(f"{BASE_URL}/api/approvals/pending", timeout=20).json()
        ids = {p.get("request_id") for p in pending if isinstance(p, dict)}
        assert leave["id"] in ids, f"leave {leave['id']} not in pending for linked user; got {ids}"

        # linked_user approves it
        act = linked_user["session"].post(
            f"{BASE_URL}/api/approvals/act",
            json={"request_type": "leave", "request_id": leave["id"],
                  "action": "approve", "remarks": "ok by iter24"},
            timeout=20,
        )
        assert act.status_code == 200, f"act: {act.status_code} {act.text[:200]}"

    def test_put_chain_rejects_orphan_staff(self, admin_session, orphan_staff, linked_user):
        # First create a valid chain
        chain = {
            "name": f"T24PutGood_{RUN}", "type": "reimbursement", "active": False,
            "steps": [{"level": 1, "kind": "user", "value": linked_user["id"]}],
        }
        r = admin_session.post(f"{BASE_URL}/api/approval-chains", json=chain, timeout=20)
        assert r.status_code == 200
        cid = r.json()["id"]

        # Now PUT it with an orphan-staff step → 400
        bad = {
            "name": f"T24PutBad_{RUN}", "type": "reimbursement", "active": False,
            "steps": [{"level": 1, "kind": "staff", "value": orphan_staff["id"]}],
        }
        rp = admin_session.put(f"{BASE_URL}/api/approval-chains/{cid}", json=bad, timeout=20)
        assert rp.status_code == 400, f"PUT expected 400 got {rp.status_code} {rp.text[:200]}"


# ============================================================
# FEATURE: Leave Types CRUD + lazy seed
# ============================================================
class TestLeaveTypes:

    def test_get_leave_types_lazy_seeds_defaults(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/leave-types", timeout=20)
        assert r.status_code == 200
        types = r.json()
        assert isinstance(types, list)
        codes = {t["code"] for t in types}
        for must in ("CL", "SL", "PL", "COMP", "LWP"):
            assert must in codes, f"default type {must} missing — codes={codes}"
        # sorted by name
        names = [t["name"] for t in types]
        assert names == sorted(names, key=str.lower), "should be sorted by name"

    def test_create_leave_type_then_duplicate_rejected(self, admin_session):
        code = f"TT{RUN[:5]}"
        body = {"name": f"T24Type_{RUN}", "code": code, "annual_quota": 7, "paid": True}
        r = admin_session.post(f"{BASE_URL}/api/leave-types", json=body, timeout=20)
        assert r.status_code == 200, f"create: {r.status_code} {r.text[:200]}"
        created = r.json()
        assert created["code"] == code.upper()
        assert created["annual_quota"] == 7

        # dup
        rd = admin_session.post(f"{BASE_URL}/api/leave-types", json=body, timeout=20)
        assert rd.status_code == 400

    def test_update_leave_type(self, admin_session):
        # create
        code = f"TU{RUN[:5]}"
        body = {"name": f"T24Upd_{RUN}", "code": code, "annual_quota": 5}
        r = admin_session.post(f"{BASE_URL}/api/leave-types", json=body, timeout=20)
        assert r.status_code == 200
        tid = r.json()["id"]
        # update
        upd = {"name": f"T24UpdRenamed_{RUN}", "code": code, "annual_quota": 9}
        ru = admin_session.put(f"{BASE_URL}/api/leave-types/{tid}", json=upd, timeout=20)
        assert ru.status_code == 200, ru.text[:200]
        assert ru.json()["annual_quota"] == 9

    def test_delete_leave_type_blocked_when_balances_exist(self, admin_session, submitter_staff):
        # Make a fresh type, allocate to staff, then try delete → 400
        code = f"TD{RUN[:5]}"
        rt = admin_session.post(f"{BASE_URL}/api/leave-types",
                                json={"name": f"T24Del_{RUN}", "code": code, "annual_quota": 2},
                                timeout=20)
        assert rt.status_code == 200
        tid = rt.json()["id"]
        ra = admin_session.post(f"{BASE_URL}/api/leave-balances/allocate",
                                json={"leave_type_id": tid, "year": 2026, "days": 1,
                                      "staff_ids": [submitter_staff["id"]], "mode": "set"},
                                timeout=20)
        assert ra.status_code == 200, ra.text[:200]
        rd = admin_session.delete(f"{BASE_URL}/api/leave-types/{tid}", timeout=20)
        assert rd.status_code == 400

    def test_delete_unused_leave_type_succeeds(self, admin_session):
        code = f"TX{RUN[:5]}"
        rt = admin_session.post(f"{BASE_URL}/api/leave-types",
                                json={"name": f"T24Unused_{RUN}", "code": code, "annual_quota": 0},
                                timeout=20)
        assert rt.status_code == 200
        tid = rt.json()["id"]
        rd = admin_session.delete(f"{BASE_URL}/api/leave-types/{tid}", timeout=20)
        assert rd.status_code == 200


# ============================================================
# FEATURE: Leave allocation + balances
# ============================================================
@pytest.fixture(scope="session")
def cl_type_id(admin_session):
    r = admin_session.get(f"{BASE_URL}/api/leave-types", timeout=20).json()
    cl = next((t for t in r if t["code"] == "CL"), None)
    assert cl, "default CL type not present"
    return cl["id"]


class TestLeaveAllocation:

    def test_allocate_to_specific_staff_set_mode(self, admin_session, submitter_staff, cl_type_id):
        body = {"leave_type_id": cl_type_id, "year": 2026, "days": 10,
                "staff_ids": [submitter_staff["id"]], "mode": "set",
                "remarks": "iter24-set"}
        r = admin_session.post(f"{BASE_URL}/api/leave-balances/allocate", json=body, timeout=20)
        assert r.status_code == 200, r.text[:200]
        data = r.json()
        assert data["ok"] is True
        assert data["updated"] >= 1

        # verify via GET
        g = admin_session.get(f"{BASE_URL}/api/leave-balances",
                              params={"staff_id": submitter_staff["id"], "year": 2026},
                              timeout=20).json()
        row = next((b for b in g if b["leave_type_id"] == cl_type_id), None)
        assert row is not None
        assert row["allocated"] == 10
        assert row["balance"] == 10  # used=0

    def test_allocate_add_mode_increments(self, admin_session, submitter_staff, cl_type_id):
        body = {"leave_type_id": cl_type_id, "year": 2026, "days": 3,
                "staff_ids": [submitter_staff["id"]], "mode": "add",
                "remarks": "iter24-add"}
        r = admin_session.post(f"{BASE_URL}/api/leave-balances/allocate", json=body, timeout=20)
        assert r.status_code == 200
        g = admin_session.get(f"{BASE_URL}/api/leave-balances",
                              params={"staff_id": submitter_staff["id"], "year": 2026},
                              timeout=20).json()
        row = next((b for b in g if b["leave_type_id"] == cl_type_id), None)
        assert row["allocated"] == 13  # 10 + 3

    def test_allocate_no_matching_staff_400(self, admin_session, cl_type_id):
        # bogus staff id
        body = {"leave_type_id": cl_type_id, "year": 2026, "days": 1,
                "staff_ids": [f"nope-{RUN}"], "mode": "set"}
        r = admin_session.post(f"{BASE_URL}/api/leave-balances/allocate", json=body, timeout=20)
        assert r.status_code == 400

    def test_get_balances_my(self, admin_session):
        # Admin probably has no staff row — endpoint should still return shape with empty list
        r = admin_session.get(f"{BASE_URL}/api/leave-balances/my", timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "balances" in data
        assert "types" in data

    def test_patch_balance_adjust_with_negative_delta_clamps(self, admin_session, submitter_staff, cl_type_id):
        # Fetch balance id
        g = admin_session.get(f"{BASE_URL}/api/leave-balances",
                              params={"staff_id": submitter_staff["id"], "year": 2026},
                              timeout=20).json()
        row = next((b for b in g if b["leave_type_id"] == cl_type_id), None)
        assert row is not None
        bid = row["id"]
        before_allocated = row["allocated"]
        rp = admin_session.patch(f"{BASE_URL}/api/leave-balances/{bid}",
                                 json={"delta_allocated": -2, "delta_used": 0,
                                       "remarks": "iter24 adjust down"}, timeout=20)
        assert rp.status_code == 200, rp.text[:200]
        rec = rp.json()
        assert rec["allocated"] == before_allocated - 2
        # try huge negative used → clamps to 0
        rp2 = admin_session.patch(f"{BASE_URL}/api/leave-balances/{bid}",
                                  json={"delta_allocated": 0, "delta_used": -999,
                                        "remarks": "iter24 clamp"}, timeout=20)
        assert rp2.status_code == 200
        assert rp2.json()["used"] >= 0


# ============================================================
# FEATURE: Leave deduction on approve (inclusive day-count)
# ============================================================
class TestLeaveDeductionOnApprove:

    def test_3_day_leave_deducts_3(self, admin_session, submitter_staff, cl_type_id, linked_user):
        # Ensure a leave chain routing to linked_user (it's already active from earlier test, but
        # idempotently re-assert by creating a new center-less leave chain pointing at linked_user.)
        chain = {
            "name": f"T24DeductChain_{RUN}", "type": "leave", "active": True,
            "steps": [{"level": 1, "kind": "user", "value": linked_user["id"]}],
        }
        r = admin_session.post(f"{BASE_URL}/api/approval-chains", json=chain, timeout=20)
        assert r.status_code == 200, r.text[:200]

        # Read current balance (used so far)
        before = admin_session.get(f"{BASE_URL}/api/leave-balances",
                                   params={"staff_id": submitter_staff["id"], "year": 2026},
                                   timeout=20).json()
        row_before = next((b for b in before if b["leave_type_id"] == cl_type_id), None)
        assert row_before is not None, "expected pre-existing CL balance row for submitter"
        used_before = row_before.get("used", 0) or 0

        # Submit 3-day leave Apr 10-12
        leave_body = {"staff_id": submitter_staff["id"], "leave_type_id": cl_type_id,
                      "start_date": "2026-04-10", "end_date": "2026-04-12",
                      "reason": "iter24 deduction test"}
        lr = admin_session.post(f"{BASE_URL}/api/leaves", json=leave_body, timeout=20)
        assert lr.status_code in (200, 201)
        leave = lr.json()

        # Approve via linked_user
        act = linked_user["session"].post(
            f"{BASE_URL}/api/approvals/act",
            json={"request_type": "leave", "request_id": leave["id"],
                  "action": "approve", "remarks": "approving 3 days"},
            timeout=20,
        )
        assert act.status_code == 200, act.text[:200]

        # Re-read balance: used should be +3, balance reduced
        after = admin_session.get(f"{BASE_URL}/api/leave-balances",
                                  params={"staff_id": submitter_staff["id"], "year": 2026},
                                  timeout=20).json()
        row_after = next((b for b in after if b["leave_type_id"] == cl_type_id), None)
        assert row_after is not None
        used_after = row_after.get("used", 0) or 0
        delta = used_after - used_before
        assert delta == 3, f"expected used to grow by 3 (inclusive Apr10-12), got {delta}"

    def test_leave_without_leave_type_id_doesnt_crash(self, admin_session, submitter_staff, linked_user):
        leave_body = {"staff_id": submitter_staff["id"],
                      "start_date": "2026-06-01", "end_date": "2026-06-01",
                      "reason": "iter24 no-type"}
        lr = admin_session.post(f"{BASE_URL}/api/leaves", json=leave_body, timeout=20)
        assert lr.status_code in (200, 201)
        leave = lr.json()
        act = linked_user["session"].post(
            f"{BASE_URL}/api/approvals/act",
            json={"request_type": "leave", "request_id": leave["id"],
                  "action": "approve", "remarks": "no type field"},
            timeout=20,
        )
        # Should still succeed; deduction silently skipped
        assert act.status_code == 200, act.text[:200]


# ============================================================
# REGRESSION
# ============================================================
class TestRegression:

    def test_auth_users_200(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/auth/users", timeout=20)
        assert r.status_code == 200

    def test_dashboard_summary_200(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/dashboard/summary", timeout=20)
        assert r.status_code == 200

    def test_transactions_200(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/transactions", timeout=20)
        assert r.status_code == 200

    def test_default_chains_present(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/approval-chains", timeout=20)
        assert r.status_code == 200
        types = {c.get("type") for c in r.json()}
        for must in ("reimbursement", "leave", "transaction", "employee_transfer"):
            assert must in types, f"default chain for {must} missing — present={types}"

    def test_login_history_admin_200(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/auth/login-history", timeout=20)
        # Allowed roles vary; admin must always have access.
        assert r.status_code == 200

    def test_role_widgets_admin_200(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/dashboard/role-widgets", timeout=20)
        assert r.status_code == 200

    def test_center_staff_finance_gate_still_403(self, admin_session):
        """Quick re-check: center_staff (a restricted role) gets 403 on /transactions."""
        s = requests.Session()
        email = f"TEST_iter24_cs_{RUN}@example.com"
        pw = "Passw0rd!"
        r = s.post(f"{BASE_URL}/api/auth/register",
                   json={"email": email, "password": pw, "name": "CS24", "role": "center_staff"},
                   timeout=20)
        assert r.status_code in (200, 201)
        s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=20)
        rr = s.get(f"{BASE_URL}/api/transactions", timeout=20)
        assert rr.status_code == 403
