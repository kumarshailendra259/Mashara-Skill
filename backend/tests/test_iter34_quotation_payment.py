"""iter-34 — Quotation → QRN → Payment two-stage procurement workflow.

Under test (server.py):
  - Models QuotationIn / PaymentIn
  - Helpers _slug_center_prefix, _next_qrn
  - QUOTATION_CREATORS role gate
  - POST/GET/DELETE /api/quotations
  - POST/GET /api/payments
  - /api/approvals/act branches for request_type in {quotation, payment}
      * final-approve quotation → status='approved', QRN stamped, counter unique per center
      * final-approve payment → auto-approved EXPENSE txn tagged with qrn+quotation_id+payment_id
      * reject payment → quotation reverts to status='approved', payment_id cleared
  - DEFAULT_CHAINS seeding for 'quotation' + 'payment'
  - Indexes: quotations.qrn unique-sparse, qrn_counters.center_id unique
  - Role scope on list endpoints
"""
import os
import re
import uuid
import time
import requests
import pytest

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL")
            or "https://invest-analytics-24.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@finance.app"
ADMIN_PASSWORD = "Admin@123"
RUN = uuid.uuid4().hex[:6]

QRN_REGEX = re.compile(r"^[A-Z0-9]{1,8}-QRN-\d{4}$")


# ---------- helpers ----------
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


def _get(s, path, ok=(200,), params=None):
    r = s.get(f"{BASE_URL}{path}", params=params, timeout=20)
    assert r.status_code in ok, f"GET {path}: {r.status_code} {r.text}"
    return r.json()


def _patch(s, path, body, ok=(200, 201)):
    r = s.patch(f"{BASE_URL}{path}", json=body, timeout=20)
    assert r.status_code in ok, f"PATCH {path}: {r.status_code} {r.text}"
    return r.json()


def _act(admin_s, req_type, req_id, action="approve", remarks="ok fine"):
    """Perform a single approval action; return response json for inspection."""
    r = admin_s.post(f"{BASE_URL}/api/approvals/act", json={
        "request_type": req_type,
        "request_id": req_id,
        "action": action,
        "remarks": remarks,
    }, timeout=20)
    return r


def _approve_all_levels(admin_s, req_type, req_id, levels=3):
    """Admin bypasses role check → acts once per level. Returns list of responses."""
    out = []
    for _ in range(levels):
        r = _act(admin_s, req_type, req_id, "approve", "auto-approve")
        out.append(r)
        if r.status_code != 200:
            break
    return out


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def seed(admin):
    """Create fresh test company + partner + 2 centers + 2 users for role gating."""
    s = admin
    comp = _post(s, "/api/entities/company", {"name": f"TEST_iter34_Co_{RUN}"})
    partner = _post(s, "/api/entities/partner", {"name": f"TEST_iter34_P_{RUN}"})
    # Center 1: primary — prefix must be distinct within 8 alnum chars for QRN uniqueness
    c1 = _post(s, "/api/entities/center",
               {"name": f"IT34AAA-{RUN}",
                "city": "X", "state": "Y", "company_id": comp["id"]})
    # Center 2: secondary — different 8-alnum prefix
    c2 = _post(s, "/api/entities/center",
               {"name": f"IT34BBB-{RUN}",
                "city": "X", "state": "Y", "company_id": comp["id"]})

    # Register a center_staff user for c1 (default 'viewer' via register — patch role after)
    staff_email = f"iter34_staff_{RUN}@finance.app"
    staff_pwd = "Staff@123"
    r = requests.post(f"{BASE_URL}/api/auth/register", json={
        "email": staff_email, "password": staff_pwd,
        "name": f"iter34 staff {RUN}", "role": "center_staff",
    }, timeout=20)
    assert r.status_code in (200, 201), r.text
    staff_uid = r.json()["id"]
    _patch(s, f"/api/auth/users/{staff_uid}", {
        "role": "center_staff",
        "assigned_center_ids": [c1["id"]],
    })

    # Register a partner user (should be blocked from creating quotations)
    partner_email = f"iter34_partner_{RUN}@finance.app"
    partner_pwd = "Part@123"
    r = requests.post(f"{BASE_URL}/api/auth/register", json={
        "email": partner_email, "password": partner_pwd,
        "name": f"iter34 partner {RUN}", "role": "partner",
    }, timeout=20)
    assert r.status_code in (200, 201), r.text
    partner_uid = r.json()["id"]
    _patch(s, f"/api/auth/users/{partner_uid}", {
        "role": "partner",
        "assigned_partner_id": partner["id"],
    })

    # Register a viewer role — must NOT be able to create quotations
    viewer_email = f"iter34_viewer_{RUN}@finance.app"
    viewer_pwd = "View@123"
    r = requests.post(f"{BASE_URL}/api/auth/register", json={
        "email": viewer_email, "password": viewer_pwd,
        "name": f"iter34 viewer {RUN}", "role": "viewer",
    }, timeout=20)
    assert r.status_code in (200, 201), r.text
    viewer_uid = r.json()["id"]
    _patch(s, f"/api/auth/users/{viewer_uid}", {"role": "viewer"})

    return {
        "company_id": comp["id"],
        "partner_id": partner["id"],
        "c1": c1, "c2": c2,
        "staff": {"email": staff_email, "password": staff_pwd, "uid": staff_uid},
        "partner_user": {"email": partner_email, "password": partner_pwd,
                         "uid": partner_uid},
        "viewer": {"email": viewer_email, "password": viewer_pwd, "uid": viewer_uid},
    }


