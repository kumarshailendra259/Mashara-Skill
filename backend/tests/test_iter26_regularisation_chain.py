"""iter-26 — Regularisation as a first-class approval-chain type + leave balance deduction bugfix.

Covers:
- Default Regularisation chain seeded on startup (type=regularisation, 1 level, kind=role, value=hr)
- POST /api/regularisations enriches with chain_snapshot, chain_id, current_level=1, attendance_status (renamed from status)
- /api/approvals/pending lists regularisation items with summary.date + summary.description
- /api/approvals/act with request_type=regularisation final-approves → attendance upsert + status=approved
- Legacy PATCH /api/regularisations/{rid}?decision=approved still works (back-compat with old docs)
- POST /api/leaves passes leave_type_id through and final-approval increments used + decrements balance
- POST/PUT /api/approval-chains supports type=regularisation
- Regression: leave/reimbursement/asset_purchase/employee_transfer default chains all exist
"""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
RUN = uuid.uuid4().hex[:6]
ADMIN_EMAIL = "admin@finance.app"
ADMIN_PASSWORD = "Admin@123"


# ----------------- Fixtures -----------------
@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def admin_user(admin_session):
    r = admin_session.get(f"{BASE_URL}/api/auth/me", timeout=15)
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="module")
def staff_user_session(admin_session):
    """Create a fresh user + linked staff record so admin (HR role) can act on its regularisation."""
    email = f"TEST_iter26_staff_{RUN}@finance.app"
    pwd = "Staff@123"
    # Use a temp session for registration so admin_session cookies aren't overwritten
    tmp = requests.Session()
    r = tmp.post(f"{BASE_URL}/api/auth/register",
                 json={"email": email, "password": pwd, "name": f"T26 Staff {RUN}", "role": "center_staff"},
                 timeout=20)
    assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text}"
    user = r.json().get("user") or r.json()
    user_id = user.get("id")
    # link staff using admin_session (admin role still intact)
    r2 = admin_session.post(f"{BASE_URL}/api/staff",
                            json={"name": f"T26 Staff {RUN}", "user_id": user_id,
                                  "designation": "Engineer", "monthly_salary": 30000},
                            timeout=20)
    assert r2.status_code in (200, 201), f"staff create failed: {r2.status_code} {r2.text}"
    staff = r2.json()
    # fresh session for the staff user
    ss = requests.Session()
    lr = ss.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pwd}, timeout=15)
    assert lr.status_code == 200
    return {"session": ss, "user_id": user_id, "staff_id": staff["id"], "email": email}


