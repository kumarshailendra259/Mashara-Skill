"""Iteration-6: Partner settlement dashboard view tests.

Covers GET /api/dashboard/settlement:
- auth required (401 without cookie)
- partner-role scoping (only own centers)
- admin filter via ?center_id=X
- admin without filter (all partner-bearing centers)
- math: net_contribution, fair_share, adjustment sum ≈ 0
- approved-only filtering (pending/rejected excluded)
- date filter ?start=&end=
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
def setup_centers(admin):
    """Create an isolated center with 2 partners and approved txns:
       P1: investment 50K, expense 10K  -> net 60K
       P2: investment 30K, income   15K -> net 15K
       total 75K, fair share 37500, adj P1 = -22500 (receive), P2 = +22500 (pay).
       Also create a pending txn (should be excluded) and a 2nd isolated center
       with 1 partner for admin-without-filter test.
    """
    tag = uuid.uuid4().hex[:6]
    # entities
    c = admin.post(f"{BASE_URL}/api/entities/center",
                   json={"name": f"TEST_settle_center_{tag}"}).json()["id"]
    p1 = admin.post(f"{BASE_URL}/api/entities/partner",
                    json={"name": f"TEST_settle_P1_{tag}"}).json()["id"]
    p2 = admin.post(f"{BASE_URL}/api/entities/partner",
                    json={"name": f"TEST_settle_P2_{tag}"}).json()["id"]

    def _post(payload):
        r = admin.post(f"{BASE_URL}/api/transactions", json=payload)
        assert r.status_code == 200, r.text
        return r.json()

    _post({"type": "investment", "amount": 50000, "date": "2026-06-01",
           "description": "TEST_set_p1_inv", "center_id": c, "partner_id": p1})
    _post({"type": "expense", "amount": 10000, "date": "2026-06-02",
           "description": "TEST_set_p1_exp", "center_id": c, "partner_id": p1})
    _post({"type": "investment", "amount": 30000, "date": "2026-06-03",
           "description": "TEST_set_p2_inv", "center_id": c, "partner_id": p2})
    _post({"type": "income", "amount": 15000, "date": "2026-06-04",
           "description": "TEST_set_p2_inc", "center_id": c, "partner_id": p2})

    # pending txn (admin posts are auto-approved, so use a non-admin path):
    # register a CM scoped to this center to create a pending txn
    cm = _s()
    email = f"TEST_settle_cm_{tag}@x.com"
    rr = cm.post(f"{BASE_URL}/api/auth/register",
                 json={"email": email, "password": "Pass1234", "name": "CM", "role": "viewer"})
    assert rr.status_code == 200
    uid = rr.json()["id"]
    admin.patch(f"{BASE_URL}/api/auth/users/{uid}",
                json={"role": "center_manager", "assigned_center_ids": [c]})
    rp = cm.post(f"{BASE_URL}/api/transactions",
                 json={"type": "income", "amount": 99999, "date": "2026-06-05",
                       "description": "TEST_pending_should_be_excluded",
                       "center_id": c, "partner_id": p1})
    assert rp.status_code == 200 and rp.json()["status"] == "pending"

    # Second isolated center with one partner (for admin no-filter check)
    c2 = admin.post(f"{BASE_URL}/api/entities/center",
                    json={"name": f"TEST_settle_center2_{tag}"}).json()["id"]
    _post({"type": "investment", "amount": 1000, "date": "2026-06-10",
           "description": "TEST_c2_inv", "center_id": c2, "partner_id": p1})

    return {"tag": tag, "center": c, "center2": c2, "p1": p1, "p2": p2}


@pytest.fixture(scope="module")
def partner_session(admin, setup_centers):
    """Register a user, promote to partner with assigned_partner_id=p1."""
    s = _s()
    email = f"TEST_settle_partner_{setup_centers['tag']}@x.com"
    r = s.post(f"{BASE_URL}/api/auth/register",
               json={"email": email, "password": "Pass1234", "name": "P", "role": "viewer"})
    assert r.status_code == 200
    uid = r.json()["id"]
    r2 = admin.patch(f"{BASE_URL}/api/auth/users/{uid}",
                     json={"role": "partner", "assigned_partner_id": setup_centers["p1"]})
    assert r2.status_code == 200, r2.text
    me = s.get(f"{BASE_URL}/api/auth/me").json()
    assert me["role"] == "partner" and me["assigned_partner_id"] == setup_centers["p1"]
    return s


# ----- Auth -----
class TestAuth:
    def test_settlement_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/dashboard/settlement")
        assert r.status_code == 401


# ----- Response shape & math -----
class TestSettlementMath:
    def test_admin_with_center_id(self, admin, setup_centers):
        r = admin.get(f"{BASE_URL}/api/dashboard/settlement",
                      params={"center_id": setup_centers["center"]})
        assert r.status_code == 200, r.text
        body = r.json()
        assert "centers" in body and isinstance(body["centers"], list)
        # only the requested center should appear
        assert len(body["centers"]) == 1
        ctr = body["centers"][0]
        assert ctr["center_id"] == setup_centers["center"]
        for k in ("center_name", "total_contribution", "fair_share_each",
                  "partner_count", "partners"):
            assert k in ctr
        assert ctr["partner_count"] == 2
        # total_contribution = 50000+10000 + 30000-15000 = 75000
        assert ctr["total_contribution"] == 75000
        assert ctr["fair_share_each"] == 37500
        p_by_id = {p["id"]: p for p in ctr["partners"]}
        p1 = p_by_id[setup_centers["p1"]]
        p2 = p_by_id[setup_centers["p2"]]
        # net contributions
        assert p1["net_contribution"] == 60000
        assert p2["net_contribution"] == 15000
        # adjustments
        assert p1["adjustment"] == -22500   # receive
        assert p2["adjustment"] == 22500    # pay
        # sum of adjustments ≈ 0
        assert abs(sum(p["adjustment"] for p in ctr["partners"])) < 0.01
        # profit_share = income - expense
        assert p1["profit_share"] == -10000
        assert p2["profit_share"] == 15000
        # per-partner field presence
        for p in ctr["partners"]:
            for k in ("id", "name", "investment", "income", "expense",
                      "net_contribution", "profit_share", "fair_share", "adjustment"):
                assert k in p

    def test_pending_excluded(self, admin, setup_centers):
        r = admin.get(f"{BASE_URL}/api/dashboard/settlement",
                      params={"center_id": setup_centers["center"]})
        ctr = r.json()["centers"][0]
        # If 99999 pending had been included, P1 income would skew net_contrib hugely.
        p1 = next(p for p in ctr["partners"] if p["id"] == setup_centers["p1"])
        assert p1["income"] == 0
        assert p1["net_contribution"] == 60000


# ----- Partner scoping -----
class TestPartnerScope:
    def test_partner_sees_only_their_centers(self, partner_session, setup_centers):
        r = partner_session.get(f"{BASE_URL}/api/dashboard/settlement")
        assert r.status_code == 200, r.text
        body = r.json()
        center_ids = [c["center_id"] for c in body["centers"]]
        # Partner P1 has txns in both center and center2
        assert setup_centers["center"] in center_ids
        assert setup_centers["center2"] in center_ids
        # And own data is visible
        ctr = next(c for c in body["centers"] if c["center_id"] == setup_centers["center"])
        ids = {p["id"] for p in ctr["partners"]}
        assert setup_centers["p1"] in ids


# ----- Admin global view & filters -----
class TestAdminGlobal:
    def test_admin_no_filter_includes_partner_centers(self, admin, setup_centers):
        r = admin.get(f"{BASE_URL}/api/dashboard/settlement")
        assert r.status_code == 200
        cids = [c["center_id"] for c in r.json()["centers"]]
        assert setup_centers["center"] in cids
        assert setup_centers["center2"] in cids

    def test_date_filter_excludes_out_of_range(self, admin, setup_centers):
        # range that excludes all txns in 'center'
        r = admin.get(f"{BASE_URL}/api/dashboard/settlement",
                      params={"center_id": setup_centers["center"],
                              "start": "2027-01-01", "end": "2027-12-31"})
        assert r.status_code == 200
        # since no approved txns in that window, center disappears
        cids = [c["center_id"] for c in r.json()["centers"]]
        assert setup_centers["center"] not in cids

    def test_date_filter_includes_in_range(self, admin, setup_centers):
        r = admin.get(f"{BASE_URL}/api/dashboard/settlement",
                      params={"center_id": setup_centers["center"],
                              "start": "2026-06-01", "end": "2026-06-30"})
        assert r.status_code == 200
        ctrs = r.json()["centers"]
        assert len(ctrs) == 1
        assert ctrs[0]["total_contribution"] == 75000
