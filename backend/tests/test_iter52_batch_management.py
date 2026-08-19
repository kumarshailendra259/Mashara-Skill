"""
Iter 52 — Phase 37 Batch Management (Stage 1 Target Allocation + Stage 2 Batch Creation)
Tests /api/batch-targets CRUD, RBAC, and target-gated batch create/delete.
"""
import os
import uuid
import asyncio
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE}/api"

ADMIN = {"email": "admin@finance.app", "password": "Admin@123"}


@pytest.fixture(scope="module")
def admin_sess():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=ADMIN, timeout=30)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def project_id(admin_sess):
    r = admin_sess.get(f"{API}/entities/project", timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert len(data) > 0
    return data[0]["id"]


@pytest.fixture(scope="module")
def center_id(admin_sess, project_id):
    r = admin_sess.get(f"{API}/entities/center", timeout=30)
    assert r.status_code == 200
    data = r.json()
    if not data:
        return None
    return data[0]["id"]


# ==== Target Allocation CRUD ====

class TestBatchTargets:
    created_ids = []

    def test_create_target_valid(self, admin_sess, project_id):
        payload = {
            "project_id": project_id,
            "target_year": "2025-26",
            "fy": "2025-26",
            "training_type": "STT",
            "state": "Delhi",
            "territory": "North",
            "job_role_targets": [
                {"job_role": "Data Entry Op", "count": 30},
                {"job_role": "CRM Executive", "count": 20},
            ],
            "total_target": 50,
            "remarks": "iter52 test target",
        }
        r = admin_sess.post(f"{API}/batch-targets", json=payload, timeout=30)
        assert r.status_code == 201, r.text
        d = r.json()
        assert d["id"] and d["total_target"] == 50
        assert d["allocated"] == 0 and d["remaining"] == 50
        assert d["project_name"]  # enriched
        TestBatchTargets.created_ids.append(d["id"])

    def test_create_target_mismatch_total(self, admin_sess, project_id):
        payload = {
            "project_id": project_id,
            "target_year": "2025-26",
            "job_role_targets": [{"job_role": "X", "count": 10}],
            "total_target": 99,  # doesn't match
        }
        r = admin_sess.post(f"{API}/batch-targets", json=payload, timeout=30)
        assert r.status_code == 400
        assert "sum of job_role_targets" in r.text or "total_target" in r.text

    def test_create_target_zero(self, admin_sess, project_id):
        payload = {
            "project_id": project_id,
            "target_year": "2025-26",
            "job_role_targets": [],
            "total_target": 0,
        }
        r = admin_sess.post(f"{API}/batch-targets", json=payload, timeout=30)
        assert r.status_code in (400, 422)

    def test_create_target_bad_project(self, admin_sess):
        payload = {
            "project_id": "does-not-exist",
            "target_year": "2025-26",
            "job_role_targets": [{"job_role": "X", "count": 5}],
            "total_target": 5,
        }
        r = admin_sess.post(f"{API}/batch-targets", json=payload, timeout=30)
        assert r.status_code == 400

    def test_list_targets(self, admin_sess, project_id):
        r = admin_sess.get(f"{API}/batch-targets", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list) and len(data) >= 1

    def test_list_only_available(self, admin_sess):
        r = admin_sess.get(f"{API}/batch-targets", params={"only_available": "true"}, timeout=30)
        assert r.status_code == 200
        for t in r.json():
            assert t["remaining"] > 0

    def test_get_target(self, admin_sess):
        assert TestBatchTargets.created_ids
        tid = TestBatchTargets.created_ids[0]
        r = admin_sess.get(f"{API}/batch-targets/{tid}", timeout=30)
        assert r.status_code == 200
        assert r.json()["id"] == tid

    def test_get_target_404(self, admin_sess):
        r = admin_sess.get(f"{API}/batch-targets/nonexistent", timeout=30)
        assert r.status_code == 404

    def test_patch_target_shrink_below_allocated_ok_when_no_alloc(self, admin_sess, project_id):
        tid = TestBatchTargets.created_ids[0]
        payload = {
            "project_id": project_id,
            "target_year": "2025-26",
            "job_role_targets": [{"job_role": "A", "count": 40}],
            "total_target": 40,
        }
        r = admin_sess.patch(f"{API}/batch-targets/{tid}", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["total_target"] == 40
        assert r.json()["remaining"] == 40


# ==== Target-gated batch creation ====

class TestBatchTargetConsumption:
    tid = None
    batch_ids = []

    @pytest.fixture(scope="class", autouse=True)
    def setup_target(self, admin_sess, project_id):
        payload = {
            "project_id": project_id,
            "target_year": "2025-26",
            "job_role_targets": [{"job_role": "R1", "count": 100}],
            "total_target": 100,
        }
        r = admin_sess.post(f"{API}/batch-targets", json=payload, timeout=30)
        assert r.status_code == 201
        TestBatchTargetConsumption.tid = r.json()["id"]
        yield
        # cleanup
        for bid in TestBatchTargetConsumption.batch_ids:
            admin_sess.delete(f"{API}/batches/{bid}", timeout=30)
        admin_sess.delete(f"{API}/batch-targets/{TestBatchTargetConsumption.tid}", timeout=30)

    def test_batch_consumes_target(self, admin_sess, project_id):
        payload = {
            "project_id": project_id,
            "target_id": self.tid,
            "name": f"TEST_BM_{uuid.uuid4().hex[:6]}",
            "total_beneficiaries": 30,
        }
        r = admin_sess.post(f"{API}/batches", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["target_id"] == self.tid
        TestBatchTargetConsumption.batch_ids.append(b["id"])
        # verify target updated
        t = admin_sess.get(f"{API}/batch-targets/{self.tid}", timeout=30).json()
        assert t["allocated"] == 30 and t["remaining"] == 70

    def test_batch_insufficient_target(self, admin_sess, project_id):
        payload = {
            "project_id": project_id,
            "target_id": self.tid,
            "name": f"TEST_BM_OVER_{uuid.uuid4().hex[:6]}",
            "total_beneficiaries": 999,
        }
        r = admin_sess.post(f"{API}/batches", json=payload, timeout=30)
        assert r.status_code == 400
        assert "Insufficient" in r.text or "remaining" in r.text.lower()

    def test_batch_project_coherence(self, admin_sess, project_id):
        # Find a different project
        projects = admin_sess.get(f"{API}/entities/project", timeout=30).json()
        other = next((p for p in projects if p["id"] != project_id), None)
        if not other:
            pytest.skip("Only one project available")
        payload = {
            "project_id": other["id"],
            "target_id": self.tid,
            "name": f"TEST_BM_MIS_{uuid.uuid4().hex[:6]}",
            "total_beneficiaries": 5,
        }
        r = admin_sess.post(f"{API}/batches", json=payload, timeout=30)
        assert r.status_code == 400
        assert "project_id" in r.text

    def test_legacy_batch_no_target(self, admin_sess, project_id):
        payload = {
            "project_id": project_id,
            "name": f"TEST_LEGACY_{uuid.uuid4().hex[:6]}",
            "total_beneficiaries": 5,
        }
        r = admin_sess.post(f"{API}/batches", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b.get("target_id") in (None, "")
        TestBatchTargetConsumption.batch_ids.append(b["id"])

    def test_delete_batch_releases_target(self, admin_sess, project_id):
        # create a batch with target consumption
        payload = {
            "project_id": project_id,
            "target_id": self.tid,
            "name": f"TEST_REL_{uuid.uuid4().hex[:6]}",
            "total_beneficiaries": 15,
        }
        r = admin_sess.post(f"{API}/batches", json=payload, timeout=30)
        assert r.status_code == 200
        bid = r.json()["id"]
        pre = admin_sess.get(f"{API}/batch-targets/{self.tid}").json()
        # delete
        r2 = admin_sess.delete(f"{API}/batches/{bid}", timeout=30)
        assert r2.status_code in (200, 204)
        post = admin_sess.get(f"{API}/batch-targets/{self.tid}").json()
        assert post["remaining"] == pre["remaining"] + 15
        assert post["allocated"] == pre["allocated"] - 15

    def test_target_batches_list(self, admin_sess):
        r = admin_sess.get(f"{API}/batch-targets/{self.tid}/batches", timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_delete_target_with_allocated_fails(self, admin_sess, project_id):
        # setup: create a target and consume some
        p = {
            "project_id": project_id,
            "target_year": "2025-26",
            "job_role_targets": [{"job_role": "X", "count": 10}],
            "total_target": 10,
        }
        t = admin_sess.post(f"{API}/batch-targets", json=p).json()
        b = admin_sess.post(f"{API}/batches", json={
            "project_id": project_id, "target_id": t["id"],
            "name": f"TEST_DELG_{uuid.uuid4().hex[:6]}", "total_beneficiaries": 5,
        }).json()
        TestBatchTargetConsumption.batch_ids.append(b["id"])
        r = admin_sess.delete(f"{API}/batch-targets/{t['id']}", timeout=30)
        assert r.status_code == 400
        # cleanup
        admin_sess.delete(f"{API}/batches/{b['id']}")
        admin_sess.delete(f"{API}/batch-targets/{t['id']}")

    def test_concurrent_consume_no_over(self, admin_sess, project_id):
        # create target with capacity 10
        t = admin_sess.post(f"{API}/batch-targets", json={
            "project_id": project_id, "target_year": "2025-26",
            "job_role_targets": [{"job_role": "C", "count": 10}], "total_target": 10,
        }).json()
        tid = t["id"]

        # fire 3 parallel batch creates of 6 each — only one should succeed (or two if 6+6 fits? no, 10<12)
        import concurrent.futures
        def create():
            return requests.Session()  # placeholder — we'll reuse admin_sess cookies

        # reuse cookies via new sessions
        cookies = admin_sess.cookies
        def make_batch(i):
            s = requests.Session()
            s.cookies.update(cookies)
            return s.post(f"{API}/batches", json={
                "project_id": project_id, "target_id": tid,
                "name": f"TEST_CC_{i}_{uuid.uuid4().hex[:5]}",
                "total_beneficiaries": 6,
            }, timeout=30)

        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
            results = list(ex.map(make_batch, range(3)))
        successes = [r for r in results if r.status_code == 200]
        assert len(successes) == 1, f"Expected exactly 1 success got {len(successes)}: {[r.status_code for r in results]}"

        # verify target: consumed exactly 6
        final = admin_sess.get(f"{API}/batch-targets/{tid}").json()
        assert final["allocated"] == 6 and final["remaining"] == 4

        # cleanup
        for r in successes:
            admin_sess.delete(f"{API}/batches/{r.json()['id']}")
        admin_sess.delete(f"{API}/batch-targets/{tid}")


# ==== RBAC ====

class TestRBAC:
    def test_unauth_create_403(self):
        r = requests.post(f"{API}/batch-targets", json={
            "project_id": "x", "target_year": "2025", "total_target": 5,
            "job_role_targets": [{"job_role": "x", "count": 5}],
        }, timeout=30)
        assert r.status_code in (401, 403)

    def test_unauth_list_403(self):
        r = requests.get(f"{API}/batch-targets", timeout=30)
        assert r.status_code in (401, 403)


# ==== Cleanup ====

def test_zz_cleanup(admin_sess):
    # Delete any remaining test targets
    for tid in TestBatchTargets.created_ids:
        admin_sess.delete(f"{API}/batch-targets/{tid}", timeout=30)
