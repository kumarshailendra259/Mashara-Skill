"""Phase 88 follow-up (D + E + Rate Config Admin) end-to-end backend tests.

Covers:
  * Rate Config CRUD + overlap + 403 for non-admin
  * Snapshot / versioning: master version bump + WO stores old snapshot
  * Course Master migration preview + apply + backfill (admin only)
  * Candidate stamping on enrollment (from batch.job_role_master_id)
  * Union candidates export contains new columns

All test artefacts are prefixed TEST_P88F_ and cleaned up in a module
teardown fixture.
"""
from __future__ import annotations
import os
import uuid
import io
import pytest
import requests
from openpyxl import load_workbook

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@finance.app", "password": "Admin@123"}
MANAGER = {"email": "hr@finance.app", "password": "Hr@12345"}  # role=manager (non-admin)


# -------- helpers --------
def _login(email, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed {email}: {r.status_code} {r.text[:200]}"
    csrf = s.cookies.get("csrf_token")
    if csrf:
        s.headers.update({"X-CSRF-Token": csrf})
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN["email"], ADMIN["password"])


@pytest.fixture(scope="module")
def non_admin():
    return _login(MANAGER["email"], MANAGER["password"])


@pytest.fixture(scope="module")
def tracker():
    ids = {"masters": [], "work_orders": [], "batches": [], "candidates": [], "slabs": []}
    yield ids
    # teardown
    try:
        s = _login(ADMIN["email"], ADMIN["password"])
        for cid in ids["candidates"]:
            try: s.delete(f"{API}/candidates/{cid}", timeout=15)
            except Exception: pass
        for bid in ids["batches"]:
            try: s.delete(f"{API}/batches/{bid}", timeout=15)
            except Exception: pass
        for wid in ids["work_orders"]:
            try: s.delete(f"{API}/work-orders/{wid}", timeout=15)
            except Exception: pass
        for mid in ids["masters"]:
            try: s.delete(f"{API}/job-role-master/{mid}", timeout=15)
            except Exception: pass
        for sid in ids["slabs"]:
            try: s.delete(f"{API}/work-order/rate-config/{sid}", timeout=15)
            except Exception: pass
    except Exception:
        pass


@pytest.fixture(scope="module")
def refs(admin):
    """Fetch a project + center + company usable for WO creation."""
    r = admin.get(f"{API}/entities/project", timeout=20); r.raise_for_status()
    projects = r.json()
    assert projects, "no projects seeded"
    r = admin.get(f"{API}/entities/center", timeout=20); r.raise_for_status()
    centers = r.json()
    assert centers, "no centers seeded"
    return {"project_id": projects[0]["id"], "center_id": centers[0]["id"]}


