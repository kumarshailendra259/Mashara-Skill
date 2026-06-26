"""Iteration-20 backend tests:
  (A) ApprovalChain.center_id — center-scoped chains, scope-limited deactivation, transaction attachment.
  (B) BatchPayment.company_id propagation at receive-time — company-share txn gets company_id, partner txns don't.

Re-uses admin login + helpers similar to iter-19.
"""
import os
import uuid
import requests
import pytest


def _read_url():
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL"):
                    return line.split("=", 1)[1].strip()
    except Exception:
        pass
    return ""


BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _read_url()).rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "admin@finance.app"
ADMIN_PWD = "Admin@123"
TAG = uuid.uuid4().hex[:6]


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN_EMAIL, ADMIN_PWD)


# ----------------------------- entity helpers -----------------------------
@pytest.fixture(scope="module")
def project_id(admin):
    r = admin.post(f"{API}/entities/project", json={"name": f"TEST_iter20_proj_{TAG}"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.fixture(scope="module")
def center_a(admin):
    r = admin.post(f"{API}/entities/center", json={"name": f"TEST_iter20_centerA_{TAG}"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.fixture(scope="module")
def center_b(admin):
    r = admin.post(f"{API}/entities/center", json={"name": f"TEST_iter20_centerB_{TAG}"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.fixture(scope="module")
def company_x(admin):
    r = admin.post(f"{API}/entities/company", json={"name": f"TEST_iter20_companyX_{TAG}"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.fixture(scope="module")
def company_y(admin):
    r = admin.post(f"{API}/entities/company", json={"name": f"TEST_iter20_companyY_{TAG}"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["id"]


# ----------------------------- A. ApprovalChain center_id -----------------------------
def _make_chain(admin, name, ctype, center_id, active=True):
    body = {
        "name": name,
        "type": ctype,
        "active": active,
        "center_id": center_id,
        "steps": [{"level": 1, "kind": "role", "value": "admin", "label": "Admin"}],
    }
    r = admin.post(f"{API}/approval-chains", json=body, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


class TestApprovalChainCenterScope:
    def test_create_global_chain_accepts_no_center(self, admin):
        chain = _make_chain(admin, f"TEST_iter20_global_{TAG}", "transaction", None, active=True)
        assert chain.get("center_id") in (None, "")
        assert chain["active"] is True

    def test_two_active_chains_coexist_when_centers_differ(self, admin, center_a):
        # Center-A specific chain should remain active alongside the global default
        center_chain = _make_chain(admin, f"TEST_iter20_centerA_chain_{TAG}", "transaction", center_a, active=True)
        # Listing should show BOTH active chains for type=transaction (one global, one center-A)
        r = admin.get(f"{API}/approval-chains", timeout=15)
        assert r.status_code == 200
        chains = r.json()
        txn_active = [c for c in chains if c["type"] == "transaction" and c.get("active")]
        # At least one global (center_id None) and one center-A specific
        globals_active = [c for c in txn_active if not c.get("center_id")]
        center_a_active = [c for c in txn_active if c.get("center_id") == center_a]
        assert len(globals_active) >= 1, "global default chain must still be active"
        assert len(center_a_active) == 1, "center-A specific chain must be active"
        assert center_chain["id"] in [c["id"] for c in center_a_active]

    def test_new_active_chain_only_deactivates_same_scope(self, admin, center_a):
        # Create a second center-A active chain — should deactivate the first center-A chain
        # but NOT the global default.
        # First grab current active chains
        r = admin.get(f"{API}/approval-chains", timeout=15)
        before = r.json()
        global_before = [c for c in before if c["type"] == "transaction" and c.get("active") and not c.get("center_id")]
        assert len(global_before) >= 1
        global_id = global_before[0]["id"]

        new_chain = _make_chain(admin, f"TEST_iter20_centerA_chain2_{TAG}", "transaction", center_a, active=True)
        r = admin.get(f"{API}/approval-chains", timeout=15)
        after = r.json()
        # Global still active
        g_after = [c for c in after if c["id"] == global_id]
        assert g_after and g_after[0]["active"] is True, "global default must NOT be deactivated"
        # Only ONE center-A active chain
        center_a_active = [c for c in after if c["type"] == "transaction" and c.get("active") and c.get("center_id") == center_a]
        assert len(center_a_active) == 1
        assert center_a_active[0]["id"] == new_chain["id"]

    def test_transaction_on_center_uses_center_specific_chain(self, admin, center_a, center_b, project_id):
        # The currently active center-A chain (the second one we created above)
        r = admin.get(f"{API}/approval-chains", timeout=15)
        chains = r.json()
        center_a_chain = next(c for c in chains if c["type"] == "transaction" and c.get("active") and c.get("center_id") == center_a)
        global_chain = next(c for c in chains if c["type"] == "transaction" and c.get("active") and not c.get("center_id"))

        # Create a transaction on center_a — should attach center_a chain
        body = {
            "type": "expense",
            "amount": 1234,
            "date": "2025-06-01",
            "description": f"TEST_iter20_txn_centerA_{TAG}",
            "center_id": center_a,
            "project_id": project_id,
            "items": [],
        }
        r = admin.post(f"{API}/transactions", json=body, timeout=15)
        assert r.status_code == 200, r.text
        txn = r.json()
        assert txn.get("chain_id") == center_a_chain["id"], (
            f"txn chain_id {txn.get('chain_id')} != center_a chain {center_a_chain['id']}"
        )

        # Create transaction on center_b (no specific chain) — should use global default
        body2 = dict(body)
        body2["center_id"] = center_b
        body2["description"] = f"TEST_iter20_txn_centerB_{TAG}"
        r = admin.post(f"{API}/transactions", json=body2, timeout=15)
        assert r.status_code == 200, r.text
        txn2 = r.json()
        assert txn2.get("chain_id") == global_chain["id"], (
            f"txn(centerB) chain_id {txn2.get('chain_id')} != global {global_chain['id']}"
        )

        # Transaction with NO center_id → global default
        body3 = dict(body)
        body3["center_id"] = None
        body3["description"] = f"TEST_iter20_txn_nocenter_{TAG}"
        r = admin.post(f"{API}/transactions", json=body3, timeout=15)
        assert r.status_code == 200, r.text
        txn3 = r.json()
        assert txn3.get("chain_id") == global_chain["id"]

    def test_default_chains_still_seeded(self, admin):
        # DEFAULT_CHAINS on startup should produce a leave + reimbursement + transaction default
        r = admin.get(f"{API}/approval-chains", timeout=15)
        chains = r.json()
        types_seeded = {c["type"] for c in chains if not c.get("center_id")}
        # at minimum transaction/leave/reimbursement should each have a global default
        assert "transaction" in types_seeded
        assert "leave" in types_seeded
        assert "reimbursement" in types_seeded

    def test_update_chain_preserves_center_id_scope(self, admin, center_a):
        # PUT update on the center-A chain keeps it active and scoped; doesn't disturb global
        r = admin.get(f"{API}/approval-chains", timeout=15)
        chains = r.json()
        ca = next(c for c in chains if c["type"] == "transaction" and c.get("active") and c.get("center_id") == center_a)
        body = {
            "name": ca["name"] + " (upd)",
            "type": ca["type"],
            "active": True,
            "center_id": center_a,
            "steps": ca["steps"],
        }
        r = admin.put(f"{API}/approval-chains/{ca['id']}", json=body, timeout=15)
        assert r.status_code == 200, r.text
        updated = r.json()
        assert updated["center_id"] == center_a
        assert updated["active"] is True
        # Global still active
        r = admin.get(f"{API}/approval-chains", timeout=15)
        chains2 = r.json()
        global_after = [c for c in chains2 if c["type"] == "transaction" and c.get("active") and not c.get("center_id")]
        assert len(global_after) >= 1

    def test_delete_chain_works_with_center_field(self, admin, center_b):
        # Create + delete a center-B chain; ensure delete endpoint still works
        chain = _make_chain(admin, f"TEST_iter20_centerB_chain_{TAG}", "leave", center_b, active=False)
        r = admin.delete(f"{API}/approval-chains/{chain['id']}", timeout=15)
        assert r.status_code == 200
        # 404 on second delete
        r2 = admin.delete(f"{API}/approval-chains/{chain['id']}", timeout=15)
        assert r2.status_code == 404


# ----------------------------- B. Company_id propagation on receive -----------------------------
@pytest.fixture(scope="module")
def batch_with_partners(admin, project_id, center_a):
    # Create a partner
    r = admin.post(f"{API}/entities/partner", json={"name": f"TEST_iter20_partner_{TAG}"}, timeout=15)
    assert r.status_code == 200, r.text
    partner_id = r.json()["id"]

    # Create batch: 25% partner share, 1 partner. Receive split → 75% to company, 25% to partner.
    body = {
        "name": f"TEST_iter20_batch_{TAG}",
        "project_id": project_id,
        "center_id": center_a,
        "training_cost_per_candidate": 10000,
        "total_candidates": 10,
        "passed_candidates": 8,
        "uniform_amount": 0,
        "custom_rate_category": "other",
        "milestone_split": {"first": 30, "mid": 40, "final": 30},
        "partner_ids": [partner_id],
        "partner_share_percent": 25,
    }
    r = admin.post(f"{API}/batches", json=body, timeout=15)
    assert r.status_code == 200, r.text
    return r.json(), partner_id


def _create_payment(admin, batch_id, milestone, amount, company_id=None):
    body = {
        "batch_id": batch_id, "milestone": milestone, "amount": amount,
        "expected_date": "2025-06-01", "description": f"TEST_iter20_{milestone}",
    }
    if company_id is not None:
        body["company_id"] = company_id
    r = admin.post(f"{API}/batch-payments", json=body, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


class TestReceiveCompanyId:
    def test_receive_company_id_in_body_tags_only_company_share_txn(self, admin, batch_with_partners, company_x):
        batch, partner_id = batch_with_partners
        pay = _create_payment(admin, batch["id"], "first", 100000, company_id=None)
        # Receive with body.company_id = company_x
        r = admin.patch(
            f"{API}/batch-payments/{pay['id']}/receive",
            json={"tds_percent": 0, "company_id": company_x},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        out = r.json()
        # BatchPayment row should persist company_id
        assert out.get("company_id") == company_x, f"batch_payment company_id={out.get('company_id')}"
        # Fetch txns and verify
        txn_ids = out.get("txn_ids") or []
        assert len(txn_ids) == 2, f"expected company + partner income txns, got {txn_ids}"
        rows = []
        for tid in txn_ids:
            tr = admin.get(f"{API}/transactions/{tid}", timeout=15)
            assert tr.status_code == 200
            rows.append(tr.json())
        company_txn = [t for t in rows if t.get("partner_id") in (None, "")][0]
        partner_txn = [t for t in rows if t.get("partner_id") == partner_id][0]
        assert company_txn["company_id"] == company_x, f"company-share txn company_id={company_txn.get('company_id')}"
        assert partner_txn.get("company_id") in (None, ""), (
            f"partner txn must NOT inherit company_id, got {partner_txn.get('company_id')}"
        )
        # And amounts: 75k company, 25k partner
        assert abs(company_txn["amount"] - 75000.0) < 0.01
        assert abs(partner_txn["amount"] - 25000.0) < 0.01

    def test_receive_falls_back_to_batchpayment_company_id(self, admin, batch_with_partners, company_y):
        batch, partner_id = batch_with_partners
        # Create payment WITH company_id pre-set on BatchPayment row
        pay = _create_payment(admin, batch["id"], "mid", 100000, company_id=company_y)
        # Receive without company_id in body → should use BatchPayment.company_id
        r = admin.patch(
            f"{API}/batch-payments/{pay['id']}/receive",
            json={"tds_percent": 2},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        out = r.json()
        assert out.get("company_id") == company_y
        # Find the company-share income txn
        txn_ids = out.get("txn_ids") or []
        assert len(txn_ids) == 2
        rows = []
        for tid in txn_ids:
            rows.append(admin.get(f"{API}/transactions/{tid}", timeout=15).json())
        company_txn = [t for t in rows if t.get("partner_id") in (None, "")][0]
        partner_txn = [t for t in rows if t.get("partner_id") == partner_id][0]
        assert company_txn["company_id"] == company_y
        assert partner_txn.get("company_id") in (None, "")

    def test_receive_without_any_company_id_leaves_txn_untagged(self, admin, project_id, center_a):
        # Batch without partners, receive without company_id → income txn has company_id None
        body = {
            "name": f"TEST_iter20_no_company_batch_{TAG}",
            "project_id": project_id,
            "center_id": center_a,
            "training_cost_per_candidate": 5000,
            "total_candidates": 10,
            "passed_candidates": 10,
            "custom_rate_category": "other",
            "milestone_split": {"first": 30, "mid": 40, "final": 30},
            "partner_share_percent": 0,
        }
        r = admin.post(f"{API}/batches", json=body, timeout=15)
        assert r.status_code == 200, r.text
        b = r.json()
        pay = _create_payment(admin, b["id"], "first", 50000, company_id=None)
        r = admin.patch(
            f"{API}/batch-payments/{pay['id']}/receive",
            json={"tds_percent": 0},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        out = r.json()
        assert out.get("company_id") in (None, "")
        txn_ids = out.get("txn_ids") or []
        assert len(txn_ids) == 1
        tr = admin.get(f"{API}/transactions/{txn_ids[0]}", timeout=15).json()
        assert tr.get("company_id") in (None, "")
