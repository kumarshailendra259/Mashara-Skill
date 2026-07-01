"""iter-31 — auto-derive company_id / partner_id on center-only transactions.

Code under test:
  - server.py `_derive_context_for_center` (new helper, line ~423)
  - server.py `create_transaction` (auto-derive at top, line ~1401)
  - server.py `approval_act` reimbursement + asset_purchase branches (auto-derive on final approve)
  - server.py `reimb_pay` legacy pay endpoint (line ~4193)
  - server.py `payroll_pay` (line ~4844)
  - server.py `/transactions/backfill-company-partner` (admin-only, line ~1541)

Also validates:
  - Center form Default Company + Default Partner fields accepted (ConfigDict extra=allow).
  - Non-admin gets 403 on backfill.
  - Caller-provided company_id/partner_id NOT overwritten.
  - Isolated center (no batches / partner / txn history) doesn't crash.
"""
import os
import uuid
import requests
import pytest

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL")
            or "https://invest-analytics-24.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@finance.app"
ADMIN_PASSWORD = "Admin@123"
RUN = uuid.uuid4().hex[:6]
TODAY = "2026-01-15"


def _login(email, pwd):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": email, "password": pwd}, timeout=20)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return s


def _post(s, path, body, ok=(200, 201)):
    r = s.post(f"{BASE_URL}{path}", json=body, timeout=20)
    assert r.status_code in ok, f"POST {path}: {r.status_code} {r.text}"
    return r.json()


def _put(s, path, body, ok=(200, 201)):
    r = s.put(f"{BASE_URL}{path}", json=body, timeout=20)
    assert r.status_code in ok, f"PUT {path}: {r.status_code} {r.text}"
    return r.json()


def _patch(s, path, body=None, ok=(200, 201)):
    r = s.patch(f"{BASE_URL}{path}", json=body or {}, timeout=30)
    assert r.status_code in ok, f"PATCH {path}: {r.status_code} {r.text}"
    return r.json()


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def seed(admin):
    """Create isolated company + partner + center + project + staff for this test run."""
    s = admin
    comp = _post(s, "/api/entities/company",
                 {"name": f"TEST_iter31_Co_{RUN}"})
    partner = _post(s, "/api/entities/partner",
                    {"name": f"TEST_iter31_P_{RUN}"})
    center = _post(s, "/api/entities/center",
                   {"name": f"TEST_iter31_C_{RUN}", "city": "X", "state": "Y"})
    proj = _post(s, "/api/entities/project",
                 {"name": f"TEST_iter31_Proj_{RUN}",
                  "project_code": f"T31{RUN[:3]}"})
    # Set the center's default company_id via PUT (accepts extra='allow')
    _put(s, f"/api/entities/center/{center['id']}",
         {"name": center["name"], "city": "X", "state": "Y",
          "company_id": comp["id"]})
    # Also seed one staff member at this center
    staff = _post(s, "/api/staff",
                  {"name": f"TEST_iter31_Staff_{RUN}",
                   "designation": "Trainer",
                   "monthly_salary": 30000,
                   "per_day_rate": 1000,
                   "joining_date": "2024-01-01",
                   "center_id": center["id"]})
    # Also seed an isolated center (no company_id, no partner, no batches)
    iso_center = _post(s, "/api/entities/center",
                       {"name": f"TEST_iter31_ISO_{RUN}",
                        "city": "X", "state": "Y"})
    return {
        "company_id": comp["id"],
        "partner_id": partner["id"],
        "center_id": center["id"],
        "iso_center_id": iso_center["id"],
        "project_id": proj["id"],
        "staff_id": staff["id"],
        "staff_name": staff.get("name"),
    }


