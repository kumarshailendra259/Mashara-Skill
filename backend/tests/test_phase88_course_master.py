"""Phase 88 — Course / Job Role Master + WO integration.

Verifies CRUD, duplicate guard, usage, WO integration (course_master_id resolve),
value/pbg math, and non-admin enforcement (master overwrites tampered fields).
Cleans up all TEST_ course masters + WOs it creates.
"""
from __future__ import annotations
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@finance.app", "password": "Admin@123"}
COMPANY_ADMIN = {"email": "companyadmin1@x.com", "password": "Test@1234"}
MANAGER = {"email": "hr@finance.app", "password": "Hr@12345"}  # role=manager


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
def admin():
    return _login(ADMIN["email"], ADMIN["password"])


@pytest.fixture(scope="module")
def created_ids():
    """Track resource ids for cleanup teardown."""
    ids = {"course_masters": [], "work_orders": []}
    yield ids
    # cleanup — admin session for teardown
    try:
        s = _login(ADMIN["email"], ADMIN["password"])
        for wid in ids["work_orders"]:
            try:
                s.delete(f"{API}/work-orders/{wid}", timeout=15)
            except Exception:
                pass
        for cid in ids["course_masters"]:
            try:
                s.delete(f"{API}/job-role-master/{cid}", timeout=15)  # soft delete
            except Exception:
                pass
    except Exception:
        pass


@pytest.fixture(scope="module")
def scope_ids(admin):
    r = admin.get(f"{API}/work-orders", timeout=30)
    assert r.status_code == 200
    arr = r.json()
    if arr:
        return {"project_id": arr[0]["project_id"], "center_id": arr[0]["center_id"]}
    t = admin.get(f"{API}/batch-targets", timeout=30).json()
    assert t
    return {"project_id": t[0]["project_id"], "center_id": t[0]["center_id"]}


