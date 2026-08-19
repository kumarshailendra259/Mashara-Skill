"""Iteration 54 — Phase 37 · Phase 3: Assessment (Stage 5), Placement (Stage 6),
Attendance CSV export.

Endpoints under test:
- PATCH /api/batches/{bid}/assessment
- POST  /api/batches/{bid}/candidates/{cid}/assessment
- POST  /api/batches/{bid}/candidates/assessment/bulk
- GET   /api/batches/{bid}/assessment/summary
- PATCH /api/batches/{bid}/candidates/{cid}/placement (400 for non-certified 'placed')
- POST  /api/batches/{bid}/candidates/placement/bulk (silently skips non-certified)
- GET   /api/batches/{bid}/placement/summary
- GET   /api/batches/{bid}/attendance/export.csv
"""
import io
import os
import csv
import uuid
from datetime import date, timedelta

import pytest
import requests


def _load_base_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if not v:
        env_path = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", ".env")
        try:
            with open(env_path) as f:
                for line in f:
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        v = line.strip().split("=", 1)[1]
                        break
        except FileNotFoundError:
            pass
    if not v:
        raise RuntimeError("REACT_APP_BACKEND_URL not set")
    return v.rstrip("/")


BASE_URL = _load_base_url()
ADMIN_EMAIL = "admin@finance.app"
ADMIN_PASSWORD = "Admin@123"