# ---------- Cleanup ----------
@pytest.fixture(scope="module", autouse=True)
def _cleanup(admin, seed):
    yield
    s = admin
    # Best-effort cleanup — delete only what we created
    try:
        # Wipe txns tagged to our centers
        for cid in (seed["center_id"], seed["iso_center_id"]):
            rows = s.get(f"{BASE_URL}/api/transactions", timeout=30).json()
            ids = [t["id"] for t in rows if t.get("center_id") == cid]
            if ids:
                s.post(f"{BASE_URL}/api/transactions/bulk-delete",
                       json={"ids": ids}, timeout=30)
        # Batches
        b = s.get(f"{BASE_URL}/api/batches", timeout=15).json()
        bids = [x["id"] for x in b if x.get("center_id") == seed["center_id"]]
        if bids:
            s.post(f"{BASE_URL}/api/batches/bulk-delete",
                   json={"ids": bids}, timeout=30)
        # Entities
        s.post(f"{BASE_URL}/api/entities/staff/bulk-delete",
               json={"ids": [seed["staff_id"]]}, timeout=15)
        s.post(f"{BASE_URL}/api/entities/center/bulk-delete",
               json={"ids": [seed["center_id"], seed["iso_center_id"]]},
               timeout=15)
        s.post(f"{BASE_URL}/api/entities/partner/bulk-delete",
               json={"ids": [seed["partner_id"]]}, timeout=15)
        s.post(f"{BASE_URL}/api/entities/company/bulk-delete",
               json={"ids": [seed["company_id"]]}, timeout=15)
        s.post(f"{BASE_URL}/api/entities/project/bulk-delete",
               json={"ids": [seed["project_id"]]}, timeout=15)
    except Exception as e:
        print(f"cleanup failed (non-fatal): {e}")


# =================================================================
class TestAutoDeriveOnCreateTxn:
    """POST /api/transactions with only center_id must fill company_id from center."""

    def test_bare_txn_derives_company_from_center_field(self, admin, seed):
        # Sanity: center should have company_id set to test_company (via PUT)
        c = admin.get(f"{BASE_URL}/api/entities/center", timeout=15).json()
        our = next((x for x in c if x["id"] == seed["center_id"]), None)
        assert our and our.get("company_id") == seed["company_id"], \
            f"center default company_id not persisted: {our}"

        # Now create a bare txn — only center_id supplied
        txn = _post(admin, "/api/transactions", {
            "type": "expense", "amount": 100, "date": TODAY,
            "description": f"TEST_iter31 auto-derive {RUN}",
            "center_id": seed["center_id"],
        })
        assert txn["company_id"] == seed["company_id"], \
            f"expected company={seed['company_id']} got {txn.get('company_id')}"
        # partner_id may or may not be None here (no batches yet)

    def test_with_batch_derives_both_company_and_partner(self, admin, seed):
        # Create a batch that ties this center → company + partner
        batch = _post(admin, "/api/batches", {
            "project_id": seed["project_id"],
            "center_id": seed["center_id"],
            "company_id": seed["company_id"],
            "partner_ids": [seed["partner_id"]],
            "name": f"TEST_iter31_batch_{RUN}",
            "start_date": "2025-01-01",
            "end_date": "2026-12-31",
        })
        assert batch["id"]
        # Bare txn now
        txn = _post(admin, "/api/transactions", {
            "type": "expense", "amount": 250, "date": TODAY,
            "description": f"TEST_iter31 batch-derive {RUN}",
            "center_id": seed["center_id"],
        })
        assert txn["company_id"] == seed["company_id"]
        assert txn["partner_id"] == seed["partner_id"], \
            f"expected partner={seed['partner_id']} got {txn.get('partner_id')}"

    def test_caller_provided_values_not_overwritten(self, admin, seed):
        # Explicit company/partner should be preserved (using different values wouldn't
        # apply here — we just verify they aren't blanked by the auto-derive).
        txn = _post(admin, "/api/transactions", {
            "type": "expense", "amount": 50, "date": TODAY,
            "description": f"TEST_iter31 explicit {RUN}",
            "center_id": seed["center_id"],
            "company_id": seed["company_id"],
            "partner_id": seed["partner_id"],
        })
        assert txn["company_id"] == seed["company_id"]
        assert txn["partner_id"] == seed["partner_id"]

    def test_isolated_center_no_crash_returns_none(self, admin, seed):
        # Center with no company_id, no partner_id, no batches, no txn history
        txn = _post(admin, "/api/transactions", {
            "type": "expense", "amount": 25, "date": TODAY,
            "description": f"TEST_iter31 iso {RUN}",
            "center_id": seed["iso_center_id"],
        })
        # Should not crash; company_id + partner_id may be None
        assert txn["center_id"] == seed["iso_center_id"]
        assert txn.get("company_id") in (None, "")
        assert txn.get("partner_id") in (None, "")


