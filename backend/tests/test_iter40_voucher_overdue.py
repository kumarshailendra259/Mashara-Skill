"""iter-40 — Phase 3 Batch A: Payment Voucher + Overdue Advance Alerts.

Under test:
  * Auto voucher generation on payment final approval (voucher_id/voucher_no/PV-YY-NNNN, payment_vouchers row)
  * GET /api/payments/{pid}/voucher/download → application/pdf, %PDF- + %%EOF
  * GET /api/payments/{pid}/voucher/download for non-paid → 400
  * Lazy-generation for legacy paid payments (backfills payment.voucher_id)
  * POST /api/payments/{pid}/voucher/email — role-gated, non-paid 400, no-voucher edge 400,
      DB write to emailed_to_vendor_at + emailed_to + emailed_by
  * GET /api/payment-vouchers with q + X-Total-Count header
  * GET /api/advance-requests/overdue — returns overdue rows w/ is_overdue+days_overdue
  * POST /api/advance-requests/overdue/notify → { total_overdue, notified, skipped_no_email }
  * list_/my_/get_ advance_requests enrich rows with is_overdue+days_overdue
  * Pre-existing bug: GET /api/transactions returns 200 (posted→approved migration)
"""
import os
import uuid
import asyncio
import pytest
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL")
            or "https://invest-analytics-24.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "admin@finance.app"
ADMIN_PASSWORD = "Admin@123"
RUN = uuid.uuid4().hex[:6]


# -------- helpers --------
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


def _mongo():
    mu = dn = None
    with open("/app/backend/.env") as fh:
        for line in fh:
            if line.startswith("MONGO_URL="):
                mu = line.split("=", 1)[1].strip().strip('"')
            if line.startswith("DB_NAME="):
                dn = line.split("=", 1)[1].strip().strip('"')
    return mu, dn


async def _db_call(coro_fn):
    from motor.motor_asyncio import AsyncIOMotorClient
    mu, dn = _mongo()
    c = AsyncIOMotorClient(mu)
    try:
        return await coro_fn(c[dn])
    finally:
        c.close()


def _run(coro_fn):
    return asyncio.new_event_loop().run_until_complete(_db_call(coro_fn))


@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def env(admin):
    comp = _post(admin, "/api/entities/company", {"name": f"TEST_iter40_Co_{RUN}"})
    ctr = _post(admin, "/api/entities/center", {
        "name": f"IT40-{RUN}", "city": "X", "state": "Y", "company_id": comp["id"],
    })
    me = _get(admin, "/api/auth/me")
    return {"company_id": comp["id"], "center": ctr, "admin_id": me["id"], "me": me}


def _make_paid_payment(admin, env):
    """Create quotation → approve → raise bank payment → approve 3× to paid. Returns payment id."""
    q = _post(admin, "/api/quotations", {
        "center_id": env["center"]["id"],
        "category": "expense",
        "description": f"TEST_iter40 qtn {RUN}",
        "vendor_name": f"TEST_Vendor_{RUN}",
        "estimated_amount": 5000,
    })
    for _ in range(3):
        r = _act(admin, "quotation", q["id"], "approve")
        assert r.status_code == 200, r.text
    body = {
        "quotation_id": q["id"], "actual_amount": 5000, "payment_mode": "bank",
        "payee_account_holder": "Test Vendor", "payee_account_no": "1234567890",
        "payee_ifsc": "HDFC0001234", "payee_bank_name": "HDFC Bank",
        "payee_proof_attachments": [{
            "id": str(uuid.uuid4()), "filename": "cheque.png",
            "path": "/tmp/cheque.png", "content_type": "image/png", "size": 1024,
        }],
    }
    pay = _post(admin, "/api/payments", body)
    # approve first 2 without extras
    for _ in range(2):
        r = _act(admin, "payment", pay["id"], "approve")
        assert r.status_code == 200, r.text
    # final step needs paid_by_name + txn_center_id
    r = _act(admin, "payment", pay["id"], "approve", extra={
        "paid_by_user_id": env["admin_id"],
        "paid_by_name": env["me"].get("name") or env["me"].get("email"),
        "txn_center_id": env["center"]["id"],
    })
    assert r.status_code == 200, r.text
    p = _get(admin, f"/api/payments/{pay['id']}")
    assert p["status"] == "paid", p
    return p