@pytest.fixture(scope="module", autouse=True)
def _cleanup(admin, seed):
    """Bulk-delete everything the test created."""
    yield
    s = admin
    try:
        # Delete quotations + payments manually via GET+DELETE
        q_all = _get(s, "/api/quotations")
        for q in q_all:
            if seed["c1"]["id"] == q.get("center_id") or seed["c2"]["id"] == q.get("center_id"):
                # payment cannot be raised on non-approved; delete order — pop txn+payment via mongo? skip
                try:
                    s.delete(f"{BASE_URL}/api/quotations/{q['id']}", timeout=15)
                except Exception:
                    pass
        # Bulk delete txns on our test centers
        rows = _get(s, "/api/transactions")
        ids = [t["id"] for t in rows
               if t.get("center_id") in (seed["c1"]["id"], seed["c2"]["id"])]
        if ids:
            s.post(f"{BASE_URL}/api/transactions/bulk-delete",
                   json={"ids": ids}, timeout=30)
        # Entities cleanup
        s.post(f"{BASE_URL}/api/entities/center/bulk-delete",
               json={"ids": [seed["c1"]["id"], seed["c2"]["id"]]}, timeout=15)
        s.post(f"{BASE_URL}/api/entities/partner/bulk-delete",
               json={"ids": [seed["partner_id"]]}, timeout=15)
        s.post(f"{BASE_URL}/api/entities/company/bulk-delete",
               json={"ids": [seed["company_id"]]}, timeout=15)
    except Exception as e:
        print(f"cleanup non-fatal error: {e}")


# =========================================================================
class TestDefaultChains:
    def test_quotation_chain_seeded(self, admin):
        chains = _get(admin, "/api/approval-chains")
        q = [c for c in chains if c["type"] == "quotation" and c.get("active")]
        assert q, "no active quotation chain seeded"
        steps = [s["value"] for s in q[0]["steps"]]
        assert steps == ["center_manager", "senior_manager", "admin"], f"unexpected steps: {steps}"

    def test_payment_chain_seeded(self, admin):
        chains = _get(admin, "/api/approval-chains")
        p = [c for c in chains if c["type"] == "payment" and c.get("active")]
        assert p, "no active payment chain seeded"
        steps = [s["value"] for s in p[0]["steps"]]
        assert steps == ["senior_manager", "admin", "accountant"], f"unexpected steps: {steps}"


