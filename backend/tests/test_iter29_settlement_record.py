"""Iteration-29: Partner Settlement Record & Cutoff Logic.

Covers:
- POST /api/dashboard/settlement/record  -> 201 + record validation
- GET  /api/dashboard/settlement?include_history=true  -> cutoff + lifetime
- Future-date cutoff -> 0 partners + lifetime preserved
- GET  /api/dashboard/settlement/history?center_id=X  -> desc by date
- DELETE /api/dashboard/settlement/record/{id}  -> 204 + cutoff removed
- Permission gates (same-partner 400, missing center/partner 404, non-finance 403)
"""
import os
import uuid
import pytest
import requests


def _read_url():
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL"):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    return ""


BASE_URL = (os.environ.get("FINANCE_TEST_BASE_URL") or _read_url()).rstrip("/")
ADMIN_EMAIL = os.environ.get("FINANCE_TEST_ADMIN_EMAIL", "admin@finance.app")
ADMIN_PASSWORD = os.environ.get("FINANCE_TEST_ADMIN_PASSWORD", "Admin@123")


def _s():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin():
    s = _s()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def seed(admin):
    """Create isolated center + 2 partners + approved txns."""
    tag = uuid.uuid4().hex[:6]
    c = admin.post(f"{BASE_URL}/api/entities/center",
                   json={"name": f"TEST_iter29_C_{tag}"}).json()["id"]
    p1 = admin.post(f"{BASE_URL}/api/entities/partner",
                    json={"name": f"TEST_iter29_P1_{tag}"}).json()["id"]
    p2 = admin.post(f"{BASE_URL}/api/entities/partner",
                    json={"name": f"TEST_iter29_P2_{tag}"}).json()["id"]

    def _post(payload):
        r = admin.post(f"{BASE_URL}/api/transactions", json=payload)
        assert r.status_code == 200, r.text
        return r.json()

    # P1 net_contribution = 60000, P2 = 15000 -> total 75000, fair=37500
    _post({"type": "investment", "amount": 50000, "date": "2026-06-01",
           "description": "TEST_iter29_p1_inv", "center_id": c, "partner_id": p1})
    _post({"type": "expense", "amount": 10000, "date": "2026-06-02",
           "description": "TEST_iter29_p1_exp", "center_id": c, "partner_id": p1})
    _post({"type": "investment", "amount": 30000, "date": "2026-06-03",
           "description": "TEST_iter29_p2_inv", "center_id": c, "partner_id": p2})
    _post({"type": "income", "amount": 15000, "date": "2026-06-04",
           "description": "TEST_iter29_p2_inc", "center_id": c, "partner_id": p2})

    yield {"tag": tag, "center": c, "p1": p1, "p2": p2}

    # Cleanup any leftover settlement records for this center
    try:
        h = admin.get(f"{BASE_URL}/api/dashboard/settlement/history",
                      params={"center_id": c}).json().get("records", [])
        for rec in h:
            admin.delete(f"{BASE_URL}/api/dashboard/settlement/record/{rec['id']}")
    except Exception:
        pass


@pytest.fixture
def cleanup_after(admin, seed):
    """Per-test cleanup: remove any settlements created for the seeded center."""
    yield
    try:
        h = admin.get(f"{BASE_URL}/api/dashboard/settlement/history",
                      params={"center_id": seed["center"]}).json().get("records", [])
        for rec in h:
            admin.delete(f"{BASE_URL}/api/dashboard/settlement/record/{rec['id']}")
    except Exception:
        pass