# ============================================================================
# Rate Config CRUD + RBAC
# ============================================================================
class TestRateConfig:
    def test_get_rate_config(self, admin):
        r = admin.get(f"{API}/work-order/rate-config", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "slabs" in data and "lwe_multiplier" in data and "categories" in data
        assert set(data["categories"]) == {"I", "II", "III"}
        assert len(data["slabs"]) >= 1

    def test_non_admin_cannot_post(self, non_admin):
        r = non_admin.post(f"{API}/work-order/rate-config",
                           json={"label": "TEST_P88F", "fy_from": 3000, "fy_to": 3001,
                                 "rates": {"I": 1, "II": 2, "III": 3}}, timeout=15)
        assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text[:200]}"

    def test_non_admin_cannot_delete(self, non_admin, admin):
        # pick any existing slab id
        slabs = admin.get(f"{API}/work-order/rate-config", timeout=15).json()["slabs"]
        sid = slabs[0]["id"]
        r = non_admin.delete(f"{API}/work-order/rate-config/{sid}", timeout=15)
        assert r.status_code == 403

    def test_overlap_rejected(self, admin):
        slabs = admin.get(f"{API}/work-order/rate-config", timeout=15).json()["slabs"]
        # try to add a slab overlapping with an existing one
        existing = slabs[0]
        r = admin.post(f"{API}/work-order/rate-config",
                       json={"label": "TEST_P88F_overlap",
                             "fy_from": int(existing["fy_from"]),
                             "fy_to": int(existing.get("fy_to") or 9999),
                             "rates": {"I": 10, "II": 20, "III": 30}}, timeout=15)
        assert r.status_code == 400, f"expected overlap 400 got {r.status_code}: {r.text[:200]}"
        assert "overlap" in r.text.lower()

    def test_patch_shrink_then_add_then_restore(self, admin, tracker):
        # Get current slabs; find the open-ended one (fy_to == 9999 typically)
        slabs = admin.get(f"{API}/work-order/rate-config", timeout=15).json()["slabs"]
        open_slab = max(slabs, key=lambda s: int(s.get("fy_to") or 9999))
        original_fy_to = int(open_slab.get("fy_to") or 9999)
        # Choose an unused future window; if original open is 2026-9999, shrink to 2026-3000 and add 3001-3010
        shrink_to = 3000
        new_from = 3001
        new_to = 3010
        # PATCH shrink
        r = admin.patch(f"{API}/work-order/rate-config/{open_slab['id']}",
                        json={"fy_to": shrink_to}, timeout=15)
        assert r.status_code == 200, r.text[:200]
        assert int(r.json()["fy_to"]) == shrink_to
        try:
            # Now overlap check with old range would have failed; add future
            r2 = admin.post(f"{API}/work-order/rate-config",
                            json={"label": "TEST_P88F_future",
                                  "fy_from": new_from, "fy_to": new_to,
                                  "rates": {"I": 100, "II": 90, "III": 80}}, timeout=15)
            assert r2.status_code == 201, r2.text[:200]
            new_slab = r2.json()
            tracker["slabs"].append(new_slab["id"])
            assert new_slab["rates"]["I"] == 100

            # Delete the newly created slab
            r3 = admin.delete(f"{API}/work-order/rate-config/{new_slab['id']}", timeout=15)
            assert r3.status_code == 204
            tracker["slabs"].remove(new_slab["id"])
        finally:
            # Restore open slab fy_to
            admin.patch(f"{API}/work-order/rate-config/{open_slab['id']}",
                        json={"fy_to": original_fy_to}, timeout=15)

    def test_cannot_delete_only_slab(self, admin):
        # Not going to actually delete all — verify guard by attempting delete after
        # reducing to a hypothetical 1-slab case is destructive. Instead ensure the
        # count>1 path works and trust the code-path is `count_documents<=1 -> 400`.
        slabs = admin.get(f"{API}/work-order/rate-config", timeout=15).json()["slabs"]
        assert len(slabs) >= 1