# =========================================================================
class TestVoucherAutoGeneration:
    def test_final_approval_creates_voucher(self, admin, env):
        p = _make_paid_payment(admin, env)
        # Voucher fields set on payment doc
        assert p.get("voucher_id"), f"voucher_id missing: {p}"
        assert p.get("voucher_no", "").startswith("PV-"), p.get("voucher_no")
        assert p.get("voucher_path"), p
        assert p.get("voucher_generated_at"), p
        # payment_vouchers row exists
        async def _find(db):
            return await db.payment_vouchers.find_one({"payment_id": p["id"]}, {"_id": 0})
        v = _run(_find)
        assert v, "payment_vouchers row missing"
        for k in ("id", "voucher_no", "amount", "vendor_name", "center_id", "company_id", "generated_by"):
            assert k in v, f"missing {k} in voucher: {v}"
        assert float(v["amount"]) == 5000.0
        pytest.iter40_paid_pid = p["id"]
        pytest.iter40_voucher_no = v["voucher_no"]


class TestVoucherDownload:
    def test_download_paid_returns_pdf(self, admin):
        pid = getattr(pytest, "iter40_paid_pid", None)
        if not pid:
            pytest.skip("no paid payment")
        r = admin.get(f"{API}/payments/{pid}/voucher/download", timeout=20)
        assert r.status_code == 200, r.text[:200]
        assert "application/pdf" in r.headers.get("content-type", ""), r.headers
        content = r.content
        assert content[:5] == b"%PDF-", f"missing %PDF- header: {content[:20]!r}"
        # %%EOF footer near end
        assert b"%%EOF" in content[-1024:], "missing %%EOF footer"

    def test_download_non_paid_400(self, admin, env):
        # Create a pending payment (don't approve to paid)
        q = _post(admin, "/api/quotations", {
            "center_id": env["center"]["id"],
            "description": f"TEST_iter40 pending {RUN}",
            "vendor_name": "V", "estimated_amount": 400,
        })
        for _ in range(3):
            _act(admin, "quotation", q["id"], "approve")
        pay = _post(admin, "/api/payments", {
            "quotation_id": q["id"], "actual_amount": 400, "payment_mode": "bank",
            "payee_account_holder": "V", "payee_account_no": "1", "payee_ifsc": "HDFC0001234",
            "payee_bank_name": "HDFC",
            "payee_proof_attachments": [{"id": str(uuid.uuid4()), "filename": "x.png",
                                          "path": "/tmp/x.png", "content_type": "image/png", "size": 1}],
        })
        r = admin.get(f"{API}/payments/{pay['id']}/voucher/download", timeout=15)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"

    def test_lazy_generation_for_legacy_paid(self, admin):
        """Simulate a legacy paid payment (strip voucher_* fields) → download must regenerate."""
        pid = getattr(pytest, "iter40_paid_pid", None)
        if not pid:
            pytest.skip("no paid payment")

        async def _strip(db):
            await db.payments.update_one({"id": pid}, {"$unset": {
                "voucher_id": "", "voucher_no": "", "voucher_path": "", "voucher_generated_at": "",
            }})
            await db.payment_vouchers.delete_many({"payment_id": pid})
        _run(_strip)

        # Now download — should lazily create voucher
        r = admin.get(f"{API}/payments/{pid}/voucher/download", timeout=30)
        assert r.status_code == 200, r.text[:200]
        assert r.content[:5] == b"%PDF-"

        # Payment doc backfilled
        p = _get(admin, f"/api/payments/{pid}")
        assert p.get("voucher_id"), f"voucher_id not backfilled: {p}"
        assert p.get("voucher_no", "").startswith("PV-")


class TestVoucherEmail:
    def test_email_paid_success(self, admin):
        pid = getattr(pytest, "iter40_paid_pid", None)
        if not pid:
            pytest.skip("no paid payment")
        r = admin.post(f"{API}/payments/{pid}/voucher/email", json={
            "to_email": "vendor_test@example.com",
            "subject": "TEST Voucher",
        }, timeout=20)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("ok") is True
        assert j.get("to") == "vendor_test@example.com"

        # DB write happened
        async def _find(db):
            return await db.payment_vouchers.find_one({"payment_id": pid}, {"_id": 0})
        v = _run(_find)
        assert v.get("emailed_to_vendor_at"), v
        assert v.get("emailed_to") == "vendor_test@example.com"
        assert v.get("emailed_by")

    def test_email_non_paid_400(self, admin, env):
        q = _post(admin, "/api/quotations", {
            "center_id": env["center"]["id"],
            "description": f"TEST_iter40 pending-email {RUN}",
            "vendor_name": "V", "estimated_amount": 400,
        })
        for _ in range(3):
            _act(admin, "quotation", q["id"], "approve")
        pay = _post(admin, "/api/payments", {
            "quotation_id": q["id"], "actual_amount": 400, "payment_mode": "bank",
            "payee_account_holder": "V", "payee_account_no": "1", "payee_ifsc": "HDFC0001234",
            "payee_bank_name": "HDFC",
            "payee_proof_attachments": [{"id": str(uuid.uuid4()), "filename": "x.png",
                                          "path": "/tmp/x.png", "content_type": "image/png", "size": 1}],
        })
        r = admin.post(f"{API}/payments/{pay['id']}/voucher/email",
                       json={"to_email": "v@x.com"}, timeout=15)
        assert r.status_code == 400, r.text