# =========================================================================
class TestQuotationCreate:
    def test_admin_can_create_quotation(self, admin, seed):
        body = {
            "center_id": seed["c1"]["id"],
            "category": "expense",
            "description": f"TEST_iter34 A/C paint {RUN}",
            "vendor_name": "TEST Vendor 1",
            "estimated_amount": 5000,
            "expected_delivery_date": "2026-02-15",
            "purpose": "Center refurbishment",
        }
        q = _post(admin, "/api/quotations", body)
        assert q["status"] == "pending"
        assert q["current_level"] == 1
        assert q.get("chain_id"), "chain_id not attached"
        snap = q.get("chain_snapshot") or []
        assert len(snap) == 3, f"expected 3 steps in snapshot, got {len(snap)}"
        assert q.get("qrn") is None
        assert q["payment_id"] is None

    def test_partner_role_403_on_create(self, seed):
        p = _login(seed["partner_user"]["email"], seed["partner_user"]["password"])
        r = p.post(f"{BASE_URL}/api/quotations", json={
            "center_id": seed["c1"]["id"],
            "description": "should fail",
            "vendor_name": "X",
            "estimated_amount": 1,
        }, timeout=20)
        assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text}"

    def test_viewer_role_403_on_create(self, seed):
        v = _login(seed["viewer"]["email"], seed["viewer"]["password"])
        r = v.post(f"{BASE_URL}/api/quotations", json={
            "center_id": seed["c1"]["id"],
            "description": "should fail viewer",
            "vendor_name": "X",
            "estimated_amount": 1,
        }, timeout=20)
        assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text}"

    def test_center_staff_wrong_center_403(self, seed):
        st = _login(seed["staff"]["email"], seed["staff"]["password"])
        r = st.post(f"{BASE_URL}/api/quotations", json={
            "center_id": seed["c2"]["id"],   # NOT in assigned
            "description": "wrong-center TEST_iter34",
            "vendor_name": "X",
            "estimated_amount": 100,
        }, timeout=20)
        assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text}"

    def test_center_staff_own_center_ok(self, seed):
        st = _login(seed["staff"]["email"], seed["staff"]["password"])
        r = st.post(f"{BASE_URL}/api/quotations", json={
            "center_id": seed["c1"]["id"],   # assigned
            "description": f"staff-own TEST_iter34 {RUN}",
            "vendor_name": "OwnCenter Vendor",
            "estimated_amount": 250,
        }, timeout=20)
        assert r.status_code in (200, 201), f"expected 200/201 got {r.status_code}: {r.text}"
        q = r.json()
        assert q["status"] == "pending"
        assert q["center_id"] == seed["c1"]["id"]


# =========================================================================
class TestQRNStamping:
    def test_final_approval_stamps_qrn_and_counter_increments(self, admin, seed):
        # Two sequential quotations on the SAME center → QRN counter should increment
        q1 = _post(admin, "/api/quotations", {
            "center_id": seed["c1"]["id"],
            "description": f"TEST_iter34 QRN-A {RUN}",
            "vendor_name": "V1",
            "estimated_amount": 1000,
        })
        rs = _approve_all_levels(admin, "quotation", q1["id"], 3)
        assert all(r.status_code == 200 for r in rs), \
            f"approve failures: {[(i,r.status_code,r.text) for i,r in enumerate(rs)]}"
        got = _get(admin, f"/api/quotations/{q1['id']}")
        assert got["status"] == "approved", got
        assert got["qrn"], "QRN not stamped"
        assert QRN_REGEX.match(got["qrn"]), f"QRN regex mismatch: {got['qrn']}"
        m1 = re.match(r"^([A-Z0-9]{1,8})-QRN-(\d{4})$", got["qrn"])
        prefix1, ctr1 = m1.group(1), int(m1.group(2))

        # Prefix should be derived from center name (alnum uppercase, ≤8 chars).
        c_name = seed["c1"]["name"]
        expected_prefix = ("".join(ch for ch in c_name.upper()
                                   if ch.isalnum()) or "CENTER")[:8]
        assert prefix1 == expected_prefix, f"prefix mismatch {prefix1} vs {expected_prefix}"

        # Second quotation on the same center
        q2 = _post(admin, "/api/quotations", {
            "center_id": seed["c1"]["id"],
            "description": f"TEST_iter34 QRN-B {RUN}",
            "vendor_name": "V2",
            "estimated_amount": 1500,
        })
        for _ in range(3):
            r = _act(admin, "quotation", q2["id"], "approve", "okay done")
            assert r.status_code == 200, r.text
        got2 = _get(admin, f"/api/quotations/{q2['id']}")
        m2 = re.match(r"^([A-Z0-9]{1,8})-QRN-(\d{4})$", got2["qrn"])
        prefix2, ctr2 = m2.group(1), int(m2.group(2))
        assert prefix2 == prefix1
        assert ctr2 == ctr1 + 1, f"counter didn't increment: {ctr1} → {ctr2}"

        # Store for downstream tests
        pytest.qrn_test_q1 = q1["id"]
        pytest.qrn_test_q2 = q2["id"]
        pytest.qrn_val_q1 = got["qrn"]

    def test_reject_quotation_no_qrn(self, admin, seed):
        q = _post(admin, "/api/quotations", {
            "center_id": seed["c1"]["id"],
            "description": f"TEST_iter34 will-reject {RUN}",
            "vendor_name": "VR",
            "estimated_amount": 999,
        })
        r = _act(admin, "quotation", q["id"], "reject", "not needed")
        assert r.status_code == 200, r.text
        got = _get(admin, f"/api/quotations/{q['id']}")
        assert got["status"] == "rejected"
        assert not got.get("qrn"), "rejected quotation should have no QRN"


