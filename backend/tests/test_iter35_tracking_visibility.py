"""iter-35: Requester-side tracking visibility for Leave / Reimbursement / Regularisation.

Verifies:
  * GET /api/leaves/my           → returns chain_snapshot, chain_history, pending_with,
                                    current_step_label, total_steps for pending items
                                    (lazy chain-attach migration for legacy rows).
  * GET /api/reimbursements/my   → same shape.
  * GET /api/regularisations/my  → same shape (already worked before iter-35 but
                                    verified for regression).
  * GET /api/approvals/<type>/<id>/timeline → returns rich timeline for each type.
  * Regression: manager still receives their pending inbox (Pending Approvals).
"""
import os
import uuid
import datetime as dt
import requests
import pytest
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

MGR_EMAIL = "test_mgr2_e0e668@x.com"
MGR_PW = "Mgr@12345"
ADMIN_EMAIL = "admin@finance.app"
ADMIN_PW = "Admin@123"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def mgr_session() -> requests.Session:
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"email": MGR_EMAIL, "password": MGR_PW})
    assert r.status_code == 200, f"manager login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def admin_session() -> requests.Session:
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def mgr_staff(mgr_session) -> dict:
    """The staff record for the manager user (needed for staff_id in Leave/Reimb payloads)."""
    r = mgr_session.get(f"{BASE}/api/auth/me")
    assert r.status_code == 200
    me = r.json()
    # Find staff linked to this user
    rs = mgr_session.get(f"{BASE}/api/staff")
    assert rs.status_code == 200, rs.text
    staff_list = rs.json()
    mine = next((s for s in staff_list if s.get("user_id") == me["id"]), None)
    if not mine:
        pytest.skip("Manager has no linked staff record — cannot submit leave/reimb")
    return mine


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------
_REQUIRED_TRACKING_FIELDS = ["chain_snapshot", "chain_history", "pending_with",
                             "current_step_label", "total_steps"]


def _assert_tracking_fields(doc: dict, kind: str) -> None:
    """Every field must be *present* (not undefined). chain_snapshot/history/pending_with
    must be lists. total_steps must be int. current_step_label may be None."""
    for f in _REQUIRED_TRACKING_FIELDS:
        assert f in doc, f"[{kind}] missing field '{f}' in doc keys={list(doc.keys())}"
    assert isinstance(doc["chain_snapshot"], list), f"[{kind}] chain_snapshot not a list"
    assert isinstance(doc["chain_history"], list), f"[{kind}] chain_history not a list"
    assert isinstance(doc["pending_with"], list), f"[{kind}] pending_with not a list"
    assert isinstance(doc["total_steps"], int), f"[{kind}] total_steps not int"


# ---------------------------------------------------------------------------
# 1. /leaves/my — new leave submitted → tracking fields visible
# ---------------------------------------------------------------------------
class TestLeaveTracking:
    def test_login(self, mgr_session):
        r = mgr_session.get(f"{BASE}/api/auth/me")
        assert r.status_code == 200
        assert r.json()["email"] == MGR_EMAIL

    def test_submit_leave_and_track(self, mgr_session, mgr_staff):
        payload = {
            "staff_id": mgr_staff["id"],
            "start_date": "2026-08-01",
            "end_date": "2026-08-01",
            "reason": f"TEST_iter35 tracking {uuid.uuid4().hex[:6]}",
        }
        r = mgr_session.post(f"{BASE}/api/leaves", json=payload)
        assert r.status_code == 200, f"POST /leaves failed: {r.status_code} {r.text}"
        created = r.json()
        assert created["status"] == "pending"
        lid = created["id"]

        # Now GET /leaves/my — new item must show tracking fields
        r = mgr_session.get(f"{BASE}/api/leaves/my")
        assert r.status_code == 200, r.text
        docs = r.json()
        assert isinstance(docs, list) and len(docs) > 0
        mine = next((d for d in docs if d["id"] == lid), None)
        assert mine is not None, "Submitted leave not returned by /leaves/my"
        _assert_tracking_fields(mine, "leave")

        # If a chain is configured, total_steps must match snapshot length
        if mine["chain_snapshot"]:
            assert mine["total_steps"] == len(mine["chain_snapshot"])
            # current_step_label may still be None if chain step didn't set a label
            # (kind='user' steps often omit label) — that's OK, field just needs to exist.

    def test_timeline_endpoint_for_leave(self, mgr_session):
        r = mgr_session.get(f"{BASE}/api/leaves/my")
        assert r.status_code == 200
        docs = r.json()
        pending = [d for d in docs if d.get("status") == "pending"]
        if not pending:
            pytest.skip("No pending leave to test timeline against")
        target = pending[0]
        rt = mgr_session.get(f"{BASE}/api/approvals/leave/{target['id']}/timeline")
        assert rt.status_code == 200, rt.text
        tl = rt.json()
        assert "timeline" in tl
        assert isinstance(tl["timeline"], list)
        assert "current_level" in tl
        assert "total_levels" in tl


