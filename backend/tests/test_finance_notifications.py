"""Iteration-9 tests: Bulk-approve transactions + Notifications + Reimbursement attachments."""
import os
import io
import uuid
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
ADMIN_EMAIL = os.environ.get("FINANCE_TEST_ADMIN_EMAIL", "admin@finance.app")
ADMIN_PASSWORD = os.environ.get("FINANCE_TEST_ADMIN_PASSWORD", "Admin@123")
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


def _register_or_login(email, password, name, role="viewer"):
    s = _s()
    r = s.post(f"{BASE_URL}/api/auth/register",
               json={"email": email, "password": password, "name": name, "role": role})
    if r.status_code == 400:
        return _login(email, password)
    assert r.status_code == 200, r.text
    return s


# ----------------------- Fixtures -----------------------
@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def manager_user(admin):
    """A 'manager' user — required to create pending txns (admin auto-approves)."""
    email = f"TEST_mgr2_{TAG}@x.com"
    pw = "Pass@1234"
    s = _register_or_login(email, pw, f"TEST_mgr2_{TAG}")
    me = s.get(f"{BASE_URL}/api/auth/me").json()
    # promote to manager so txn create works and is not auto-approved
    r = admin.patch(f"{BASE_URL}/api/auth/users/{me['id']}", json={"role": "manager"})
    assert r.status_code == 200, r.text
    # re-login to refresh cookie context (cookie role is per-request anyway)
    s2 = _login(email, pw)
    me2 = s2.get(f"{BASE_URL}/api/auth/me").json()
    return {"session": s2, "id": me2["id"], "email": email, "pw": pw}


# ----------------------- Bulk Approve -----------------------
class TestBulkApprove:
    def test_bulk_approve_basic(self, admin, manager_user):
        ids = []
        for i in range(3):
            r = manager_user["session"].post(f"{BASE_URL}/api/transactions", json={
                "type": "expense", "amount": 100 + i, "category": "TEST_bulk",
                "description": f"TEST_bulk_{TAG}_{i}", "date": "2025-06-15"
            })
            assert r.status_code == 200, r.text
            assert r.json()["status"] == "pending"
            ids.append(r.json()["id"])
        r = admin.post(f"{BASE_URL}/api/transactions/bulk-approve", json={"ids": ids})
        assert r.status_code == 200, r.text
        assert r.json()["approved"] == 3
        # Verify status persisted (no GET by id, so list and filter)
        rows = admin.get(f"{BASE_URL}/api/transactions").json()
        idset = set(ids)
        approved = [t for t in rows if t["id"] in idset and t["status"] == "approved"]
        assert len(approved) == 3

    def test_bulk_approve_skips_already_approved(self, admin, manager_user):
        # admin creates -> auto-approved
        r1 = admin.post(f"{BASE_URL}/api/transactions", json={
            "type": "expense", "amount": 10, "description": f"TEST_bulkA_{TAG}",
            "date": "2025-06-15"
        })
        # manager creates -> pending
        r2 = manager_user["session"].post(f"{BASE_URL}/api/transactions", json={
            "type": "expense", "amount": 20, "description": f"TEST_bulkP_{TAG}",
            "date": "2025-06-15"
        })
        assert r1.json()["status"] == "approved"
        assert r2.json()["status"] == "pending"
        ids = [r1.json()["id"], r2.json()["id"]]
        r = admin.post(f"{BASE_URL}/api/transactions/bulk-approve", json={"ids": ids})
        assert r.status_code == 200
        assert r.json()["approved"] == 1

    def test_bulk_approve_empty(self, admin):
        r = admin.post(f"{BASE_URL}/api/transactions/bulk-approve", json={"ids": []})
        assert r.status_code == 200
        assert r.json()["approved"] == 0

    def test_bulk_approve_requires_admin(self, manager_user):
        r = manager_user["session"].post(f"{BASE_URL}/api/transactions/bulk-approve",
                                          json={"ids": ["nonexistent"]})
        assert r.status_code == 403