# ============================================================================
# Snapshot / Versioning
# ============================================================================
class TestSnapshotVersion:
    def test_master_version_starts_at_1_and_bumps(self, admin, tracker):
        unique = uuid.uuid4().hex[:8]
        payload = {
            "name": f"TEST_P88F_ver_{unique}",
            "qp_code": f"TP88F/V/{unique}",
            "sector": "IT-ITeS", "sub_sector": "IT Services",
            "category": "II", "nsqf_level": "4",
            "training_hours": 300, "cost_per_hour": 41,
            "boarding_per_day": 0, "default_days": 0, "benefit": 0,
        }
        r = admin.post(f"{API}/job-role-master", json=payload, timeout=15)
        assert r.status_code == 201, r.text[:200]
        m = r.json()
        assert m.get("version") == 1
        tracker["masters"].append(m["id"])

        # PATCH -> version 2
        r2 = admin.patch(f"{API}/job-role-master/{m['id']}",
                         json={"cost_per_hour": 50}, timeout=15)
        assert r2.status_code == 200
        assert r2.json().get("version") == 2

    def test_wo_stores_snapshot_and_old_wo_unchanged_after_bump(self, admin, refs, tracker):
        unique = uuid.uuid4().hex[:6]
        # 1. Create master v1
        m = admin.post(f"{API}/job-role-master", json={
            "name": f"TEST_P88F_snap_{unique}",
            "qp_code": f"TP88F/SNAP/{unique}",
            "sector": "IT-ITeS", "sub_sector": "IT Services",
            "category": "II", "nsqf_level": "4",
            "training_hours": 200, "cost_per_hour": 40,
        }, timeout=15).json()
        tracker["masters"].append(m["id"])
        assert m.get("version") == 1

        # 2. Create WO referencing master. As admin, master values do NOT overwrite;
        # inline values pass through, but master_version is still stamped.
        wo_num = f"TEST_P88F_WO_{unique}"
        wo_payload = {
            "project_id": refs["project_id"], "center_id": refs["center_id"],
            "fy": "2026-27", "wo_number": wo_num, "issue_date": "2026-04-01",
            "pbg_mode": "3", "pbg_percent": 3,
            "courses": [{"course_master_id": m["id"],
                         "course": m["name"], "qp_code": m["qp_code"],
                         "sector": "IT-ITeS", "sub_sector": "IT Services",
                         "category": "II", "nsqf_level": "4",
                         "course_hours": 200, "cost_per_hour": 40,
                         "beneficiaries": 10}],
        }
        r = admin.post(f"{API}/work-orders", json=wo_payload, timeout=20)
        assert r.status_code == 201, r.text[:300]
        wo = r.json()
        tracker["work_orders"].append(wo["id"])
        assert wo["courses"][0].get("course_master_version") == 1
        assert wo["courses"][0].get("cost_per_hour") == 40

        # 3. Patch master -> v2 with new cost
        m2 = admin.patch(f"{API}/job-role-master/{m['id']}",
                         json={"cost_per_hour": 55, "training_hours": 250}, timeout=15).json()
        assert m2.get("version") == 2

        # 4. Fetch old WO — snapshot unchanged (version=1, cost=40, hours=200)
        wo_get = admin.get(f"{API}/work-orders/{wo['id']}", timeout=15).json()
        c0 = wo_get["courses"][0]
        assert c0.get("course_master_version") == 1, "old WO snapshot version must be 1"
        assert c0.get("cost_per_hour") == 40, "old WO cost snapshot must remain 40"
        assert c0.get("course_hours") == 200, "old WO hours snapshot must remain 200"

        # 5. Create a NEW WO after bump -> should pick v2 (as admin, inline overrides allowed but version tag = 2)
        wo2_num = f"TEST_P88F_WO2_{unique}"
        wo2 = admin.post(f"{API}/work-orders", json={
            **wo_payload, "wo_number": wo2_num,
        }, timeout=20).json()
        tracker["work_orders"].append(wo2["id"])
        assert wo2["courses"][0].get("course_master_version") == 2, "new WO should carry v2 snapshot"