# ---------- POST /record ----------
class TestRecordSettlement:
    def test_record_success(self, admin, seed, cleanup_after):
        body = {
            "center_id": seed["center"],
            "from_partner_id": seed["p2"],
            "to_partner_id": seed["p1"],
            "amount": 22500,
            "date": "2026-06-30",
            "note": "TEST iter29",
        }
        r = admin.post(f"{BASE_URL}/api/dashboard/settlement/record", json=body)
        assert r.status_code == 201, r.text
        data = r.json()
        assert "id" in data and isinstance(data["id"], str)
        assert data["center_id"] == seed["center"]
        assert data["from_partner_id"] == seed["p2"]
        assert data["to_partner_id"] == seed["p1"]
        assert data["amount"] == 22500.0
        assert data["date"] == "2026-06-30"
        assert data["from_partner_name"].startswith("TEST_iter29_P2_")
        assert data["to_partner_name"].startswith("TEST_iter29_P1_")
        assert data["center_name"].startswith("TEST_iter29_C_")
        assert data["recorded_by_name"]
        # _id (mongo) must NOT leak
        assert "_id" not in data

    def test_same_partner_400(self, admin, seed, cleanup_after):
        body = {
            "center_id": seed["center"],
            "from_partner_id": seed["p1"],
            "to_partner_id": seed["p1"],
            "amount": 100,
            "date": "2026-06-30",
        }
        r = admin.post(f"{BASE_URL}/api/dashboard/settlement/record", json=body)
        assert r.status_code == 400, r.text

    def test_missing_center_404(self, admin, seed, cleanup_after):
        body = {
            "center_id": "nonexistent-center-id",
            "from_partner_id": seed["p1"],
            "to_partner_id": seed["p2"],
            "amount": 100,
            "date": "2026-06-30",
        }
        r = admin.post(f"{BASE_URL}/api/dashboard/settlement/record", json=body)
        assert r.status_code == 404, r.text

    def test_missing_partner_404(self, admin, seed, cleanup_after):
        body = {
            "center_id": seed["center"],
            "from_partner_id": seed["p1"],
            "to_partner_id": "nonexistent-partner-id",
            "amount": 100,
            "date": "2026-06-30",
        }
        r = admin.post(f"{BASE_URL}/api/dashboard/settlement/record", json=body)
        assert r.status_code == 404, r.text


# ---------- GET /settlement with include_history & cutoff ----------
class TestSettlementCutoff:
    def test_cutoff_after_record(self, admin, seed, cleanup_after):
        # Record settlement dated 2026-06-30 — all txns are <= that, so all should be excluded
        rec = admin.post(f"{BASE_URL}/api/dashboard/settlement/record", json={
            "center_id": seed["center"],
            "from_partner_id": seed["p2"],
            "to_partner_id": seed["p1"],
            "amount": 22500,
            "date": "2026-06-30",
        }).json()
        assert "id" in rec

        r = admin.get(f"{BASE_URL}/api/dashboard/settlement",
                      params={"center_id": seed["center"], "include_history": "true"})
        assert r.status_code == 200, r.text
        centers = r.json()["centers"]
        assert len(centers) == 1
        ctr = centers[0]
        assert ctr["center_id"] == seed["center"]
        assert ctr["settled_till"] == "2026-06-30"
        assert ctr["last_settlement"]["id"] == rec["id"]
        # All txns are on/before cutoff -> current is 0
        assert ctr["total_contribution"] == 0
        assert ctr["partner_count"] == 0
        assert ctr["partners"] == []
        # Lifetime preserved
        assert ctr["lifetime"]["total_contribution"] == 75000
        assert ctr["lifetime"]["fair_share_each"] == 37500
        assert ctr["lifetime"]["partner_count"] == 2
        assert ctr["total_contribution"] <= ctr["lifetime"]["total_contribution"]

    def test_far_future_cutoff_resets_to_zero(self, admin, seed, cleanup_after):
        admin.post(f"{BASE_URL}/api/dashboard/settlement/record", json={
            "center_id": seed["center"],
            "from_partner_id": seed["p2"],
            "to_partner_id": seed["p1"],
            "amount": 22500,
            "date": "2099-12-31",
        })
        r = admin.get(f"{BASE_URL}/api/dashboard/settlement",
                      params={"center_id": seed["center"], "include_history": "true"})
        ctr = r.json()["centers"][0]
        assert ctr["total_contribution"] == 0
        assert ctr["partners"] == []
        assert ctr["settled_till"] == "2099-12-31"
        # Lifetime is FULL history regardless
        assert ctr["lifetime"]["total_contribution"] == 75000


# ---------- GET /history ----------
class TestSettlementHistory:
    def test_history_desc_order(self, admin, seed, cleanup_after):
        for d, amt in [("2026-06-15", 1000), ("2026-07-10", 2000), ("2026-05-20", 500)]:
            admin.post(f"{BASE_URL}/api/dashboard/settlement/record", json={
                "center_id": seed["center"],
                "from_partner_id": seed["p2"],
                "to_partner_id": seed["p1"],
                "amount": amt,
                "date": d,
            })
        r = admin.get(f"{BASE_URL}/api/dashboard/settlement/history",
                      params={"center_id": seed["center"]})
        assert r.status_code == 200
        records = r.json()["records"]
        assert len(records) == 3
        dates = [rec["date"] for rec in records]
        assert dates == sorted(dates, reverse=True)
        # Validate fields
        for rec in records:
            assert rec["center_id"] == seed["center"]
            assert "id" in rec and "from_partner_name" in rec
            assert "_id" not in rec