# ----------------------- Notifications -----------------------
class TestNotifications:
    def test_endpoints_exist(self, admin):
        r = admin.get(f"{BASE_URL}/api/notifications")
        assert r.status_code == 200
        body = r.json()
        assert "items" in body and "unread" in body
        assert isinstance(body["items"], list)
        assert isinstance(body["unread"], int)

    def test_txn_approve_notifies_creator(self, admin, manager_user):
        r = manager_user["session"].post(f"{BASE_URL}/api/transactions", json={
            "type": "expense", "amount": 222, "description": f"TEST_notif_{TAG}_a",
            "date": "2025-06-15"
        })
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        r = admin.post(f"{BASE_URL}/api/transactions/{tid}/approve")
        assert r.status_code == 200
        items = manager_user["session"].get(f"{BASE_URL}/api/notifications").json()["items"]
        msgs = [n for n in items if n.get("ref_id") == tid]
        assert len(msgs) >= 1
        assert msgs[0]["type"] == "txn_approved"
        assert msgs[0]["read"] is False

    def test_txn_reject_notifies_creator(self, admin, manager_user):
        r = manager_user["session"].post(f"{BASE_URL}/api/transactions", json={
            "type": "expense", "amount": 50, "description": f"TEST_notif_{TAG}_r",
            "date": "2025-06-15"
        })
        tid = r.json()["id"]
        r = admin.post(f"{BASE_URL}/api/transactions/{tid}/reject",
                       json={"reason": "out of policy"})
        assert r.status_code == 200
        items = manager_user["session"].get(f"{BASE_URL}/api/notifications").json()["items"]
        msgs = [n for n in items if n.get("ref_id") == tid]
        assert len(msgs) >= 1
        assert msgs[0]["type"] == "txn_rejected"
        assert "out of policy" in msgs[0]["message"]

    def test_bulk_approve_emits_notifications(self, admin, manager_user):
        ids = []
        for i in range(2):
            r = manager_user["session"].post(f"{BASE_URL}/api/transactions", json={
                "type": "expense", "amount": 11 + i,
                "description": f"TEST_notif_bulk_{TAG}_{i}", "date": "2025-06-15"
            })
            assert r.status_code == 200, r.text
            ids.append(r.json()["id"])
        r = admin.post(f"{BASE_URL}/api/transactions/bulk-approve", json={"ids": ids})
        assert r.status_code == 200
        items = manager_user["session"].get(f"{BASE_URL}/api/notifications").json()["items"]
        ref_ids = {n.get("ref_id") for n in items if n.get("type") == "txn_approved"}
        for tid in ids:
            assert tid in ref_ids

    def test_mark_one_read(self, admin, manager_user):
        r = manager_user["session"].post(f"{BASE_URL}/api/transactions", json={
            "type": "expense", "amount": 7,
            "description": f"TEST_notif_read_{TAG}", "date": "2025-06-15"
        })
        tid = r.json()["id"]
        admin.post(f"{BASE_URL}/api/transactions/{tid}/approve")
        items = manager_user["session"].get(f"{BASE_URL}/api/notifications").json()["items"]
        nid = next(n["id"] for n in items if n.get("ref_id") == tid)
        r = manager_user["session"].patch(f"{BASE_URL}/api/notifications/{nid}/read")
        assert r.status_code == 200
        items = manager_user["session"].get(f"{BASE_URL}/api/notifications").json()["items"]
        rec = next(n for n in items if n["id"] == nid)
        assert rec["read"] is True

    def test_mark_one_read_404(self, admin):
        r = admin.patch(f"{BASE_URL}/api/notifications/nonexistent-id/read")
        assert r.status_code == 404

    def test_mark_all_read(self, manager_user):
        # Ensure at least one unread, then mark-all
        resp = manager_user["session"].patch(f"{BASE_URL}/api/notifications/mark-all-read")
        assert resp.status_code == 200
        body = manager_user["session"].get(f"{BASE_URL}/api/notifications").json()
        assert body["unread"] == 0

    def test_notifications_user_scoped(self, admin, manager_user):
        admin_items = admin.get(f"{BASE_URL}/api/notifications").json()["items"]
        mgr_items = manager_user["session"].get(f"{BASE_URL}/api/notifications").json()["items"]
        admin_ids = {n["id"] for n in admin_items}
        mgr_ids = {n["id"] for n in mgr_items}
        assert admin_ids.isdisjoint(mgr_ids)