# ---------- Course Master CRUD ----------
class TestCourseMasterCRUD:
    def test_create_full_fields_and_default_hours_sync(self, admin, created_ids):
        suffix = uuid.uuid4().hex[:8]
        payload = {
            "name": f"TEST_Role_{suffix}",
            "qp_code": f"TEST-QP-{suffix}",
            "sector": "IT-ITeS",
            "sub_sector": "IT Services",
            "category": "1",
            "nsqf_level": "4",
            "qp_hours": 400, "training_hours": 300,
            "cost_per_hour": 41, "boarding_per_day": 100,
            "default_days": 30, "benefit": 500,
            "description": "phase88 test", "effective_from": "2025-04-01",
            "effective_to": "2026-03-31", "active": True,
        }
        r = admin.post(f"{API}/job-role-master", json=payload, timeout=30)
        assert r.status_code == 201, r.text[:300]
        d = r.json()
        created_ids["course_masters"].append(d["id"])
        assert d["name"] == payload["name"]
        assert d["qp_code"] == payload["qp_code"]
        assert float(d["training_hours"]) == 300
        # default_hours must be auto-synced to training_hours
        assert float(d["default_hours"]) == 300, f"default_hours not synced: {d.get('default_hours')}"
        assert d["active"] is True

    def test_duplicate_name_returns_409(self, admin, created_ids):
        suffix = uuid.uuid4().hex[:8]
        base = {"name": f"TEST_DupName_{suffix}", "qp_code": f"TEST-QPDN-{suffix}",
                "training_hours": 200, "cost_per_hour": 40}
        r = admin.post(f"{API}/job-role-master", json=base, timeout=30)
        assert r.status_code == 201
        created_ids["course_masters"].append(r.json()["id"])
        # duplicate name only
        r2 = admin.post(f"{API}/job-role-master", json={**base, "qp_code": f"OTHER-{suffix}"}, timeout=30)
        assert r2.status_code == 409
        assert "already exists in Course Master" in r2.text or "already exists" in r2.text

    def test_duplicate_qp_returns_409(self, admin, created_ids):
        suffix = uuid.uuid4().hex[:8]
        base = {"name": f"TEST_DupQP_{suffix}", "qp_code": f"TEST-QPDQ-{suffix}",
                "training_hours": 100, "cost_per_hour": 30}
        r = admin.post(f"{API}/job-role-master", json=base, timeout=30)
        assert r.status_code == 201
        created_ids["course_masters"].append(r.json()["id"])
        # duplicate qp only
        r2 = admin.post(f"{API}/job-role-master", json={**base, "name": f"TEST_OTHER_{suffix}"}, timeout=30)
        assert r2.status_code == 409

    def test_patch_updates_and_sets_updated_by(self, admin, created_ids):
        suffix = uuid.uuid4().hex[:8]
        r = admin.post(f"{API}/job-role-master", json={
            "name": f"TEST_Patch_{suffix}", "qp_code": f"TEST-QPP-{suffix}",
            "training_hours": 100, "cost_per_hour": 20}, timeout=30)
        assert r.status_code == 201
        rid = r.json()["id"]
        created_ids["course_masters"].append(rid)
        r2 = admin.patch(f"{API}/job-role-master/{rid}",
                         json={"training_hours": 250, "cost_per_hour": 55}, timeout=30)
        assert r2.status_code == 200, r2.text[:300]
        d = r2.json()
        assert float(d["training_hours"]) == 250
        assert float(d["default_hours"]) == 250, "default_hours must sync when training_hours patched"
        assert float(d["cost_per_hour"]) == 55
        assert d.get("updated_by")
        assert d.get("updated_at")

    def test_patch_duplicate_collision_returns_409(self, admin, created_ids):
        s = uuid.uuid4().hex[:8]
        a = admin.post(f"{API}/job-role-master", json={"name": f"TEST_A_{s}", "qp_code": f"TEST-A-{s}",
                                                       "training_hours": 100, "cost_per_hour": 30}, timeout=30).json()
        b = admin.post(f"{API}/job-role-master", json={"name": f"TEST_B_{s}", "qp_code": f"TEST-B-{s}",
                                                       "training_hours": 100, "cost_per_hour": 30}, timeout=30).json()
        created_ids["course_masters"] += [a["id"], b["id"]]
        # rename B -> A (collision)
        r = admin.patch(f"{API}/job-role-master/{b['id']}", json={"name": a["name"]}, timeout=30)
        assert r.status_code == 409

    def test_delete_soft_deactivates(self, admin, created_ids):
        s = uuid.uuid4().hex[:8]
        r = admin.post(f"{API}/job-role-master", json={"name": f"TEST_Del_{s}", "qp_code": f"TEST-DEL-{s}",
                                                       "training_hours": 50, "cost_per_hour": 10}, timeout=30)
        rid = r.json()["id"]
        created_ids["course_masters"].append(rid)
        d = admin.delete(f"{API}/job-role-master/{rid}", timeout=15)
        assert d.status_code == 204
        # GET active_only=false should still find it and active=false
        lst = admin.get(f"{API}/job-role-master?active_only=false", timeout=30).json()
        found = [x for x in lst if x["id"] == rid]
        assert found and found[0]["active"] is False

    def test_list_filters_and_with_usage(self, admin, created_ids):
        s = uuid.uuid4().hex[:8]
        r = admin.post(f"{API}/job-role-master", json={
            "name": f"TEST_Filter_{s}", "qp_code": f"TEST-FLT-{s}",
            "sector": "Agriculture", "category": "2",
            "training_hours": 120, "cost_per_hour": 20}, timeout=30).json()
        created_ids["course_masters"].append(r["id"])
        # q= name
        lst = admin.get(f"{API}/job-role-master?q=TEST_Filter_{s}", timeout=30).json()
        assert any(x["id"] == r["id"] for x in lst)
        # sector filter
        lst = admin.get(f"{API}/job-role-master?sector=Agriculture", timeout=30).json()
        assert any(x["id"] == r["id"] for x in lst)
        # category filter
        lst = admin.get(f"{API}/job-role-master?category=2", timeout=30).json()
        assert any(x["id"] == r["id"] for x in lst)
        # with_usage
        lst = admin.get(f"{API}/job-role-master?with_usage=true&q=TEST_Filter_{s}", timeout=30).json()
        assert lst and "usage" in lst[0]
        u = lst[0]["usage"]
        assert set(u.keys()) >= {"work_orders", "batches", "candidates"}

    def test_usage_endpoint_404_unknown(self, admin):
        r = admin.get(f"{API}/job-role-master/{uuid.uuid4().hex}/usage", timeout=15)
        assert r.status_code == 404


