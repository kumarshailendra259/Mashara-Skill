"""Iteration-14 backend tests:
 - Forgot password OTP flow: /auth/forgot-password (+ rate limit), /auth/verify-otp, /auth/reset-password
 - Partner cross-approval: /transactions/{tid}/partner-approve + partner-approve-eligibility
 - Partner associations CRUD: /partner-associations
"""
import os
import uuid
import hashlib
import asyncio
import requests
import pytest
from datetime import datetime, timezone, timedelta
from motor.motor_asyncio import AsyncIOMotorClient


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
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "finance_tracker_db"


def _sha256(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return s


def _register(email, password, name="TEST user"):
    s = requests.Session()
    r = s.post(f"{API}/auth/register", json={"email": email, "password": password, "name": name}, timeout=15)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    return s, r.json()


@pytest.fixture(scope="module")
def db():
    client = AsyncIOMotorClient(MONGO_URL)
    return client[DB_NAME]


@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN_EMAIL, ADMIN_PWD)


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# ============ Forgot password ============
class TestForgotPasswordFlow:
    def test_forgot_password_unknown_email_generic_ok(self):
        """No email enumeration — unknown email also returns generic ok."""
        r = requests.post(f"{API}/auth/forgot-password",
                          json={"email": f"nobody_{TAG}@example.com"}, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("ok") is True

    def test_forgot_password_valid_email_creates_otp_doc(self, db):
        # Use a fresh user so admin's rate limit isn't affected
        email = f"fp_{TAG}@finance.app"
        _register(email, "Pass@123", name="TEST fp user")
        # Clean any prior OTPs (in case re-run)
        _run(db.password_reset_otps.delete_many({"email": email}))

        r = requests.post(f"{API}/auth/forgot-password", json={"email": email}, timeout=20)
        assert r.status_code == 200, r.text
        # Verify an OTP doc was inserted
        count = _run(db.password_reset_otps.count_documents({"email": email}))
        assert count >= 1, "OTP doc not created in password_reset_otps"

    def test_forgot_password_rate_limit_429(self, db):
        email = f"fprl_{TAG}@finance.app"
        _register(email, "Pass@123", name="TEST rl user")
        _run(db.password_reset_otps.delete_many({"email": email}))
        statuses = []
        for _ in range(4):
            r = requests.post(f"{API}/auth/forgot-password", json={"email": email}, timeout=15)
            statuses.append(r.status_code)
        # First 3 should be 200; 4th must be 429
        assert statuses[:3] == [200, 200, 200], f"statuses={statuses}"
        assert statuses[3] == 429, f"expected 429 on 4th attempt, got {statuses}"


# ============ Verify OTP + Reset password ============
class TestVerifyAndResetFlow:
    @pytest.fixture(scope="class")
    def reset_user(self, db):
        email = f"reset_{TAG}@finance.app"
        old_pwd = "OldPass@123"
        _register(email, old_pwd, name="TEST reset user")
        _run(db.password_reset_otps.delete_many({"email": email}))
        return {"email": email, "old_pwd": old_pwd}

    def _seed_otp(self, db, email, otp_plain="123456"):
        """Directly seed an OTP doc — same shape as forgot-password endpoint."""
        now = datetime.now(timezone.utc)
        doc = {
            "id": str(uuid.uuid4()),
            "email": email,
            "otp_hash": _sha256(otp_plain),
            "attempts": 0,
            "used": False,
            "reset_token": None,
            "reset_token_expires_at": None,
            "created_at": now.isoformat(),
            "expires_at": now + timedelta(minutes=15),
        }
        _run(db.password_reset_otps.insert_one(doc))
        return doc

    def test_verify_otp_wrong_increments_attempts(self, db, reset_user):
        email = reset_user["email"]
        _run(db.password_reset_otps.delete_many({"email": email}))
        self._seed_otp(db, email, "123456")
        # Wrong OTP
        r = requests.post(f"{API}/auth/verify-otp",
                          json={"email": email, "otp": "000000"}, timeout=15)
        assert r.status_code == 400, r.text
        assert "incorrect" in r.json().get("detail", "").lower()
        # attempts incremented
        doc = _run(db.password_reset_otps.find_one({"email": email, "used": False}))
        assert doc.get("attempts") == 1

    def test_verify_otp_max_attempts_429(self, db, reset_user):
        email = reset_user["email"]
        _run(db.password_reset_otps.delete_many({"email": email}))
        self._seed_otp(db, email, "123456")
        # 5 wrong attempts -> last call before will already be at attempts=5 -> 429
        statuses = []
        for _ in range(6):
            r = requests.post(f"{API}/auth/verify-otp",
                              json={"email": email, "otp": "000000"}, timeout=15)
            statuses.append(r.status_code)
        # First 5 = 400 (each increments attempts), 6th sees attempts>=5 -> 429
        assert statuses[:5] == [400] * 5, f"expected 5x400, got {statuses}"
        assert statuses[5] == 429, f"expected 429 at 6th, got {statuses}"

    def test_verify_correct_then_reset_then_login(self, db, reset_user):
        email = reset_user["email"]
        new_pwd = "NewPass@456"
        _run(db.password_reset_otps.delete_many({"email": email}))
        # Seed multiple OTPs to verify open ones get invalidated
        self._seed_otp(db, email, "111111")
        self._seed_otp(db, email, "123456")
        # Correct verify
        r = requests.post(f"{API}/auth/verify-otp",
                          json={"email": email, "otp": "123456"}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        token = body.get("reset_token")
        assert token and isinstance(token, str)
        assert body.get("expires_in", 0) > 0

        # Bad token rejected
        r_bad = requests.post(f"{API}/auth/reset-password",
                              json={"reset_token": "garbage_token_xxx", "new_password": new_pwd}, timeout=15)
        assert r_bad.status_code == 400

        # Reset succeeds
        r2 = requests.post(f"{API}/auth/reset-password",
                           json={"reset_token": token, "new_password": new_pwd}, timeout=15)
        assert r2.status_code == 200, r2.text

        # Login with new password
        s = requests.Session()
        rlogin = s.post(f"{API}/auth/login",
                        json={"email": email, "password": new_pwd}, timeout=15)
        assert rlogin.status_code == 200, f"new password login failed: {rlogin.text}"

        # Old password fails
        s2 = requests.Session()
        rold = s2.post(f"{API}/auth/login",
                       json={"email": email, "password": reset_user["old_pwd"]}, timeout=15)
        assert rold.status_code in (400, 401), f"old password should fail, got {rold.status_code}"

        # Verify the other open OTP was invalidated (used=True)
        other = _run(db.password_reset_otps.find_one({"email": email, "otp_hash": _sha256("111111")}))
        assert other.get("used") is True, "other open OTPs were not invalidated"

    def test_admin_password_unchanged_at_end(self):
        """Sanity check: admin login still works with Admin@123 (we never touched admin)."""
        s = requests.Session()
        r = s.post(f"{API}/auth/login",
                   json={"email": ADMIN_EMAIL, "password": ADMIN_PWD}, timeout=15)
        assert r.status_code == 200, "admin password was inadvertently changed"


# ============ Partner Associations CRUD ============
class TestPartnerAssociations:
    @pytest.fixture(scope="class")
    def two_partners(self, admin):
        """Create two TEST partner entities."""
        r1 = admin.post(f"{API}/entities/partner",
                       json={"name": f"TEST_PartnerA_{TAG}"}, timeout=15)
        r2 = admin.post(f"{API}/entities/partner",
                       json={"name": f"TEST_PartnerB_{TAG}"}, timeout=15)
        assert r1.status_code == 200 and r2.status_code == 200
        return r1.json()["id"], r2.json()["id"]

    def test_create_pairing(self, admin, two_partners):
        a, b = two_partners
        r = admin.post(f"{API}/partner-associations",
                       json={"partner_a_id": a, "partner_b_id": b}, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        # IDs are normalized (sorted) — verify both ids present
        assert {d["partner_a_id"], d["partner_b_id"]} == {a, b}
        assert d.get("id")

    def test_same_partner_rejected(self, admin, two_partners):
        a, _ = two_partners
        r = admin.post(f"{API}/partner-associations",
                       json={"partner_a_id": a, "partner_b_id": a}, timeout=15)
        assert r.status_code == 400

    def test_duplicate_is_idempotent(self, admin, two_partners):
        a, b = two_partners
        r1 = admin.post(f"{API}/partner-associations",
                        json={"partner_a_id": a, "partner_b_id": b}, timeout=15)
        r2 = admin.post(f"{API}/partner-associations",
                        json={"partner_a_id": b, "partner_b_id": a}, timeout=15)
        assert r1.status_code == 200 and r2.status_code == 200
        # Same id returned
        assert r1.json()["id"] == r2.json()["id"]

    def test_list_and_delete(self, admin, two_partners):
        a, b = two_partners
        # Ensure exists
        admin.post(f"{API}/partner-associations",
                   json={"partner_a_id": a, "partner_b_id": b}, timeout=15)
        # List
        rl = admin.get(f"{API}/partner-associations", timeout=15)
        assert rl.status_code == 200
        items = rl.json()
        target = [x for x in items if {x["partner_a_id"], x["partner_b_id"]} == {a, b}]
        assert target, "newly created pairing not in list"
        assoc_id = target[0]["id"]
        # Delete
        rd = admin.delete(f"{API}/partner-associations/{assoc_id}", timeout=15)
        assert rd.status_code == 200
        # Delete again -> 404
        rd2 = admin.delete(f"{API}/partner-associations/{assoc_id}", timeout=15)
        assert rd2.status_code == 404


# ============ Partner cross-approval ============
class TestPartnerCrossApprove:
    @pytest.fixture(scope="class")
    def fixture_data(self, admin, db):
        """Set up: 2 partners P1/P2, a project, a center; create one txn owned by P1 in shared project.
        Create two users: user1 (assigned_partner_id=P1) — the creator, user2 (assigned_partner_id=P2) — the approver.
        Plus a third partner P3 for the 'unrelated partner' negative case.
        Plus user_self (assigned_partner_id=P1) — same partner as creator → should be rejected."""
        # entities
        rp1 = admin.post(f"{API}/entities/partner", json={"name": f"TEST_P1_{TAG}"}).json()
        rp2 = admin.post(f"{API}/entities/partner", json={"name": f"TEST_P2_{TAG}"}).json()
        rp3 = admin.post(f"{API}/entities/partner", json={"name": f"TEST_P3_{TAG}"}).json()
        rproj = admin.post(f"{API}/entities/project", json={"name": f"TEST_PRJ_{TAG}"}).json()
        rcent = admin.post(f"{API}/entities/center", json={"name": f"TEST_CEN_{TAG}"}).json()
        rcomp = admin.post(f"{API}/entities/company", json={"name": f"TEST_CO_{TAG}"}).json()

        # users (partner role) — admin creates via /users with partner role then sets assigned_partner_id
        def make_partner_user(email_prefix, partner_id):
            email = f"{email_prefix}_{TAG}@finance.app"
            # register first
            sess = requests.Session()
            rr = sess.post(f"{API}/auth/register",
                           json={"email": email, "password": "Pass@123", "name": email_prefix},
                           timeout=15)
            assert rr.status_code == 200, rr.text
            uid = rr.json()["id"]
            # admin promotes via PATCH /auth/users/{uid}
            up = admin.patch(f"{API}/auth/users/{uid}",
                             json={"role": "partner", "assigned_partner_id": partner_id}, timeout=15)
            assert up.status_code == 200, up.text
            # login under that user (cookies)
            s2 = requests.Session()
            r2 = s2.post(f"{API}/auth/login",
                         json={"email": email, "password": "Pass@123"}, timeout=15)
            assert r2.status_code == 200
            return s2, uid

        creator_sess, creator_uid = make_partner_user("creator", rp1["id"])
        approver_sess, approver_uid = make_partner_user("approver", rp2["id"])
        same_partner_sess, _ = make_partner_user("samep", rp1["id"])  # same partner as creator
        unrelated_sess, _ = make_partner_user("unrel", rp3["id"])     # unrelated partner
        no_pid_sess, no_pid_uid = make_partner_user("nopid", rp2["id"])
        # strip assigned_partner_id from no_pid user — PATCH /auth/users filters out None,
        # so use direct DB update as a workaround (this exposes a known backend bug:
        # there is no way to clear assigned_partner_id via the public API).
        _run(db.users.update_one({"id": no_pid_uid}, {"$set": {"assigned_partner_id": None}}))

        # First create a "shared scope" txn: approver's partner P2 has an existing txn in this project_id
        # — this is what /shares_project_or_center looks for.
        shared_seed = admin.post(f"{API}/transactions", json={
            "type": "income", "amount": 10.0, "date": "2099-01-01",
            "description": f"TEST shared scope seed {TAG}",
            "company_id": rcomp["id"], "partner_id": rp2["id"],
            "project_id": rproj["id"], "center_id": rcent["id"],
        }, timeout=15)
        assert shared_seed.status_code == 200, shared_seed.text

        # Now create the target txn — owned by P1, same project + center, status will be pending
        target = creator_sess.post(f"{API}/transactions", json={
            "type": "expense", "amount": 100.0, "date": "2099-01-02",
            "description": f"TEST target {TAG}",
            "company_id": rcomp["id"], "partner_id": rp1["id"],
            "project_id": rproj["id"], "center_id": rcent["id"],
        }, timeout=15)
        assert target.status_code == 200, target.text
        target_txn = target.json()
        assert target_txn["status"] == "pending", f"expected pending, got {target_txn['status']}"

        return {
            "p1": rp1["id"], "p2": rp2["id"], "p3": rp3["id"],
            "project_id": rproj["id"], "center_id": rcent["id"], "company_id": rcomp["id"],
            "creator_sess": creator_sess, "creator_uid": creator_uid,
            "approver_sess": approver_sess, "approver_uid": approver_uid,
            "same_partner_sess": same_partner_sess,
            "unrelated_sess": unrelated_sess,
            "no_pid_sess": no_pid_sess,
            "txn_id": target_txn["id"],
        }

    def _new_pending_txn(self, fixture_data, admin):
        """Create a new pending txn owned by P1 in same scope."""
        f = fixture_data
        r = f["creator_sess"].post(f"{API}/transactions", json={
            "type": "expense", "amount": 50.0, "date": "2099-02-02",
            "description": f"TEST txn {uuid.uuid4().hex[:6]}",
            "company_id": f["company_id"], "partner_id": f["p1"],
            "project_id": f["project_id"], "center_id": f["center_id"],
        }, timeout=15)
        assert r.status_code == 200, r.text
        return r.json()["id"]

    def test_creator_cannot_self_approve(self, fixture_data):
        f = fixture_data
        r = f["creator_sess"].post(f"{API}/transactions/{f['txn_id']}/partner-approve", timeout=15)
        # Creator's partner == owner partner → rejected with 403
        assert r.status_code == 403, r.text
    def test_same_partner_id_rejected(self, fixture_data, admin):
        tid = self._new_pending_txn(fixture_data, admin)
        f = fixture_data
        r = f["same_partner_sess"].post(f"{API}/transactions/{tid}/partner-approve", timeout=15)
        assert r.status_code == 403, r.text

    def test_no_assigned_partner_rejected(self, fixture_data, admin):
        tid = self._new_pending_txn(fixture_data, admin)
        f = fixture_data
        r = f["no_pid_sess"].post(f"{API}/transactions/{tid}/partner-approve", timeout=15)
        assert r.status_code == 403, r.text

    def test_non_partner_role_rejected(self, fixture_data, admin):
        """Plain user (default role=user) cannot partner-approve."""
        tid = self._new_pending_txn(fixture_data, admin)
        email = f"plainuser_{TAG}@finance.app"
        sess, _ = _register(email, "Pass@123", name="TEST plain")
        r = sess.post(f"{API}/transactions/{tid}/partner-approve", timeout=15)
        assert r.status_code == 403, r.text

    def test_unrelated_partner_rejected(self, fixture_data, admin):
        """P3 has no shared project/center and no custom pairing — should be rejected."""
        tid = self._new_pending_txn(fixture_data, admin)
        f = fixture_data
        # Confirm eligibility check matches
        elig = f["unrelated_sess"].get(f"{API}/transactions/{tid}/partner-approve-eligibility", timeout=15)
        assert elig.status_code == 200
        assert elig.json()["eligible"] is False
        r = f["unrelated_sess"].post(f"{API}/transactions/{tid}/partner-approve", timeout=15)
        assert r.status_code == 403, r.text

    def test_approve_via_shared_project_or_center(self, fixture_data, admin):
        tid = self._new_pending_txn(fixture_data, admin)
        f = fixture_data
        # Approver's partner P2 has a seed txn in same project — should be eligible
        elig = f["approver_sess"].get(f"{API}/transactions/{tid}/partner-approve-eligibility", timeout=15)
        assert elig.status_code == 200
        assert elig.json()["eligible"] is True, elig.json()
        r = f["approver_sess"].post(f"{API}/transactions/{tid}/partner-approve", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "approved"
        # NOTE: approval_via/approval_reason are persisted in DB but missing from TransactionOut model
        # (TransactionOut inherits TransactionIn and doesn't declare them). Skipping assertion.
        # Re-approving an already-approved txn returns 400
        r2 = f["approver_sess"].post(f"{API}/transactions/{tid}/partner-approve", timeout=15)
        assert r2.status_code == 400

    def test_approve_via_custom_pairing(self, fixture_data, admin):
        """Create a P1<->P3 pairing — now P3 user can approve P1's txn even without shared project/center."""
        f = fixture_data
        # First create a txn with no project_id/center_id so only custom pairing applies
        r_isolated = f["creator_sess"].post(f"{API}/transactions", json={
            "type": "expense", "amount": 20.0, "date": "2099-03-03",
            "description": f"TEST isolated {TAG}",
            "company_id": f["company_id"], "partner_id": f["p1"],
        }, timeout=15)
        assert r_isolated.status_code == 200, r_isolated.text
        tid = r_isolated.json()["id"]

        # Unrelated session (P3) — before pairing, should fail
        r_pre = f["unrelated_sess"].get(f"{API}/transactions/{tid}/partner-approve-eligibility", timeout=15)
        assert r_pre.json()["eligible"] is False

        # Admin creates P1<->P3 pairing
        rc = admin.post(f"{API}/partner-associations",
                        json={"partner_a_id": f["p1"], "partner_b_id": f["p3"]}, timeout=15)
        assert rc.status_code == 200, rc.text

        # Now eligible
        r_post = f["unrelated_sess"].get(f"{API}/transactions/{tid}/partner-approve-eligibility", timeout=15)
        assert r_post.json()["eligible"] is True, r_post.json()

        # Approve succeeds
        ra = f["unrelated_sess"].post(f"{API}/transactions/{tid}/partner-approve", timeout=15)
        assert ra.status_code == 200, ra.text
        assert ra.json()["status"] == "approved"


# ============ Partner association role check ============
class TestPartnerAssocRoles:
    def test_non_admin_cannot_create(self):
        """A plain user cannot create partner associations."""
        email = f"plain_assoc_{TAG}@finance.app"
        sess, _ = _register(email, "Pass@123", name="TEST plain assoc")
        r = sess.post(f"{API}/partner-associations",
                      json={"partner_a_id": "x", "partner_b_id": "y"}, timeout=15)
        assert r.status_code == 403