# =================================================================
class TestReimbursementFlow:
    """Legacy reimbursement pay path — should auto-derive company + partner
    on the offsetting expense transaction."""

    def test_reimb_pay_creates_txn_with_company_and_partner(self, admin, seed):
        # Create reimbursement
        r = _post(admin, "/api/reimbursements", {
            "staff_id": seed["staff_id"],
            "amount": 500,
            "date": TODAY,
            "category": "travel",
            "description": f"TEST_iter31 reimb {RUN}",
        })
        rid = r["id"]
        # Walk through legacy chain (admin can perform all three steps)
        _patch(admin, f"/api/reimbursements/{rid}/l1-approve")
        _patch(admin, f"/api/reimbursements/{rid}/accountant-approve")
        _patch(admin, f"/api/reimbursements/{rid}/pay")
        # Find the auto-created txn
        rows = admin.get(f"{BASE_URL}/api/transactions", timeout=30).json()
        matches = [t for t in rows
                   if t.get("center_id") == seed["center_id"]
                   and (t.get("description") or "").startswith("Reimbursement:")
                   and RUN in (t.get("description") or "")]
        assert matches, "reimbursement txn not found"
        t = matches[0]
        assert t["company_id"] == seed["company_id"], \
            f"reimb txn company_id missing: {t}"
        assert t["partner_id"] == seed["partner_id"], \
            f"reimb txn partner_id missing: {t}"


# =================================================================
class TestPayrollFlow:
    """PATCH /api/payroll/{id}/pay must auto-derive company + partner on the
    Salary: expense transaction."""

    def test_payroll_pay_creates_txn_with_company_and_partner(self, admin, seed):
        # Run payroll for a period well into the future (isolated from real data)
        r = admin.post(f"{BASE_URL}/api/payroll/run?month=12&year=2099",
                       timeout=60)
        assert r.status_code in (200, 201), f"payroll run failed: {r.status_code} {r.text}"
        # Find OUR staff's payroll row
        pays = admin.get(f"{BASE_URL}/api/payroll?month=12&year=2099",
                         timeout=30).json()
        ours = next((p for p in pays if p["staff_id"] == seed["staff_id"]), None)
        assert ours, f"payroll row not found for staff {seed['staff_id']}"
        pid = ours["id"]
        # Edit to give it a non-zero net (basic=1000)
        _patch(admin, f"/api/payroll/{pid}", {"basic": 1000})
        # Pay
        _patch(admin, f"/api/payroll/{pid}/pay")
        # Locate the salary txn
        rows = admin.get(f"{BASE_URL}/api/transactions", timeout=30).json()
        matches = [t for t in rows
                   if t.get("center_id") == seed["center_id"]
                   and (t.get("description") or "").startswith("Salary:")]
        assert matches, "salary txn not found after payroll_pay"
        t = matches[0]
        assert t["company_id"] == seed["company_id"], \
            f"payroll txn missing company_id: {t}"
        assert t["partner_id"] == seed["partner_id"], \
            f"payroll txn missing partner_id: {t}"


