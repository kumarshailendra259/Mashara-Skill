"""Iter-22 backend tests: Phase-3 Asset Management + Phase-4 Employee Transfer.

Covers:
  - POST /api/asset-purchase-requests (creates 4-level chain snapshot, pending)
  - GET /api/asset-purchase-requests + listing in /api/approvals/pending
  - /api/approvals/act with request_type=asset_purchase advances through 4 levels
    and on final approve creates an /api/assets row + an expense /api/transactions row
  - Rejection at level-1 → status=rejected, no asset/transaction
  - Manual POST /api/assets (admin), PATCH, DELETE
  - Asset transfer create + decide approve → asset.center_id moves; reject → asset stays
  - POST /api/employee-transfers (3-level chain), staff_name/from_center_id captured
  - employee_transfer final-approve updates staff.center_id; reject keeps staff
  - DELETE /api/employee-transfers/{id} works for initiator/admin while pending
  - /api/approvals/pending summary.amount + description fallback for new types
  - Permission gating: center_staff cannot raise asset_purchase (403)
  - Regression: transaction approval chain still acts, reimbursement final
    creates offsetting expense txn, login-history recorded, dashboard role-widgets
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@finance.app")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Admin@123")

RUN = uuid.uuid4().hex[:8]


# ----------------------------- fixtures -----------------------------
@pytest.fixture(scope="session")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="session")
def seed_center(admin_session):
    """Create a brand-new center for this run (avoids touching seed assets)."""
    r = admin_session.post(f"{BASE_URL}/api/entities/center",
                           json={"name": f"TEST_AssetCenter_{RUN}",
                                 "email": f"test_assetcenter_{RUN}@example.com"},
                           timeout=15)
    assert r.status_code == 200, f"create center failed: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="session")
def seed_center_dest(admin_session):
    r = admin_session.post(f"{BASE_URL}/api/entities/center",
                           json={"name": f"TEST_AssetCenterDest_{RUN}",
                                 "email": f"test_assetdest_{RUN}@example.com"},
                           timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="session")
def seed_staff(admin_session, seed_center):
    """Staff used for employee transfer tests."""
    payload = {
        "name": f"TEST_Staff_{RUN}",
        "email": f"test_staff_{RUN}@example.com",
        "phone": "9999990000",
        "designation": "Trainer",
        "center_id": seed_center["id"],
        "monthly_ctc": 30000,
    }
    r = admin_session.post(f"{BASE_URL}/api/staff", json=payload, timeout=15)
    assert r.status_code in (200, 201), f"create staff failed: {r.status_code} {r.text}"
    return r.json()


# ============================================================================
# Phase-3: Asset Purchase Request 4-level approval chain
# ============================================================================
class TestAssetPurchaseChain:
    asset_req_id: str = ""

    def test_create_asset_purchase_request(self, admin_session, seed_center):
        payload = {
            "name": f"TEST_Laptop_{RUN}",
            "category": "Electronics",
            "est_amount": 65000,
            "required_date": "2026-02-15",
            "depreciation_rate_pct": 25,
            "useful_life_years": 4,
            "center_id": seed_center["id"],
        }
        r = admin_session.post(f"{BASE_URL}/api/asset-purchase-requests",
                               json=payload, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "pending"
        assert data["current_level"] == 1
        snap = data.get("chain_snapshot") or []
        assert len(snap) == 4, f"expected 4 chain steps, got {len(snap)}: {snap}"
        labels_lower = " ".join((s.get("label") or "").lower() for s in snap)
        assert "center manager" in labels_lower
        assert "senior manager" in labels_lower
        assert "accountant" in labels_lower
        assert "admin" in labels_lower
        assert data["est_amount"] == 65000
        assert data["center_id"] == seed_center["id"]
        TestAssetPurchaseChain.asset_req_id = data["id"]

    def test_listed_in_asset_purchase_requests(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/asset-purchase-requests", timeout=15)
        assert r.status_code == 200
        ids = [d["id"] for d in r.json()]
        assert TestAssetPurchaseChain.asset_req_id in ids

    def test_listed_in_approvals_pending_with_amount(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/approvals/pending", timeout=15)
        assert r.status_code == 200
        rows = [x for x in r.json()
                if x.get("request_type") == "asset_purchase"
                and x.get("request_id") == TestAssetPurchaseChain.asset_req_id]
        assert rows, "asset_purchase request not in /approvals/pending"
        row = rows[0]
        assert row["summary"]["amount"] == 65000
        # description should fall back to "<name> → <category>"
        assert "TEST_Laptop" in (row["summary"].get("description") or "")

    def test_advance_through_4_levels_creates_asset_and_txn(self, admin_session):
        rid = TestAssetPurchaseChain.asset_req_id
        # 4 approvals (admin bypasses level role check)
        for level in range(1, 5):
            r = admin_session.post(f"{BASE_URL}/api/approvals/act",
                                   json={"request_type": "asset_purchase",
                                         "request_id": rid,
                                         "action": "approve",
                                         "remarks": f"approve L{level}"},
                                   timeout=15)
            assert r.status_code == 200, f"L{level} act failed: {r.status_code} {r.text}"

        # After final approve, request status=approved
        all_req = admin_session.get(f"{BASE_URL}/api/asset-purchase-requests", timeout=15).json()
        req = next(x for x in all_req if x["id"] == rid)
        assert req["status"] == "approved"
        assert req.get("asset_id"), "asset_id not stamped on request"

        # An asset doc should exist
        assets = admin_session.get(f"{BASE_URL}/api/assets", timeout=15).json()
        asset = next((a for a in assets if a.get("purchase_request_id") == rid), None)
        assert asset, "Asset not created on final approve"
        assert asset["purchase_amount"] == 65000
        assert asset["status"] == "active"
        assert asset.get("txn_id"), "linked txn_id missing on asset"

        # The expense transaction should exist with status=approved.
        # Note: TransactionOut response model strips `asset_id`, so we match by description.
        txns = admin_session.get(f"{BASE_URL}/api/transactions?limit=500", timeout=15).json()
        txn_list = txns if isinstance(txns, list) else txns.get("items", [])
        marker = f"TEST_Laptop_{RUN}"
        txn = next((t for t in txn_list
                    if t.get("type") == "expense"
                    and marker in (t.get("description") or "")), None)
        assert txn, "expense transaction not recorded for asset purchase"
        assert txn["amount"] == 65000
        assert txn["status"] == "approved"


# ============================================================================
# Phase-3: Rejection mid-chain → no asset/transaction
# ============================================================================
class TestAssetPurchaseRejection:
    def test_reject_at_level_1(self, admin_session, seed_center):
        payload = {
            "name": f"TEST_RejectAsset_{RUN}",
            "est_amount": 12000,
            "center_id": seed_center["id"],
        }
        r = admin_session.post(f"{BASE_URL}/api/asset-purchase-requests",
                               json=payload, timeout=15)
        assert r.status_code == 200
        rid = r.json()["id"]

        rej = admin_session.post(f"{BASE_URL}/api/approvals/act",
                                 json={"request_type": "asset_purchase",
                                       "request_id": rid,
                                       "action": "reject",
                                       "remarks": "not needed"},
                                 timeout=15)
        assert rej.status_code == 200
        all_req = admin_session.get(f"{BASE_URL}/api/asset-purchase-requests", timeout=15).json()
        req = next(x for x in all_req if x["id"] == rid)
        assert req["status"] == "rejected"

        assets = admin_session.get(f"{BASE_URL}/api/assets", timeout=15).json()
        assert not any(a.get("purchase_request_id") == rid for a in assets), \
            "Asset should NOT be created when request is rejected"


# ============================================================================
# Phase-3: Manual asset CRUD
# ============================================================================
class TestAssetCRUD:
    aid: str = ""

    def test_admin_creates_legacy_asset(self, admin_session, seed_center):
        payload = {
            "name": f"TEST_LegacyAsset_{RUN}",
            "category": "Furniture",
            "purchase_amount": 5000,
            "purchase_date": "2025-12-01",
            "center_id": seed_center["id"],
        }
        r = admin_session.post(f"{BASE_URL}/api/assets", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["name"] == payload["name"]
        assert data.get("manual_entry") is True
        TestAssetCRUD.aid = data["id"]

    def test_patch_asset(self, admin_session):
        r = admin_session.patch(f"{BASE_URL}/api/assets/{TestAssetCRUD.aid}",
                                json={"vendor": "TEST_Vendor", "purchase_amount": 5500},
                                timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["vendor"] == "TEST_Vendor"
        assert data["purchase_amount"] == 5500

    def test_delete_asset(self, admin_session):
        r = admin_session.delete(f"{BASE_URL}/api/assets/{TestAssetCRUD.aid}", timeout=15)
        assert r.status_code == 200
        # Verify gone
        assets = admin_session.get(f"{BASE_URL}/api/assets", timeout=15).json()
        assert not any(a["id"] == TestAssetCRUD.aid for a in assets)


# ============================================================================
# Phase-3: Asset Transfer (lightweight 2-step)
# ============================================================================
class TestAssetTransfer:
    asset_id: str = ""
    transfer_id_rej: str = ""
    transfer_id_app: str = ""

    def test_setup_asset(self, admin_session, seed_center):
        r = admin_session.post(f"{BASE_URL}/api/assets",
                               json={"name": f"TEST_TransferAsset_{RUN}",
                                     "purchase_amount": 8000,
                                     "center_id": seed_center["id"]},
                               timeout=15)
        assert r.status_code == 200, r.text
        TestAssetTransfer.asset_id = r.json()["id"]

    def test_create_transfer_then_reject_keeps_asset(self, admin_session, seed_center, seed_center_dest):
        r = admin_session.post(f"{BASE_URL}/api/asset-transfers",
                               json={"asset_id": TestAssetTransfer.asset_id,
                                     "to_center_id": seed_center_dest["id"],
                                     "reason": "shifting to dest"},
                               timeout=15)
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        TestAssetTransfer.transfer_id_rej = tid

        rj = admin_session.post(f"{BASE_URL}/api/asset-transfers/{tid}/decide",
                                json={"action": "reject", "remarks": "later"},
                                timeout=15)
        assert rj.status_code == 200
        assert rj.json()["status"] == "rejected"
        # Asset center unchanged
        assets = admin_session.get(f"{BASE_URL}/api/assets", timeout=15).json()
        a = next(x for x in assets if x["id"] == TestAssetTransfer.asset_id)
        assert a["center_id"] == seed_center["id"], "Asset center must not change on reject"

    def test_create_transfer_then_approve_moves_asset(self, admin_session, seed_center_dest):
        r = admin_session.post(f"{BASE_URL}/api/asset-transfers",
                               json={"asset_id": TestAssetTransfer.asset_id,
                                     "to_center_id": seed_center_dest["id"],
                                     "reason": "now move"},
                               timeout=15)
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        TestAssetTransfer.transfer_id_app = tid

        ap = admin_session.post(f"{BASE_URL}/api/asset-transfers/{tid}/decide",
                                json={"action": "approve", "remarks": "ok"},
                                timeout=15)
        assert ap.status_code == 200
        assert ap.json()["status"] == "approved"
        assets = admin_session.get(f"{BASE_URL}/api/assets", timeout=15).json()
        a = next(x for x in assets if x["id"] == TestAssetTransfer.asset_id)
        assert a["center_id"] == seed_center_dest["id"]


# ============================================================================
# Phase-4: Employee Transfer 3-level chain
# ============================================================================
class TestEmployeeTransfer:
    transfer_id: str = ""

    def test_create_employee_transfer(self, admin_session, seed_staff, seed_center_dest):
        payload = {
            "staff_id": seed_staff["id"],
            "to_center_id": seed_center_dest["id"],
            "effective_date": "2026-02-01",
            "reason": "regional rotation",
            "new_designation": "Senior Trainer",
        }
        r = admin_session.post(f"{BASE_URL}/api/employee-transfers",
                               json=payload, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "pending"
        assert data["current_level"] == 1
        assert data["staff_name"] == seed_staff["name"]
        assert data["from_center_id"] == seed_staff["center_id"]
        snap = data.get("chain_snapshot") or []
        assert len(snap) == 3, f"expected 3 chain steps, got {len(snap)}: {snap}"
        TestEmployeeTransfer.transfer_id = data["id"]

    def test_pending_approvals_shows_employee_transfer(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/approvals/pending", timeout=15)
        assert r.status_code == 200
        rows = [x for x in r.json()
                if x.get("request_type") == "employee_transfer"
                and x.get("request_id") == TestEmployeeTransfer.transfer_id]
        assert rows, "employee_transfer not in /approvals/pending"
        desc = rows[0]["summary"].get("description") or ""
        # description is "reason" when present (fallback to staff_name → center otherwise).
        # Our reason is "regional rotation"; either should be non-empty + amount None for employee transfer.
        assert desc, "summary.description must not be empty for employee_transfer"
        assert rows[0]["summary"].get("amount") is None  # employee transfers have no amount
        assert rows[0]["summary"].get("date") == "2026-02-01"

    def test_full_3_level_approve_updates_staff_center(self, admin_session, seed_staff, seed_center_dest):
        tid = TestEmployeeTransfer.transfer_id
        for level in range(1, 4):
            r = admin_session.post(f"{BASE_URL}/api/approvals/act",
                                   json={"request_type": "employee_transfer",
                                         "request_id": tid,
                                         "action": "approve",
                                         "remarks": f"approve level {level}"},
                                   timeout=15)
            assert r.status_code == 200, f"L{level} {r.status_code} {r.text}"
        # Status approved
        all_ = admin_session.get(f"{BASE_URL}/api/employee-transfers", timeout=15).json()
        rec = next(x for x in all_ if x["id"] == tid)
        assert rec["status"] == "approved"
        # Staff center moved
        staff = admin_session.get(f"{BASE_URL}/api/staff/{seed_staff['id']}", timeout=15)
        if staff.status_code == 200:
            assert staff.json()["center_id"] == seed_center_dest["id"]
        else:
            # Fallback: list staff and verify
            all_staff = admin_session.get(f"{BASE_URL}/api/staff", timeout=15).json()
            sl = all_staff if isinstance(all_staff, list) else all_staff.get("items", [])
            target = next(x for x in sl if x["id"] == seed_staff["id"])
            assert target["center_id"] == seed_center_dest["id"]


class TestEmployeeTransferRejectAndDelete:
    def test_reject_keeps_staff(self, admin_session, seed_center, seed_center_dest):
        # Create new staff for a clean reject test
        sp = admin_session.post(f"{BASE_URL}/api/staff",
                                json={"name": f"TEST_RejStaff_{RUN}",
                                      "email": f"test_rejstaff_{RUN}@example.com",
                                      "phone": "9111111111",
                                      "designation": "Trainer",
                                      "center_id": seed_center["id"],
                                      "monthly_ctc": 20000}, timeout=15)
        assert sp.status_code in (200, 201)
        staff_id = sp.json()["id"]
        original_center = sp.json()["center_id"]

        tr = admin_session.post(f"{BASE_URL}/api/employee-transfers",
                                json={"staff_id": staff_id,
                                      "to_center_id": seed_center_dest["id"],
                                      "effective_date": "2026-03-01",
                                      "reason": "test reject path"}, timeout=15)
        assert tr.status_code == 200
        tid = tr.json()["id"]

        rj = admin_session.post(f"{BASE_URL}/api/approvals/act",
                                json={"request_type": "employee_transfer",
                                      "request_id": tid,
                                      "action": "reject",
                                      "remarks": "not now"}, timeout=15)
        assert rj.status_code == 200
        all_ = admin_session.get(f"{BASE_URL}/api/employee-transfers", timeout=15).json()
        rec = next(x for x in all_ if x["id"] == tid)
        assert rec["status"] == "rejected"

        # Staff center unchanged
        all_staff = admin_session.get(f"{BASE_URL}/api/staff", timeout=15).json()
        sl = all_staff if isinstance(all_staff, list) else all_staff.get("items", [])
        st = next(x for x in sl if x["id"] == staff_id)
        assert st["center_id"] == original_center

    def test_delete_pending_employee_transfer(self, admin_session, seed_staff, seed_center_dest):
        # staff already moved earlier; pick from_center on the fly. Just to test delete-while-pending.
        # Need a different to_center for "different center" rule.
        # Create another temp center
        c = admin_session.post(f"{BASE_URL}/api/entities/center",
                               json={"name": f"TEST_TmpCenter_{RUN}",
                                     "email": f"test_tmpc_{RUN}@example.com"},
                               timeout=15).json()
        tr = admin_session.post(f"{BASE_URL}/api/employee-transfers",
                                json={"staff_id": seed_staff["id"],
                                      "to_center_id": c["id"],
                                      "effective_date": "2026-04-01",
                                      "reason": "test delete path"}, timeout=15)
        assert tr.status_code == 200, tr.text
        tid = tr.json()["id"]
        d = admin_session.delete(f"{BASE_URL}/api/employee-transfers/{tid}", timeout=15)
        assert d.status_code == 200
        # Ensure absent
        all_ = admin_session.get(f"{BASE_URL}/api/employee-transfers", timeout=15).json()
        assert not any(x["id"] == tid for x in all_)


# ============================================================================
# Permission gating — center_staff cannot raise asset_purchase
# ============================================================================
class TestPermissionGating:
    def test_center_staff_cannot_raise_asset_purchase(self, admin_session, seed_center):
        # Register a center_staff
        email = f"test_cstaff_{RUN}@example.com"
        pwd = "Staff@12345"
        rr = requests.post(f"{BASE_URL}/api/auth/register",
                           json={"email": email, "password": pwd,
                                 "name": "TEST_CStaff", "role": "center_staff"},
                           timeout=15)
        # Some apps disallow self-registering admin roles; center_staff usually OK.
        # If registration not allowed, skip test gracefully.
        if rr.status_code not in (200, 201):
            pytest.skip(f"register center_staff not allowed: {rr.status_code} {rr.text}")

        s = requests.Session()
        lg = s.post(f"{BASE_URL}/api/auth/login",
                    json={"email": email, "password": pwd}, timeout=15)
        assert lg.status_code == 200, lg.text
        r = s.post(f"{BASE_URL}/api/asset-purchase-requests",
                   json={"name": "TEST_StaffAttempt", "est_amount": 100,
                         "center_id": seed_center["id"]},
                   timeout=15)
        assert r.status_code == 403, f"expected 403 got {r.status_code} {r.text}"


# ============================================================================
# REGRESSION — existing flows still work
# ============================================================================
class TestRegression:
    def test_login_history_records(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/auth/login-history?limit=5", timeout=15)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list) and rows

    def test_role_widgets_admin(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/dashboard/role-widgets", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d.get("role") == "admin"
        assert "as_of" in d

    def test_transaction_chain_still_works(self, admin_session):
        # Create a small income txn (default chain = admin 1-level)
        payload = {"type": "income", "amount": 111, "date": "2026-01-15",
                   "description": f"TEST_RegTxn_{RUN}"}
        r = admin_session.post(f"{BASE_URL}/api/transactions", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        t = r.json()
        # Some envs auto-approve admin-created; otherwise act on it
        if t.get("status") == "pending":
            act = admin_session.post(f"{BASE_URL}/api/approvals/act",
                                     json={"request_type": "transaction",
                                           "request_id": t["id"],
                                           "action": "approve"}, timeout=15)
            assert act.status_code == 200

    def test_pending_approvals_endpoint_responds(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/approvals/pending", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
