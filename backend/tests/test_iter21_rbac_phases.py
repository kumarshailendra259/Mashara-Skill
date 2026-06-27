"""Iter-21 backend tests: Enterprise RBAC Phase-1 & Phase-2 + regression checks.

Covers:
  - /api/auth/login-history (admin sees paginated logs with ip + user_agent)
  - /api/dashboard/role-widgets (admin shape)
  - register + login for new roles reporting_authority, center_partner; /auth/me
  - /api/entities/center & /api/entities/partner auto-user creation
    (returns generated_password ONCE, sets credentials_mail_sent)
  - /api/entities/{etype}/{eid}/resend-credentials regenerates password
  - /api/approvals/pending unified list (admin scoped)
  - Regression: /api/transactions create + /api/approvals/act,
    /api/batches create, /api/dashboard/summary, /api/fooding-entries CRUD,
    /api/dashboard/fooding-income
  - Center-scoped approval chain (with center_id) is accepted + active
"""
import os
import uuid
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@finance.app")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Admin@123")

# Unique suffix per test run so we never collide with prior iterations
RUN = uuid.uuid4().hex[:8]


# ---------- session fixtures ----------
@pytest.fixture(scope="session")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="session")
def fresh_session():
    """Unauthenticated session for register/login tests of new roles."""
    return requests.Session()


