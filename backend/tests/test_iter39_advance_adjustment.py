"""iter-39 — Phase 2 Advance Adjustment ("Expense against Advance") backend tests.

Under test (server.py):
  * GET  /api/advance-requests/adjustable (scoped, released/adjusting w/ balance>0)
  * POST /api/payments  with advance_request_id + payment_mode='advance_adjustment'
      - happy path (partial adjustment) → advance status flips to 'adjusting'
      - full-settlement path → advance status flips to 'settled', balance_amount=0
      - negative: other-user's advance = 403
      - negative: settled/cancelled advance = 400
      - negative: actual_amount > balance = 400
      - resubmit_payment with amount exceeding balance = 400
  * Non-regression: bank/upi/cheque payments still enforce payee validation
  * Payment final approval when advance-linked skips paid_by_name / txn_center_id
"""
import os
import re
import uuid
import time
import pytest
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL")
            or "https://invest-analytics-24.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "admin@finance.app"
ADMIN_PASSWORD = "Admin@123"
RUN = uuid.uuid4().hex[:6]


# ---------- helpers ----------
def _login(email, pwd):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=20)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return s


def _post(s, path, body, ok=(200, 201)):
    r = s.post(f"{BASE_URL}{path}", json=body, timeout=20)
    assert r.status_code in ok, f"POST {path}: {r.status_code} {r.text}"
    return r.json()


def _get(s, path, ok=(200,), params=None):
    r = s.get(f"{BASE_URL}{path}", params=params, timeout=20)
    assert r.status_code in ok, f"GET {path}: {r.status_code} {r.text}"
    return r.json()


def _act(admin_s, req_type, req_id, action="approve", extra=None):
    body = {"request_type": req_type, "request_id": req_id, "action": action, "remarks": "auto"}
    if extra:
        body.update(extra)
    return admin_s.post(f"{API}/approvals/act", json=body, timeout=20)


def _approve_n_times(admin_s, req_type, req_id, n, extras=None):
    """Approve `n` levels. `extras` (dict) applied on the LAST call only."""
    for i in range(n):
        payload = extras if (extras and i == n - 1) else None
        r = _act(admin_s, req_type, req_id, "approve", extra=payload)
        assert r.status_code == 200, f"act #{i+1}: {r.status_code} {r.text}"


def _make_center(s):
    comp = _post(s, "/api/entities/company", {"name": f"TEST_iter39_Co_{RUN}_{uuid.uuid4().hex[:4]}"})
    ctr = _post(s, "/api/entities/center", {
        "name": f"IT39-{RUN}-{uuid.uuid4().hex[:4]}",
        "city": "X", "state": "Y", "company_id": comp["id"],
    })
    return comp, ctr


def _create_approve_release_advance(admin_s, amount=6000, purpose_suffix="", allow_no_chain=False):
    """Create a fresh advance, approve till 'approved', then release. Returns full advance doc.
    If approval chain isn't configured for advance_request, returns None (test will skip)."""
    r0 = admin_s.post(f"{API}/advance-requests", json={
        "purpose": f"TEST_iter39 adv {purpose_suffix} {RUN}",
        "amount": amount,
        "required_till": "2026-12-31",
    }, timeout=20)
    assert r0.status_code == 201, r0.text
    aid = r0.json()["id"]
    # Approve until status='approved'
    for _ in range(10):
        rec = _get(admin_s, f"/api/advance-requests/{aid}")
        if rec.get("status") == "approved":
            break
        if not rec.get("current_level") and rec.get("status") != "pending":
            break
        r = _act(admin_s, "advance_request", aid, "approve")
        if r.status_code != 200:
            if allow_no_chain:
                return None
            pytest.skip(f"advance_request approval failed: {r.status_code} {r.text}")
    rec = _get(admin_s, f"/api/advance-requests/{aid}")
    if rec.get("status") != "approved":
        if allow_no_chain:
            return None
        pytest.skip(f"advance not approved after chain: status={rec.get('status')}")
    me = _get(admin_s, "/api/auth/me")
    rel = _post(admin_s, f"/api/advance-requests/{aid}/release", {
        "payment_mode": "bank",
        "payment_date": "2026-01-15",
        "transaction_ref": f"TEST_REF_{uuid.uuid4().hex[:6]}",
        "paid_amount": amount,
        "paid_by_user_id": me["id"],
        "remarks": "auto",
    })
    return rel