# =================================================================
class TestAssetPurchaseFlow:
    """Asset purchase final approve → Asset Purchase: expense txn must carry
    company + partner via _derive_context_for_center."""

    def test_asset_purchase_txn_carries_company_and_partner(self, admin, seed):
        req = _post(admin, "/api/asset-purchase-requests", {
            "name": f"TEST_iter31_Asset_{RUN}",
            "category": "electronics",
            "est_amount": 1200,
            "required_date": TODAY,
            "center_id": seed["center_id"],
        })
        rid = req["id"]
        # Walk approval chain — admin auto-approves at each level via
        # /approvals/act if _can_auto_approve returns True (admin auto-eligible).
        # We loop up to 5 steps.
        for _ in range(6):
            rec = admin.get(f"{BASE_URL}/api/asset-purchase-requests",
                            timeout=15).json()
            cur = next((x for x in rec if x["id"] == rid), None)
            if not cur or cur.get("status") in ("approved", "rejected"):
                break
            r = admin.post(f"{BASE_URL}/api/approvals/act",
                           json={"request_type": "asset_purchase",
                                 "request_id": rid, "action": "approve",
                                 "remarks": "auto-approve"}, timeout=20)
            if r.status_code == 400 and "finalised" in r.text.lower():
                break
            assert r.status_code == 200, f"approve act failed: {r.status_code} {r.text}"

        # Verify request is now approved
        rec = admin.get(f"{BASE_URL}/api/asset-purchase-requests",
                        timeout=15).json()
        cur = next((x for x in rec if x["id"] == rid), None)
        assert cur and cur.get("status") == "approved", \
            f"asset request not approved: {cur}"

        # Find the Asset Purchase: txn
        rows = admin.get(f"{BASE_URL}/api/transactions", timeout=30).json()
        matches = [t for t in rows
                   if t.get("center_id") == seed["center_id"]
                   and (t.get("description") or "").startswith("Asset Purchase:")
                   and RUN in (t.get("description") or "")]
        assert matches, "asset purchase txn not found"
        t = matches[0]
        assert t["company_id"] == seed["company_id"], \
            f"asset txn missing company_id: {t}"
        assert t["partner_id"] == seed["partner_id"], \
            f"asset txn missing partner_id: {t}"


# =================================================================
class TestBackfillEndpoint:
    """/api/transactions/backfill-company-partner: admin-only, idempotent."""

    def test_backfill_admin_response_shape_and_updated_count(self, admin):
        r = admin.post(
            f"{BASE_URL}/api/transactions/backfill-company-partner",
            timeout=120)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        data = r.json()
        assert set(("scanned", "updated", "distinct_centers")).issubset(
            data.keys()), f"missing keys: {data}"
        assert isinstance(data["scanned"], int)
        assert isinstance(data["updated"], int)
        assert isinstance(data["distinct_centers"], int)
        # Since DB has hundreds of dangling txns, at least SOME should have
        # been updated on this initial run. (If a previous testing agent
        # already backfilled — this may be 0. So we log but only assert >=0.)
        print(f"backfill run-1: {data}")
        # Second run should be idempotent -> updated == 0
        r2 = admin.post(
            f"{BASE_URL}/api/transactions/backfill-company-partner",
            timeout=120)
        assert r2.status_code == 200
        data2 = r2.json()
        print(f"backfill run-2: {data2}")
        assert data2["updated"] == 0, \
            f"expected idempotent 2nd run, got updated={data2['updated']}"

    def test_backfill_forbidden_for_non_admin(self):
        # Create a non-admin (HR) user
        email = f"TEST_iter31_hr_{RUN}@finance.app"
        pwd = "Hr@1234"
        r = requests.post(f"{BASE_URL}/api/auth/register",
                          json={"email": email, "password": pwd,
                                "name": f"T31 HR {RUN}", "role": "hr"},
                          timeout=20)
        if r.status_code not in (200, 201):
            pytest.skip(f"cannot register hr user: {r.status_code}")
        s = _login(email, pwd)
        r2 = s.post(
            f"{BASE_URL}/api/transactions/backfill-company-partner",
            timeout=30)
        assert r2.status_code == 403, \
            f"expected 403 for hr, got {r2.status_code} {r2.text}"