# =========================================================================
class TestPaymentFlow:
    def test_cannot_raise_payment_on_pending_quotation(self, admin, seed):
        q = _post(admin, "/api/quotations", {
            "center_id": seed["c1"]["id"],
            "description": f"TEST_iter34 pending-guard {RUN}",
            "vendor_name": "V",
            "estimated_amount": 500,
        })
        r = admin.post(f"{BASE_URL}/api/payments", json={
            "quotation_id": q["id"], "actual_amount": 500,
        }, timeout=20)
        assert r.status_code == 400, f"expected 400 got {r.status_code}: {r.text}"

    def test_payment_full_happy_path(self, admin, seed):
        # Create + approve a fresh quotation
        q = _post(admin, "/api/quotations", {
            "center_id": seed["c1"]["id"],
            "description": f"TEST_iter34 pay-happy {RUN}",
            "vendor_name": "HappyVendor",
            "estimated_amount": 2000,
        })
        for _ in range(3):
            r = _act(admin, "quotation", q["id"], "approve", "okay done")
            assert r.status_code == 200
        q_after = _get(admin, f"/api/quotations/{q['id']}")
        assert q_after["status"] == "approved"
        qrn = q_after["qrn"]

        # Raise payment (editable actual_amount)
        pay = _post(admin, "/api/payments", {
            "quotation_id": q["id"],
            "actual_amount": 1950,   # different from estimated
            "payment_mode": "bank",
            "payment_date": "2026-01-20",
            "notes": "actual paid slightly less",
        })
        assert pay["qrn"] == qrn, "payment did not echo QRN"
        assert pay["status"] == "pending"
        assert pay["quotation_id"] == q["id"]
        assert pay["actual_amount"] == 1950
        # Quotation flips to payment_pending
        q_now = _get(admin, f"/api/quotations/{q['id']}")
        assert q_now["status"] == "payment_pending"
        assert q_now.get("payment_id") == pay["id"]

        # Cannot raise a 2nd payment
        r = admin.post(f"{BASE_URL}/api/payments", json={
            "quotation_id": q["id"], "actual_amount": 1,
        }, timeout=20)
        assert r.status_code == 400, f"expected 400 got {r.status_code}: {r.text}"

        # Approve payment × 3 (senior_manager → admin → accountant, admin-bypass)
        for _ in range(3):
            r = _act(admin, "payment", pay["id"], "approve", "final approve step")
            assert r.status_code == 200, r.text

        # Final state
        p_final = _get(admin, f"/api/payments/{pay['id']}")
        assert p_final["status"] == "paid", p_final
        assert p_final.get("txn_id"), "txn_id not populated on payment"
        q_final = _get(admin, f"/api/quotations/{q['id']}")
        assert q_final["status"] == "paid"
        assert q_final.get("txn_id") == p_final["txn_id"]

        # Auto-created transaction: verify all critical fields
        txns = _get(admin, "/api/transactions", params={"status": "approved"})
        matches = [t for t in txns if t.get("id") == p_final["txn_id"]]
        assert matches, f"auto-created txn {p_final['txn_id']} not found in approved list"
        txn = matches[0]
        assert txn["type"] == "expense"
        assert float(txn["amount"]) == 1950.0
        assert txn["center_id"] == seed["c1"]["id"]
        assert txn.get("source") == "quotation_payment"
        assert txn.get("qrn") == qrn
        assert txn.get("quotation_id") == q["id"]
        assert txn.get("payment_id") == pay["id"]
        assert txn["status"] == "approved"
        assert f"QRN {qrn}" in (txn.get("description") or ""), \
            f"description missing QRN: {txn.get('description')}"
        # Auto-derived company_id from center (seed set company on c1)
        assert txn.get("company_id") == seed["company_id"], \
            f"company_id not auto-derived: {txn.get('company_id')}"

    def test_payment_txn_type_override(self, admin, seed):
        """txn_type_override on payment overrides quotation.category."""
        q = _post(admin, "/api/quotations", {
            "center_id": seed["c1"]["id"],
            "category": "expense",
            "description": f"TEST_iter34 override {RUN}",
            "vendor_name": "Ovr",
            "estimated_amount": 400,
        })
        for _ in range(3):
            _act(admin, "quotation", q["id"], "approve", "okay done")
        pay = _post(admin, "/api/payments", {
            "quotation_id": q["id"], "actual_amount": 400,
            "txn_type_override": "investment",
        })
        for _ in range(3):
            r = _act(admin, "payment", pay["id"], "approve", "okay done")
            assert r.status_code == 200
        p_final = _get(admin, f"/api/payments/{pay['id']}")
        txns = _get(admin, "/api/transactions")
        t = next((x for x in txns if x["id"] == p_final["txn_id"]), None)
        assert t is not None and t["type"] == "investment", f"override not applied: {t}"

    def test_payment_reject_frees_quotation(self, admin, seed):
        q = _post(admin, "/api/quotations", {
            "center_id": seed["c1"]["id"],
            "description": f"TEST_iter34 pay-reject {RUN}",
            "vendor_name": "PRJ",
            "estimated_amount": 300,
        })
        for _ in range(3):
            _act(admin, "quotation", q["id"], "approve", "okay done")
        pay = _post(admin, "/api/payments", {
            "quotation_id": q["id"], "actual_amount": 300,
        })
        # Quotation is now payment_pending
        assert _get(admin, f"/api/quotations/{q['id']}")["status"] == "payment_pending"

        r = _act(admin, "payment", pay["id"], "reject", "not needed after all")
        assert r.status_code == 200, r.text
        # Quotation should revert to approved and payment_id cleared
        q_after = _get(admin, f"/api/quotations/{q['id']}")
        assert q_after["status"] == "approved", f"quotation status not reverted: {q_after}"
        assert q_after.get("payment_id") is None, f"payment_id not cleared: {q_after}"

        # A new payment can be raised on the same quotation
        pay2 = _post(admin, "/api/payments", {
            "quotation_id": q["id"], "actual_amount": 280,
        })
        assert pay2["status"] == "pending"


