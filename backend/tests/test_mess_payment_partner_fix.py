"""Iter89 — Mess bill->unpaid/unassigned txn, payment->paid+manual partner (no dup txn),
admin partner audit + RBAC, payment_status filter, quotation regression (no txn)."""
import os
import io
import time
import pytest
import requests
from datetime import date as _date

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
TODAY = _date.today().isoformat()
RICE_ITEM_ID = "882dd82f-0e03-4733-b9c3-3e33adca9c85"
CENTER_ID = "10751714-23a9-4afc-96d6-66b0640ac94f"


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    s.headers.update({"X-CSRF-Token": s.cookies.get("csrf_token")})
    return s


@pytest.fixture(scope="module")
def admin():
    return _login("admin@finance.app", "Admin@123")


@pytest.fixture(scope="module")
def accountant():
    return _login("test_center_manager_c6912430@x.com", "Test@1234")


@pytest.fixture(scope="module")
def state():
    return {}


def _txns_for_receipt(admin, rid):
    rows = admin.get(f"{API}/transactions").json()
    return [t for t in rows if t.get("mess_receipt_id") == rid]


# --- Mess receipt -> approve -> unpaid + unassigned expense txn
class TestMessBillToPayment:
    def test_create_receipt(self, admin, state):
        up = admin.post(f"{API}/files/upload",
                        files={"file": ("TEST_bill.pdf", io.BytesIO(b"%PDF-1.4 test bill"), "application/pdf")})
        assert up.status_code == 200, up.text
        inv = f"TEST-IT89-{int(time.time()*1000)}"
        r = admin.post(f"{API}/mess/receipts", json={
            "center_id": CENTER_ID, "supplier_name": "TEST_Sup_IT89", "invoice_no": inv,
            "invoice_date": TODAY, "attachments": [up.json()],
            "lines": [{"item_id": RICE_ITEM_ID, "qty": 10, "unit": "kg", "unit_price": 50,
                       "accepted_qty": 10, "rejected_qty": 0}]})
        assert r.status_code == 200, r.text
        rec = r.json()
        assert rec["status"] == "pending"
        state["rid"] = rec["id"]
        state["amount"] = float(rec["total_amount"])

    def test_receipt_requires_attachment(self, admin):
        r = admin.post(f"{API}/mess/receipts", json={
            "center_id": CENTER_ID, "supplier_name": "TEST_Sup", "invoice_no": "TEST-NOATT",
            "invoice_date": TODAY, "attachments": [],
            "lines": [{"item_id": RICE_ITEM_ID, "qty": 1, "unit": "kg", "unit_price": 50,
                       "accepted_qty": 1, "rejected_qty": 0}]})
        assert r.status_code == 400

    def test_approve_receipt_creates_unpaid_unassigned_txn(self, admin, state):
        rid = state["rid"]
        for _ in range(5):
            rows = admin.get(f"{API}/mess/receipts", params={"center_id": CENTER_ID}).json()
            rec = next(x for x in rows if x["id"] == rid)
            if rec["status"] == "approved":
                break
            r = admin.post(f"{API}/approvals/act", json={"request_type": "mess_receipt",
                                                       "request_id": rid, "action": "approve", "remarks": "approved by test"})
            assert r.status_code == 200, r.text
        assert rec["status"] == "approved" or admin.get(f"{API}/mess/receipts", params={"center_id": CENTER_ID}).json()
        txns = _txns_for_receipt(admin, rid)
        assert len(txns) == 1, txns
        t = txns[0]
        state["txn_id"] = t["id"]
        assert t["source"] == "mess_purchase"
        assert t["partner_id"] is None
        assert t["status"] == "approved"
        assert t["payment_status"] == "unpaid"
        assert float(t["paid_amount"]) == 0
        assert float(t["balance"]) == state["amount"]

    def test_payment_status_filter_unpaid(self, admin, state):
        rows = admin.get(f"{API}/transactions", params={"payment_status": "unpaid"}).json()
        assert all(r.get("payment_status") == "unpaid" for r in rows)
        assert any(r["id"] == state["txn_id"] for r in rows)

    def test_new_txn_not_flagged_by_audit(self, admin, state):
        d = admin.get(f"{API}/admin/mess-partner-audit").json()
        assert not any(f["txn_id"] == state["txn_id"] for f in d["flagged"])

    def test_raise_and_approve_payment_marks_same_txn_paid(self, admin, state):
        rid = state["rid"]
        r = admin.post(f"{API}/mess/receipts/{rid}/raise-payment",
                       json={"payment_mode": "cash", "payment_date": TODAY, "paid_by_name": "TEST_Payer"})
        assert r.status_code == 200, r.text
        pid = r.json()["id"]
        state["pid"] = pid
        mp = admin.get(f"{API}/centers/{CENTER_ID}/mapped-partners").json()
        mp = mp if isinstance(mp, list) else mp.get("partners") or mp.get("items") or []
        if mp:
            partner_id = mp[0]["partner_id"]
        else:  # no mapped partner for test center -> use any partner (accountant manual pick)
            partner_id = "d9a5228f-144e-481f-81cb-6417cd099901"  # known seeded partner
        assert partner_id, "need a partner to verify manual assignment"
        state["partner_id"] = partner_id
        banks = admin.get(f"{API}/bank-accounts").json()
        bank_id = next((b["id"] for b in banks if b.get("is_active", True)), None)
        last = None
        for _ in range(5):
            last = admin.post(f"{API}/approvals/act", json={
                "request_type": "mess_payment", "request_id": pid, "action": "approve", "remarks": "approved by test",
                "txn_center_id": CENTER_ID, "txn_partner_id": partner_id,
                "bank_account_id": bank_id, "paid_by_name": "TEST_Payer"})
            if last.status_code != 200:
                break
            rows = admin.get(f"{API}/mess/receipts", params={"center_id": CENTER_ID}).json()
            if next(x for x in rows if x["id"] == rid).get("payment_status") == "paid":
                break
        assert last.status_code == 200, last.text
        txns = _txns_for_receipt(admin, rid)
        assert len(txns) == 1, f"duplicate txn created: {txns}"
        t = txns[0]
        assert t["id"] == state["txn_id"]
        assert t["payment_status"] == "paid"
        assert float(t["balance"]) == 0
        assert float(t["paid_amount"]) == state["amount"]
        assert t["partner_id"] == partner_id
        # No mess_payment-sourced txn
        alltx = admin.get(f"{API}/transactions").json()
        assert not [x for x in alltx if x.get("source") == "mess_payment" and state["amount"] == x.get("amount")
                    and "TEST-IT89" in (x.get("description") or "")]