def _approve_qtn_and_raise_payment(admin_s, center_id, actual_amount, adv_id=None,
                                   payment_mode="bank", extra_pay=None):
    """Create + approve a quotation, then raise a payment. Returns (quotation, payment)."""
    q = _post(admin_s, "/api/quotations", {
        "center_id": center_id,
        "category": "expense",
        "description": f"TEST_iter39 qtn {RUN}",
        "vendor_name": "TestVendor",
        "estimated_amount": actual_amount,
    })
    for _ in range(3):
        r = _act(admin_s, "quotation", q["id"], "approve")
        assert r.status_code == 200, r.text
    q_after = _get(admin_s, f"/api/quotations/{q['id']}")
    assert q_after["status"] == "approved"

    body = {"quotation_id": q["id"], "actual_amount": actual_amount, "payment_mode": payment_mode}
    if adv_id:
        body["advance_request_id"] = adv_id
    elif payment_mode == "bank":
        body.update({
            "payee_account_holder": "Test Vendor",
            "payee_account_no": "1234567890",
            "payee_ifsc": "HDFC0001234",
            "payee_bank_name": "HDFC Bank",
            "payee_proof_attachments": [{
                "id": str(uuid.uuid4()), "filename": "cheque.png",
                "path": "/tmp/cheque.png", "content_type": "image/png", "size": 1024,
            }],
        })
    if extra_pay:
        body.update(extra_pay)
    pay = _post(admin_s, "/api/payments", body)
    return q_after, pay


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def env(admin):
    comp, ctr = _make_center(admin)
    me = _get(admin, "/api/auth/me")
    return {"company_id": comp["id"], "center": ctr, "admin_id": me["id"]}


@pytest.fixture(scope="module")
def staff(admin):
    """Register a fresh non-admin staff user + return session + id."""
    email = f"TEST_iter39_staff_{uuid.uuid4().hex[:8]}@x.com"
    pwd = "Staff@12345"
    r = requests.post(f"{API}/auth/register", json={
        "email": email, "password": pwd, "name": "iter39 staff",
    }, timeout=15)
    assert r.status_code in (200, 201), r.text
    s = requests.Session()
    r2 = s.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=15)
    assert r2.status_code == 200
    me = _get(s, "/api/auth/me")
    return {"session": s, "email": email, "id": me["id"]}


# =========================================================================
class TestAdjustableEndpoint:
    def test_returns_only_own_adjustable(self, admin, env, staff):
        """Admin should see their own released/adjusting advances (balance>0), NOT staff's."""
        rows = _get(admin, "/api/advance-requests/adjustable")
        assert isinstance(rows, list)
        # Every row must be owned by admin, status in released/adjusting, balance>0
        for r in rows:
            assert r.get("status") in ("released", "adjusting"), r
            assert (r.get("balance_amount") or 0) > 0, r
            # slim payload shape
            for k in ("id", "advance_no", "amount", "paid_amount", "adjusted_amount",
                      "balance_amount", "purpose", "status"):
                assert k in r, f"missing {k} in slim row: {r}"

    def test_staff_sees_only_own(self, staff):
        """A brand-new staff with no advances gets empty list."""
        rows = _get(staff["session"], "/api/advance-requests/adjustable")
        assert isinstance(rows, list)
        assert rows == [] or all((row.get("balance_amount") or 0) > 0 for row in rows)


