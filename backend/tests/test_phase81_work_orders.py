"""Phase 81 — Work Order backend regression tests.

Covers CRUD, auto-compute correctness, override, effective status,
financials aggregation, target-allocation enrichment, and RBAC.
"""
from __future__ import annotations
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://invest-analytics-24.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@finance.app", "password": "Admin@123"}
PARTNER = {"email": "kumarshailendra259@gmail.com", "password": "Test@1234"}


def _login(email: str, password: str) -> requests.Session:
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text[:300]}"
    csrf = s.cookies.get("csrf_token")
    if csrf:
        s.headers.update({"X-CSRF-Token": csrf})
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_session():
    return _login(ADMIN["email"], ADMIN["password"])


@pytest.fixture(scope="module")
def partner_session():
    try:
        return _login(PARTNER["email"], PARTNER["password"])
    except AssertionError:
        pytest.skip("partner login not available")


@pytest.fixture(scope="module")
def scope_ids(admin_session):
    """Reuse project/center IDs from the existing seeded WO 'WO-TEST-001' so we
    stay on the same Project+Centre+FY the review request pins."""
    r = admin_session.get(f"{API}/work-orders", timeout=30)
    assert r.status_code == 200, r.text[:200]
    arr = r.json()
    if arr:
        wo = arr[0]
        return {"project_id": wo["project_id"], "center_id": wo["center_id"]}
    # fallback — derive from any target row
    t = admin_session.get(f"{API}/batch-targets", timeout=30).json()
    assert t, "need seed data (WO or target) to derive scope"
    return {"project_id": t[0]["project_id"], "center_id": t[0]["center_id"]}


def _course(**overrides):
    base = dict(
        sector="IT-ITeS", sub_sector="ITeS", course="Domestic Data Entry",
        qp_code="SSC/Q2212", category="Fresh", nsqf_level="4",
        course_hours=300, cost_per_hour=56.35,
        boarding_per_day=200, boarding_days=30, beneficiaries=30,
    )
    base.update(overrides)
    return base