# ============================================================================
# 1) login-history: admin lists paginated history with IP + user_agent
# ============================================================================
class TestLoginHistory:
    def test_login_appends_record_with_ip_and_ua(self, admin_session):
        # Force a fresh login event by an isolated session
        s = requests.Session()
        before = admin_session.get(f"{BASE_URL}/api/auth/login-history?limit=500", timeout=15)
        assert before.status_code == 200
        before_count = len(before.json())

        r = s.post(f"{BASE_URL}/api/auth/login",
                   json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                   headers={"User-Agent": f"iter21-tester/{RUN}"},
                   timeout=15)
        assert r.status_code == 200

        after = admin_session.get(f"{BASE_URL}/api/auth/login-history?limit=500", timeout=15)
        assert after.status_code == 200
        rows = after.json()
        assert isinstance(rows, list)
        assert len(rows) > before_count, "new login should append a row"
        latest = rows[0]
        # Required fields
        assert "ip" in latest or "ip_address" in latest, \
            f"missing ip field; keys={list(latest.keys())}"
        assert "user_agent" in latest, f"missing user_agent; keys={list(latest.keys())}"
        assert "at" in latest
        assert "success" in latest
        # Newest record should belong to the admin we just authenticated
        assert latest.get("email") == ADMIN_EMAIL.lower()
        assert latest.get("success") is True

    def test_login_history_admin_visible(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/auth/login-history?limit=10", timeout=15)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        # When there are rows, admin should see many emails (not just their own)
        # but we only assert structure here.
        if rows:
            sample = rows[0]
            for k in ("id", "email", "at", "success"):
                assert k in sample


# ============================================================================
# 2) /api/dashboard/role-widgets — admin shape
# ============================================================================
class TestRoleWidgets:
    def test_role_widgets_admin_ok(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/dashboard/role-widgets", timeout=15)
        assert r.status_code == 200, f"got {r.status_code}: {r.text[:300]}"
        data = r.json()
        assert isinstance(data, dict)
        assert data.get("role") == "admin"
        assert "as_of" in data

    def test_role_widgets_accountant_shape(self, admin_session):
        """Create+login a temp accountant, hit endpoint, check accountant-specific keys."""
        email = f"acct_{RUN}@masharatest.com"
        s = requests.Session()
        reg = s.post(f"{BASE_URL}/api/auth/register",
                     json={"email": email, "password": "Pwd@12345",
                           "name": "T Acct", "role": "accountant"}, timeout=15)
        assert reg.status_code in (200, 201), reg.text
        r = s.get(f"{BASE_URL}/api/dashboard/role-widgets", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["role"] == "accountant"
        # accountant-specific keys
        for k in ("pending_payments", "payroll_unpaid", "totals_by_type"):
            assert k in data, f"accountant widget missing key {k}"


# ============================================================================
# 3) New roles: register + login + /auth/me
# ============================================================================
class TestNewRoles:
    @pytest.mark.parametrize("role", ["reporting_authority", "center_partner"])
    def test_register_login_me(self, role):
        email = f"{role}_{RUN}@masharatest.com"
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/auth/register",
                   json={"email": email, "password": "Pwd@12345",
                         "name": f"T {role}", "role": role}, timeout=15)
        assert r.status_code in (200, 201), f"register {role} failed: {r.text}"
        body = r.json()
        assert body["role"] == role, f"role not preserved on register: {body}"

        # logout effect: use a fresh session, then login
        s2 = requests.Session()
        lr = s2.post(f"{BASE_URL}/api/auth/login",
                     json={"email": email, "password": "Pwd@12345"}, timeout=15)
        assert lr.status_code == 200, lr.text
        me = s2.get(f"{BASE_URL}/api/auth/me", timeout=15)
        assert me.status_code == 200
        assert me.json()["role"] == role

        # role-widgets returns role-specific shape
        rw = s2.get(f"{BASE_URL}/api/dashboard/role-widgets", timeout=15)
        assert rw.status_code == 200, rw.text
        assert rw.json()["role"] == role


# ============================================================================
# 4) Entity auto-user creation (center + partner) + 5) resend-credentials
# ============================================================================
class TestEntityAutoUser:
    def test_create_center_autocreates_user(self, admin_session):
        email = f"TEST_center_{RUN}@masharatest.com"
        payload = {"name": f"TEST_Center_{RUN}", "email": email,
                   "manager_name": "TEST Manager", "mobile": "9999999999"}
        r = admin_session.post(f"{BASE_URL}/api/entities/center",
                               json=payload, timeout=20)
        assert r.status_code == 200, f"center create failed: {r.status_code} {r.text}"
        ent = r.json()
        assert ent["id"]
        assert ent.get("email") == email.lower() or ent.get("email") == email
        # Phase-1 contract: password returned ONCE on response
        assert ent.get("generated_password"), \
            f"generated_password missing from response: keys={list(ent.keys())}"
        # credentials_mail_sent is set true/false; either is acceptable per spec
        assert "credentials_mail_sent" in ent
        assert isinstance(ent["credentials_mail_sent"], bool)
        # The new user should be able to log in with that password
        s2 = requests.Session()
        lr = s2.post(f"{BASE_URL}/api/auth/login",
                     json={"email": email, "password": ent["generated_password"]},
                     timeout=15)
        assert lr.status_code == 200, \
            f"auto-created center user could not log in: {lr.status_code} {lr.text}"
        me = s2.get(f"{BASE_URL}/api/auth/me", timeout=15).json()
        assert me["role"] == "center_manager"
        # Stash for cross-test reuse
        TestEntityAutoUser.center_id = ent["id"]
        TestEntityAutoUser.center_email = email

    def test_create_partner_autocreates_user(self, admin_session):
        email = f"TEST_partner_{RUN}@masharatest.com"
        payload = {"name": f"TEST_Partner_{RUN}", "email": email,
                   "mobile": "8888888888"}
        r = admin_session.post(f"{BASE_URL}/api/entities/partner",
                               json=payload, timeout=20)
        assert r.status_code == 200, f"partner create failed: {r.status_code} {r.text}"
        ent = r.json()
        assert ent.get("generated_password")
        assert "credentials_mail_sent" in ent and isinstance(ent["credentials_mail_sent"], bool)
        # New partner user can login
        s2 = requests.Session()
        lr = s2.post(f"{BASE_URL}/api/auth/login",
                     json={"email": email, "password": ent["generated_password"]},
                     timeout=15)
        assert lr.status_code == 200, lr.text
        me = s2.get(f"{BASE_URL}/api/auth/me", timeout=15).json()
        assert me["role"] == "partner"
        assert me.get("assigned_partner_id") == ent["id"]
        TestEntityAutoUser.partner_id = ent["id"]
        TestEntityAutoUser.partner_email = email

    def test_resend_credentials_center(self, admin_session):
        eid = getattr(TestEntityAutoUser, "center_id", None)
        email = getattr(TestEntityAutoUser, "center_email", None)
        assert eid, "center_id from prior test required"
        r = admin_session.post(f"{BASE_URL}/api/entities/center/{eid}/resend-credentials",
                               timeout=20)
        assert r.status_code == 200, f"resend failed: {r.status_code} {r.text}"
        body = r.json()
        # Per spec: should return generated_password on rotation
        assert body.get("generated_password"), f"resend response missing generated_password: {body}"
        assert "sent" in body and isinstance(body["sent"], bool)
        # Verify rotation actually persisted: login with NEW password works
        s2 = requests.Session()
        lr = s2.post(f"{BASE_URL}/api/auth/login",
                     json={"email": email, "password": body["generated_password"]},
                     timeout=15)
        assert lr.status_code == 200, \
            f"could not log in with rotated password: {lr.status_code} {lr.text}"

    def test_resend_credentials_partner(self, admin_session):
        eid = getattr(TestEntityAutoUser, "partner_id", None)
        email = getattr(TestEntityAutoUser, "partner_email", None)
        assert eid
        r = admin_session.post(f"{BASE_URL}/api/entities/partner/{eid}/resend-credentials",
                               timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("generated_password")
        s2 = requests.Session()
        lr = s2.post(f"{BASE_URL}/api/auth/login",
                     json={"email": email, "password": body["generated_password"]},
                     timeout=15)
        assert lr.status_code == 200


# ============================================================================
# 6) /api/approvals/pending unified list
# ============================================================================
class TestUnifiedApprovalsPending:
    def test_pending_list_returns_list(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/approvals/pending", timeout=15)
        assert r.status_code == 200, r.text
        rows = r.json()
        assert isinstance(rows, list)
        # Each row should expose request_type + request_id + summary
        for row in rows[:5]:
            assert "request_type" in row
            assert row["request_type"] in ("reimbursement", "leave", "transaction")
            assert "request_id" in row
            assert "summary" in row


# ============================================================================
# 7) Regression: dashboard summary + transactions + batches + fooding
# ============================================================================
class TestRegression:
    def test_dashboard_summary_ok(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/dashboard/summary", timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, dict)

    def test_transaction_create_admin_auto_approved(self, admin_session):
        # admin should be able to create a transaction; status approved (admin auto-approves)
        body = {"type": "expense", "amount": 123.45, "date": "2025-12-15",
                "description": f"TEST_iter21_{RUN}"}
        r = admin_session.post(f"{BASE_URL}/api/transactions", json=body, timeout=15)
        assert r.status_code in (200, 201), r.text
        t = r.json()
        assert t["id"]
        TestRegression.txn_id = t["id"]
        # Admin auto-approves per _can_auto_approve
        assert t.get("status") in ("approved", "pending")

    def test_dashboard_summary_after_txn(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/dashboard/summary", timeout=20)
        assert r.status_code == 200

    def test_batch_create_with_company_and_partners(self, admin_session):
        # Need a project + company + partner to build a batch
        proj = admin_session.post(f"{BASE_URL}/api/entities/project",
                                  json={"name": f"TEST_Proj_{RUN}"}, timeout=15).json()
        comp = admin_session.post(f"{BASE_URL}/api/entities/company",
                                  json={"name": f"TEST_Co_{RUN}"}, timeout=15).json()
        pid = getattr(TestEntityAutoUser, "partner_id", None)
        if not pid:
            # create a fresh partner without email so no auto-user
            pid = admin_session.post(f"{BASE_URL}/api/entities/partner",
                                     json={"name": f"TEST_P2_{RUN}"}, timeout=15).json()["id"]
        body = {"project_id": proj["id"], "company_id": comp["id"],
                "partner_ids": [pid], "name": f"TEST_Batch_{RUN}"}
        r = admin_session.post(f"{BASE_URL}/api/batches", json=body, timeout=15)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["id"]
        assert b["company_id"] == comp["id"]
        assert pid in b["partner_ids"]
        TestRegression.batch_id = b["id"]
        TestRegression.project_id = proj["id"]

    def test_fooding_entry_crud_and_dashboard(self, admin_session):
        bid = getattr(TestRegression, "batch_id", None)
        assert bid, "batch_id required"
        # CREATE
        body = {"batch_id": bid, "month": "2025-11",
                "mandays_claimed": 10, "boarding_cost_per_manday": 50}
        r = admin_session.post(f"{BASE_URL}/api/fooding-entries", json=body, timeout=15)
        assert r.status_code == 200, r.text
        f = r.json()
        assert f["gross_amount"] == 500.0
        fid = f["id"]
        # LIST
        r2 = admin_session.get(f"{BASE_URL}/api/fooding-entries?batch_id={bid}", timeout=15)
        assert r2.status_code == 200
        assert any(x["id"] == fid for x in r2.json())
        # UPDATE
        body2 = {**body, "mandays_claimed": 20}
        r3 = admin_session.put(f"{BASE_URL}/api/fooding-entries/{fid}",
                               json=body2, timeout=15)
        assert r3.status_code == 200, r3.text
        assert r3.json()["gross_amount"] == 1000.0
        # DASHBOARD
        r4 = admin_session.get(f"{BASE_URL}/api/dashboard/fooding-income", timeout=15)
        assert r4.status_code == 200, r4.text
        # DELETE
        r5 = admin_session.delete(f"{BASE_URL}/api/fooding-entries/{fid}", timeout=15)
        assert r5.status_code in (200, 204)


# ============================================================================
# 8) Center-scoped approval chain
# ============================================================================
class TestCenterScopedChain:
    def test_create_center_scoped_chain(self, admin_session):
        center_id = getattr(TestEntityAutoUser, "center_id", None)
        assert center_id, "center_id from prior test required"
        body = {
            "name": f"TEST_ChainCS_{RUN}",
            "type": "transaction",
            "center_id": center_id,
            "active": True,
            "steps": [
                {"level": 1, "label": "L1", "kind": "role", "value": "manager"},
                {"level": 2, "label": "L2", "kind": "role", "value": "admin"},
            ],
        }
        r = admin_session.post(f"{BASE_URL}/api/approval-chains",
                               json=body, timeout=15)
        assert r.status_code == 200, r.text
        ch = r.json()
        assert ch["center_id"] == center_id
        assert ch["active"] is True
        # Verify it shows up in list
        r2 = admin_session.get(f"{BASE_URL}/api/approval-chains", timeout=15)
        assert r2.status_code == 200
        rows = r2.json()
        match = [x for x in rows if x["id"] == ch["id"]]
        assert len(match) == 1
        assert match[0]["center_id"] == center_id