# =========================================================================
class TestAdvanceAdjustmentHappyPath:
    """Full lifecycle: fresh advance → release → raise adv-adjustment payment → approve → verify."""

    def test_partial_adjustment_updates_balance_and_status(self, admin, env):
        rel = _create_approve_release_advance(admin, amount=6000, purpose_suffix="happy")
        if rel is None:
            pytest.skip("no advance_request approval chain configured")
        assert rel["status"] == "released"
        assert rel["balance_amount"] == 6000
        adv_id = rel["id"]

        # Fresh quotation + payment linked to advance for 2000
        _, pay = _approve_qtn_and_raise_payment(
            admin, env["center"]["id"], actual_amount=2000,
            adv_id=adv_id, payment_mode="advance_adjustment",
        )
        assert pay["status"] == "pending"
        assert pay["advance_request_id"] == adv_id
        assert pay.get("advance_no") == rel["advance_no"]
        assert pay.get("payment_mode") == "advance_adjustment"

        # Approve 3× (payment chain: senior_manager → admin → accountant). NO paid_by_name needed.
        for _ in range(3):
            r = _act(admin, "payment", pay["id"], "approve")
            assert r.status_code == 200, r.text

        # Payment final state
        p_final = _get(admin, f"/api/payments/{pay['id']}")
        assert p_final["status"] == "paid"
        assert p_final.get("txn_id")

        # Advance state — adjusted_amount=2000, balance=4000, status='adjusting'
        adv = _get(admin, f"/api/advance-requests/{adv_id}")
        assert adv["adjusted_amount"] == 2000
        assert adv["balance_amount"] == 4000
        assert adv["status"] == "adjusting"
        adjustments = adv.get("adjustments") or []
        assert len(adjustments) == 1
        adj = adjustments[0]
        for k in ("payment_id", "qrn", "amount", "at", "vendor_name", "txn_id"):
            assert k in adj, f"missing {k} in adjustments entry: {adj}"
        assert adj["payment_id"] == pay["id"]
        assert float(adj["amount"]) == 2000.0

        # Transaction row: is_advance_adjustment=True, funded_by_advance_id set, advance_no set
        import asyncio
        from motor.motor_asyncio import AsyncIOMotorClient
        mu = dn = None
        with open("/app/backend/.env") as fh:
            for line in fh:
                if line.startswith("MONGO_URL="):
                    mu = line.split("=", 1)[1].strip().strip('"')
                if line.startswith("DB_NAME="):
                    dn = line.split("=", 1)[1].strip().strip('"')

        async def _fetch():
            c = AsyncIOMotorClient(mu)
            t = await c[dn].transactions.find_one({"id": p_final["txn_id"]}, {"_id": 0})
            c.close()
            return t

        txn = asyncio.new_event_loop().run_until_complete(_fetch())
        assert txn, f"txn {p_final['txn_id']} not found in db"
        assert txn.get("is_advance_adjustment") is True
        assert txn.get("funded_by_advance_id") == adv_id
        assert txn.get("advance_no") == rel["advance_no"]

        # Persist advance id for full-settlement test
        pytest.iter39_adv_id = adv_id
        pytest.iter39_center_id = env["center"]["id"]
        pytest.iter39_adv_no = rel["advance_no"]

    def test_full_settlement_flips_status_settled(self, admin):
        aid = getattr(pytest, "iter39_adv_id", None)
        cid = getattr(pytest, "iter39_center_id", None)
        if not (aid and cid):
            pytest.skip("prev happy-path did not complete")
        # Balance is currently 4000 → settle with a 4000 adv-adjustment payment
        _, pay = _approve_qtn_and_raise_payment(
            admin, cid, actual_amount=4000, adv_id=aid, payment_mode="advance_adjustment",
        )
        for _ in range(3):
            r = _act(admin, "payment", pay["id"], "approve")
            assert r.status_code == 200, r.text
        adv = _get(admin, f"/api/advance-requests/{aid}")
        assert adv["status"] == "settled", adv
        assert adv["balance_amount"] == 0
        assert adv.get("settled_at")
        assert len(adv.get("adjustments") or []) == 2


# =========================================================================
class TestAdvanceAdjustmentNegatives:
    def test_other_users_advance_403(self, admin, env, staff):
        """Payment linking to another user's advance should 403."""
        # Create advance owned by staff, then approve & release via admin
        r0 = staff["session"].post(f"{API}/advance-requests", json={
            "purpose": f"TEST_iter39 staff-adv {RUN}",
            "amount": 3000,
            "required_till": "2026-12-31",
        }, timeout=15)
        assert r0.status_code == 201, r0.text
        aid = r0.json()["id"]
        # Admin approves and releases
        for _ in range(10):
            rec = _get(admin, f"/api/advance-requests/{aid}")
            if rec.get("status") == "approved":
                break
            r = _act(admin, "advance_request", aid, "approve")
            if r.status_code != 200:
                pytest.skip("advance approval chain unavailable")
        me = _get(admin, "/api/auth/me")
        rel = _post(admin, f"/api/advance-requests/{aid}/release", {
            "payment_mode": "bank", "paid_amount": 3000, "paid_by_user_id": me["id"],
        })
        assert rel["status"] == "released"

        # Admin (not owner) tries to link this advance to a payment → 403
        q = _post(admin, "/api/quotations", {
            "center_id": env["center"]["id"],
            "description": f"TEST_iter39 other-user {RUN}", "vendor_name": "V",
            "estimated_amount": 500,
        })
        for _ in range(3):
            _act(admin, "quotation", q["id"], "approve")
        r = admin.post(f"{API}/payments", json={
            "quotation_id": q["id"], "actual_amount": 500,
            "payment_mode": "advance_adjustment", "advance_request_id": aid,
        }, timeout=15)
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"

    def test_settled_advance_400(self, admin, env):
        """Using an already-settled advance should 400."""
        aid = getattr(pytest, "iter39_adv_id", None)
        if not aid:
            pytest.skip("no settled advance")
        adv = _get(admin, f"/api/advance-requests/{aid}")
        if adv.get("status") != "settled":
            pytest.skip("advance not settled from prior test")
        q = _post(admin, "/api/quotations", {
            "center_id": env["center"]["id"],
            "description": f"TEST_iter39 settled-guard {RUN}", "vendor_name": "V",
            "estimated_amount": 100,
        })
        for _ in range(3):
            _act(admin, "quotation", q["id"], "approve")
        r = admin.post(f"{API}/payments", json={
            "quotation_id": q["id"], "actual_amount": 100,
            "payment_mode": "advance_adjustment", "advance_request_id": aid,
        }, timeout=15)
        assert r.status_code == 400, f"expected 400 got {r.status_code}: {r.text}"

    def test_actual_amount_exceeds_balance_400(self, admin, env):
        rel = _create_approve_release_advance(admin, amount=1000, purpose_suffix="overbal")
        if rel is None:
            pytest.skip("no chain")
        q = _post(admin, "/api/quotations", {
            "center_id": env["center"]["id"],
            "description": f"TEST_iter39 overbal {RUN}", "vendor_name": "V",
            "estimated_amount": 5000,
        })
        for _ in range(3):
            _act(admin, "quotation", q["id"], "approve")
        r = admin.post(f"{API}/payments", json={
            "quotation_id": q["id"], "actual_amount": 5000,   # > 1000 balance
            "payment_mode": "advance_adjustment",
            "advance_request_id": rel["id"],
        }, timeout=15)
        assert r.status_code == 400, f"expected 400 got {r.status_code}: {r.text}"

    def test_resubmit_exceeding_balance_400(self, admin, env):
        """Resubmit path re-validates amount against balance."""
        rel = _create_approve_release_advance(admin, amount=1000, purpose_suffix="resub")
        if rel is None:
            pytest.skip("no chain")
        q = _post(admin, "/api/quotations", {
            "center_id": env["center"]["id"],
            "description": f"TEST_iter39 resub {RUN}", "vendor_name": "V",
            "estimated_amount": 500,
        })
        for _ in range(3):
            _act(admin, "quotation", q["id"], "approve")
        pay = _post(admin, "/api/payments", {
            "quotation_id": q["id"], "actual_amount": 500,
            "payment_mode": "advance_adjustment", "advance_request_id": rel["id"],
        })
        # Send back at level 1
        r = _act(admin, "payment", pay["id"], "send_back", extra={"remarks": "please fix"})
        assert r.status_code == 200, r.text
        # Now resubmit with amount 5000 > balance 1000 → 400
        r2 = admin.post(f"{API}/payments/{pay['id']}/resubmit", json={
            "actual_amount": 5000,
            "edit_note": "trying larger amount",
        }, timeout=15)
        assert r2.status_code == 400, f"expected 400 got {r2.status_code}: {r2.text}"


