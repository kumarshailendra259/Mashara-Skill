"""Mess Phase 2 — approval-chain integration, raise-payment, bill PDF, templates, RBAC."""
import os
import io
import time
import pytest
import requests
from datetime import date as _date

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://invest-analytics-24.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
TODAY = _date.today().isoformat()

RICE_ITEM_ID = "882dd82f-0e03-4733-b9c3-3e33adca9c85"  # per agent context
CENTER_ID    = "10751714-23a9-4afc-96d6-66b0640ac94f"  # per agent context (LPEKKN)


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    csrf = s.cookies.get("csrf_token")
    assert csrf, "no csrf_token cookie set after login"
    s.headers.update({"X-CSRF-Token": csrf})
    return s, r.json()


@pytest.fixture(scope="module")
def admin():
    return _login("admin@finance.app", "Admin@123")[0]


@pytest.fixture(scope="module")
def cm():
    try:
        return _login("cmtest_salary@x.com", "Test@1234")[0]
    except Exception as e:
        pytest.skip(f"center_manager login failed: {e}")


# ---------------- Approval chain / defaults ----------------
class TestDefaultChains:
    def test_mess_receipt_chain_default(self, admin):
        r = admin.get(f"{API}/approval-chains", params={"type": "mess_receipt"})
        assert r.status_code == 200
        chains = [c for c in r.json() if c.get("type") == "mess_receipt" and c.get("active")]
        assert chains, "no active mess_receipt chain"
        steps = chains[0]["steps"]
        roles = [s.get("value") for s in steps]
        assert roles == ["center_manager", "senior_manager", "accountant"], roles

    def test_mess_payment_chain_default(self, admin):
        r = admin.get(f"{API}/approval-chains", params={"type": "mess_payment"})
        assert r.status_code == 200
        chains = [c for c in r.json() if c.get("type") == "mess_payment" and c.get("active")]
        assert chains, "no active mess_payment chain"
        steps = chains[0]["steps"]
        roles = [s.get("value") for s in steps]
        assert roles == ["senior_manager", "admin", "accountant"], roles