# ---------- DELETE /record/{id} ----------
class TestDeleteSettlement:
    def test_delete_removes_cutoff(self, admin, seed, cleanup_after):
        rec = admin.post(f"{BASE_URL}/api/dashboard/settlement/record", json={
            "center_id": seed["center"],
            "from_partner_id": seed["p2"],
            "to_partner_id": seed["p1"],
            "amount": 22500,
            "date": "2026-06-30",
        }).json()
        # Verify cutoff active (include_history needed because all txns <= cutoff -> 0 current activity)
        r1 = admin.get(f"{BASE_URL}/api/dashboard/settlement",
                       params={"center_id": seed["center"], "include_history": "true"})
        assert r1.json()["centers"][0].get("settled_till") == "2026-06-30"

        # DELETE
        rd = admin.delete(f"{BASE_URL}/api/dashboard/settlement/record/{rec['id']}")
        assert rd.status_code == 204, rd.text

        # Cutoff removed -> normal 2-partner view restored
        r2 = admin.get(f"{BASE_URL}/api/dashboard/settlement",
                       params={"center_id": seed["center"]})
        ctr = r2.json()["centers"][0]
        assert "settled_till" not in ctr
        assert ctr["total_contribution"] == 75000
        assert ctr["partner_count"] == 2

    def test_delete_404_for_unknown(self, admin):
        r = admin.delete(f"{BASE_URL}/api/dashboard/settlement/record/nonexistent-id")
        assert r.status_code == 404


# ---------- Permission gates ----------
@pytest.fixture(scope="module")
def role_sessions(admin, seed):
    """Create users for each restricted role and return sessions."""
    tag = seed["tag"]
    sessions = {}
    for role in ("viewer", "center_manager", "center_staff"):
        s = _s()
        email = f"TEST_iter29_{role}_{tag}@x.com"
        r = s.post(f"{BASE_URL}/api/auth/register",
                   json={"email": email, "password": "Pass1234",
                         "name": role, "role": "viewer"})
        assert r.status_code == 200, r.text
        uid = r.json()["id"]
        admin.patch(f"{BASE_URL}/api/auth/users/{uid}",
                    json={"role": role, "assigned_center_ids": [seed["center"]]})
        # re-login to pick up new role
        s2 = _s()
        s2.post(f"{BASE_URL}/api/auth/login",
                json={"email": email, "password": "Pass1234"})
        sessions[role] = s2
    return sessions


class TestPermissions:
    @pytest.mark.parametrize("role", ["viewer", "center_manager", "center_staff"])
    def test_get_settlement_forbidden(self, role_sessions, role):
        r = role_sessions[role].get(f"{BASE_URL}/api/dashboard/settlement")
        assert r.status_code == 403, f"{role} got {r.status_code}: {r.text}"

    @pytest.mark.parametrize("role", ["viewer", "center_manager", "center_staff"])
    def test_post_record_forbidden(self, role_sessions, role, seed):
        r = role_sessions[role].post(f"{BASE_URL}/api/dashboard/settlement/record", json={
            "center_id": seed["center"],
            "from_partner_id": seed["p1"],
            "to_partner_id": seed["p2"],
            "amount": 1,
            "date": "2026-06-30",
        })
        assert r.status_code == 403

    def test_delete_forbidden_for_partner(self, admin, seed, cleanup_after):
        """Partner role is finance_visible but NOT in DELETE allow-list."""
        # admin first creates a record
        rec = admin.post(f"{BASE_URL}/api/dashboard/settlement/record", json={
            "center_id": seed["center"],
            "from_partner_id": seed["p2"],
            "to_partner_id": seed["p1"],
            "amount": 100,
            "date": "2026-06-30",
        }).json()
        # Register partner-role user mapped to p1
        s = _s()
        email = f"TEST_iter29_partner_del_{seed['tag']}_{uuid.uuid4().hex[:4]}@x.com"
        s.post(f"{BASE_URL}/api/auth/register",
               json={"email": email, "password": "Pass1234", "name": "PartnerUser", "role": "viewer"})
        uid = s.get(f"{BASE_URL}/api/auth/me").json()["id"]
        admin.patch(f"{BASE_URL}/api/auth/users/{uid}",
                    json={"role": "partner", "assigned_partner_id": seed["p1"]})
        s2 = _s()
        s2.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": "Pass1234"})
        r = s2.delete(f"{BASE_URL}/api/dashboard/settlement/record/{rec['id']}")
        assert r.status_code == 403, r.text