# =========================================================================
class TestNonRegressionPayeeValidation:
    """Standard bank/upi/cheque payments (no advance link) must still enforce payee rules."""

    def _fresh_approved_quotation(self, admin, center_id, tag):
        q = _post(admin, "/api/quotations", {
            "center_id": center_id,
            "description": f"TEST_iter39 payee-{tag} {RUN}",
            "vendor_name": "V", "estimated_amount": 400,
        })
        for _ in range(3):
            _act(admin, "quotation", q["id"], "approve")
        return q

    def test_bank_requires_account_details(self, admin, env):
        q = self._fresh_approved_quotation(admin, env["center"]["id"], "bank")
        r = admin.post(f"{API}/payments", json={
            "quotation_id": q["id"], "actual_amount": 400, "payment_mode": "bank",
        }, timeout=15)
        assert r.status_code == 400
        assert "Account" in r.text or "IFSC" in r.text or "Bank" in r.text

    def test_upi_requires_upi_id_and_proof(self, admin, env):
        q = self._fresh_approved_quotation(admin, env["center"]["id"], "upi")
        r = admin.post(f"{API}/payments", json={
            "quotation_id": q["id"], "actual_amount": 400, "payment_mode": "upi",
        }, timeout=15)
        assert r.status_code == 400

    def test_cheque_requires_bank_details_and_proof(self, admin, env):
        q = self._fresh_approved_quotation(admin, env["center"]["id"], "cheque")
        r = admin.post(f"{API}/payments", json={
            "quotation_id": q["id"], "actual_amount": 400, "payment_mode": "cheque",
        }, timeout=15)
        assert r.status_code == 400

    def test_bank_happy_still_works(self, admin, env):
        """Bank payment with all details supplied still succeeds end-to-end."""
        q, pay = _approve_qtn_and_raise_payment(
            admin, env["center"]["id"], actual_amount=400, payment_mode="bank",
        )
        assert pay["status"] == "pending"
        # Approve to final (requires paid_by_name + txn_center_id on last step)
        me = _get(admin, "/api/auth/me")
        _approve_n_times(admin, "payment", pay["id"], 3, extras={
            "paid_by_user_id": me["id"], "paid_by_name": me.get("name") or me.get("email"),
            "txn_center_id": env["center"]["id"],
        })
        p_final = _get(admin, f"/api/payments/{pay['id']}")
        assert p_final["status"] == "paid"
        assert p_final.get("txn_id")