# ============== CREATE + AUTO COMPUTE ==============
class TestWorkOrderCRUD:
    def test_create_with_computed_value_and_pbg(self, admin_session, scope_ids):
        wo_num = f"WO-TEST-{uuid.uuid4().hex[:8].upper()}"
        payload = {
            "project_id": scope_ids["project_id"],
            "center_id": scope_ids["center_id"],
            "fy": "2026-27",
            "wo_number": wo_num,
            "loi_number": "LOI-TEST-001",
            "issue_date": "2026-01-05",
            "expiry_date": "2027-03-31",
            "status": "active",
            "pbg_mode": "3",
            "pbg_percent": 3,
            "courses": [_course()],
        }
        r = admin_session.post(f"{API}/work-orders", json=payload, timeout=30)
        assert r.status_code == 201, f"{r.status_code}: {r.text[:400]}"
        data = r.json()
        # Auto-compute correctness: 300 * 56.35 * 30 = 507150 ; 200*30*30 = 180000 ; total 687150
        assert data["total_training_fee"] == 507150.0
        assert data["total_boarding_cost"] == 180000.0
        assert data["work_order_value"] == 687150.0
        assert data["pbg_amount"] == 20614.5
        assert data["effective_status"] == "active"
        assert data["total_beneficiaries"] == 30
        assert data["project_name"] and data["center_name"]
        # persist id for downstream tests
        pytest.wo_id = data["id"]
        pytest.wo_number = wo_num

    def test_get_by_id(self, admin_session):
        wid = getattr(pytest, "wo_id", None)
        if not wid:
            pytest.skip("no WO id from create test")
        r = admin_session.get(f"{API}/work-orders/{wid}", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["id"] == wid
        assert data["work_order_value"] == 687150.0

    def test_list_includes_created(self, admin_session):
        wid = getattr(pytest, "wo_id", None)
        r = admin_session.get(f"{API}/work-orders", timeout=30)
        assert r.status_code == 200
        assert any(d["id"] == wid for d in r.json())

    def test_update_beneficiaries_recomputes(self, admin_session, scope_ids):
        wid = getattr(pytest, "wo_id", None)
        payload = {
            "project_id": scope_ids["project_id"],
            "center_id": scope_ids["center_id"],
            "fy": "2026-27",
            "wo_number": pytest.wo_number,
            "pbg_mode": "3", "pbg_percent": 3,
            "status": "active",
            "courses": [_course(beneficiaries=60)],
        }
        r = admin_session.patch(f"{API}/work-orders/{wid}", json=payload, timeout=30)
        assert r.status_code == 200, r.text[:400]
        data = r.json()
        # doubles fees
        assert data["total_training_fee"] == 1014300.0
        assert data["total_boarding_cost"] == 360000.0
        assert data["work_order_value"] == 1374300.0
        assert data["pbg_amount"] == 41229.0

    def test_value_override_takes_precedence(self, admin_session, scope_ids):
        wid = getattr(pytest, "wo_id", None)
        payload = {
            "project_id": scope_ids["project_id"],
            "center_id": scope_ids["center_id"],
            "fy": "2026-27",
            "wo_number": pytest.wo_number,
            "pbg_mode": "5", "pbg_percent": 5,
            "work_order_value_override": 1000000,
            "status": "active",
            "courses": [_course(beneficiaries=60)],
        }
        r = admin_session.patch(f"{API}/work-orders/{wid}", json=payload, timeout=30)
        assert r.status_code == 200, r.text[:400]
        data = r.json()
        assert data["work_order_value"] == 1000000.0
        assert data["computed_value"] == 1374300.0  # underlying stays
        assert data["pbg_amount"] == 50000.0  # 5% of override

    def test_expired_work_order_effective_status(self, admin_session, scope_ids):
        payload = {
            "project_id": scope_ids["project_id"],
            "center_id": scope_ids["center_id"],
            "fy": "2024-25",
            "wo_number": f"WO-EXPIRED-{uuid.uuid4().hex[:6]}",
            "expiry_date": "2024-01-01",
            "status": "active",
            "pbg_mode": "3", "pbg_percent": 3,
            "courses": [_course(beneficiaries=10)],
        }
        r = admin_session.post(f"{API}/work-orders", json=payload, timeout=30)
        assert r.status_code == 201
        data = r.json()
        assert data["effective_status"] == "expired"
        pytest.wo_expired_id = data["id"]

    def test_cancelled_status(self, admin_session, scope_ids):
        payload = {
            "project_id": scope_ids["project_id"],
            "center_id": scope_ids["center_id"],
            "fy": "2026-27",
            "wo_number": f"WO-CANC-{uuid.uuid4().hex[:6]}",
            "status": "cancelled",
            "pbg_mode": "3", "pbg_percent": 3,
            "courses": [_course(beneficiaries=5)],
        }
        r = admin_session.post(f"{API}/work-orders", json=payload, timeout=30)
        assert r.status_code == 201
        assert r.json()["effective_status"] == "cancelled"
        pytest.wo_cancelled_id = r.json()["id"]

    def test_status_filter_surfaces_inactive(self, admin_session):
        r = admin_session.get(f"{API}/work-orders", params={"status": "expired"}, timeout=30)
        assert r.status_code == 200
        assert any(d.get("effective_status") == "expired" for d in r.json())


# ============== FINANCIALS DASHBOARD ==============
class TestFinancials:
    def test_financials_shape(self, admin_session):
        r = admin_session.get(f"{API}/batch-management/financials", timeout=30)
        assert r.status_code == 200
        data = r.json()
        for k in ("cards", "summary_rows", "grand_total"):
            assert k in data
        cards = data["cards"]
        for k in ("total_work_order_value", "total_pbg_amount", "allocated_value",
                  "average_work_order_value", "active_work_orders"):
            assert k in cards
        # only active WOs count — expired/cancelled should not inflate
        assert cards["total_work_order_value"] >= 1000000.0  # our overridden active WO

    def test_financials_filter_by_status_expired(self, admin_session):
        r = admin_session.get(f"{API}/batch-management/financials",
                              params={"status": "expired"}, timeout=30)
        assert r.status_code == 200
        # With status=expired filter, only expired WOs enter, and after that
        # the "active" cut ends up with 0. This validates the filter is applied.
        data = r.json()
        # summary rows only built from active-effective; expired filtered set
        # yields active_work_orders == 0 in cards.
        assert data["cards"]["active_work_orders"] == 0

    def test_summary_grand_total_consistency(self, admin_session):
        r = admin_session.get(f"{API}/batch-management/financials", timeout=30)
        data = r.json()
        rows = data["summary_rows"]
        gt = data["grand_total"]
        s_val = round(sum(r["total_wo_value"] for r in rows), 2)
        s_pbg = round(sum(r["pbg_amount"] for r in rows), 2)
        assert abs(s_val - gt["total_wo_value"]) < 0.05
        assert abs(s_pbg - gt["pbg_amount"]) < 0.05


# ============== TARGET ALLOCATION ENRICHMENT ==============
class TestTargetAllocationEnrichment:
    def test_targets_have_work_order_value_field(self, admin_session):
        r = admin_session.get(f"{API}/batch-targets", timeout=30)
        assert r.status_code == 200
        arr = r.json()
        if not arr:
            pytest.skip("no batch targets seeded")
        # every row must expose work_order_value + center_wo_value (Phase 81 enrichment)
        assert all("work_order_value" in row for row in arr)
        assert all("center_wo_value" in row for row in arr)


# ============== RBAC ==============
class TestRBAC:
    def test_partner_cannot_read_work_orders(self, partner_session):
        r = partner_session.get(f"{API}/work-orders", timeout=30)
        assert r.status_code == 403, f"expected 403, got {r.status_code}"

    def test_partner_cannot_read_financials(self, partner_session):
        r = partner_session.get(f"{API}/batch-management/financials", timeout=30)
        assert r.status_code == 403


# ============== CLEANUP (runs last) ==============
class TestZCleanup:
    def test_delete_admin_only(self, admin_session):
        for attr in ("wo_id", "wo_expired_id", "wo_cancelled_id"):
            wid = getattr(pytest, attr, None)
            if not wid:
                continue
            r = admin_session.delete(f"{API}/work-orders/{wid}", timeout=30)
            assert r.status_code in (204, 200), f"delete {attr} failed: {r.status_code}"

    def test_delete_returns_404_after(self, admin_session):
        wid = getattr(pytest, "wo_id", None)
        if not wid:
            pytest.skip()
        r = admin_session.get(f"{API}/work-orders/{wid}", timeout=30)
        assert r.status_code == 404
