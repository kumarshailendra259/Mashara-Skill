"""Iteration 44 — Advance Request approval-time Payment Attribution + payee surfacing.

Covers (per review request):
  1. GET /api/approvals/pending surfaces payee_* + vendor_name(=employee_name) + qrn(=advance_no)
     + payment_mode(=preferred_payment_mode) for advance_request rows.
  2. POST /api/approvals/act request_type=advance_request is_final_step:
     - succeeds without any txn_center_id / txn_partner_id / paid_by_* (OPTIONAL for advance)
     - stamps approved_center_id/name + approved_company_id when txn_center_id provided
     - stamps approved_partner_id when txn_partner_id provided
     - stamps approved_paid_by_user_id + approved_paid_by_name when provided
     - 400 when txn_center_id refers to non-existent center
  3. POST /api/advance-requests/{aid}/release uses approved_* values as eff_center/partner/company/paid_by
     for the auto-created transaction. Body.paid_by_user_id (if provided) overrides.
  4. Regression: POST /api/approvals/act request_type=payment final step still 400s without
     paid_by_name + txn_center_id.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
ADMIN_EMAIL = "admin@finance.app"
ADMIN_PASSWORD = "Admin@123"


@pytest.fixture(scope="module", autouse=True)
def activate_default_advance_chain():
    """Ensure the default admin-only advance_request chain is active so newly
    created advance requests get a chain attached (else current_level=None and
    they're invisible to /approvals/pending)."""
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient
    from dotenv import load_dotenv
    load_dotenv('/app/backend/.env')

    async def _activate():
        c = AsyncIOMotorClient(os.environ['MONGO_URL'])
        db = c[os.environ['DB_NAME']]
        await db.approval_chains.update_many(
            {"type": "advance_request", "name": {"$regex": "Default"}},
            {"$set": {"active": True}},
        )
        c.close()

    try:
        asyncio.run(_activate())
    except Exception as e:
        print(f"chain activation failed: {e}")
    yield


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text[:200]
    return s


@pytest.fixture(scope="module")
def sample_center(admin):
    r = admin.get(f"{BASE_URL}/api/entities/center", timeout=30)
    assert r.status_code == 200
    centers = r.json()
    assert isinstance(centers, list) and len(centers) > 0
    # prefer a center with a company_id set
    with_co = [c for c in centers if c.get("company_id")]
    return with_co[0] if with_co else centers[0]


@pytest.fixture(scope="module")
def sample_partner(admin):
    r = admin.get(f"{BASE_URL}/api/entities/partner", timeout=30)
    if r.status_code != 200:
        return None
    partners = r.json()
    return partners[0] if partners else None


@pytest.fixture(scope="module")
def admin_me(admin):
    r = admin.get(f"{BASE_URL}/api/auth/me", timeout=30)
    assert r.status_code == 200
    return r.json()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _create_advance_bank(admin, tag="ITER44"):
    payload = {
        "employee_name": f"TEST44 Employee {tag}",
        "amount": 3210,
        "purpose": f"TEST44 {tag} payee-attribution",
        "required_date": "2026-01-20",
        "preferred_payment_mode": "bank",
        "payee_account_holder": "Iter44 Holder",
        "payee_account_no": "4444555566",
        "payee_ifsc": "HDFC0004444",
        "payee_bank_name": "HDFC Bank",
    }
    r = admin.post(f"{BASE_URL}/api/advance-requests", json=payload, timeout=30)
    assert r.status_code in (200, 201), r.text[:300]
    return r.json()


def _walk_and_get_final_step(admin, aid):
    """Walk approvals until row is at is_final_step=True. Returns pending item dict."""
    for _ in range(8):
        r = admin.get(f"{BASE_URL}/api/approvals/pending", timeout=30)
        assert r.status_code == 200
        items = [i for i in r.json() if i.get("request_type") == "advance_request"
                 and i.get("request_id") == aid]
        if not items:
            # advance may have moved past current user; refetch
            adv = admin.get(f"{BASE_URL}/api/advance-requests/{aid}", timeout=30).json()
            raise AssertionError(f"advance {aid} not in pending; status={adv.get('status')}")
        item = items[0]
        if item.get("is_final_step"):
            return item
        # not final yet — approve non-final and advance
        r_act = admin.post(f"{BASE_URL}/api/approvals/act",
                           json={"request_type": "advance_request", "request_id": aid,
                                 "action": "approve", "remarks": "walk"},
                           timeout=30)
        assert r_act.status_code == 200, r_act.text[:200]
    raise AssertionError("Never reached final step in 8 loops")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
class TestPendingApprovalsSummary:
    def test_pending_advance_request_summary_carries_payee_and_advance_no(self, admin):
        adv = _create_advance_bank(admin, tag=f"summary-{uuid.uuid4().hex[:6]}")
        r = admin.get(f"{BASE_URL}/api/approvals/pending", timeout=30)
        assert r.status_code == 200
        items = [i for i in r.json() if i.get("request_type") == "advance_request"
                 and i.get("request_id") == adv["id"]]
        assert items, "Newly created advance not visible in /approvals/pending for admin"
        s = items[0]["summary"]
        assert s.get("vendor_name") == adv["employee_name"], s
        assert s.get("qrn") == adv["advance_no"], s
        assert s.get("payment_mode") == "bank", s
        assert s.get("payee_account_holder") == "Iter44 Holder"
        assert s.get("payee_account_no") == "4444555566"
        assert s.get("payee_ifsc") == "HDFC0004444"
        assert s.get("payee_bank_name") == "HDFC Bank"
        # payee_proof_attachments default empty list
        assert isinstance(s.get("payee_proof_attachments"), list)


class TestApprovalActAdvanceOptional:
    def test_final_approve_advance_without_attribution_succeeds(self, admin):
        adv = _create_advance_bank(admin, tag=f"noattr-{uuid.uuid4().hex[:6]}")
        item = _walk_and_get_final_step(admin, adv["id"])
        assert item["is_final_step"] is True
        r = admin.post(f"{BASE_URL}/api/approvals/act",
                       json={"request_type": "advance_request", "request_id": adv["id"],
                             "action": "approve", "remarks": "no attribution"},
                       timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert r.json().get("status") == "approved"
        # advance row now approved, but no approved_* attribution fields set
        row = admin.get(f"{BASE_URL}/api/advance-requests/{adv['id']}", timeout=30).json()
        assert row.get("status") == "approved"
        assert row.get("approved_center_id") in (None, "")
        assert row.get("approved_partner_id") in (None, "")
        assert row.get("approved_paid_by_user_id") in (None, "")

    def test_final_approve_with_full_attribution_stamps_approved_fields(
            self, admin, sample_center, sample_partner, admin_me):
        adv = _create_advance_bank(admin, tag=f"full-{uuid.uuid4().hex[:6]}")
        item = _walk_and_get_final_step(admin, adv["id"])
        assert item["is_final_step"] is True
        body = {
            "request_type": "advance_request",
            "request_id": adv["id"],
            "action": "approve",
            "remarks": "full attribution",
            "txn_center_id": sample_center["id"],
            "paid_by_user_id": admin_me["id"],
            "paid_by_name": admin_me.get("name") or admin_me.get("email"),
        }
        if sample_partner:
            body["txn_partner_id"] = sample_partner["id"]
        r = admin.post(f"{BASE_URL}/api/approvals/act", json=body, timeout=30)
        assert r.status_code == 200, r.text[:400]
        row = admin.get(f"{BASE_URL}/api/advance-requests/{adv['id']}", timeout=30).json()
        assert row["status"] == "approved"
        assert row.get("approved_center_id") == sample_center["id"], row
        assert row.get("approved_center_name") == sample_center.get("name")
        # company_id may be None if center lacks one; only assert if center has it
        if sample_center.get("company_id"):
            assert row.get("approved_company_id") == sample_center["company_id"]
        if sample_partner:
            assert row.get("approved_partner_id") == sample_partner["id"]
        assert row.get("approved_paid_by_user_id") == admin_me["id"]
        assert row.get("approved_paid_by_name") == body["paid_by_name"]

    def test_final_approve_with_bad_center_returns_400(self, admin):
        adv = _create_advance_bank(admin, tag=f"badctr-{uuid.uuid4().hex[:6]}")
        item = _walk_and_get_final_step(admin, adv["id"])
        r = admin.post(f"{BASE_URL}/api/approvals/act",
                       json={"request_type": "advance_request", "request_id": adv["id"],
                             "action": "approve",
                             "remarks": "bad center",
                             "txn_center_id": "does-not-exist-xxx"},
                       timeout=30)
        assert r.status_code == 400, r.text[:300]
        assert "center" in r.text.lower()


class TestReleaseUsesApprovedAttribution:
    def test_release_picks_up_approved_attribution(
            self, admin, sample_center, sample_partner, admin_me):
        adv = _create_advance_bank(admin, tag=f"rel-{uuid.uuid4().hex[:6]}")
        _walk_and_get_final_step(admin, adv["id"])
        body = {
            "request_type": "advance_request",
            "request_id": adv["id"],
            "action": "approve",
            "remarks": "release picks approved",
            "txn_center_id": sample_center["id"],
            "paid_by_user_id": admin_me["id"],
            "paid_by_name": admin_me.get("name") or admin_me.get("email"),
        }
        if sample_partner:
            body["txn_partner_id"] = sample_partner["id"]
        r = admin.post(f"{BASE_URL}/api/approvals/act", json=body, timeout=30)
        assert r.status_code == 200

        # Release with empty body → should use approved_* defaults
        r_rel = admin.post(f"{BASE_URL}/api/advance-requests/{adv['id']}/release",
                           json={"payment_mode": "bank"}, timeout=30)
        assert r_rel.status_code == 200, r_rel.text[:400]
        released = r_rel.json()
        txn_id = released.get("linked_transaction_id")
        assert txn_id, released

        # Find the created transaction and check attribution
        r_txns = admin.get(f"{BASE_URL}/api/transactions", timeout=30)
        assert r_txns.status_code == 200
        txns = r_txns.json()
        txn = next((t for t in txns if t.get("id") == txn_id), None)
        assert txn, f"txn {txn_id} not visible in listing"
        assert txn.get("center_id") == sample_center["id"], txn
        if sample_partner:
            assert txn.get("partner_id") == sample_partner["id"]
        if sample_center.get("company_id"):
            assert txn.get("company_id") == sample_center["company_id"]
        assert txn.get("paid_by_user_id") == admin_me["id"]
        # paid_by_name resolved from users collection lookup
        assert txn.get("paid_by_name"), txn

    def test_release_body_paid_by_user_id_overrides_approved(
            self, admin, sample_center, admin_me):
        adv = _create_advance_bank(admin, tag=f"override-{uuid.uuid4().hex[:6]}")
        _walk_and_get_final_step(admin, adv["id"])
        # Approve WITHOUT paid_by (leave approved_paid_by_* unset), stamp only center
        r = admin.post(f"{BASE_URL}/api/approvals/act",
                       json={"request_type": "advance_request", "request_id": adv["id"],
                             "action": "approve",
                             "remarks": "center-only, no paid_by",
                             "txn_center_id": sample_center["id"]},
                       timeout=30)
        assert r.status_code == 200

        # Release body supplies paid_by_user_id explicitly
        r_rel = admin.post(f"{BASE_URL}/api/advance-requests/{adv['id']}/release",
                           json={"payment_mode": "bank", "paid_by_user_id": admin_me["id"]},
                           timeout=30)
        assert r_rel.status_code == 200, r_rel.text[:400]
        txn_id = r_rel.json().get("linked_transaction_id")
        txn = next((t for t in admin.get(f"{BASE_URL}/api/transactions").json()
                    if t.get("id") == txn_id), None)
        assert txn is not None
        assert txn.get("paid_by_user_id") == admin_me["id"]
        assert txn.get("center_id") == sample_center["id"]


class TestPaymentAttributionStillMandatory:
    """Regression: payment/reimbursement flow still forces txn_center_id + paid_by_name at final."""

    def _find_payment_final_step_item(self, admin):
        r = admin.get(f"{BASE_URL}/api/approvals/pending", timeout=30)
        assert r.status_code == 200
        for it in r.json():
            if it.get("request_type") in ("payment", "reimbursement") and it.get("is_final_step"):
                return it
        return None

    def test_payment_final_without_attribution_400(self, admin):
        item = self._find_payment_final_step_item(admin)
        if not item:
            pytest.skip("No payment/reimbursement final-step item in pending queue")
        r = admin.post(f"{BASE_URL}/api/approvals/act",
                       json={"request_type": item["request_type"],
                             "request_id": item["request_id"],
                             "action": "approve",
                             "remarks": "no attribution — should 400"},
                       timeout=30)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:300]}"
        low = r.text.lower()
        assert "center" in low or "paid" in low, r.text[:300]
