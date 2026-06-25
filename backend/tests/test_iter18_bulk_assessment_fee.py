"""Iter-18 tests: Bulk delete/archive endpoints + 2nd milestone assessment fee
& recovery-aware TDS.

Covers:
- Admin-only bulk-delete on transactions, entities, batches, partner-associations
- Admin-only bulk-archive on staff & users (with self-archive prevention)
- 2nd milestone TDS calculation on (gross − recovery), NOT gross
- Assessment fee separate expense transaction (source='assessment_fee')
- Full canonical scenario math (gross=117208, recovery=13524, af=13000, tds=2%)
- Backwards compat: 1st milestone uniform TDS still works
- Validation: negative assessment fee → 422
"""
import os
import uuid
import pytest
import requests


def _read_env():
    p = "/app/frontend/.env"
    if os.path.exists(p):
        for line in open(p):
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip()
    return os.environ.get("REACT_APP_BACKEND_URL", "")


BASE_URL = _read_env().rstrip("/")
ADMIN_EMAIL = "admin@finance.app"
ADMIN_PWD = "Admin@123"


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def admin_client():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PWD})
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def admin_id(admin_client):
    me = admin_client.get(f"{BASE_URL}/api/auth/me")
    assert me.status_code == 200
    return me.json()["id"]


@pytest.fixture(scope="module")
def project_center(admin_client):
    pname = f"TEST_proj_{uuid.uuid4().hex[:6]}"
    cname = f"TEST_center_{uuid.uuid4().hex[:6]}"
    p = admin_client.post(f"{BASE_URL}/api/entities/project", json={"name": pname, "description": ""})
    c = admin_client.post(f"{BASE_URL}/api/entities/center", json={"name": cname, "description": ""})
    assert p.status_code == 200 and c.status_code == 200
    return {"project_id": p.json()["id"], "center_id": c.json()["id"]}


def _mk_batch(client, project_center, **overrides):
    body = {
        "name": f"TEST_batch_{uuid.uuid4().hex[:6]}",
        "project_id": project_center["project_id"],
        "center_id": project_center["center_id"],
        "partner_ids": [],
        "start_date": "2025-01-01",
        "end_date": "2025-06-30",
        "candidates_count": 30,
        "passed_candidates": 26,
        "placed_candidates": 20,
        "job_roles": [{"category": "1", "job_role": "Trainer", "candidates": 30, "hours": 200}],
    }
    body.update(overrides)
    r = client.post(f"{BASE_URL}/api/batches", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _mk_non_admin_user(admin_client, role="accountant"):
    email = f"TEST_user_{uuid.uuid4().hex[:6]}@x.io"
    pwd = "Test@1234"
    # Register a fresh user via public register endpoint
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/register",
                json={"email": email, "password": pwd, "name": "tx"})
    assert r.status_code in (200, 201), r.text
    uid = r.json()["id"]
    # Optionally elevate role via admin patch (default is usually viewer/member)
    if role and role != r.json().get("role"):
        admin_client.patch(f"{BASE_URL}/api/auth/users/{uid}", json={"role": role})
    return s, uid