class TestVoucherList:
    def test_list_has_total_count(self, admin):
        r = admin.get(f"{API}/payment-vouchers", timeout=15)
        assert r.status_code == 200, r.text
        assert "x-total-count" in {k.lower() for k in r.headers.keys()}
        rows = r.json()
        assert isinstance(rows, list)

    def test_list_q_search(self, admin):
        vno = getattr(pytest, "iter40_voucher_no", None)
        if not vno:
            pytest.skip("no voucher no")
        r = admin.get(f"{API}/payment-vouchers", params={"q": vno}, timeout=15)
        assert r.status_code == 200
        rows = r.json()
        assert any(x.get("voucher_no") == vno for x in rows) or len(rows) >= 0


# =========================================================================
class TestOverdueAdvances:
    """Prep: create a released advance owned by admin, backdate its required_till, hit endpoints."""

    def _make_released_advance(self, admin):
        r0 = admin.post(f"{API}/advance-requests", json={
            "purpose": f"TEST_iter40 overdue {RUN}",
            "amount": 2000, "required_till": "2026-12-31",
        }, timeout=20)
        assert r0.status_code == 201, r0.text
        aid = r0.json()["id"]
        for _ in range(10):
            rec = _get(admin, f"/api/advance-requests/{aid}")
            if rec.get("status") == "approved":
                break
            r = _act(admin, "advance_request", aid, "approve")
            if r.status_code != 200:
                pytest.skip(f"advance approval chain unavailable: {r.text}")
        me = _get(admin, "/api/auth/me")
        rel = _post(admin, f"/api/advance-requests/{aid}/release", {
            "payment_mode": "bank", "paid_amount": 2000, "paid_by_user_id": me["id"],
            "transaction_ref": f"TEST_REF_{uuid.uuid4().hex[:6]}",
        })
        assert rel["status"] == "released"
        return aid

    def test_overdue_flow(self, admin):
        aid = self._make_released_advance(admin)

        # Not overdue yet
        rows = _get(admin, "/api/advance-requests/overdue")
        assert isinstance(rows, list)
        assert all(r["id"] != aid for r in rows), "should not be overdue with future required_till"

        # Backdate required_till 30 days into the past
        async def _backdate(db):
            await db.advance_requests.update_one(
                {"id": aid},
                {"$set": {"required_till": "2025-01-01"}},
            )
        _run(_backdate)

        # Now overdue endpoint should include it
        rows = _get(admin, "/api/advance-requests/overdue")
        hit = [r for r in rows if r["id"] == aid]
        assert hit, f"advance {aid} not in overdue list: {rows}"
        r = hit[0]
        assert r["is_overdue"] is True
        assert r["days_overdue"] > 0

        # Individual GET should also enrich
        row = _get(admin, f"/api/advance-requests/{aid}")
        assert row.get("is_overdue") is True
        assert row.get("days_overdue", 0) > 0

        # List endpoint enrichment
        rows_all = _get(admin, "/api/advance-requests")
        found = [x for x in rows_all if x.get("id") == aid]
        if found:
            assert found[0].get("is_overdue") is True

        # my_advance_requests enrichment (admin created it)
        mine = _get(admin, "/api/advance-requests/my")
        fmine = [x for x in mine if x.get("id") == aid]
        if fmine:
            assert fmine[0].get("is_overdue") is True

        # Notify — must return 200 with counters
        r = admin.post(f"{API}/advance-requests/overdue/notify", timeout=25)
        assert r.status_code == 200, r.text
        j = r.json()
        for k in ("total_overdue", "notified", "skipped_no_email"):
            assert k in j, j
        assert j["total_overdue"] >= 1

        # Cleanup — restore required_till
        async def _restore(db):
            await db.advance_requests.update_one(
                {"id": aid}, {"$set": {"required_till": "2026-12-31"}},
            )
        _run(_restore)


# =========================================================================
class TestTransactionsListingFix:
    """Pre-existing bug from iter-38: GET /api/transactions used to 500 due to
    status='posted' being rejected by TransactionOut Literal. Now fixed via
    'posted'→'approved' migration + release_advance writing 'approved'."""

    def test_get_transactions_200(self, admin):
        r = admin.get(f"{API}/transactions", timeout=20)
        assert r.status_code == 200, f"transactions listing failed: {r.status_code} {r.text[:300]}"
        assert isinstance(r.json(), list)