# -------------- Session / fixtures --------------
@pytest.fixture(scope="session")
def admin_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={
        "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="session")
def project_id(admin_session):
    r = admin_session.get(f"{BASE_URL}/api/entities/project")
    r.raise_for_status()
    projects = r.json()
    assert projects, "no projects found"
    return projects[0]["id"]


@pytest.fixture(scope="session")
def bm_target(admin_session, project_id):
    r = admin_session.get(f"{BASE_URL}/api/entities/project", params={"id": project_id})
    prj = r.json()[0] if isinstance(r.json(), list) else r.json()
    body = {
        "project_id": project_id, "company_id": prj.get("company_id"),
        "center_id": prj.get("center_id"),
        "target_year": "2026", "financial_year": "2025-2026", "training_type": "STT",
        "state": prj.get("state") or "MH", "territory": "Central",
        "job_role_targets": [{"job_role": "TEST_BM54_role", "count": 200}],
        "total_target": 200, "remarks": "TEST_BM54 iter54 target",
    }
    r = admin_session.post(f"{BASE_URL}/api/batch-targets", json=body)
    assert r.status_code in (200, 201), f"target create failed: {r.status_code} {r.text}"
    tid = r.json()["id"]
    yield r.json()
    admin_session.delete(f"{BASE_URL}/api/batch-targets/{tid}")


def _make_batch(session, target, name, start, end, capacity=6):
    body = {
        "target_id": target["id"], "project_id": target["project_id"],
        "company_id": target.get("company_id"), "center_id": target.get("center_id"),
        "name": name, "start_date": start, "end_date": end,
        "total_beneficiaries": capacity, "training_type": "STT",
    }
    r = session.post(f"{BASE_URL}/api/batches", json=body)
    assert r.status_code in (200, 201), f"batch create failed: {r.status_code} {r.text}"
    return r.json()


def _add_cand(session, bid, name, aadhaar=None):
    payload = {"name": name}
    if aadhaar: payload["aadhaar"] = aadhaar
    r = session.post(f"{BASE_URL}/api/batches/{bid}/candidates", json=payload)
    assert r.status_code == 201, r.text
    return r.json()["candidate"]


@pytest.fixture
def batch_with_cands(admin_session, bm_target):
    today = date.today()
    start = (today - timedelta(days=2)).isoformat()
    end = (today + timedelta(days=3)).isoformat()
    b = _make_batch(admin_session, bm_target,
                    f"TEST_BM54_{uuid.uuid4().hex[:6]}", start, end, capacity=6)
    cands = []
    for i in range(4):
        cands.append(_add_cand(admin_session, b["id"], f"TEST_BM54_c{i}",
                               aadhaar=f"9{uuid.uuid4().hex[:11]}"[:12]))
    yield b, cands
    admin_session.delete(f"{BASE_URL}/api/batches/{b['id']}")


def _get_batch(session, bid):
    for b in session.get(f"{BASE_URL}/api/batches").json():
        if b["id"] == bid: return b
    return None


# ============ Stage 5 · Assessment ============
class TestBatchAssessmentMeta:
    def test_patch_batch_meta(self, admin_session, batch_with_cands):
        b, _ = batch_with_cands
        payload = {"sdms_batch_id": "SDMS-TEST-54", "assessment_agency": "NSDC",
                   "assessor_name": "Mr Test", "assessor_contact": "9998887777",
                   "assessment_date": date.today().isoformat(),
                   "assessment_status": "SDMS Not Received"}
        r = admin_session.patch(f"{BASE_URL}/api/batches/{b['id']}/assessment", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["sdms_batch_id"] == "SDMS-TEST-54"
        assert d["assessment_agency"] == "NSDC"
        # Verify persisted via GET
        got = _get_batch(admin_session, b["id"])
        assert got["sdms_batch_id"] == "SDMS-TEST-54"
        assert got["assessor_name"] == "Mr Test"


class TestCandidateAssessment:
    def test_per_candidate_passed_sets_certified(self, admin_session, batch_with_cands):
        b, cands = batch_with_cands
        r = admin_session.post(
            f"{BASE_URL}/api/batches/{b['id']}/candidates/{cands[0]['id']}/assessment",
            json={"status": "passed", "marks": 85})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["assessment_status"] == "passed"
        assert d["certified"] is True
        assert d["assessment_marks"] == 85
        # Batch counters resynced
        got = _get_batch(admin_session, b["id"])
        assert got["passed_candidates"] == 1
        assert got["total_certified"] == 1
        assert got["pass_count"] == 1

    def test_per_candidate_failed_no_cert(self, admin_session, batch_with_cands):
        b, cands = batch_with_cands
        r = admin_session.post(
            f"{BASE_URL}/api/batches/{b['id']}/candidates/{cands[0]['id']}/assessment",
            json={"status": "failed"})
        assert r.status_code == 200
        assert r.json()["certified"] is False
        got = _get_batch(admin_session, b["id"])
        assert got["fail_count"] == 1
        assert got["passed_candidates"] == 0

    def test_bulk_assessment(self, admin_session, batch_with_cands):
        b, cands = batch_with_cands
        rows = [
            {"candidate_id": cands[0]["id"], "status": "passed", "marks": 90},
            {"candidate_id": cands[1]["id"], "status": "passed"},
            {"candidate_id": cands[2]["id"], "status": "failed"},
            {"candidate_id": cands[3]["id"], "status": "absent"},
        ]
        r = admin_session.post(
            f"{BASE_URL}/api/batches/{b['id']}/candidates/assessment/bulk",
            json={"rows": rows})
        assert r.status_code == 200, r.text
        assert r.json()["updated"] >= 4
        got = _get_batch(admin_session, b["id"])
        assert got["passed_candidates"] == 2
        assert got["total_certified"] == 2
        assert got["fail_count"] == 1
        assert got["absent_count"] == 1

    def test_bulk_empty_rows_400(self, admin_session, batch_with_cands):
        b, _ = batch_with_cands
        r = admin_session.post(
            f"{BASE_URL}/api/batches/{b['id']}/candidates/assessment/bulk",
            json={"rows": []})
        assert r.status_code == 400


class TestAssessmentSummary:
    def test_summary(self, admin_session, batch_with_cands):
        b, cands = batch_with_cands
        # Mark 2 passed, 1 failed, 1 absent
        admin_session.post(
            f"{BASE_URL}/api/batches/{b['id']}/candidates/assessment/bulk",
            json={"rows": [
                {"candidate_id": cands[0]["id"], "status": "passed"},
                {"candidate_id": cands[1]["id"], "status": "passed"},
                {"candidate_id": cands[2]["id"], "status": "failed"},
                {"candidate_id": cands[3]["id"], "status": "absent"},
            ]})
        r = admin_session.get(f"{BASE_URL}/api/batches/{b['id']}/assessment/summary")
        assert r.status_code == 200, r.text
        s = r.json()
        assert s["total_enrolled"] == 4
        assert s["passed"] == 2
        assert s["failed"] == 1
        assert s["absent"] == 1
        assert s["present"] == 3   # present+passed+failed
        assert s["certified"] == 2
        assert s["certification_pct"] == 50.0
        assert "batch" in s and s["batch"]["id"] == b["id"]


# ============ Stage 6 · Placement ============
class TestPlacement:
    def test_placed_blocked_for_non_certified(self, admin_session, batch_with_cands):
        b, cands = batch_with_cands
        # cands[0] not yet certified
        r = admin_session.patch(
            f"{BASE_URL}/api/batches/{b['id']}/candidates/{cands[0]['id']}/placement",
            json={"placement_status": "placed", "employer": "Reliance", "ctc": 250000})
        assert r.status_code == 400, r.text
        assert "certified" in r.text.lower()

    def test_placed_ok_after_cert(self, admin_session, batch_with_cands):
        b, cands = batch_with_cands
        # certify first
        admin_session.post(
            f"{BASE_URL}/api/batches/{b['id']}/candidates/{cands[0]['id']}/assessment",
            json={"status": "passed"})
        r = admin_session.patch(
            f"{BASE_URL}/api/batches/{b['id']}/candidates/{cands[0]['id']}/placement",
            json={"placement_status": "placed", "employer": "Reliance",
                  "ctc": 220000, "retention_month_1": "retained"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["placement_status"] == "placed"
        assert d["employer"] == "Reliance"
        assert float(d["ctc"]) == 220000
        # batch counter
        got = _get_batch(admin_session, b["id"])
        assert got["placed_candidates"] == 1
        assert got["num_placement"] == 1

    def test_placement_bulk_skips_non_certified(self, admin_session, batch_with_cands):
        b, cands = batch_with_cands
        # certify only cands[0] and cands[1]
        admin_session.post(
            f"{BASE_URL}/api/batches/{b['id']}/candidates/assessment/bulk",
            json={"rows": [
                {"candidate_id": cands[0]["id"], "status": "passed"},
                {"candidate_id": cands[1]["id"], "status": "passed"},
            ]})
        rows = [
            {"candidate_id": cands[0]["id"], "placement_status": "placed",
             "employer": "TCS", "ctc": 300000, "retention_month_1": "retained"},
            {"candidate_id": cands[1]["id"], "placement_status": "placed",
             "employer": "Infosys", "ctc": 280000, "retention_month_1": "retained",
             "retention_month_2": "retained"},
            {"candidate_id": cands[2]["id"], "placement_status": "placed",
             "employer": "SkipMe", "ctc": 100000},   # not certified — should skip
        ]
        r = admin_session.post(
            f"{BASE_URL}/api/batches/{b['id']}/candidates/placement/bulk",
            json={"rows": rows})
        assert r.status_code == 200, r.text
        # only 2 should have updated (3rd is silently skipped)
        assert r.json()["updated"] == 2
        got = _get_batch(admin_session, b["id"])
        assert got["placed_candidates"] == 2

    def test_placement_summary(self, admin_session, batch_with_cands):
        b, cands = batch_with_cands
        # certify all 4, place 3, retain M1 for 2
        admin_session.post(
            f"{BASE_URL}/api/batches/{b['id']}/candidates/assessment/bulk",
            json={"rows": [{"candidate_id": c["id"], "status": "passed"} for c in cands]})
        admin_session.post(
            f"{BASE_URL}/api/batches/{b['id']}/candidates/placement/bulk",
            json={"rows": [
                {"candidate_id": cands[0]["id"], "placement_status": "placed",
                 "employer": "A", "ctc": 200000, "retention_month_1": "retained"},
                {"candidate_id": cands[1]["id"], "placement_status": "placed",
                 "employer": "B", "ctc": 300000, "retention_month_1": "retained",
                 "retention_month_2": "retained"},
                {"candidate_id": cands[2]["id"], "placement_status": "placed",
                 "employer": "C", "ctc": 400000},
            ]})
        r = admin_session.get(f"{BASE_URL}/api/batches/{b['id']}/placement/summary")
        assert r.status_code == 200, r.text
        s = r.json()
        assert s["total_enrolled"] == 4
        assert s["certified"] == 4
        assert s["placed"] == 3
        assert s["placement_pct"] == 75.0  # 3/4
        assert s["pending_placement"] == 1
        assert s["retention"]["month_1"] == 2
        assert s["retention"]["month_2"] == 1
        assert s["retention"]["month_3"] == 0
        assert s["ctc"]["avg"] == 300000
        assert s["ctc"]["min"] == 200000
        assert s["ctc"]["max"] == 400000


# ============ Attendance CSV Export ============
class TestAttendanceCsv:
    def test_export_csv(self, admin_session, batch_with_cands):
        b, cands = batch_with_cands
        # Mark today P for first 2 candidates
        today = date.today().isoformat()
        r = admin_session.post(
            f"{BASE_URL}/api/batches/{b['id']}/attendance/mark",
            json={"dates": [today], "status": "P",
                  "candidate_ids": [cands[0]["id"], cands[1]["id"]],
                  "overwrite": False})
        assert r.status_code in (200, 201), r.text
        # Now export
        r = admin_session.get(f"{BASE_URL}/api/batches/{b['id']}/attendance/export.csv")
        assert r.status_code == 200, r.text
        assert "text/csv" in r.headers.get("content-type", "")
        assert "attachment" in r.headers.get("content-disposition", "").lower()
        body = r.text
        reader = list(csv.reader(io.StringIO(body)))
        header = reader[0]
        assert header[0] == "Candidate ID"
        assert header[1] == "Name"
        assert header[2] == "Mobile"
        assert "Present" in header and "Absent" in header
        assert "Holiday" in header and "Present %" in header
        assert len(reader) - 1 == len(cands)   # 4 candidate rows
        # First candidate should have P count >= 1
        # Locate row for cands[0]
        cand_names = [row[1] for row in reader[1:]]
        assert cands[0]["name"] in cand_names

    def test_export_csv_with_date_range(self, admin_session, batch_with_cands):
        b, _ = batch_with_cands
        today = date.today().isoformat()
        r = admin_session.get(
            f"{BASE_URL}/api/batches/{b['id']}/attendance/export.csv",
            params={"from_date": today, "to_date": today})
        assert r.status_code == 200


# ============ RBAC ============
class TestRbac:
    def test_unauth_gets_401(self, batch_with_cands):
        b, _ = batch_with_cands
        s = requests.Session()
        r = s.patch(f"{BASE_URL}/api/batches/{b['id']}/assessment",
                    json={"sdms_batch_id": "X"})
        assert r.status_code in (401, 403)
        r = s.get(f"{BASE_URL}/api/batches/{b['id']}/attendance/export.csv")
        assert r.status_code in (401, 403)


# ============ Regression ============
class TestRegression:
    def test_batches_list_still_works(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/batches")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_batch_targets_still_works(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/batch-targets")
        assert r.status_code == 200

    def test_mis_live_overview_still_works(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/mis/live/overview")
        assert r.status_code == 200