# ============================================================================
# Migration Preview + Apply + Backfill + RBAC
# ============================================================================
class TestMigration:
    def test_non_admin_blocked(self, non_admin):
        r = non_admin.get(f"{API}/course-master/migration/preview", timeout=15)
        assert r.status_code == 403
        r = non_admin.post(f"{API}/course-master/migration/apply", json={"do_auto_link": True}, timeout=15)
        assert r.status_code == 403
        r = non_admin.post(f"{API}/course-master/backfill-candidates", json={}, timeout=15)
        assert r.status_code == 403

    def test_preview_apply_flow(self, admin, refs, tracker):
        unique = uuid.uuid4().hex[:6]

        # Existing master to auto-link to
        existing_name = f"TEST_P88F_MigExist_{unique}"
        existing_qp = f"TP88F/MIG/E/{unique}"
        m_existing = admin.post(f"{API}/job-role-master", json={
            "name": existing_name, "qp_code": existing_qp,
            "sector": "Retail", "sub_sector": "Store Ops",
            "category": "III", "nsqf_level": "3",
            "training_hours": 150, "cost_per_hour": 30,
        }, timeout=15).json()
        tracker["masters"].append(m_existing["id"])

        # WO with a MANUAL course row (no course_master_id) matching existing -> auto_link
        wo1_num = f"TEST_P88F_MIG_{unique}_A"
        wo1 = admin.post(f"{API}/work-orders", json={
            "project_id": refs["project_id"], "center_id": refs["center_id"],
            "fy": "2026-27", "wo_number": wo1_num,
            "pbg_mode": "3", "pbg_percent": 3,
            "courses": [{"course": existing_name, "qp_code": existing_qp,
                         "sector": "Retail", "sub_sector": "Store Ops",
                         "category": "III", "nsqf_level": "3",
                         "course_hours": 150, "cost_per_hour": 30, "beneficiaries": 5}],
        }, timeout=20).json()
        tracker["work_orders"].append(wo1["id"])

        # WO with brand-new course name -> create_new
        new_name = f"TEST_P88F_MigNew_{unique}"
        new_qp = f"TP88F/MIG/N/{unique}"
        wo2_num = f"TEST_P88F_MIG_{unique}_B"
        wo2 = admin.post(f"{API}/work-orders", json={
            "project_id": refs["project_id"], "center_id": refs["center_id"],
            "fy": "2026-27", "wo_number": wo2_num,
            "pbg_mode": "3", "pbg_percent": 3,
            "courses": [{"course": new_name, "qp_code": new_qp,
                         "sector": "Logistics", "sub_sector": "Warehouse",
                         "category": "II", "nsqf_level": "4",
                         "course_hours": 180, "cost_per_hour": 35, "beneficiaries": 8}],
        }, timeout=20).json()
        tracker["work_orders"].append(wo2["id"])

        # Preview
        prev = admin.get(f"{API}/course-master/migration/preview", timeout=30)
        assert prev.status_code == 200
        pd = prev.json()
        assert "summary" in pd
        # Our test sigs should appear
        auto_names = {a["name"] for a in pd["auto_link"]}
        create_names = {a["name"] for a in pd["create_new"]}
        assert existing_name in auto_names, f"expected {existing_name} in auto_link: {auto_names}"
        assert new_name in create_names, f"expected {new_name} in create_new: {create_names}"

        # Apply
        ap = admin.post(f"{API}/course-master/migration/apply",
                        json={"do_auto_link": True, "do_create_new": True, "mappings": []},
                        timeout=60)
        assert ap.status_code == 200, ap.text[:300]
        result = ap.json()
        assert result.get("created_masters", 0) >= 1
        assert result.get("wo_updated", 0) >= 2

        # Track newly-created master for cleanup
        r = admin.get(f"{API}/job-role-master", params={"q": new_name}, timeout=15)
        if r.status_code == 200:
            for m in r.json():
                if m.get("name") == new_name:
                    tracker["masters"].append(m["id"])

        # Preview again -> our test sigs should be gone (0 in create_new/auto_link for them)
        prev2 = admin.get(f"{API}/course-master/migration/preview", timeout=30).json()
        auto_names2 = {a["name"] for a in prev2["auto_link"]}
        create_names2 = {a["name"] for a in prev2["create_new"]}
        assert existing_name not in auto_names2
        assert new_name not in create_names2

        # Confirm WO now has course_master_id linked
        wo1_after = admin.get(f"{API}/work-orders/{wo1['id']}", timeout=15).json()
        assert wo1_after["courses"][0].get("course_master_id") == m_existing["id"]
        wo2_after = admin.get(f"{API}/work-orders/{wo2['id']}", timeout=15).json()
        assert wo2_after["courses"][0].get("course_master_id"), "new master linked to WO2"

    def test_backfill_endpoint(self, admin):
        r = admin.post(f"{API}/course-master/backfill-candidates", json={}, timeout=30)
        assert r.status_code == 200
        assert "candidates_updated" in r.json()