# ---------- WO integration ----------
class TestWorkOrderIntegration:
    def _course(self, master_id, **overrides):
        base = dict(
            course_master_id=master_id,
            sector="IT-ITeS", sub_sector="IT Services",
            course="X", qp_code="X", category="1", nsqf_level="4",
            course_hours=300, cost_per_hour=41,
            boarding_per_day=0, boarding_days=0,
            beneficiaries=20,
        )
        base.update(overrides)
        return base

    def test_wo_create_with_course_master_id_stores_and_computes(self, admin, scope_ids, created_ids):
        s = uuid.uuid4().hex[:8]
        cm = admin.post(f"{API}/job-role-master", json={
            "name": f"TEST_WOMaster_{s}", "qp_code": f"TEST-WOM-{s}",
            "sector": "IT-ITeS", "sub_sector": "IT Services",
            "category": "1", "nsqf_level": "4",
            "training_hours": 300, "cost_per_hour": 41,
            "boarding_per_day": 0, "default_days": 0}, timeout=30).json()
        created_ids["course_masters"].append(cm["id"])
        payload = {
            **scope_ids,
            "fy": "2026-27", "wo_number": f"TEST-WO-{s}",
            "issue_date": "2025-04-01", "expiry_date": "2027-03-31",
            "status": "active", "pbg_mode": "3", "pbg_percent": 3,
            "courses": [self._course(cm["id"])],
        }
        r = admin.post(f"{API}/work-orders", json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text[:400]
        wo = r.json()
        created_ids["work_orders"].append(wo["id"])
        # 300 * 41 * 20 = 246000, pbg 3% = 7380
        assert wo["work_order_value"] == 246000, f"got {wo['work_order_value']}"
        assert wo["pbg_amount"] == 7380
        assert wo["courses"][0]["course_master_id"] == cm["id"]
        # usage counter goes up
        u = admin.get(f"{API}/job-role-master/{cm['id']}/usage", timeout=15).json()
        assert u["work_orders"] >= 1

    def test_admin_override_kept_when_submitted(self, admin, scope_ids, created_ids):
        """Admin sends different sector/cost — the submitted values must be kept
        even though course_master_id is recorded."""
        s = uuid.uuid4().hex[:8]
        cm = admin.post(f"{API}/job-role-master", json={
            "name": f"TEST_AdmOv_{s}", "qp_code": f"TEST-AO-{s}",
            "sector": "IT-ITeS", "training_hours": 100, "cost_per_hour": 41}, timeout=30).json()
        created_ids["course_masters"].append(cm["id"])
        payload = {
            **scope_ids, "fy": "2026-27", "wo_number": f"TEST-WO-AO-{s}",
            "issue_date": "2025-04-01", "expiry_date": "2027-03-31",
            "status": "active", "pbg_mode": "3", "pbg_percent": 3,
            "courses": [self._course(cm["id"],
                                     sector="Overridden Sector",
                                     course="Overridden Course",
                                     cost_per_hour=99,
                                     course_hours=100,
                                     beneficiaries=1)],
        }
        r = admin.post(f"{API}/work-orders", json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text[:400]
        wo = r.json()
        created_ids["work_orders"].append(wo["id"])
        c0 = wo["courses"][0]
        assert c0["course_master_id"] == cm["id"]
        # admin override kept
        assert c0["sector"] == "Overridden Sector", c0
        assert c0["cost_per_hour"] == 99, c0

    def test_wo_without_course_master_still_works(self, admin, scope_ids, created_ids):
        s = uuid.uuid4().hex[:8]
        payload = {
            **scope_ids, "fy": "2026-27", "wo_number": f"TEST-WO-NoMaster-{s}",
            "issue_date": "2025-04-01", "expiry_date": "2027-03-31",
            "status": "active", "pbg_mode": "3", "pbg_percent": 3,
            "courses": [dict(
                sector="Manual", course="Manual Role", qp_code="MAN-01",
                category="1", nsqf_level="4",
                course_hours=200, cost_per_hour=50,
                boarding_per_day=0, boarding_days=0, beneficiaries=10,
            )],
        }
        r = admin.post(f"{API}/work-orders", json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text[:400]
        wo = r.json()
        created_ids["work_orders"].append(wo["id"])
        # 200 * 50 * 10 = 100000
        assert wo["work_order_value"] == 100000
        assert wo["pbg_amount"] == 3000
        assert wo["courses"][0].get("course_master_id") in (None, "")


class TestNonAdminEnforcement:
    """As NON-admin (manager), tampered/blank descriptive+rate fields must be
    overwritten from the Course Master."""

    @pytest.fixture(scope="class")
    def manager(self):
        try:
            return _login(MANAGER["email"], MANAGER["password"])
        except AssertionError:
            pytest.skip("manager account not available")

    @pytest.fixture(scope="class")
    def mgr_scope(self, manager):
        r = manager.get(f"{API}/work-orders", timeout=30)
        arr = r.json() if r.status_code == 200 else []
        if not arr:
            pytest.skip("no WO scope available for manager")
        return {"project_id": arr[0]["project_id"], "center_id": arr[0]["center_id"]}

    def test_manager_tampered_fields_overwritten_by_master(self, admin, manager, mgr_scope, created_ids):
        s = uuid.uuid4().hex[:8]
        cm = admin.post(f"{API}/job-role-master", json={
            "name": f"TEST_MgrEnforce_{s}", "qp_code": f"TEST-MENF-{s}",
            "sector": "MasterSector", "sub_sector": "MasterSubSector",
            "category": "1", "nsqf_level": "5",
            "training_hours": 300, "cost_per_hour": 41,
            "boarding_per_day": 0, "default_days": 0}, timeout=30).json()
        created_ids["course_masters"].append(cm["id"])
        payload = {
            **mgr_scope, "fy": "2026-27", "wo_number": f"TEST-MGR-WO-{s}",
            "issue_date": "2025-04-01", "expiry_date": "2027-03-31",
            "status": "active", "pbg_mode": "3", "pbg_percent": 3,
            "courses": [dict(
                course_master_id=cm["id"],
                sector="",  # blank — must be filled from master
                sub_sector="TAMPERED",  # tampered — must be overwritten
                course="WRONG",
                qp_code="WRONG",
                category="9",
                nsqf_level="9",
                course_hours=1,   # tampered rate — overwrite
                cost_per_hour=1,
                boarding_per_day=0, boarding_days=0,
                beneficiaries=20,
            )],
        }
        r = manager.post(f"{API}/work-orders", json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text[:400]
        wo = r.json()
        created_ids["work_orders"].append(wo["id"])
        c0 = wo["courses"][0]
        assert c0["course_master_id"] == cm["id"]
        # master values enforced
        assert c0["sector"] == "MasterSector", c0
        assert c0["sub_sector"] == "MasterSubSector", c0
        assert c0["course"] == f"TEST_MgrEnforce_{s}", c0
        assert c0["qp_code"] == f"TEST-MENF-{s}", c0
        assert c0["category"] == "1", c0
        assert c0["nsqf_level"] == "5", c0
        assert c0["course_hours"] == 300, c0
        assert c0["cost_per_hour"] == 41, c0
        # beneficiaries kept from client
        assert c0["beneficiaries"] == 20
        # WO value recomputed with master rates: 300 * 41 * 20 = 246000
        assert wo["work_order_value"] == 246000
        assert wo["pbg_amount"] == 7380