# ---------------------------------------------------------------------------
# 2. /reimbursements/my — new claim submitted → tracking fields visible
# ---------------------------------------------------------------------------
class TestReimbursementTracking:
    def test_submit_claim_and_track(self, mgr_session, mgr_staff):
        payload = {
            "staff_id": mgr_staff["id"],
            "amount": 500,
            "date": dt.date.today().isoformat(),
            "category": "Travel",
            "description": f"TEST_iter35 approval tracking {uuid.uuid4().hex[:6]}",
        }
        r = mgr_session.post(f"{BASE}/api/reimbursements", json=payload)
        assert r.status_code == 200, f"POST /reimbursements failed: {r.status_code} {r.text}"
        created = r.json()
        rid = created["id"]

        r = mgr_session.get(f"{BASE}/api/reimbursements/my")
        assert r.status_code == 200, r.text
        docs = r.json()
        assert isinstance(docs, list) and len(docs) > 0
        mine = next((d for d in docs if d["id"] == rid), None)
        assert mine is not None, "Submitted claim not returned by /reimbursements/my"
        _assert_tracking_fields(mine, "reimbursement")

    def test_timeline_endpoint_for_reimbursement(self, mgr_session):
        r = mgr_session.get(f"{BASE}/api/reimbursements/my")
        assert r.status_code == 200
        docs = r.json()
        active = [d for d in docs if d.get("status") in ("pending", "submitted", "in_progress")]
        if not active:
            pytest.skip("No active reimbursement to test timeline against")
        target = active[0]
        rt = mgr_session.get(f"{BASE}/api/approvals/reimbursement/{target['id']}/timeline")
        assert rt.status_code == 200, rt.text
        tl = rt.json()
        assert "timeline" in tl and isinstance(tl["timeline"], list)


# ---------------------------------------------------------------------------
# 3. /regularisations/my — new regularisation → tracking fields visible
# ---------------------------------------------------------------------------
class TestRegularisationTracking:
    def test_submit_regularisation_and_track(self, mgr_session, mgr_staff):
        payload = {
            "date": "2026-07-01",
            "status": "present",
            "reason": f"TEST_iter35 Forgot to punch {uuid.uuid4().hex[:6]}",
        }
        r = mgr_session.post(f"{BASE}/api/regularisations", json=payload)
        assert r.status_code == 200, f"POST /regularisations failed: {r.status_code} {r.text}"
        created = r.json()
        rgid = created["id"]

        r = mgr_session.get(f"{BASE}/api/regularisations/my")
        assert r.status_code == 200, r.text
        docs = r.json()
        assert isinstance(docs, list) and len(docs) > 0
        mine = next((d for d in docs if d["id"] == rgid), None)
        assert mine is not None, "Submitted regularisation not returned by /regularisations/my"
        _assert_tracking_fields(mine, "regularisation")

    def test_timeline_endpoint_for_regularisation(self, mgr_session):
        r = mgr_session.get(f"{BASE}/api/regularisations/my")
        assert r.status_code == 200
        docs = r.json()
        pending = [d for d in docs if d.get("status") == "pending"]
        if not pending:
            pytest.skip("No pending regularisation to test timeline against")
        target = pending[0]
        rt = mgr_session.get(f"{BASE}/api/approvals/regularisation/{target['id']}/timeline")
        assert rt.status_code == 200, rt.text
        tl = rt.json()
        assert "timeline" in tl and isinstance(tl["timeline"], list)


# ---------------------------------------------------------------------------
# 4. Regression: Pending Approvals inbox still works for the manager approver
# ---------------------------------------------------------------------------
class TestPendingApprovalsRegression:
    def test_pending_approvals_inbox(self, mgr_session):
        r = mgr_session.get(f"{BASE}/api/approvals/pending")
        assert r.status_code == 200, f"/approvals/pending failed: {r.status_code} {r.text}"
        data = r.json()
        # Expected to be a list of pending items
        assert isinstance(data, list)
        # No assertion on count (0 is OK if this manager isn't an approver on anything now)
        # But if items exist, each should have request_type + request_id + a resolvable label
        for item in data[:5]:
            assert "request_type" in item or "type" in item, f"item missing type: {item}"
