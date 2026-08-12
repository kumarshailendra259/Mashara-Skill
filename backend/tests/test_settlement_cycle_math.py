"""Phase 31 — Cycle-Based Partner Settlement Math tests.

User's confirmed formula:
  • A Contribution + B Contribution = Total Expense  (each = investment + expense)
  • Total Income − Total Expense = Profit/Loss
  • Final Share = Contribution + (Profit/Loss × 0.5)   [equal 50-50 split]
  • Only ACTIVE cycle txns (strictly AFTER last settlement date) are counted.

Scenario:
  Two partners at a center, seed 4 approved transactions.
  P1: investment 40,000 + expense 20,000  → contribution 60,000
  P2: investment 30,000 + expense 10,000  → contribution 40,000
  Center income: 20,000 to P1 (income partner column)

  total_contribution = 100,000
  total_income       = 20,000
  profit_loss        = -80,000
  profit_share_each  = -40,000
  fair_share         = 50,000
  P1 final_share     = 60,000 + (-40,000) = 20,000
  P2 final_share     = 40,000 + (-40,000) =      0
  P1 adjustment      = 50,000 - 60,000    = -10,000  (over-contributed → receive)
  P2 adjustment      = 50,000 - 40,000    =  10,000  (under-contributed → pay)
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
    tag = uuid.uuid4().hex[:6]
    c = admin.post(f"{BASE_URL}/api/entities/center", json={"name": f"TEST_cycle_{tag}"}).json()["id"]
    p1 = admin.post(f"{BASE_URL}/api/entities/partner", json={"name": f"TEST_cycleP1_{tag}"}).json()["id"]
    p2 = admin.post(f"{BASE_URL}/api/entities/partner", json={"name": f"TEST_cycleP2_{tag}"}).json()["id"]

    def _post(payload):
        r = admin.post(f"{BASE_URL}/api/transactions", json=payload)
        assert r.status_code == 200, r.text

    # Active cycle txns — all in 2027
    _post({"type": "investment", "amount": 40000, "date": "2027-01-05",
           "description": "TEST_cycle p1 inv", "center_id": c, "partner_id": p1})
    _post({"type": "expense", "amount": 20000, "date": "2027-01-06",
           "description": "TEST_cycle p1 exp", "center_id": c, "partner_id": p1})
    _post({"type": "investment", "amount": 30000, "date": "2027-01-07",
           "description": "TEST_cycle p2 inv", "center_id": c, "partner_id": p2})
    _post({"type": "expense", "amount": 10000, "date": "2027-01-08",
           "description": "TEST_cycle p2 exp", "center_id": c, "partner_id": p2})
    _post({"type": "income", "amount": 20000, "date": "2027-01-09",
           "description": "TEST_cycle p1 inc", "center_id": c, "partner_id": p1})
    return {"tag": tag, "center": c, "p1": p1, "p2": p2}


class TestCycleMath:
    def test_center_level_math(self, admin, seed):
        r = admin.get(f"{BASE_URL}/api/dashboard/settlement", params={"center_id": seed["center"]})
        assert r.status_code == 200, r.text
        body = r.json()
        assert len(body["centers"]) == 1
        c = body["centers"][0]

        # Center-level KPIs
        assert c["total_contribution"] == 100000
        assert c["total_income"] == 20000
        assert c["profit_loss"] == -80000
        assert c["profit_share_each"] == -40000
        assert c["fair_share_each"] == 50000
        assert c["partner_count"] == 2

    def test_partner_level_math(self, admin, seed):
        r = admin.get(f"{BASE_URL}/api/dashboard/settlement", params={"center_id": seed["center"]})
        c = r.json()["centers"][0]
        by_id = {p["id"]: p for p in c["partners"]}
        p1 = by_id[seed["p1"]]
        p2 = by_id[seed["p2"]]

        # Contribution = investment + expense
        assert p1["total_contribution"] == 60000
        assert p2["total_contribution"] == 40000

        # Equal 50/50 profit share
        assert p1["profit_share"] == -40000
        assert p2["profit_share"] == -40000

        # Final Share = Contribution + Profit Share
        assert p1["final_share"] == 20000
        assert p2["final_share"] == 0

        # Adjustment = fair_share - contribution
        assert p1["adjustment"] == -10000
        assert p2["adjustment"] == 10000

        # Zero-sum adjustments
        assert abs(sum(p["adjustment"] for p in c["partners"])) < 0.01

    def test_final_share_sum_equals_total_income(self, admin, seed):
        """Sanity: sum of final shares across all partners == total_income
        (because sum(contrib) + sum(profit_share) = total_contrib + profit_loss = total_income)."""
        r = admin.get(f"{BASE_URL}/api/dashboard/settlement", params={"center_id": seed["center"]})
        c = r.json()["centers"][0]
        total_final = sum(p["final_share"] for p in c["partners"])
        assert abs(total_final - c["total_income"]) < 0.01


class TestCycleReset:
    """After recording a settlement, only txns strictly AFTER the settlement date should count."""

    def test_settlement_creates_cycle_cutoff(self, admin, seed):
        # Record a settlement using date 2027-01-08 → txns on/before this date should be excluded.
        r = admin.post(f"{BASE_URL}/api/dashboard/settlement/record", json={
            "center_id": seed["center"],
            "from_partner_id": seed["p2"],
            "to_partner_id": seed["p1"],
            "amount": 10000,
            "date": "2027-01-08",
            "note": "TEST cycle close",
        })
        assert r.status_code == 201, r.text
        rec_id = r.json()["id"]

        try:
            # Now the active cycle should only contain the 2027-01-09 income row (P1 income 20000)
            r2 = admin.get(f"{BASE_URL}/api/dashboard/settlement", params={"center_id": seed["center"]})
            assert r2.status_code == 200
            centers = r2.json()["centers"]
            # Center may still show with income-only rows for P1
            c = next((x for x in centers if x["center_id"] == seed["center"]), None)
            assert c is not None
            assert c.get("settled_till") == "2027-01-08"
            # Active cycle: total_contribution == 0 (only income row exists post-cutoff)
            assert c["total_contribution"] == 0
            assert c["total_income"] == 20000
            assert c["profit_loss"] == 20000  # 20000 - 0
        finally:
            # cleanup
            admin.delete(f"{BASE_URL}/api/dashboard/settlement/record/{rec_id}")

    def test_include_history_returns_lifetime_block(self, admin, seed):
        r = admin.get(f"{BASE_URL}/api/dashboard/settlement",
                      params={"center_id": seed["center"], "include_history": "true"})
        assert r.status_code == 200
        c = r.json()["centers"][0]
        # No settlement recorded now → lifetime should still be present when history flag set
        assert "lifetime" in c
        lt = c["lifetime"]
        for k in ("total_contribution", "total_income", "profit_loss",
                  "fair_share_each", "partner_count", "partners"):
            assert k in lt
        assert lt["total_contribution"] == 100000
        assert lt["total_income"] == 20000
        assert lt["profit_loss"] == -80000