# ---------------- Receipt chain attach + pending_with + approvals/pending ----------------
@pytest.fixture(scope="module")
def new_receipt(admin):
    inv = f"TEST-P2-{int(time.time()*1000)}"
    payload = {
        "center_id": CENTER_ID, "supplier_name": f"TEST_Sup_{int(time.time())}",
        "invoice_no": inv, "invoice_date": TODAY,
        "lines": [{"item_id": RICE_ITEM_ID, "qty": 10, "unit": "kg",
                   "unit_price": 55, "accepted_qty": 10, "rejected_qty": 0}],
    }
    r = admin.post(f"{API}/mess/receipts", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


class TestReceiptChain:
    def test_receipt_attaches_chain(self, new_receipt):
        rec = new_receipt
        assert rec.get("status") == "pending"
        assert rec.get("current_level") == 1
        snap = rec.get("chain_snapshot") or []
        assert len(snap) == 3, f"expected 3-step snapshot, got {len(snap)}"

    def test_pending_approvals_inbox_shows_receipt(self, admin, new_receipt):
        r = admin.get(f"{API}/approvals/pending")
        assert r.status_code == 200
        items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        hit = [x for x in items if x.get("request_type") == "mess_receipt" and x.get("request_id") == new_receipt["id"]]
        assert hit, f"receipt {new_receipt['id']} not in pending approvals inbox"
        it = hit[0]
        assert it.get("step_label")
        # summary should carry amount/vendor-ish text
        summary_obj = it.get("summary") or {}
        if isinstance(summary_obj, dict):
            summary = " ".join(str(v) for v in summary_obj.values())
        else:
            summary = str(summary_obj)
        summary += " " + (it.get("purpose") or "") + " " + (it.get("description") or "")
        assert (new_receipt["invoice_no"] in summary
                or str(int(new_receipt["total_amount"])) in summary
                or (new_receipt.get("supplier_name") or "") in summary), f"summary: {summary}"

    def test_list_enriches_pending_with(self, admin, new_receipt):
        r = admin.get(f"{API}/mess/receipts", params={"center_id": CENTER_ID})
        assert r.status_code == 200
        rows = r.json()
        hit = next((x for x in rows if x.get("id") == new_receipt["id"]), None)
        assert hit, "receipt missing from list"
        # enrich_with_approval_status fields
        assert "pending_with" in hit or "current_step_label" in hit, f"keys: {list(hit.keys())}"


# ---------------- Approve through chain -> expense + stock ----------------
class TestApprovalFlow:
    def test_approve_through_chain_to_final(self, admin, new_receipt):
        rid = new_receipt["id"]
        # Step 1
        r = admin.post(f"{API}/approvals/act",
                       json={"request_type": "mess_receipt", "request_id": rid, "action": "approve", "remarks": "approved by test"})
        assert r.status_code == 200, r.text
        # Step 2
        r = admin.post(f"{API}/approvals/act",
                       json={"request_type": "mess_receipt", "request_id": rid, "action": "approve", "remarks": "approved by test"})
        assert r.status_code == 200, r.text
        # Step 3 (final) — triggers stock-in + finance expense
        r = admin.post(f"{API}/approvals/act",
                       json={"request_type": "mess_receipt", "request_id": rid, "action": "approve", "remarks": "approved by test"})
        assert r.status_code == 200, r.text

        # Verify receipt is approved + unpaid
        rows = admin.get(f"{API}/mess/receipts", params={"center_id": CENTER_ID}).json()
        rec = next((x for x in rows if x["id"] == rid), None)
        assert rec is not None
        assert rec["status"] == "approved", rec.get("status")
        assert rec["payment_status"] == "unpaid"
        assert rec.get("expense_txn_id"), "no expense_txn_id after final approval"

        # Verify finance txn created (source=mess_purchase)
        tx = admin.get(f"{API}/transactions", params={"source": "mess_purchase"}).json()
        rows2 = tx if isinstance(tx, list) else tx.get("transactions") or tx.get("items") or []
        found = [t for t in rows2 if new_receipt["invoice_no"] in (t.get("description") or "")]
        assert found, "mess expense txn not found"

    def test_bill_before_payment_404(self, admin, new_receipt):
        r = admin.get(f"{API}/mess/receipts/{new_receipt['id']}/bill")
        assert r.status_code == 404, f"bill should 404 before payment got {r.status_code}"


# ---------------- Payment: raise + chain + final => paid + PDF ----------------
class TestPaymentFlow:
    def test_raise_payment_attaches_mess_payment_chain(self, admin, new_receipt):
        r = admin.post(f"{API}/mess/receipts/{new_receipt['id']}/raise-payment",
                       json={"payment_mode": "bank_transfer",
                             "paid_by_name": "TEST_Payer",
                             "payment_date": TODAY,
                             "notes": "TEST raise"})
        assert r.status_code == 200, r.text
        pay = r.json()
        assert pay.get("current_level") == 1
        assert len(pay.get("chain_snapshot") or []) == 3
        pytest.mess_payment_id = pay["id"]

        # receipt payment_status now payment_pending
        rows = admin.get(f"{API}/mess/receipts", params={"center_id": CENTER_ID}).json()
        rec = next((x for x in rows if x["id"] == new_receipt["id"]), None)
        assert rec["payment_status"] == "payment_pending"

    def test_payment_visible_in_pending_approvals(self, admin):
        pid = pytest.mess_payment_id
        r = admin.get(f"{API}/approvals/pending")
        items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        hit = [x for x in items if x.get("request_type") == "mess_payment" and x.get("request_id") == pid]
        assert hit, f"mess_payment {pid} not in pending approvals"

    def test_approve_payment_to_final_marks_paid_and_generates_bill(self, admin, new_receipt):
        pid = pytest.mess_payment_id
        for i in range(3):
            r = admin.post(f"{API}/approvals/act",
                           json={"request_type": "mess_payment", "request_id": pid, "action": "approve", "remarks": "approved by test"})
            assert r.status_code == 200, f"step {i+1}: {r.text}"
        # Receipt should now be paid
        rows = admin.get(f"{API}/mess/receipts", params={"center_id": CENTER_ID}).json()
        rec = next((x for x in rows if x["id"] == new_receipt["id"]), None)
        assert rec["payment_status"] == "paid", rec.get("payment_status")
        assert rec.get("bill_pdf_path") or rec.get("bill_no"), f"bill not generated: {rec.keys()}"

    def test_download_bill_pdf(self, admin, new_receipt):
        time.sleep(1)  # bill upload latency
        r = admin.get(f"{API}/mess/receipts/{new_receipt['id']}/bill")
        assert r.status_code == 200, r.text[:200]
        ct = r.headers.get("content-type", "")
        assert "application/pdf" in ct, ct
        assert r.content[:4] == b"%PDF", "not a valid PDF"
        assert len(r.content) > 500, f"pdf too small ({len(r.content)} bytes)"


# ---------------- /mess/centers RBAC scope ----------------
class TestCentersScope:
    def test_admin_sees_all(self, admin):
        r = admin.get(f"{API}/mess/centers")
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        assert len(r.json()) >= 1

    def test_center_manager_scoped(self, cm):
        r = cm.get(f"{API}/mess/centers")
        assert r.status_code == 200
        ids = {c["id"] for c in r.json()}
        assert CENTER_ID in ids or len(ids) <= 2, f"cm got {len(ids)} centers: {ids}"

    def test_cm_cross_center_403(self, cm, admin):
        all_centers = admin.get(f"{API}/centers").json()
        outside = next((c for c in all_centers if c["id"] != CENTER_ID), None)
        if not outside:
            pytest.skip("no outside center available")
        r = cm.get(f"{API}/mess/receipts", params={"center_id": outside["id"]})
        assert r.status_code == 403, f"expected 403 got {r.status_code}"


# ---------------- Mess bill templates (HR Settings) ----------------
class TestMessBillTemplates:
    def test_list_templates_admin(self, admin):
        r = admin.get(f"{API}/mess-bill-templates")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_upload_rejects_non_docx(self, admin):
        files = {"file": ("bad.txt", io.BytesIO(b"hello"), "text/plain")}
        # requests Session: strip JSON content-type for multipart
        headers = {k: v for k, v in admin.headers.items() if k.lower() != "content-type"}
        r = admin.post(f"{API}/mess-bill-templates", files=files, headers=headers)
        assert r.status_code == 400, r.status_code

    def test_cm_cannot_upload_template(self, cm):
        files = {"file": ("x.docx", io.BytesIO(b"PK\x03\x04fakedocx"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
        headers = {k: v for k, v in cm.headers.items() if k.lower() != "content-type"}
        r = cm.post(f"{API}/mess-bill-templates", files=files, headers=headers)
        assert r.status_code in (401, 403), r.status_code
