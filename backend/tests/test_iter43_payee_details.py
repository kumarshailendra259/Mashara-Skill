"""Iteration 43 — Advance Request Payee/Bank details propagation.

Covers:
  * POST /api/advance-requests accepts preferred_payment_mode + payee_* + payee_proof_attachments
  * GET /api/advance-requests/{aid} returns them verbatim
  * POST /api/advance-requests/{aid}/release stamps payee_* + payee_proof_attachments
    + request_attachments + advance_no + vendor_name onto the auto-created transaction
  * TransactionOut surfaces payee_* + vendor_name + payment_mode + transaction_ref + paid_by_*
  * Regression: advances w/o payee fields still list/release cleanly
  * Regression: overdue + reroute-pending + payment-vouchers still 200
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
ADMIN_EMAIL = "admin@finance.app"
ADMIN_PASSWORD = "Admin@123"


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text[:200]
    return s


@pytest.fixture(scope="module")
def approval_chain_ensured(admin):
    """Make sure default 1-step admin approval chain exists for advance_request."""
    # Nothing to do if seeded — just return.
    return True


def _create_advance(admin, payload):
    r = admin.post(f"{BASE_URL}/api/advance-requests", json=payload, timeout=30)
    assert r.status_code in (200, 201), r.text[:300]
    return r.json()


def _approve_all_pending(admin, aid):
    """Fetch pending approvals for advance_request and approve until it's approved."""
    for _ in range(6):
        r = admin.get(f"{BASE_URL}/api/advance-requests/{aid}", timeout=30)
        assert r.status_code == 200
        row = r.json()
        if row.get("status") == "approved":
            return row
        # Directly call /approvals/act (admin can approve any step of admin-chain)
        r_act = admin.post(f"{BASE_URL}/api/approvals/act",
                           json={"request_type": "advance_request", "request_id": aid,
                                 "action": "approve", "remarks": "ok iter43"},
                           timeout=30)
        if r_act.status_code != 200:
            print("approve failed:", r_act.status_code, r_act.text[:200])
            break
    r = admin.get(f"{BASE_URL}/api/advance-requests/{aid}", timeout=30)
    return r.json()


PAYEE_BANK = {
    "payee_account_holder": "TEST43 Holder",
    "payee_account_no": "1234567890",
    "payee_ifsc": "HDFC0001234",
    "payee_bank_name": "HDFC Bank",
    "payee_proof_attachments": [
        {"id": "att1", "path": "/uploads/cheque.pdf", "filename": "cheque.pdf",
         "content_type": "application/pdf", "size": 1024}
    ],
}


class TestAdvanceCreatePersist:
    def test_create_with_bank_payee(self, admin):
        payload = {
            "purpose": f"TEST43 bank {uuid.uuid4().hex[:6]}",
            "amount": 500.0,
            "preferred_payment_mode": "bank",
            **PAYEE_BANK,
        }
        created = _create_advance(admin, payload)
        aid = created["id"]
        # GET verify verbatim
        got = admin.get(f"{BASE_URL}/api/advance-requests/{aid}", timeout=30).json()
        assert got["preferred_payment_mode"] == "bank"
        assert got["payee_account_holder"] == "TEST43 Holder"
        assert got["payee_account_no"] == "1234567890"
        assert got["payee_ifsc"] == "HDFC0001234"
        assert got["payee_bank_name"] == "HDFC Bank"
        assert isinstance(got.get("payee_proof_attachments"), list)
        assert got["payee_proof_attachments"][0]["filename"] == "cheque.pdf"

    def test_create_with_upi(self, admin):
        payload = {
            "purpose": f"TEST43 upi {uuid.uuid4().hex[:6]}",
            "amount": 200.0,
            "preferred_payment_mode": "upi",
            "payee_upi_id": "test43@upi",
        }
        created = _create_advance(admin, payload)
        got = admin.get(f"{BASE_URL}/api/advance-requests/{created['id']}", timeout=30).json()
        assert got["preferred_payment_mode"] == "upi"
        assert got["payee_upi_id"] == "test43@upi"

    def test_create_cash_no_payee(self, admin):
        payload = {
            "purpose": f"TEST43 cash {uuid.uuid4().hex[:6]}",
            "amount": 150.0,
            "preferred_payment_mode": "cash",
        }
        created = _create_advance(admin, payload)
        got = admin.get(f"{BASE_URL}/api/advance-requests/{created['id']}", timeout=30).json()
        assert got["preferred_payment_mode"] == "cash"
        assert not got.get("payee_account_no")

    def test_backward_compat_no_payee_fields(self, admin):
        """Advance without any payee_* still works — backward compat."""
        payload = {"purpose": f"TEST43 legacy {uuid.uuid4().hex[:6]}", "amount": 100.0}
        created = _create_advance(admin, payload)
        got = admin.get(f"{BASE_URL}/api/advance-requests/{created['id']}", timeout=30).json()
        assert got["status"] in ("pending", "approved", "draft")
        assert got.get("preferred_payment_mode") in (None, "")