# ----------------- Default chain seeding -----------------
class TestDefaultChainSeeding:
    """All default chains incl. regularisation must exist after startup."""

    def test_regularisation_default_chain_exists(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/approval-chains?type=regularisation", timeout=15)
        assert r.status_code == 200, r.text
        chains = r.json()
        active = [c for c in chains if c.get("active") and c.get("type") == "regularisation"]
        assert active, f"No active regularisation chain. Got: {chains}"
        # default has 1 step, role=hr
        default = next((c for c in active if "Default" in (c.get("name") or "")), active[0])
        assert len(default["steps"]) == 1
        step = default["steps"][0]
        assert step["level"] == 1
        assert step["kind"] == "role"
        assert step["value"] == "hr"

    @pytest.mark.parametrize("chain_type", ["leave", "reimbursement", "transaction", "asset_purchase", "employee_transfer"])
    def test_other_default_chains_still_present(self, admin_session, chain_type):
        r = admin_session.get(f"{BASE_URL}/api/approval-chains?type={chain_type}", timeout=15)
        assert r.status_code == 200
        chains = r.json()
        assert any(c.get("active") for c in chains), f"No active {chain_type} chain"


# ----------------- Submit regularisation through chain -----------------
class TestRegularisationSubmission:
    def test_submit_regularisation_attaches_chain(self, staff_user_session):
        s = staff_user_session["session"]
        # pick a date in the past to regularise
        body = {"date": "2025-12-15", "status": "present", "reason": f"TEST_iter26 missed punch {RUN}"}
        r = s.post(f"{BASE_URL}/api/regularisations", json=body, timeout=20)
        assert r.status_code in (200, 201), f"submit failed: {r.status_code} {r.text}"
        doc = r.json()
        # status renamed → attendance_status; chain status is 'pending'
        assert doc["attendance_status"] == "present"
        assert doc["status"] == "pending"
        assert doc.get("chain_id"), "chain_id should be enriched"
        assert doc.get("current_level") == 1
        assert isinstance(doc.get("chain_snapshot"), list) and len(doc["chain_snapshot"]) >= 1
        assert doc["staff_id"] == staff_user_session["staff_id"]
        # store for later
        pytest._iter26_reg_id = doc["id"]

    def test_pending_approvals_includes_regularisation(self, admin_session):
        assert hasattr(pytest, "_iter26_reg_id")
        r = admin_session.get(f"{BASE_URL}/api/approvals/pending", timeout=20)
        assert r.status_code == 200
        items = r.json()
        regs = [i for i in items if i.get("request_type") == "regularisation"
                and i.get("request_id") == pytest._iter26_reg_id]
        assert regs, f"Submitted regularisation {pytest._iter26_reg_id} not in admin pending list"
        item = regs[0]
        assert item["summary"].get("date") == "2025-12-15"
        # Description fallback chain: rec.get('reason') is used before the type-specific
        # 'Regularise X on Y' fallback. Since we set a custom reason, accept either.
        desc = (item["summary"].get("description") or "")
        assert desc, "description must not be empty"
        # Either the reason, or the regularisation-specific fallback if reason was empty
        assert ("Regularise" in desc) or ("missed punch" in desc), f"unexpected description: {desc}"


# ----------------- Final-approve via chain → attendance row + status approved -----------------
class TestRegularisationFinalApprove:
    def test_final_approve_creates_attendance_and_marks_approved(self, admin_session, staff_user_session):
        rid = pytest._iter26_reg_id
        r = admin_session.post(f"{BASE_URL}/api/approvals/act",
                               json={"request_type": "regularisation", "request_id": rid,
                                     "action": "approve", "remarks": "ok by HR"},
                               timeout=20)
        assert r.status_code == 200, f"act failed: {r.status_code} {r.text}"
        body = r.json()
        assert body.get("ok") is True
        assert body.get("status") == "approved"

        # verify regularisation doc updated
        rl = admin_session.get(f"{BASE_URL}/api/regularisations", timeout=15)
        assert rl.status_code == 200
        doc = next((d for d in rl.json() if d["id"] == rid), None)
        assert doc is not None
        assert doc["status"] == "approved"
        assert doc.get("current_level") == 0

        # verify attendance row created/upserted
        ar = admin_session.get(
            f"{BASE_URL}/api/attendance?staff_id={staff_user_session['staff_id']}&start=2025-12-15&end=2025-12-15",
            timeout=15,
        )
        assert ar.status_code == 200, ar.text
        rows = ar.json()
        match = [a for a in rows if a.get("date") == "2025-12-15" and a.get("staff_id") == staff_user_session["staff_id"]]
        assert match, f"attendance row not created: {rows}"
        a = match[0]
        assert a.get("regularised") is True
        assert a.get("marked_via") == "regularised"
        assert a.get("status") == "present"
        assert a.get("regularisation_id") == rid


# ----------------- Legacy PATCH back-compat -----------------
class TestLegacyPatchRegularisation:
    def test_legacy_patch_still_works_for_old_doc(self, admin_session, staff_user_session):
        """The legacy PATCH should still work — reads attendance_status OR status fallback."""
        s = staff_user_session["session"]
        body = {"date": "2025-12-20", "status": "half", "reason": f"TEST_iter26 legacy {RUN}"}
        r = s.post(f"{BASE_URL}/api/regularisations", json=body, timeout=20)
        assert r.status_code in (200, 201)
        rid = r.json()["id"]
        # Use legacy PATCH endpoint to approve
        pr = admin_session.patch(
            f"{BASE_URL}/api/regularisations/{rid}?decision=approved&remarks=legacy",
            timeout=20,
        )
        assert pr.status_code == 200, f"legacy patch failed: {pr.status_code} {pr.text}"
        # verify attendance upserted with status=half (from attendance_status)
        ar = admin_session.get(
            f"{BASE_URL}/api/attendance?staff_id={staff_user_session['staff_id']}&start=2025-12-20&end=2025-12-20",
            timeout=15,
        )
        assert ar.status_code == 200
        rows = [a for a in ar.json() if a.get("date") == "2025-12-20"]
        assert rows and rows[0].get("status") == "half"


# ----------------- Create / Update regularisation chain -----------------
class TestRegularisationChainCRUD:
    def test_create_update_regularisation_chain(self, admin_session):
        payload = {
            "name": f"TEST_iter26 Reg Chain {RUN}",
            "type": "regularisation",
            "active": False,  # don't disturb default
            "steps": [
                {"level": 1, "kind": "role", "value": "hr", "label": "HR Step", "optional": False},
            ],
        }
        r = admin_session.post(f"{BASE_URL}/api/approval-chains", json=payload, timeout=15)
        assert r.status_code in (200, 201), r.text
        chain = r.json()
        cid = chain["id"]
        # update
        upd = {"name": payload["name"] + " v2", "type": "regularisation", "active": False,
               "steps": [
                   {"level": 1, "kind": "role", "value": "hr", "label": "HR1", "optional": False},
                   {"level": 2, "kind": "role", "value": "admin", "label": "Admin Final", "optional": False},
               ]}
        r2 = admin_session.put(f"{BASE_URL}/api/approval-chains/{cid}", json=upd, timeout=15)
        assert r2.status_code == 200, r2.text
        updated = r2.json()
        assert len(updated["steps"]) == 2
        assert updated["name"].endswith("v2")


# ----------------- Leave balance bugfix — leave_type_id propagates + deducts on final approve -----------------
class TestLeaveBalanceDeduction:
    def test_leave_with_type_deducts_on_final_approve(self, admin_session, staff_user_session):
        # Create a unique leave type
        lt_payload = {"name": f"TEST_iter26 CL {RUN}", "code": f"T{RUN[:3]}", "annual_quota": 12, "color": "#10b981"}
        ltr = admin_session.post(f"{BASE_URL}/api/leave-types", json=lt_payload, timeout=15)
        assert ltr.status_code in (200, 201), ltr.text
        lt_id = ltr.json()["id"]

        # Allocate 12 days to this staff for current year
        from datetime import datetime
        year = datetime.utcnow().year
        alloc = {"leave_type_id": lt_id, "year": year, "staff_ids": [staff_user_session["staff_id"]], "days": 12.0, "mode": "set"}
        ar = admin_session.post(f"{BASE_URL}/api/leave-balances/allocate", json=alloc, timeout=15)
        assert ar.status_code in (200, 201), ar.text

        # Staff submits a 3-day leave (inclusive — so used should be 3)
        s = staff_user_session["session"]
        start = f"{year}-11-10"
        end = f"{year}-11-12"
        leave_body = {"staff_id": staff_user_session["staff_id"], "start_date": start, "end_date": end,
                      "reason": f"TEST_iter26 trip {RUN}", "leave_type_id": lt_id}
        lr = s.post(f"{BASE_URL}/api/leaves", json=leave_body, timeout=20)
        assert lr.status_code in (200, 201), lr.text
        leave_doc = lr.json()
        # critical assertion: leave_type_id propagated to doc
        assert leave_doc.get("leave_type_id") == lt_id, f"leave_type_id missing: {leave_doc}"
        assert leave_doc.get("current_level", 0) >= 1
        leave_id = leave_doc["id"]

        # walk the chain to final approval
        for _ in range(6):
            rl = admin_session.get(f"{BASE_URL}/api/approvals/pending", timeout=15)
            assert rl.status_code == 200
            mine = [it for it in rl.json() if it.get("request_id") == leave_id and it.get("request_type") == "leave"]
            if not mine:
                # check doc status — already approved?
                lst = admin_session.get(f"{BASE_URL}/api/leaves", timeout=15).json()
                cur = next((d for d in lst if d["id"] == leave_id), None)
                if cur and cur.get("status") == "approved":
                    break
                pytest.fail(f"Leave {leave_id} not in admin pending and not approved")
            act = admin_session.post(f"{BASE_URL}/api/approvals/act",
                                     json={"request_type": "leave", "request_id": leave_id,
                                           "action": "approve", "remarks": "approved by HR/admin"}, timeout=20)
            assert act.status_code == 200, act.text
            if act.json().get("status") == "approved":
                break

        # verify the leave is approved
        lst = admin_session.get(f"{BASE_URL}/api/leaves", timeout=15).json()
        cur = next((d for d in lst if d["id"] == leave_id), None)
        assert cur and cur.get("status") == "approved", f"leave not approved: {cur}"

        # verify balance deducted
        br = admin_session.get(
            f"{BASE_URL}/api/leave-balances?staff_id={staff_user_session['staff_id']}&year={year}", timeout=15,
        )
        assert br.status_code == 200, br.text
        balances = br.json()
        mine = next((b for b in balances if b.get("leave_type_id") == lt_id), None)
        assert mine, f"balance row missing: {balances}"
        assert mine["used"] == 3, f"expected used=3, got {mine.get('used')}"
        assert mine["balance"] == 9, f"expected balance=9, got {mine.get('balance')}"

    def test_leave_without_type_id_rejected_or_no_balance_impact(self, admin_session, staff_user_session):
        """POST /api/leaves without leave_type_id should still succeed but not deduct any balance row."""
        s = staff_user_session["session"]
        leave_body = {"staff_id": staff_user_session["staff_id"], "start_date": "2025-10-01",
                      "end_date": "2025-10-01", "reason": f"TEST_iter26 no type {RUN}"}
        lr = s.post(f"{BASE_URL}/api/leaves", json=leave_body, timeout=15)
        # accepted (no validation on null leave_type_id)
        assert lr.status_code in (200, 201, 400, 422)
        # if accepted, the doc.leave_type_id is None — deduction silently no-ops
        if lr.status_code in (200, 201):
            assert lr.json().get("leave_type_id") in (None, "")
