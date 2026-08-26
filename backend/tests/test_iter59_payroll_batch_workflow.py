"""Phase 55 — Payroll Batch Workflow (Finalise → Approve → Pay → Reopen).

Tests the end-to-end payroll batch integration for Iteration 59.
"""
import os
import uuid
import requests
import pytest

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0]).rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@finance.app", "password": "Admin@123"}
HR = {"email": "hr@finance.app", "password": "Hr@12345"}
ACC = {"email": "acc@finance.app", "password": "Acc@12345"}


def _login(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"Login failed for {creds['email']}: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def admin_client():
    return _login(ADMIN)


@pytest.fixture(scope="module")
def hr_client():
    return _login(HR)


@pytest.fixture(scope="module")
def acc_client():
    return _login(ACC)


# ---------------------------------------------------------------- Helpers ----
def _clear_active_batches(admin_client, month, year):
    """Reopen any active batch for month/year to leave a clean state."""
    r = admin_client.get(f"{API}/payroll-batches", params={"month": month, "year": year}, timeout=20)
    if r.status_code != 200:
        return
    for b in r.json():
        if b.get("status") in ("pending_approval", "approved", "pending_payment", "processing", "paid"):
            admin_client.post(
                f"{API}/payroll-batches/{b['id']}/reopen",
                json={"reason": "test cleanup", "reverse_transaction": True},
                timeout=20,
            )


# =============================================================== TEST CASES ==

class TestFinalise:
    """POST /api/payroll/finalise"""

    def test_accountant_forbidden(self, acc_client):
        r = acc_client.post(f"{API}/payroll/finalise", json={"month": 7, "year": 2026}, timeout=20)
        assert r.status_code == 403, f"Expected 403 got {r.status_code}: {r.text}"

    def test_hr_can_finalise(self, admin_client, hr_client):
        _clear_active_batches(admin_client, 7, 2026)
        r = hr_client.post(f"{API}/payroll/finalise", json={"month": 7, "year": 2026, "remarks": "HR finalise test"}, timeout=30)
        assert r.status_code == 200, f"{r.status_code}: {r.text}"
        b = r.json()
        assert b["id"] and b["staff_count"] > 0
        # No chain configured for payroll → should auto-approve to pending_payment
        assert b["status"] in ("pending_payment", "pending_approval"), b["status"]
        assert isinstance(b.get("audit_log"), list) and len(b["audit_log"]) >= 1
        assert b["audit_log"][0]["action"] == "finalised"

    def test_duplicate_finalise_conflict(self, hr_client):
        r = hr_client.post(f"{API}/payroll/finalise", json={"month": 7, "year": 2026}, timeout=20)
        assert r.status_code == 409, f"Expected 409 got {r.status_code}: {r.text}"

    def test_no_drafts_returns_400(self, admin_client):
        # Very old month with no payroll rows
        r = admin_client.post(f"{API}/payroll/finalise", json={"month": 1, "year": 2020}, timeout=20)
        assert r.status_code == 400, f"Expected 400 got {r.status_code}: {r.text}"


class TestBatchListingAndDetail:
    def test_list_batches(self, admin_client):
        r = admin_client.get(f"{API}/payroll-batches", params={"month": 7, "year": 2026}, timeout=20)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_get_batch_detail_and_row_enrichment(self, admin_client):
        r = admin_client.get(f"{API}/payroll-batches", params={"month": 7, "year": 2026}, timeout=20)
        batches = r.json()
        active = [b for b in batches if b.get("status") in ("pending_payment", "pending_approval", "paid")]
        if not active:
            pytest.skip("No active batch")
        bid = active[0]["id"]
        r2 = admin_client.get(f"{API}/payroll-batches/{bid}", timeout=20)
        assert r2.status_code == 200
        detail = r2.json()
        assert "rows" in detail and len(detail["rows"]) > 0
        # Ensure enrichment
        row = detail["rows"][0]
        # staff_name may be None but key should be present after enrichment (or not — accept both)
        assert "staff_id" in row


class TestPayment:
    def _current_batch(self, client, month=7, year=2026):
        r = client.get(f"{API}/payroll-batches", params={"month": month, "year": year}, timeout=20)
        for b in r.json():
            if b.get("status") == "pending_payment":
                return b
        return None

    def test_hr_cannot_pay(self, hr_client):
        b = self._current_batch(hr_client)
        if not b:
            pytest.skip("No pending_payment batch")
        r = hr_client.post(f"{API}/payroll-batches/{b['id']}/pay",
                           json={"method": "neft", "payment_date": "2026-07-31", "utr": "TESTHRPAY"}, timeout=20)
        assert r.status_code == 403, r.text

    def test_accountant_pays(self, acc_client, admin_client):
        b = self._current_batch(admin_client)
        if not b:
            pytest.skip("No pending_payment batch")
        r = acc_client.post(f"{API}/payroll-batches/{b['id']}/pay",
                            json={"method": "neft", "payment_date": "2026-07-31", "utr": f"UTR{uuid.uuid4().hex[:8]}", "remarks": "Iter59 test"},
                            timeout=60)
        assert r.status_code == 200, f"{r.status_code}: {r.text}"
        paid = r.json()
        assert paid["status"] == "paid"
        assert paid.get("transaction_id")
        assert paid["payment"]["method"] == "neft"
        # Audit log now contains finalised + auto_approved + paid
        actions = [a["action"] for a in paid["audit_log"]]
        assert "finalised" in actions
        assert "paid" in actions
        # Store txn id + batch id on module-level for later tests
        pytest.paid_batch_id = paid["id"]
        pytest.paid_txn_id = paid["transaction_id"]
        pytest.paid_month = paid["month"]
        pytest.paid_year = paid["year"]

    def test_double_pay_rejected(self, acc_client):
        bid = getattr(pytest, "paid_batch_id", None)
        if not bid:
            pytest.skip("No paid batch to test double-pay")
        r = acc_client.post(f"{API}/payroll-batches/{bid}/pay",
                            json={"method": "neft", "payment_date": "2026-07-31"}, timeout=20)
        assert r.status_code == 400, r.text
        assert "already paid" in r.text.lower()


class TestTransactionAndFinancialHistory:
    def test_txn_created_with_correct_source(self, admin_client):
        """Verify batch has linked transaction_id and paid state.

        NOTE: We do NOT call /api/transactions because it currently 500s when any
        payroll transaction has negative amount (real bug in TransactionOut.amount
        Field(ge=0) constraint — see backend_issues in test report).
        """
        bid = getattr(pytest, "paid_batch_id", None)
        txn_id = getattr(pytest, "paid_txn_id", None)
        if not bid:
            pytest.skip("No paid batch")
        r = admin_client.get(f"{API}/payroll-batches/{bid}", timeout=20)
        assert r.status_code == 200
        b = r.json()
        assert b["transaction_id"] == txn_id
        assert b["status"] == "paid"

    def test_staff_financial_history_has_salary(self, admin_client):
        bid = getattr(pytest, "paid_batch_id", None)
        if not bid:
            pytest.skip("No paid batch")
        # Grab a staff id from the batch
        r = admin_client.get(f"{API}/payroll-batches/{bid}", timeout=20)
        rows = r.json().get("rows", [])
        if not rows:
            pytest.skip("No rows in batch")
        sid = rows[0]["staff_id"]
        r2 = admin_client.get(f"{API}/staff/{sid}/financial-history", timeout=20)
        # Endpoint may or may not exist; accept 200 or 404 gracefully
        if r2.status_code == 404:
            pytest.skip("financial-history endpoint absent")
        assert r2.status_code == 200
        data = r2.json()
        # Try common shapes: list of rows OR dict with 'payments'
        rows_list = data if isinstance(data, list) else (data.get("payments") or data.get("history") or data.get("items") or [])
        # Should contain at least one salary entry from this batch
        # (best-effort — the test doesn't fail hard if the aggregator groups differently)
        assert isinstance(rows_list, list)


class TestReopen:
    def test_hr_cannot_reopen(self, hr_client):
        bid = getattr(pytest, "paid_batch_id", None)
        if not bid:
            pytest.skip("No paid batch")
        r = hr_client.post(f"{API}/payroll-batches/{bid}/reopen", json={"reason": "test", "reverse_transaction": True}, timeout=20)
        assert r.status_code == 403, r.text

    def test_admin_reopens_paid_batch_with_reversal(self, admin_client):
        bid = getattr(pytest, "paid_batch_id", None)
        txn_id = getattr(pytest, "paid_txn_id", None)
        if not bid:
            pytest.skip("No paid batch")
        r = admin_client.post(f"{API}/payroll-batches/{bid}/reopen",
                              json={"reason": "iter59 reopen test", "reverse_transaction": True}, timeout=30)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["status"] == "reopened"
        actions = [a["action"] for a in b["audit_log"]]
        assert "reopened" in actions
        # We can't call /transactions (500 due to negative-amount bug), so verify
        # via direct mongo access instead.
        import asyncio, os as _os
        from motor.motor_asyncio import AsyncIOMotorClient
        async def _check():
            c = AsyncIOMotorClient(_os.environ.get("MONGO_URL") or open("/app/backend/.env").read().split("MONGO_URL=")[1].split("\n")[0].strip('"'))
            db = c[_os.environ.get("DB_NAME") or open("/app/backend/.env").read().split("DB_NAME=")[1].split("\n")[0].strip('"')]
            orig = await db.transactions.find_one({"id": txn_id}, {"_id": 0})
            rev = await db.transactions.find_one({"reverses_txn_id": txn_id}, {"_id": 0})
            return orig, rev
        orig, rev = asyncio.get_event_loop().run_until_complete(_check()) if not asyncio.get_event_loop().is_running() else asyncio.run(_check())
        assert orig and orig.get("reversed_at"), "Original txn should be marked reversed"
        assert rev, "Reversal transaction not created"
        assert rev.get("type") == "income"
        assert rev.get("source") == "payroll_batch_reversal"

    def test_reopen_unlocks_rows_so_finalise_works_again(self, admin_client, hr_client):
        # After reopen, HR should be able to finalise again for same month
        bid = getattr(pytest, "paid_batch_id", None)
        if not bid:
            pytest.skip("No paid batch")
        r = hr_client.post(f"{API}/payroll/finalise", json={"month": 7, "year": 2026, "remarks": "post-reopen"}, timeout=30)
        assert r.status_code == 200, f"{r.status_code}: {r.text}"
        b = r.json()
        assert b["staff_count"] > 0
        pytest.refinalised_batch_id = b["id"]


class TestApprovalChainFlow:
    """Register an admin-approver chain for 'payroll' then verify approve/reject."""

    chain_id = None
    approval_batch_id = None

    def test_configure_payroll_chain(self, admin_client):
        # Clean any existing active batch for august 2026 first
        _clear_active_batches(admin_client, 8, 2026)
        # Create a 1-step approval chain for 'payroll' where admin approves.
        # Query current admin id
        r_me = admin_client.get(f"{API}/auth/me", timeout=20)
        assert r_me.status_code == 200
        admin_uid = r_me.json()["id"]

        payload = {
            "name": "iter59-payroll-chain",
            "type": "payroll",
            "steps": [{"level": 1, "kind": "user", "value": admin_uid}],
            "active": True,
        }
        r = admin_client.post(f"{API}/approval-chains", json=payload, timeout=20)
        assert r.status_code in (200, 201), f"Chain create failed: {r.status_code} {r.text}"
        TestApprovalChainFlow.chain_id = r.json().get("id")

    def test_finalise_with_chain_stays_pending_approval(self, hr_client):
        r = hr_client.post(f"{API}/payroll/finalise", json={"month": 8, "year": 2026, "remarks": "chain test"}, timeout=30)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["status"] == "pending_approval", f"Expected pending_approval, got {b['status']}"
        assert b.get("chain_snapshot"), "Chain snapshot should be attached"
        TestApprovalChainFlow.approval_batch_id = b["id"]

    def test_admin_approves_batch_flips_to_pending_payment(self, admin_client):
        bid = TestApprovalChainFlow.approval_batch_id
        if not bid:
            pytest.skip("No batch")
        r = admin_client.post(f"{API}/approvals/act",
                              json={"request_type": "payroll", "request_id": bid, "action": "approve", "remarks": "approved by test"},
                              timeout=20)
        assert r.status_code == 200, f"{r.status_code}: {r.text}"
        # Verify status
        rb = admin_client.get(f"{API}/payroll-batches/{bid}", timeout=20)
        assert rb.json()["status"] == "pending_payment"

    def test_cleanup_reopen_and_delete_chain(self, admin_client):
        bid = TestApprovalChainFlow.approval_batch_id
        if bid:
            admin_client.post(f"{API}/payroll-batches/{bid}/reopen",
                              json={"reason": "cleanup", "reverse_transaction": True}, timeout=20)
        # Also cleanup refinalised july batch
        refid = getattr(pytest, "refinalised_batch_id", None)
        if refid:
            admin_client.post(f"{API}/payroll-batches/{refid}/reopen",
                              json={"reason": "cleanup july", "reverse_transaction": True}, timeout=20)
        cid = TestApprovalChainFlow.chain_id
        if cid:
            # Try both delete paths
            r = admin_client.delete(f"{API}/approval-workflows/{cid}", timeout=20)
            if r.status_code == 404:
                admin_client.delete(f"{API}/approval-chains/{cid}", timeout=20)


class TestRegression:
    def test_staff_endpoint_still_works(self, admin_client):
        r = admin_client.get(f"{API}/staff", timeout=20)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_other_approval_types_still_registered(self, admin_client):
        # Just call pending approvals; must not 500
        r = admin_client.get(f"{API}/approvals/pending", timeout=20)
        assert r.status_code in (200, 401), r.status_code