# ----------------------- Reimbursement Attachments -----------------------
class TestReimbursementAttachments:
    def test_upload_then_submit_with_attachment(self, admin):
        me = admin.get(f"{BASE_URL}/api/auth/me").json()
        r = admin.post(f"{BASE_URL}/api/staff", json={
            "name": f"TEST_AttachStaff_{TAG}",
            "designation": "Tester",
            "user_id": me["id"],
        })
        assert r.status_code == 200, r.text
        sid = r.json()["id"]
        # Upload a small file via a fresh session (avoid session's Content-Type=application/json)
        upload_s = requests.Session()
        # Carry cookies from admin session
        upload_s.cookies.update(admin.cookies)
        files = {"file": ("receipt.txt", io.BytesIO(b"hello-receipt"), "text/plain")}
        r = upload_s.post(f"{BASE_URL}/api/files/upload", files=files)
        assert r.status_code == 200, r.text
        att = r.json()
        assert att.get("id") and att.get("filename") == "receipt.txt"
        assert att.get("size", 0) > 0
        # Submit reimbursement with attachment
        payload = {
            "staff_id": sid, "amount": 99, "date": "2025-06-15",
            "description": f"TEST_reimb_att_{TAG}", "category": "Food",
            "attachments": [{
                "id": att["id"], "path": att["path"], "filename": att["filename"],
                "content_type": att.get("content_type", "text/plain"),
                "size": att.get("size", 0),
            }],
        }
        r = admin.post(f"{BASE_URL}/api/reimbursements", json=payload)
        assert r.status_code == 200, r.text
        rid = r.json()["id"]
        # Persistence check via list
        rows = admin.get(f"{BASE_URL}/api/reimbursements").json()
        row = next(x for x in rows if x["id"] == rid)
        assert isinstance(row.get("attachments"), list)
        assert len(row["attachments"]) == 1
        assert row["attachments"][0]["filename"] == "receipt.txt"

    def test_submit_without_attachments_default_empty(self, admin):
        me = admin.get(f"{BASE_URL}/api/auth/me").json()
        rows = admin.get(f"{BASE_URL}/api/staff").json()
        sid = next((s["id"] for s in rows if s.get("user_id") == me["id"]),
                   rows[0]["id"] if rows else None)
        assert sid
        r = admin.post(f"{BASE_URL}/api/reimbursements", json={
            "staff_id": sid, "amount": 5, "date": "2025-06-15",
            "description": f"TEST_noatt_{TAG}", "category": "Misc",
        })
        assert r.status_code == 200, r.text
        assert r.json().get("attachments", []) == []


# ----------------------- Reimbursement L1 + Accountant Notifications -----------------------
class TestReimbursementNotifications:
    def test_submit_notifies_l1_approver(self, admin, manager_user):
        # Manager is the L1 (reports_to). Create employee staff that reports to manager-staff
        # Step 1: create manager-staff linked to manager_user
        mgr_id = manager_user["id"]
        rmgr = admin.post(f"{BASE_URL}/api/staff", json={
            "name": f"TEST_L1Mgr_{TAG}", "designation": "Manager", "user_id": mgr_id,
        })
        assert rmgr.status_code == 200, rmgr.text
        mgr_staff_id = rmgr.json()["id"]
        # Step 2: create employee staff that reports_to mgr_staff_id
        # Need an emp user
        emp_email = f"TEST_emp2_{TAG}@x.com"
        emp_s = _register_or_login(emp_email, "Pass@1234", f"TEST_emp2_{TAG}")
        emp_uid = emp_s.get(f"{BASE_URL}/api/auth/me").json()["id"]
        remp = admin.post(f"{BASE_URL}/api/staff", json={
            "name": f"TEST_L1Emp_{TAG}", "designation": "Eng",
            "reports_to_id": mgr_staff_id, "user_id": emp_uid,
        })
        assert remp.status_code == 200, remp.text
        emp_sid = remp.json()["id"]
        # Step 3: employee submits a reimbursement
        r = emp_s.post(f"{BASE_URL}/api/reimbursements", json={
            "staff_id": emp_sid, "amount": 120, "date": "2025-06-15",
            "description": f"TEST_L1notif_{TAG}", "category": "Travel",
        })
        assert r.status_code == 200, r.text
        rid = r.json()["id"]
        # Manager should now have a notif
        items = manager_user["session"].get(f"{BASE_URL}/api/notifications").json()["items"]
        msgs = [n for n in items if n.get("ref_id") == rid]
        assert len(msgs) >= 1
        assert msgs[0]["type"] == "reimb_l1_pending"

        # Step 4: Manager L1-approves -> all admins+accountants get notif
        r = manager_user["session"].patch(f"{BASE_URL}/api/reimbursements/{rid}/l1-approve")
        assert r.status_code == 200, r.text
        admin_items = admin.get(f"{BASE_URL}/api/notifications").json()["items"]
        msgs = [n for n in admin_items if n.get("ref_id") == rid
                and n.get("type") == "reimb_acct_pending"]
        assert len(msgs) >= 1

        # Step 5: accountant_approve -> admins+accountants notif
        r = admin.patch(f"{BASE_URL}/api/reimbursements/{rid}/accountant-approve")
        assert r.status_code == 200, r.text
        admin_items = admin.get(f"{BASE_URL}/api/notifications").json()["items"]
        msgs = [n for n in admin_items if n.get("ref_id") == rid
                and n.get("type") == "reimb_pay_pending"]
        assert len(msgs) >= 1