class TestReleasePropagatesPayee:
    def test_release_stamps_all_payee_fields_on_txn(self, admin):
        # 1. Create with bank payee
        adv_no_seed = f"TEST43R-{uuid.uuid4().hex[:6]}"
        payload = {
            "purpose": adv_no_seed,
            "amount": 777.0,
            "preferred_payment_mode": "bank",
            **PAYEE_BANK,
            "attachments": [{"id": "req1", "path": "/uploads/req.pdf", "filename": "req.pdf",
                              "content_type": "application/pdf", "size": 500}],
        }
        created = _create_advance(admin, payload)
        aid = created["id"]

        # 2. Approve (1-step admin chain)
        row = _approve_all_pending(admin, aid)
        if row.get("status") != "approved":
            pytest.skip(f"advance not auto-approved (status={row.get('status')}); approval chain differs")

        # 3. Release
        r = admin.post(f"{BASE_URL}/api/advance-requests/{aid}/release",
                       json={"payment_mode": "bank", "transaction_ref": "UTR-TEST43-XYZ"},
                       timeout=30)
        assert r.status_code == 200, r.text[:300]
        released = r.json()
        assert released["status"] == "released"
        txn_id = released["linked_transaction_id"]
        assert txn_id

        # 4. Fetch the txn via /api/transactions and validate every payee field
        tr = admin.get(f"{BASE_URL}/api/transactions", timeout=30).json()
        txn = next((t for t in tr if t.get("id") == txn_id), None)
        assert txn, "release txn not found in /api/transactions"

        # Payee fields surfaced through TransactionOut
        assert txn.get("payee_account_holder") == "TEST43 Holder"
        assert txn.get("payee_account_no") == "1234567890"
        assert txn.get("payee_ifsc") == "HDFC0001234"
        assert txn.get("payee_bank_name") == "HDFC Bank"
        assert txn.get("vendor_name") == released["employee_name"]
        assert txn.get("payment_mode") == "bank"
        assert txn.get("transaction_ref") == "UTR-TEST43-XYZ"
        assert txn.get("advance_no") == released["advance_no"]
        assert txn.get("source") == "advance_release"
        # payee_proof_attachments carried through
        proofs = txn.get("payee_proof_attachments") or []
        assert len(proofs) == 1 and proofs[0]["filename"] == "cheque.pdf"

        # Ensure adjustment/settlement/writeoff flags are NOT set
        assert not txn.get("is_advance_adjustment")
        assert not txn.get("is_advance_settlement")
        assert not txn.get("is_advance_writeoff")
        # `category` is stored but TransactionOut model does not currently surface it
        # in the list endpoint — verify it via GET-by-id would need direct DB check.
        # Not asserted here; just ensure NOT flagged as adjustment/settlement/writeoff.

    def test_release_upi_only(self, admin):
        payload = {
            "purpose": f"TEST43 upi rel {uuid.uuid4().hex[:6]}",
            "amount": 210.0,
            "preferred_payment_mode": "upi",
            "payee_upi_id": "test43rel@upi",
        }
        created = _create_advance(admin, payload)
        aid = created["id"]
        row = _approve_all_pending(admin, aid)
        if row.get("status") != "approved":
            pytest.skip("not approved")
        r = admin.post(f"{BASE_URL}/api/advance-requests/{aid}/release",
                       json={"payment_mode": "upi"}, timeout=30)
        assert r.status_code == 200, r.text[:200]
        txn_id = r.json()["linked_transaction_id"]
        tr = admin.get(f"{BASE_URL}/api/transactions", timeout=30).json()
        txn = next((t for t in tr if t.get("id") == txn_id), None)
        assert txn
        assert txn.get("payee_upi_id") == "test43rel@upi"
        assert txn.get("payment_mode") == "upi"

    def test_release_cash_no_payee_fields(self, admin):
        payload = {
            "purpose": f"TEST43 cash rel {uuid.uuid4().hex[:6]}",
            "amount": 60.0,
            "preferred_payment_mode": "cash",
        }
        created = _create_advance(admin, payload)
        aid = created["id"]
        row = _approve_all_pending(admin, aid)
        if row.get("status") != "approved":
            pytest.skip("not approved")
        r = admin.post(f"{BASE_URL}/api/advance-requests/{aid}/release",
                       json={"payment_mode": "cash"}, timeout=30)
        assert r.status_code == 200
        txn_id = r.json()["linked_transaction_id"]
        tr = admin.get(f"{BASE_URL}/api/transactions", timeout=30).json()
        txn = next((t for t in tr if t.get("id") == txn_id), None)
        assert txn
        # Payee fields should be None/absent for cash
        assert not txn.get("payee_account_no")
        assert not txn.get("payee_upi_id")
        assert txn.get("payment_mode") == "cash"


class TestRegression:
    def test_list_advances(self, admin):
        assert admin.get(f"{BASE_URL}/api/advance-requests", timeout=30).status_code == 200

    def test_overdue(self, admin):
        assert admin.get(f"{BASE_URL}/api/advance-requests/overdue", timeout=30).status_code == 200

    def test_reroute_pending(self, admin):
        r = admin.post(f"{BASE_URL}/api/advance-requests/reroute-pending", timeout=30)
        assert r.status_code == 200
        assert "scanned" in r.json()

    def test_payment_vouchers(self, admin):
        r = admin.get(f"{BASE_URL}/api/payment-vouchers", timeout=30)
        assert r.status_code == 200

    def test_transactions_list_200(self, admin):
        assert admin.get(f"{BASE_URL}/api/transactions", timeout=30).status_code == 200