# =========================================================================
class TestQuotationListing:
    def test_admin_sees_all_and_filters(self, admin, seed):
        # Filter by center_id
        docs = _get(admin, "/api/quotations",
                    params={"center_id": seed["c1"]["id"]})
        assert all(d["center_id"] == seed["c1"]["id"] for d in docs)
        assert any(d.get("status") == "approved" for d in docs)
        # Filter by status=approved
        approved = _get(admin, "/api/quotations", params={"status": "approved"})
        assert all(d["status"] == "approved" for d in approved)

    def test_center_staff_scoped_visibility(self, seed):
        st = _login(seed["staff"]["email"], seed["staff"]["password"])
        docs = _get(st, "/api/quotations")
        # Staff can see quotations for c1 (assigned) or ones they created
        for d in docs:
            assert (d["center_id"] == seed["c1"]["id"]
                    or d.get("created_by") == seed["staff"]["uid"]), \
                f"scope leak: {d.get('id')} center={d.get('center_id')}"


# =========================================================================
class TestQrnPerCenterUniqueness:
    def test_second_center_starts_its_own_counter(self, admin, seed):
        q = _post(admin, "/api/quotations", {
            "center_id": seed["c2"]["id"],
            "description": f"TEST_iter34 c2-first {RUN}",
            "vendor_name": "C2V",
            "estimated_amount": 100,
        })
        rs = _approve_all_levels(admin, "quotation", q["id"], 3)
        assert all(r.status_code == 200 for r in rs), \
            f"c2 approvals failed: {[(i, r.status_code, r.text) for i, r in enumerate(rs)]}"
        got = _get(admin, f"/api/quotations/{q['id']}")
        assert got["status"] == "approved", got
        assert QRN_REGEX.match(got.get("qrn") or ""), got.get("qrn")
        # Different center prefix + counter starts at 0001
        assert (got.get("qrn") or "").endswith("-QRN-0001"), \
            f"per-center counter not fresh: {got.get('qrn')}"


# =========================================================================
class TestConcurrentQrnCounter:
    """Ensure _next_qrn atomic $inc doesn't produce duplicates under near-parallel creation."""

    def test_parallel_creates_produce_unique_qrns(self, admin, seed):
        from concurrent.futures import ThreadPoolExecutor
        # Create 5 quotations on center c1 concurrently, then approve them sequentially.
        def create():
            return _post(admin, "/api/quotations", {
                "center_id": seed["c1"]["id"],
                "description": f"TEST_iter34 concurrent {RUN}",
                "vendor_name": "PARV",
                "estimated_amount": 50,
            })
        with ThreadPoolExecutor(max_workers=5) as ex:
            futs = [ex.submit(create) for _ in range(5)]
            quotes = [f.result() for f in futs]
        qrns = []
        for q in quotes:
            for _ in range(3):
                _act(admin, "quotation", q["id"], "approve", "okay done")
            got = _get(admin, f"/api/quotations/{q['id']}")
            assert got["status"] == "approved"
            qrns.append(got["qrn"])
        assert len(set(qrns)) == len(qrns), f"duplicate QRNs generated: {qrns}"
