"""Phase 38 Session 1 — Work Order Rate Engine + Job Role Master + District LWE.

Tests /api/work-order/rate-config, /api/work-order/calculate,
/api/job-role-master, /api/districts/{cid}/lwe, plus Batch create/update
authoritative rate recomputation.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@finance.app", "password": "Admin@123"}


# ---------- fixtures ----------
@pytest.fixture(scope="session")
def admin_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=ADMIN, timeout=15)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="session")
def project_and_center(admin_session):
    """Return (project_id, center_id) — reuse from an existing batch."""
    batches = admin_session.get(f"{API}/batches?limit=200").json()
    assert isinstance(batches, list) and batches, "No batches seeded"
    for b in batches:
        if b.get("project_id") and b.get("center_id"):
            return b["project_id"], b["center_id"]
    pytest.skip("No batch with both project_id and center_id found")


# ============  1. Rate config seeded  ============
class TestRateConfig:
    def test_get_rate_config_seeded(self, admin_session):
        r = admin_session.get(f"{API}/work-order/rate-config")
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["lwe_multiplier"] == 1.10
        assert j["categories"] == ["I", "II", "III"]
        slabs = {s["id"]: s for s in j["slabs"]}
        assert "slab-legacy" in slabs and "slab-2026" in slabs
        assert slabs["slab-legacy"]["fy_from"] == 0
        assert slabs["slab-legacy"]["fy_to"] == 2025
        assert slabs["slab-legacy"]["rates"] == {"I": 49.00, "II": 42.00, "III": 35.10}
        assert slabs["slab-2026"]["fy_from"] == 2026
        assert slabs["slab-2026"]["fy_to"] == 9999
        assert slabs["slab-2026"]["rates"] == {"I": 56.35, "II": 52.50, "III": 36.85}


# ============  2. Rate matrix (12 cases)  ============
RATE_MATRIX = [
    # (fy, category, is_lwe, expected_final_rate)
    ("2025-26", "I",   False, 49.00),
    ("2025-26", "II",  False, 42.00),
    ("2025-26", "III", False, 35.10),
    ("2025-26", "I",   True,  53.90),
    ("2025-26", "II",  True,  46.20),
    ("2025-26", "III", True,  38.61),
    ("2026-27", "I",   False, 56.35),
    ("2026-27", "II",  False, 52.50),
    ("2026-27", "III", False, 36.85),
    ("2026-27", "I",   True,  61.985),
    ("2026-27", "II",  True,  57.75),
    ("2026-27", "III", True,  40.535),
]


class TestRateMatrix:
    @pytest.mark.parametrize("fy,cat,lwe,expected", RATE_MATRIX)
    def test_matrix(self, admin_session, fy, cat, lwe, expected):
        r = admin_session.post(f"{API}/work-order/calculate",
                                json={"fy_year": fy, "category": cat, "is_lwe": lwe,
                                       "num_candidates": 0, "job_role_hours": 0})
        assert r.status_code == 200, r.text
        j = r.json()
        assert abs(j["final_rate"] - expected) < 0.001, \
            f"FY {fy} {cat} lwe={lwe}: got {j['final_rate']} expected {expected}"

    def test_calc_work_order_value(self, admin_session):
        """FY 2026-27 + Cat I + LWE + 10 cands × 8h → final 61.985, WO value 4958.80"""
        r = admin_session.post(f"{API}/work-order/calculate",
                                json={"fy_year": "2026-27", "category": "I", "is_lwe": True,
                                       "num_candidates": 10, "job_role_hours": 8})
        assert r.status_code == 200
        j = r.json()
        assert j["final_rate"] == 61.985
        assert j["work_order_value"] == 4958.80
        assert j["slab_label"] == "2026-27 & later"
        assert j["is_lwe"] is True
        assert j["base_rate"] == 56.35


# ============  3. Invalid inputs  ============
class TestCalculateInvalid:
    def test_bad_fy(self, admin_session):
        r = admin_session.post(f"{API}/work-order/calculate",
                                json={"fy_year": "foobar", "category": "I"})
        assert r.status_code == 400

    def test_invalid_category(self, admin_session):
        r = admin_session.post(f"{API}/work-order/calculate",
                                json={"fy_year": "2026-27", "category": "IV"})
        assert r.status_code == 400

    def test_missing_category(self, admin_session):
        r = admin_session.post(f"{API}/work-order/calculate",
                                json={"fy_year": "2026-27"})
        assert r.status_code == 400


# ============  4. district_id / center is_lwe lookup  ============
class TestDistrictLWELookup:
    def test_calculate_uses_center_lwe(self, admin_session, project_and_center):
        _, center_id = project_and_center
        # Set center is_lwe = True
        r = admin_session.patch(f"{API}/districts/{center_id}/lwe",
                                 json={"is_lwe": True})
        assert r.status_code == 200
        assert r.json().get("is_lwe") is True

        # Now calculate without passing is_lwe — should use center's is_lwe=True
        r = admin_session.post(f"{API}/work-order/calculate",
                                json={"fy_year": "2026-27", "category": "I",
                                       "district_id": center_id,
                                       "num_candidates": 1, "job_role_hours": 1})
        assert r.status_code == 200
        j = r.json()
        assert j["is_lwe"] is True
        assert j["final_rate"] == 61.985

        # cleanup — reset to False
        admin_session.patch(f"{API}/districts/{center_id}/lwe", json={"is_lwe": False})

    def test_lwe_nonexistent_center(self, admin_session):
        r = admin_session.patch(f"{API}/districts/does-not-exist-xyz/lwe",
                                 json={"is_lwe": True})
        assert r.status_code == 404


# ============  5. Rate-config PATCH (admin-only)  ============
class TestRateConfigPatch:
    def test_admin_patch_slab_valid(self, admin_session):
        # Patch label only (safe), then restore
        r = admin_session.patch(f"{API}/work-order/rate-config/slab-2026",
                                 json={"label": "2026-27 & later"})
        assert r.status_code == 200

    def test_invalid_category_key_rejected(self, admin_session):
        r = admin_session.patch(f"{API}/work-order/rate-config/slab-2026",
                                 json={"rates": {"IV": 100}})
        assert r.status_code == 400


# ============  6. Job Role Master CRUD  ============
class TestJobRoleMaster:
    _created_id = None

    def test_list_authed(self, admin_session):
        r = admin_session.get(f"{API}/job-role-master")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_and_dedupe(self, admin_session):
        name = f"TEST_JR_{uuid.uuid4().hex[:6]}"
        r = admin_session.post(f"{API}/job-role-master",
                                json={"name": name, "default_hours": 8})
        assert r.status_code == 201, r.text
        data = r.json()
        assert data["name"] == name
        assert data["default_hours"] == 8
        assert data["active"] is True
        TestJobRoleMaster._created_id = data["id"]

        # Dedupe (case-insensitive)
        r2 = admin_session.post(f"{API}/job-role-master",
                                 json={"name": name.lower(), "default_hours": 4})
        assert r2.status_code == 409

    def test_patch_update(self, admin_session):
        rid = TestJobRoleMaster._created_id
        assert rid, "prior create test must run first"
        r = admin_session.patch(f"{API}/job-role-master/{rid}",
                                 json={"default_hours": 10})
        assert r.status_code == 200
        assert r.json()["default_hours"] == 10

    def test_delete_soft(self, admin_session):
        rid = TestJobRoleMaster._created_id
        assert rid
        r = admin_session.delete(f"{API}/job-role-master/{rid}")
        assert r.status_code == 204
        # Confirm not in active list
        actives = admin_session.get(f"{API}/job-role-master").json()
        assert not any(x["id"] == rid for x in actives)
        # Confirm still exists when active_only=false
        all_roles = admin_session.get(f"{API}/job-role-master?active_only=false").json()
        assert any(x["id"] == rid and x.get("active") is False for x in all_roles)


# ============  7. Batch create/update authoritative rate  ============
class TestBatchAuthoritativeRate:
    def test_create_batch_recomputes_ignoring_bogus_rate(self, admin_session, project_and_center):
        project_id, center_id = project_and_center
        # Force center is_lwe=True
        admin_session.patch(f"{API}/districts/{center_id}/lwe", json={"is_lwe": True})
        try:
            body = {
                "project_id": project_id,
                "center_id": center_id,
                "name": f"TEST_WO_{uuid.uuid4().hex[:6]}",
                "fy_year": "2026-27",
                "category": "I",
                "num_candidates": 10,
                "job_role_hours": 8,
                # Bogus values that MUST be overwritten by backend
                "base_rate": 999999,
                "final_rate": 999999,
                "work_order_value": 999999,
            }
            r = admin_session.post(f"{API}/batches", json=body)
            assert r.status_code == 200, r.text
            b = r.json()
            assert b["base_rate"] == 56.35
            assert b["final_rate"] == 61.985
            assert b["is_lwe"] is True
            assert b["work_order_value"] == 4958.80
            bid = b["id"]

            # PUT — change num_candidates to 5, expect recompute
            body2 = {**body, "num_candidates": 5, "final_rate": 12345}
            r2 = admin_session.put(f"{API}/batches/{bid}", json=body2)
            assert r2.status_code == 200, r2.text
            b2 = r2.json()
            assert b2["final_rate"] == 61.985
            assert b2["work_order_value"] == round(5 * 61.985 * 8, 2)  # 2479.4
        finally:
            admin_session.patch(f"{API}/districts/{center_id}/lwe", json={"is_lwe": False})

    def test_create_batch_without_fy_category_no_rate(self, admin_session, project_and_center):
        """Legacy compatibility: batch created without fy_year/category has rate=0."""
        project_id, center_id = project_and_center
        body = {
            "project_id": project_id,
            "center_id": center_id,
            "name": f"TEST_LEGACY_{uuid.uuid4().hex[:6]}",
        }
        r = admin_session.post(f"{API}/batches", json=body)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b.get("base_rate", 0) == 0
        assert b.get("final_rate", 0) == 0
        assert b.get("work_order_value", 0) == 0