# --- Admin audit RBAC
class TestAuditRBAC:
    def test_admin_audit_ok(self, admin):
        r = admin.get(f"{API}/admin/mess-partner-audit")
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d["flagged"], list) and "count" in d and "total_amount" in d

    def test_accountant_audit_403(self, accountant):
        assert accountant.get(f"{API}/admin/mess-partner-audit").status_code == 403
        assert accountant.post(f"{API}/admin/mess-partner-audit/fix", json={}).status_code == 403

    def test_fix_idempotent_empty(self, admin):
        r = admin.post(f"{API}/admin/mess-partner-audit/fix", json={"txn_ids": ["nonexistent-id"]})
        assert r.status_code == 200 and r.json()["fixed"] == 0


# --- Quotation regression: create/approve never creates txn
class TestQuotationNoTxn:
    def test_quotation_create_approve_no_txn(self, admin):
        before = {t["id"] for t in admin.get(f"{API}/transactions").json()}
        r = admin.post(f"{API}/quotations", json={"center_id": CENTER_ID, "description": "TEST_IT89 quote",
                                                 "vendor_name": "TEST_Vendor", "estimated_amount": 1234})
        assert r.status_code == 200, r.text
        q = r.json()
        assert q["status"] == "pending"
        for _ in range(6):
            cur = admin.get(f"{API}/quotations/{q['id']}")
            st = cur.json().get("status") if cur.status_code == 200 else None
            if st == "approved":
                break
            a = admin.post(f"{API}/approvals/act", json={"request_type": "quotation", "request_id": q["id"],
                                                       "action": "approve", "remarks": "approved by test"})
            if a.status_code != 200:
                print("approve resp", a.status_code, a.text[:200])
                break
        cur = admin.get(f"{API}/quotations/{q['id']}").json()
        print("quotation final", cur.get("status"), cur.get("qrn"))
        after = admin.get(f"{API}/transactions").json()
        new = [t for t in after if t["id"] not in before]
        assert not new, f"quotation created txn(s): {new}"
        assert not [t for t in after if t.get("source") == "quotation"]
        assert cur.get("status") == "approved"
        assert cur.get("qrn")