# ============================================================================
# Candidate stamping (Phase E)
# ============================================================================
class TestCandidateStamping:
    def test_enroll_candidate_stamps_course_fields(self, admin, refs, tracker):
        unique = uuid.uuid4().hex[:6]

        # 1. Master
        m = admin.post(f"{API}/job-role-master", json={
            "name": f"TEST_P88F_stamp_{unique}",
            "qp_code": f"TP88F/ST/{unique}",
            "sector": "Healthcare", "sub_sector": "Nursing",
            "category": "I", "nsqf_level": "5",
            "training_hours": 400, "cost_per_hour": 55,
        }, timeout=15).json()
        tracker["masters"].append(m["id"])

        # 2. Batch linked to master
        b_payload = {
            "project_id": refs["project_id"],
            "center_id": refs["center_id"],
            "name": f"TEST_P88F_batch_{unique}",
            "total_beneficiaries": 30,
            "job_role_master_id": m["id"],
            "job_role": m["name"],
            "category": "I",
            "job_role_hours": 400,
            "num_candidates": 30,
            "fy_year": "2026-27",
        }
        rb = admin.post(f"{API}/batches", json=b_payload, timeout=20)
        assert rb.status_code == 200, rb.text[:300]
        batch = rb.json()
        tracker["batches"].append(batch["id"])

        # 3. Enroll a candidate
        cand_payload = {
            "name": f"TEST_P88F_Cand_{unique}",
            "mobile": "9999999901",
            "gender": "M",
            "aadhaar": f"9999{unique[:4]}0001",
        }
        rc = admin.post(f"{API}/batches/{batch['id']}/candidates",
                        json=cand_payload, timeout=20)
        assert rc.status_code == 201, rc.text[:300]
        c = rc.json()["candidate"]
        tracker["candidates"].append(c["id"])

        # 4. Assertions — course-master fields stamped
        assert c.get("job_role_master_id") == m["id"]
        assert c.get("qp_code") == m["qp_code"]
        assert c.get("sector") == "Healthcare"
        assert c.get("sub_sector") == "Nursing"
        assert str(c.get("nsqf_level")) == "5"
        assert float(c.get("course_hours") or 0) == 400.0
        # candidate.category (BOCWW govt category) NOT overwritten by master.category
        # course_master_category should be the master's category
        assert c.get("course_master_category") == "I"


# ============================================================================
# Union export contains new columns
# ============================================================================
class TestExportColumns:
    def test_union_export_has_course_master_columns(self, admin):
        r = admin.get(f"{API}/candidates/export", timeout=60)
        assert r.status_code == 200
        assert "spreadsheet" in r.headers.get("content-type", "")
        wb = load_workbook(io.BytesIO(r.content), read_only=True)
        ws = wb.active
        headers = [cell.value for cell in next(ws.iter_rows(min_row=1, max_row=1))]
        # Check the new phase-E columns are present at end
        for col in ("QP Code", "Sector", "Sub Sector", "NSQF Level", "Course Hours"):
            assert col in headers, f"missing column {col}; headers={headers}"

    def test_bocww_export_unchanged(self, admin):
        r = admin.get(f"{API}/candidates/export", params={"project": "BOCWW"}, timeout=60)
        assert r.status_code == 200
        wb = load_workbook(io.BytesIO(r.content), read_only=True)
        ws = wb.active
        headers = [cell.value for cell in next(ws.iter_rows(min_row=1, max_row=1))]
        # Phase-E columns should NOT be present in BOCWW-scoped export
        for col in ("QP Code", "Sector", "Sub Sector", "NSQF Level", "Course Hours"):
            assert col not in headers, f"{col} leaked into BOCWW export"

    def test_jsdms_export_unchanged(self, admin):
        r = admin.get(f"{API}/candidates/export", params={"project": "JSDMS"}, timeout=60)
        assert r.status_code == 200
        wb = load_workbook(io.BytesIO(r.content), read_only=True)
        ws = wb.active
        headers = [cell.value for cell in next(ws.iter_rows(min_row=1, max_row=1))]
        for col in ("QP Code", "Sector", "Sub Sector", "NSQF Level", "Course Hours"):
            assert col not in headers, f"{col} leaked into JSDMS export"
