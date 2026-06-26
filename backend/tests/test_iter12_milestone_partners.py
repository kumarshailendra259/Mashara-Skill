"""Iteration-12 backend tests: partner_ids on batches + milestone income split + /dashboard/milestone-income."""
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


@pytest.fixture(scope="module")
def project_id(admin):
    r = admin.post(f"{API}/entities/project", json={"name": f"TEST_iter12_proj_{TAG}"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.fixture(scope="module")
def center_id(admin):
    r = admin.post(f"{API}/entities/center", json={"name": f"TEST_iter12_center_{TAG}"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.fixture(scope="module")
def partner_a(admin):
    r = admin.post(f"{API}/entities/partner", json={"name": f"TEST_iter12_pA_{TAG}"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.fixture(scope="module")
def partner_b(admin):
    r = admin.post(f"{API}/entities/partner", json={"name": f"TEST_iter12_pB_{TAG}"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["id"]


# ===== BATCH partner_ids =====

class TestBatchPartnerIds:
    def test_create_batch_with_partner_ids(self, admin, project_id, center_id, partner_a, partner_b):
        r = admin.post(f"{API}/batches", json={
            "project_id": project_id,
            "center_id": center_id,
            "partner_ids": [partner_a, partner_b],
            "name": f"TEST_batch_two_partners_{TAG}",
            "total_beneficiaries": 50,
        }, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["partner_ids"] == [partner_a, partner_b]
        # GET to verify persistence
        g = admin.get(f"{API}/batches?project_id={project_id}", timeout=15)
        assert g.status_code == 200
        found = next((b for b in g.json() if b["id"] == data["id"]), None)
        assert found is not None
        assert set(found["partner_ids"]) == {partner_a, partner_b}

    def test_create_batch_bad_partner_id_returns_400(self, admin, project_id, partner_a):
        r = admin.post(f"{API}/batches", json={
            "project_id": project_id,
            "partner_ids": [partner_a, "nonexistent-partner-zzz"],
            "name": f"TEST_batch_bad_partner_{TAG}",
        }, timeout=15)
        assert r.status_code == 400, r.text

    def test_update_batch_partner_ids(self, admin, project_id, partner_a, partner_b):
        # create with one
        r = admin.post(f"{API}/batches", json={
            "project_id": project_id, "partner_ids": [partner_a],
            "name": f"TEST_batch_update_{TAG}",
        }, timeout=15)
        assert r.status_code == 200
        bid = r.json()["id"]
        # update to both
        u = admin.put(f"{API}/batches/{bid}", json={
            "project_id": project_id, "partner_ids": [partner_a, partner_b],
            "name": f"TEST_batch_update_{TAG}",
        }, timeout=15)
        assert u.status_code == 200, u.text
        assert set(u.json()["partner_ids"]) == {partner_a, partner_b}

    def test_create_batch_empty_partner_ids(self, admin, project_id):
        r = admin.post(f"{API}/batches", json={
            "project_id": project_id, "partner_ids": [],
            "name": f"TEST_batch_no_partners_{TAG}",
        }, timeout=15)
        assert r.status_code == 200
        assert r.json()["partner_ids"] == []


# ===== Receive splits =====

@pytest.fixture(scope="module")
def batch_two_partners(admin, project_id, center_id, partner_a, partner_b):
    r = admin.post(f"{API}/batches", json={
        "project_id": project_id, "center_id": center_id,
        "partner_ids": [partner_a, partner_b],
        "partner_share_percent": 100,  # iter-19: all gross goes to partner pool (matches legacy equal-split semantics)
        "name": f"TEST_split_batch_{TAG}",
    }, timeout=15)
    assert r.status_code == 200
    return r.json()["id"]


@pytest.fixture(scope="module")
def batch_no_partners(admin, project_id, center_id):
    r = admin.post(f"{API}/batches", json={
        "project_id": project_id, "center_id": center_id,
        "partner_ids": [],
        "name": f"TEST_nopart_batch_{TAG}",
    }, timeout=15)
    assert r.status_code == 200
    return r.json()["id"]


class TestReceiveSplit:
    def test_receive_splits_among_two_partners(self, admin, batch_two_partners, partner_a, partner_b, project_id, center_id):
        # Create 1st milestone of 100000
        r = admin.post(f"{API}/batch-payments", json={
            "batch_id": batch_two_partners, "milestone": "1st", "amount": 100000,
        }, timeout=15)
        assert r.status_code == 200, r.text
        pmt_id = r.json()["id"]
        # Receive
        rec = admin.patch(f"{API}/batch-payments/{pmt_id}/receive", timeout=15)
        assert rec.status_code == 200, rec.text
        body = rec.json()
        assert body["status"] == "received"
        assert body.get("txn_id") is not None
        # Pull transactions and assert 2 milestone txns exist for this batch/1st
        t = admin.get(f"{API}/transactions", timeout=15)
        assert t.status_code == 200
        txns = [x for x in t.json() if x.get("source") == "milestone"
                and x.get("milestone") == "1st"
                and x.get("project_id") == project_id
                and x.get("center_id") == center_id
                and x.get("partner_id") in (partner_a, partner_b)
                and abs(float(x.get("amount", 0)) - 50000.0) < 0.01]
        # Should be 2 txns (one per partner)
        assert len(txns) >= 2, f"expected 2 milestone txns, got {len(txns)}"
        partners_seen = {x["partner_id"] for x in txns}
        assert partner_a in partners_seen and partner_b in partners_seen
        assert all(x["status"] == "approved" for x in txns)
        total = sum(float(x["amount"]) for x in txns[:2])
        assert abs(total - 100000.0) < 0.5

    def test_receive_rounding_tail_three_partners(self, admin, project_id, center_id, partner_a, partner_b):
        # Create a 3rd partner
        p3 = admin.post(f"{API}/entities/partner", json={"name": f"TEST_iter12_pC_{TAG}"}, timeout=15).json()["id"]
        b = admin.post(f"{API}/batches", json={
            "project_id": project_id, "center_id": center_id,
            "partner_ids": [partner_a, partner_b, p3],
            "partner_share_percent": 100,
            "name": f"TEST_rounding_{TAG}",
        }, timeout=15).json()["id"]
        # amount=100 → 33.33 + 33.33 + 33.34
        pmt = admin.post(f"{API}/batch-payments", json={
            "batch_id": b, "milestone": "2nd", "amount": 100,
        }, timeout=15).json()
        rec = admin.patch(f"{API}/batch-payments/{pmt['id']}/receive", timeout=15)
        assert rec.status_code == 200
        t = admin.get(f"{API}/transactions", timeout=15).json()
        rel = [x for x in t if x.get("source") == "milestone" and x.get("milestone") == "2nd"
               and x.get("project_id") == project_id and x.get("partner_id") in (partner_a, partner_b, p3)
               and "TEST_rounding" in (x.get("description") or "")]
        assert len(rel) == 3, f"expected 3 split txns, got {len(rel)}"
        total = sum(float(x["amount"]) for x in rel)
        assert abs(total - 100.0) < 0.01, f"sum mismatch: {total}"

    def test_receive_without_partners_creates_one_txn(self, admin, batch_no_partners, project_id, center_id):
        pmt = admin.post(f"{API}/batch-payments", json={
            "batch_id": batch_no_partners, "milestone": "3rd", "amount": 25000,
        }, timeout=15).json()
        rec = admin.patch(f"{API}/batch-payments/{pmt['id']}/receive", timeout=15)
        assert rec.status_code == 200, rec.text
        t = admin.get(f"{API}/transactions", timeout=15).json()
        rel = [x for x in t if x.get("source") == "milestone" and x.get("milestone") == "3rd"
               and x.get("project_id") == project_id and x.get("center_id") == center_id
               and "TEST_nopart_batch" in (x.get("description") or "")]
        assert len(rel) == 1, f"expected exactly 1 unassigned txn, got {len(rel)}"
        assert rel[0].get("partner_id") in (None, "")
        assert rel[0]["status"] == "approved"
        assert abs(float(rel[0]["amount"]) - 25000.0) < 0.01


# ===== Milestone-income dashboard =====

class TestMilestoneIncomeDashboard:
    def test_admin_endpoint_returns_shape(self, admin):
        r = admin.get(f"{API}/dashboard/milestone-income", timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert set(["total", "by_milestone", "by_partner", "by_project", "count"]).issubset(data.keys())
        assert isinstance(data["total"], (int, float))
        assert set(["1st", "2nd", "3rd"]).issubset(data["by_milestone"].keys())
        assert isinstance(data["by_partner"], list)
        assert isinstance(data["by_project"], list)
        assert isinstance(data["count"], int)

    def test_project_filter_isolates_amounts(self, admin, project_id, partner_a, partner_b):
        r = admin.get(f"{API}/dashboard/milestone-income?project_id={project_id}", timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        # Should at least contain our 100000 (split) + 100 (rounding) + 25000 = 125100
        assert data["total"] >= 125100 - 0.5, f"unexpected total: {data['total']}"
        # By-milestone breakdown
        assert data["by_milestone"]["1st"] >= 100000 - 0.5
        assert data["by_milestone"]["2nd"] >= 100 - 0.01
        assert data["by_milestone"]["3rd"] >= 25000 - 0.5
        # partner_a and partner_b should appear
        partner_ids_in = {p.get("partner_id") for p in data["by_partner"]}
        assert partner_a in partner_ids_in
        assert partner_b in partner_ids_in
        # Unassigned partner_id grouped (None) due to no-partners batch
        unassigned = [p for p in data["by_partner"] if p["partner_id"] is None]
        assert unassigned, "Unassigned partner row missing"
        assert unassigned[0]["partner_name"] == "Unassigned"
        assert unassigned[0]["amount"] >= 25000 - 0.5
        # Project breakdown contains our project
        proj_ids = {p.get("project_id") for p in data["by_project"]}
        assert project_id in proj_ids
        # Count should be at least 2(split)+3(rounding)+1(unassigned) = 6
        assert data["count"] >= 6

    def test_unauth_returns_401(self):
        r = requests.get(f"{API}/dashboard/milestone-income", timeout=15)
        assert r.status_code in (401, 403)

    def test_date_filter(self, admin):
        # future date — should yield zero
        r = admin.get(f"{API}/dashboard/milestone-income?start=2099-01-01&end=2099-12-31", timeout=20)
        assert r.status_code == 200
        assert r.json()["count"] == 0
        assert r.json()["total"] == 0