# ============================================================
# Section 1: Bulk Delete Endpoints
# ============================================================
class TestBulkDelete:
    def test_transactions_bulk_delete_empty(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/transactions/bulk-delete", json={"ids": []})
        assert r.status_code == 200
        assert r.json() == {"deleted": 0}

    def test_transactions_bulk_delete_non_admin_403(self, admin_client):
        non_admin, _ = _mk_non_admin_user(admin_client, role="accountant")
        r = non_admin.post(f"{BASE_URL}/api/transactions/bulk-delete", json={"ids": []})
        assert r.status_code == 403

    def test_transactions_bulk_delete_valid_ids(self, admin_client):
        # Create two transactions
        ids = []
        for i in range(2):
            tx = admin_client.post(f"{BASE_URL}/api/transactions", json={
                "type": "expense", "amount": 100.0, "date": "2025-01-01",
                "description": f"TEST_bulk_{i}",
            })
            assert tx.status_code == 200
            ids.append(tx.json()["id"])
        r = admin_client.post(f"{BASE_URL}/api/transactions/bulk-delete", json={"ids": ids})
        assert r.status_code == 200
        assert r.json()["deleted"] == 2
        # Verify deleted - GET list should not include
        listing = admin_client.get(f"{BASE_URL}/api/transactions").json()
        remaining = [x["id"] for x in listing if x["id"] in ids]
        assert remaining == []

    @pytest.mark.parametrize("etype", ["company", "partner", "center", "project"])
    def test_entities_bulk_delete(self, admin_client, etype):
        # empty
        r = admin_client.post(f"{BASE_URL}/api/entities/{etype}/bulk-delete", json={"ids": []})
        assert r.status_code == 200 and r.json() == {"deleted": 0}
        # create 2 then delete
        ids = []
        for _ in range(2):
            cr = admin_client.post(f"{BASE_URL}/api/entities/{etype}",
                                    json={"name": f"TEST_{etype}_{uuid.uuid4().hex[:6]}", "description": ""})
            assert cr.status_code == 200
            ids.append(cr.json()["id"])
        r = admin_client.post(f"{BASE_URL}/api/entities/{etype}/bulk-delete", json={"ids": ids})
        assert r.status_code == 200 and r.json()["deleted"] == 2

    def test_entities_non_admin_403(self, admin_client):
        non_admin, _ = _mk_non_admin_user(admin_client, role="accountant")
        r = non_admin.post(f"{BASE_URL}/api/entities/company/bulk-delete", json={"ids": []})
        assert r.status_code == 403

    def test_batches_bulk_delete_cascades_payments(self, admin_client, project_center):
        b = _mk_batch(admin_client, project_center)
        # Create batch payment so we can verify cascade
        pay = admin_client.post(f"{BASE_URL}/api/batch-payments", json={
            "batch_id": b["id"], "milestone": "1st", "amount": 10000, "description": "TEST",
        })
        assert pay.status_code == 200, pay.text
        # bulk delete batch
        r = admin_client.post(f"{BASE_URL}/api/batches/bulk-delete", json={"ids": [b["id"]]})
        assert r.status_code == 200 and r.json()["deleted"] == 1
        # cascaded — batch_payments should also be gone for this batch
        list_pay = admin_client.get(f"{BASE_URL}/api/batch-payments?batch_id={b['id']}")
        assert list_pay.status_code == 200
        assert list_pay.json() == []

    def test_batches_empty(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/batches/bulk-delete", json={"ids": []})
        assert r.status_code == 200 and r.json() == {"deleted": 0}

    def test_partner_associations_bulk_delete_empty(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/partner-associations/bulk-delete", json={"ids": []})
        assert r.status_code == 200 and r.json() == {"deleted": 0}


# ============================================================
# Section 2: Bulk Archive Endpoints
# ============================================================
class TestBulkArchive:
    def test_users_bulk_archive_self_only_400(self, admin_client, admin_id):
        r = admin_client.post(f"{BASE_URL}/api/auth/users/bulk-archive", json={"ids": [admin_id]})
        assert r.status_code == 400

    def test_users_bulk_archive_mixed_skips_self(self, admin_client, admin_id):
        _, uid = _mk_non_admin_user(admin_client, role="accountant")
        r = admin_client.post(f"{BASE_URL}/api/auth/users/bulk-archive",
                              json={"ids": [admin_id, uid]})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["archived"] == 1
        assert data["skipped_self"] == 1

    def test_users_bulk_archive_empty(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/auth/users/bulk-archive", json={"ids": []})
        assert r.status_code == 200 and r.json() == {"archived": 0}

    def test_users_bulk_archive_non_admin_403(self, admin_client):
        non_admin, _ = _mk_non_admin_user(admin_client, role="accountant")
        r = non_admin.post(f"{BASE_URL}/api/auth/users/bulk-archive", json={"ids": []})
        assert r.status_code == 403

    def test_staff_bulk_archive_empty(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/staff/bulk-archive", json={"ids": []})
        assert r.status_code == 200 and r.json() == {"archived": 0}

    def test_staff_bulk_archive_archives_linked_user(self, admin_client):
        # create a user, then a staff linked to it
        _, uid = _mk_non_admin_user(admin_client, role="accountant")
        sname = f"TEST_staff_{uuid.uuid4().hex[:6]}"
        # try common staff endpoint
        sr = admin_client.post(f"{BASE_URL}/api/staff", json={
            "name": sname, "email": f"{sname}@x.io", "phone": "9999",
            "role": "accountant", "user_id": uid,
        })
        if sr.status_code not in (200, 201):
            pytest.skip(f"Staff create endpoint not available: {sr.status_code} {sr.text[:200]}")
        sid = sr.json()["id"]
        r = admin_client.post(f"{BASE_URL}/api/staff/bulk-archive", json={"ids": [sid]})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["archived"] == 1
        assert data["linked_users_archived"] == 1


# ============================================================
# Section 3: Recovery-aware TDS calculation
# ============================================================
class TestRecoveryAwareTDS:
    def test_simple_recovery_tds_smaller_numbers(self, admin_client, project_center):
        """gross=10000, recovery=2000, tds=10% → tds_amount = 800 (on 8000 taxable)"""
        b = _mk_batch(admin_client, project_center)
        pay = admin_client.post(f"{BASE_URL}/api/batch-payments", json={
            "batch_id": b["id"], "milestone": "2nd", "amount": 10000,
            "recovery_amount": 2000, "description": "TEST",
        })
        assert pay.status_code == 200, pay.text
        pid = pay.json()["id"]
        r = admin_client.patch(f"{BASE_URL}/api/batch-payments/{pid}/receive",
                                json={"tds_percent": 10})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["tds_amount"] == 800.0, f"Expected TDS 800 on (10000-2000)*10%, got {data['tds_amount']}"
        # net = 10000 - 800 - 2000 - 0 = 7200
        assert data["net_amount"] == 7200.0

    def test_canonical_scenario_full(self, admin_client, project_center):
        """30 cand × Cat1 × 200hrs, 26 passed, 20 placed. 2nd milestone:
        gross=117208, recovery=13524, af_per=500, af_total=13000, tds=2%
        → taxable = 117208 − 0 − 13524 = 103684
        → tds = 2073.68
        → net = 117208 − 13524 − 2073.68 − 13000 = 88610.32
        """
        b = _mk_batch(admin_client, project_center)
        pay = admin_client.post(f"{BASE_URL}/api/batch-payments", json={
            "batch_id": b["id"], "milestone": "2nd", "amount": 117208,
            "recovery_amount": 13524,
            "assessment_fee_per_candidate": 500,
            "assessment_fee_total": 13000,
            "description": "TEST canonical",
        })
        assert pay.status_code == 200, pay.text
        # Verify persisted fields
        body = pay.json()
        assert body["recovery_amount"] == 13524
        assert body["assessment_fee_per_candidate"] == 500
        assert body["assessment_fee_total"] == 13000
        pid = body["id"]
        r = admin_client.patch(f"{BASE_URL}/api/batch-payments/{pid}/receive",
                                json={"tds_percent": 2})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["tds_amount"] == 2073.68, f"got {data['tds_amount']}"
        assert data["net_amount"] == 88610.32, f"got {data['net_amount']}"
        assert data["recovery_amount"] == 13524
        assert data["assessment_fee_total"] == 13000
        assert data["assessment_fee_per_candidate"] == 500
        assert data["assessment_fee_txn_id"], "assessment_fee_txn_id must be present"
        assert data["recovery_txn_id"]
        assert data["tds_txn_id"]

    def test_first_milestone_uniform_tds_unchanged(self, admin_client, project_center):
        """Backwards compat (iter-15/16): gross=204555, uniform=23000, tds=2 → taxable=181555, tds=3631.10"""
        b = _mk_batch(admin_client, project_center)
        pay = admin_client.post(f"{BASE_URL}/api/batch-payments", json={
            "batch_id": b["id"], "milestone": "1st", "amount": 204555,
            "uniform_amount": 23000, "description": "TEST_1st_compat",
        })
        assert pay.status_code == 200, pay.text
        pid = pay.json()["id"]
        r = admin_client.patch(f"{BASE_URL}/api/batch-payments/{pid}/receive",
                                json={"tds_percent": 2})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["tds_amount"] == 3631.10, f"got {data['tds_amount']}"


# ============================================================
# Section 4: Assessment Fee Transactions
# ============================================================
class TestAssessmentFeeTxn:
    def test_assessment_fee_creates_separate_expense_txn(self, admin_client, project_center):
        b = _mk_batch(admin_client, project_center)
        pay = admin_client.post(f"{BASE_URL}/api/batch-payments", json={
            "batch_id": b["id"], "milestone": "2nd", "amount": 50000,
            "assessment_fee_per_candidate": 500, "assessment_fee_total": 13000,
        })
        pid = pay.json()["id"]
        r = admin_client.patch(f"{BASE_URL}/api/batch-payments/{pid}/receive",
                                json={"tds_percent": 0})
        assert r.status_code == 200
        af_txn_id = r.json()["assessment_fee_txn_id"]
        assert af_txn_id, "assessment_fee_txn_id must be set"
        # Fetch txn and verify fields
        all_tx = admin_client.get(f"{BASE_URL}/api/transactions").json()
        af = next((x for x in all_tx if x["id"] == af_txn_id), None)
        assert af is not None
        assert af["type"] == "expense"
        assert af["source"] == "assessment_fee"
        assert af["amount"] == 13000
        assert af["status"] == "approved"
        assert "500" in af["description"] and "26" in af["description"]

    def test_assessment_fee_zero_no_txn(self, admin_client, project_center):
        b = _mk_batch(admin_client, project_center)
        pay = admin_client.post(f"{BASE_URL}/api/batch-payments", json={
            "batch_id": b["id"], "milestone": "2nd", "amount": 50000,
        })
        pid = pay.json()["id"]
        r = admin_client.patch(f"{BASE_URL}/api/batch-payments/{pid}/receive",
                                json={"tds_percent": 0})
        assert r.status_code == 200
        data = r.json()
        assert data.get("assessment_fee_txn_id") is None
        assert data["assessment_fee_total"] == 0


# ============================================================
# Section 5: Validation
# ============================================================
class TestValidation:
    def test_negative_assessment_fee_per_candidate_422(self, admin_client, project_center):
        b = _mk_batch(admin_client, project_center)
        r = admin_client.post(f"{BASE_URL}/api/batch-payments", json={
            "batch_id": b["id"], "milestone": "2nd", "amount": 10000,
            "assessment_fee_per_candidate": -1,
        })
        assert r.status_code == 422

    def test_negative_assessment_fee_total_422(self, admin_client, project_center):
        b = _mk_batch(admin_client, project_center)
        r = admin_client.post(f"{BASE_URL}/api/batch-payments", json={
            "batch_id": b["id"], "milestone": "2nd", "amount": 10000,
            "assessment_fee_total": -100,
        })
        assert r.status_code == 422
