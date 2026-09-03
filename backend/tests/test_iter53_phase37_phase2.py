"""Iteration 53 — Phase 37 · Phase 2: Enrollment (Stage 3), Attendance (Stage 4),
Auto-Closure & Extension (Stage 7).

Tests are self-contained and use TEST_BM53_* prefixes for cleanup.
"""
import io
import os
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
import requests

def _load_base_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if not v:
        # Load from frontend/.env
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


def _get_batch(session, bid):
    r = session.get(f"{BASE_URL}/api/batches")
    for b in r.json():
        if b["id"] == bid:
            return b
    return None


# -------------------- Session / fixtures --------------------
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
    assert projects, "no projects found — seed data missing"
    return projects[0]["id"]


@pytest.fixture(scope="session")
def bm_target(admin_session, project_id):
    """Create a batch target with plenty of headroom so multiple batches can be created."""
    r = admin_session.get(f"{BASE_URL}/api/entities/project", params={"id": project_id})
    prj = r.json()[0] if isinstance(r.json(), list) else r.json()
    body = {
        "project_id": project_id,
        "company_id": prj.get("company_id"),
        "center_id": prj.get("center_id"),
        "target_year": "2026",
        "financial_year": "2025-2026",
        "training_type": "STT",
        "state": prj.get("state") or "MH",
        "territory": "Central",
        "job_role_targets": [{"job_role": "TEST_BM53_role", "count": 200}],
        "total_target": 200,
        "remarks": "TEST_BM53 iter53 target",
    }
    r = admin_session.post(f"{BASE_URL}/api/batch-targets", json=body)
    assert r.status_code in (200, 201), f"target create failed: {r.status_code} {r.text}"
    tid = r.json()["id"]
    yield r.json()
    admin_session.delete(f"{BASE_URL}/api/batch-targets/{tid}")


def _make_batch(session, target, name, start, end, capacity=5, project_id_val=None):
    body = {
        "target_id": target["id"],
        "project_id": project_id_val or target["project_id"],
        "company_id": target.get("company_id"),
        "center_id": target.get("center_id"),
        "name": name,
        "start_date": start,
        "end_date": end,
        "total_beneficiaries": capacity,
        "training_type": "STT",
    }
    r = session.post(f"{BASE_URL}/api/batches", json=body)
    assert r.status_code in (200, 201), f"batch create failed: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture
def batch(admin_session, bm_target):
    # Batch window: yesterday..today+4 (so we can mark attendance today)
    today = date.today()
    start = (today - timedelta(days=1)).isoformat()
    end = (today + timedelta(days=4)).isoformat()
    b = _make_batch(admin_session, bm_target,
                    f"TEST_BM53_batch_{uuid.uuid4().hex[:6]}", start, end, capacity=5)
    yield b
    admin_session.delete(f"{BASE_URL}/api/batches/{b['id']}")


# ============ Stage 3 · Enrollment ============
class TestEnrollment:
    def test_list_candidates_empty(self, admin_session, batch):
        r = admin_session.get(f"{BASE_URL}/api/batches/{batch['id']}/candidates")
        assert r.status_code == 200
        d = r.json()
        assert d["capacity"] == 5
        assert d["enrolled"] == 0
        assert d["available"] == 5
        assert d["rows"] == []

    def test_add_candidate_and_verify(self, admin_session, batch):
        payload = {"name": "TEST_BM53_John", "mobile": "9990000001",
                   "aadhaar": "111100001111", "gender": "M"}
        r = admin_session.post(f"{BASE_URL}/api/batches/{batch['id']}/candidates", json=payload)
        assert r.status_code == 201, r.text
        d = r.json()
        assert d["candidate"]["name"] == "TEST_BM53_John"
        assert d["capacity_state"]["enrolled"] == 1
        assert d["capacity_state"]["available"] == 4
        # Verify GET
        r = admin_session.get(f"{BASE_URL}/api/batches/{batch['id']}/candidates")
        assert r.json()["enrolled"] == 1

    def test_add_duplicate_aadhaar_returns_409(self, admin_session, batch):
        p = {"name": "TEST_BM53_A", "aadhaar": "222200002222"}
        r1 = admin_session.post(f"{BASE_URL}/api/batches/{batch['id']}/candidates", json=p)
        assert r1.status_code == 201
        r2 = admin_session.post(f"{BASE_URL}/api/batches/{batch['id']}/candidates",
                                json={"name": "TEST_BM53_B", "aadhaar": "222200002222"})
        assert r2.status_code == 409

    def test_add_when_batch_full_returns_400(self, admin_session, bm_target):
        today = date.today()
        b = _make_batch(admin_session, bm_target,
                        f"TEST_BM53_full_{uuid.uuid4().hex[:6]}",
                        today.isoformat(), (today + timedelta(days=2)).isoformat(), capacity=2)
        try:
            for i in range(2):
                r = admin_session.post(f"{BASE_URL}/api/batches/{b['id']}/candidates",
                                       json={"name": f"TEST_BM53_c{i}"})
                assert r.status_code == 201
            r = admin_session.post(f"{BASE_URL}/api/batches/{b['id']}/candidates",
                                   json={"name": "TEST_BM53_overflow"})
            assert r.status_code == 400
            assert "full capacity" in r.text.lower() or "no seats" in r.text.lower()
        finally:
            admin_session.delete(f"{BASE_URL}/api/batches/{b['id']}")

    def test_delete_candidate_frees_seat(self, admin_session, batch):
        r = admin_session.post(f"{BASE_URL}/api/batches/{batch['id']}/candidates",
                               json={"name": "TEST_BM53_del"})
        cid = r.json()["candidate"]["id"]
        r = admin_session.delete(f"{BASE_URL}/api/batches/{batch['id']}/candidates/{cid}")
        assert r.status_code == 204
        r = admin_session.get(f"{BASE_URL}/api/batches/{batch['id']}/candidates")
        assert r.json()["enrolled"] == 0
        assert r.json()["available"] == 5


class TestBulkUpload:
    def _csv(self, rows):
        headers = "name,mobile,email,gender,dob,aadhaar,father_name,address,job_role"
        lines = [headers]
        for r in rows:
            lines.append(",".join(str(r.get(h, "")) for h in headers.split(",")))
        return "\n".join(lines).encode("utf-8")

    def _upload(self, session, bid, content):
        # Multipart — remove Content-Type header set on session
        s2 = requests.Session()
        s2.cookies = session.cookies
        r = s2.post(f"{BASE_URL}/api/batches/{bid}/candidates/bulk-upload",
                    files={"file": ("candidates.csv", content, "text/csv")})
        return r

    def test_bulk_upload_ok(self, admin_session, batch):
        content = self._csv([
            {"name": "TEST_BM53_bu1", "aadhaar": "3001"},
            {"name": "TEST_BM53_bu2", "aadhaar": "3002"},
        ])
        r = self._upload(admin_session, batch["id"], content)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["counts"]["valid"] == 2
        assert d["counts"]["errors"] == 0
        assert d["capacity_state"]["available"] == 5

    def test_bulk_upload_missing_name(self, admin_session, batch):
        content = self._csv([
            {"name": "TEST_BM53_ok", "aadhaar": "3010"},
            {"name": "", "aadhaar": "3011"},
        ])
        r = self._upload(admin_session, batch["id"], content)
        assert r.status_code == 200
        d = r.json()
        assert d["counts"]["valid"] == 1
        assert d["counts"]["errors"] == 1
        assert "name is required" in d["errors"][0]["reason"].lower()

    def test_bulk_upload_duplicate_in_file(self, admin_session, batch):
        content = self._csv([
            {"name": "TEST_BM53_x", "aadhaar": "3020"},
            {"name": "TEST_BM53_y", "aadhaar": "3020"},
        ])
        r = self._upload(admin_session, batch["id"], content)
        d = r.json()
        assert d["counts"]["valid"] == 1
        assert any("duplicate aadhaar" in e["reason"].lower() for e in d["errors"])

    def test_bulk_upload_capacity_truncation(self, admin_session, bm_target):
        today = date.today()
        b = _make_batch(admin_session, bm_target,
                        f"TEST_BM53_cap_{uuid.uuid4().hex[:6]}",
                        today.isoformat(), (today + timedelta(days=2)).isoformat(), capacity=2)
        try:
            content = self._csv([{"name": f"TEST_BM53_row{i}", "aadhaar": f"31{i:02d}"} for i in range(5)])
            r = self._upload(admin_session, b["id"], content)
            d = r.json()
            assert d["counts"]["valid"] == 2
            assert d["counts"]["errors"] == 3
            assert any("exceed batch capacity" in e["reason"].lower() for e in d["errors"])
        finally:
            admin_session.delete(f"{BASE_URL}/api/batches/{b['id']}")

    def test_bulk_upload_existing_aadhaar_in_batch(self, admin_session, batch):
        admin_session.post(f"{BASE_URL}/api/batches/{batch['id']}/candidates",
                           json={"name": "TEST_BM53_pre", "aadhaar": "3200"})
        content = self._csv([{"name": "TEST_BM53_dup", "aadhaar": "3200"}])
        r = self._upload(admin_session, batch["id"], content)
        d = r.json()
        assert d["counts"]["valid"] == 0
        assert any("already enrolled" in e["reason"].lower() for e in d["errors"])

    def test_bulk_commit_inserts_and_updates_state(self, admin_session, batch):
        rows = [
            {"name": "TEST_BM53_commit1", "aadhaar": "3300"},
            {"name": "TEST_BM53_commit2", "aadhaar": "3301"},
        ]
        r = admin_session.post(f"{BASE_URL}/api/batches/{batch['id']}/candidates/bulk-commit",
                               json={"rows": rows})
        assert r.status_code == 201, r.text
        d = r.json()
        assert d["inserted"] == 2
        assert d["capacity_state"]["enrolled"] == 2
        # Verify GET
        r = admin_session.get(f"{BASE_URL}/api/batches/{batch['id']}/candidates")
        names = [c["name"] for c in r.json()["rows"]]
        assert "TEST_BM53_commit1" in names

    def test_bulk_commit_over_capacity_rejected(self, admin_session, bm_target):
        today = date.today()
        b = _make_batch(admin_session, bm_target,
                        f"TEST_BM53_bc_{uuid.uuid4().hex[:6]}",
                        today.isoformat(), (today + timedelta(days=2)).isoformat(), capacity=1)
        try:
            rows = [{"name": f"TEST_BM53_x{i}"} for i in range(3)]
            r = admin_session.post(f"{BASE_URL}/api/batches/{b['id']}/candidates/bulk-commit",
                                   json={"rows": rows})
            assert r.status_code == 400
        finally:
            admin_session.delete(f"{BASE_URL}/api/batches/{b['id']}")


# ============ Stage 4 · Attendance ============
class TestAttendance:
    def test_get_attendance_defaults_to_batch_window(self, admin_session, batch):
        r = admin_session.get(f"{BASE_URL}/api/batches/{batch['id']}/attendance")
        assert r.status_code == 200
        d = r.json()
        assert d["batch"]["start_date"] == batch["start_date"]
        assert len(d["dates"]) >= 1
        assert d["training_days"] == len(d["dates"])
        assert d["matrix"] == {}

    def test_mark_attendance_and_verify(self, admin_session, batch):
        # Enroll two candidates first
        cids = []
        for i in range(2):
            r = admin_session.post(f"{BASE_URL}/api/batches/{batch['id']}/candidates",
                                   json={"name": f"TEST_BM53_att{i}"})
            cids.append(r.json()["candidate"]["id"])
        today = date.today().isoformat()
        r = admin_session.post(
            f"{BASE_URL}/api/batches/{batch['id']}/attendance/mark",
            json={"dates": [today], "status": "P", "candidate_ids": "all", "overwrite": False})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["inserted"] == 2
        # Fetch and verify matrix
        r = admin_session.get(f"{BASE_URL}/api/batches/{batch['id']}/attendance")
        matrix = r.json()["matrix"]
        for cid in cids:
            assert matrix.get(cid, {}).get(today) == "P"

    def test_mark_overwrite_false_preserves_existing(self, admin_session, batch):
        r = admin_session.post(f"{BASE_URL}/api/batches/{batch['id']}/candidates",
                               json={"name": "TEST_BM53_ov"})
        cid = r.json()["candidate"]["id"]
        today = date.today().isoformat()
        admin_session.post(f"{BASE_URL}/api/batches/{batch['id']}/attendance/mark",
                           json={"dates": [today], "status": "P", "candidate_ids": [cid]})
        # Try to overwrite with A but overwrite=False → should stay P
        admin_session.post(f"{BASE_URL}/api/batches/{batch['id']}/attendance/mark",
                           json={"dates": [today], "status": "A", "candidate_ids": [cid], "overwrite": False})
        r = admin_session.get(f"{BASE_URL}/api/batches/{batch['id']}/attendance")
        assert r.json()["matrix"][cid][today] == "P"
        # Now overwrite=true → should flip to A
        admin_session.post(f"{BASE_URL}/api/batches/{batch['id']}/attendance/mark",
                           json={"dates": [today], "status": "A", "candidate_ids": [cid], "overwrite": True})
        r = admin_session.get(f"{BASE_URL}/api/batches/{batch['id']}/attendance")
        assert r.json()["matrix"][cid][today] == "A"

    def test_mark_outside_window_returns_400(self, admin_session, batch):
        r = admin_session.post(f"{BASE_URL}/api/batches/{batch['id']}/candidates",
                               json={"name": "TEST_BM53_win"})
        cid = r.json()["candidate"]["id"]
        beyond = (date.fromisoformat(batch["end_date"]) + timedelta(days=5)).isoformat()
        r = admin_session.post(f"{BASE_URL}/api/batches/{batch['id']}/attendance/mark",
                               json={"dates": [beyond], "status": "P", "candidate_ids": [cid]})
        assert r.status_code == 400
        assert "extension" in r.text.lower() or "after batch end" in r.text.lower()

    def test_attendance_summary(self, admin_session, batch):
        # Enroll 2, mark today P for both
        cids = []
        for i in range(2):
            r = admin_session.post(f"{BASE_URL}/api/batches/{batch['id']}/candidates",
                                   json={"name": f"TEST_BM53_sum{i}"})
            cids.append(r.json()["candidate"]["id"])
        today = date.today().isoformat()
        admin_session.post(f"{BASE_URL}/api/batches/{batch['id']}/attendance/mark",
                           json={"dates": [today], "status": "P", "candidate_ids": "all"})
        r = admin_session.get(f"{BASE_URL}/api/batches/{batch['id']}/attendance/summary")
        assert r.status_code == 200
        d = r.json()
        assert d["presents"] >= 2
        assert d["overall_pct"] == 100.0
        assert d["total_days"] >= 1
        assert isinstance(d["per_candidate"], dict)


# ============ Stage 7 · Extension + Auto-Close ============
class TestExtension:
    def test_create_extension_new_end_must_be_later(self, admin_session, batch):
        # new_end before current end → 400
        earlier = (date.fromisoformat(batch["end_date"]) - timedelta(days=1)).isoformat()
        r = admin_session.post(f"{BASE_URL}/api/batch-extension-requests",
                               json={"batch_id": batch["id"], "new_end_date": earlier,
                                     "reason": "trying earlier"})
        assert r.status_code == 400

    def test_create_and_approve_extension(self, admin_session, batch):
        new_end = (date.fromisoformat(batch["end_date"]) + timedelta(days=7)).isoformat()
        r = admin_session.post(f"{BASE_URL}/api/batch-extension-requests",
                               json={"batch_id": batch["id"], "new_end_date": new_end,
                                     "reason": "Trainer sickness"})
        assert r.status_code == 201, r.text
        rid = r.json()["id"]
        assert r.json()["status"] == "pending"
        # List pending
        r = admin_session.get(f"{BASE_URL}/api/batch-extension-requests",
                              params={"status": "pending"})
        assert any(x["id"] == rid for x in r.json())
        # Approve
        r = admin_session.patch(f"{BASE_URL}/api/batch-extension-requests/{rid}/approve")
        assert r.status_code == 200, r.text
        assert r.json()["new_end_date"] == new_end
        # Batch end_date updated
        r = admin_session.get(f"{BASE_URL}/api/batches/{batch['id']}")
        # No GET-by-id; use list helper
        bd = _get_batch(admin_session, batch['id'])
        assert bd["end_date"] == new_end
        # Re-approve → 400
        r = admin_session.patch(f"{BASE_URL}/api/batch-extension-requests/{rid}/approve")
        assert r.status_code == 400

    def test_reject_requires_reason(self, admin_session, batch):
        new_end = (date.fromisoformat(batch["end_date"]) + timedelta(days=10)).isoformat()
        r = admin_session.post(f"{BASE_URL}/api/batch-extension-requests",
                               json={"batch_id": batch["id"], "new_end_date": new_end,
                                     "reason": "for rejection test"})
        rid = r.json()["id"]
        # Empty reason → 400
        r = admin_session.patch(f"{BASE_URL}/api/batch-extension-requests/{rid}/reject",
                                json={"rejection_reason": ""})
        assert r.status_code == 400
        # With reason → ok
        r = admin_session.patch(f"{BASE_URL}/api/batch-extension-requests/{rid}/reject",
                                json={"rejection_reason": "Not needed"})
        assert r.status_code == 200
        # Cannot re-reject
        r = admin_session.patch(f"{BASE_URL}/api/batch-extension-requests/{rid}/reject",
                                json={"rejection_reason": "again"})
        assert r.status_code == 400


class TestAutoClose:
    def test_auto_close_closes_expired_batch(self, admin_session, bm_target):
        # Create batch with end_date already in past
        today = date.today()
        start = (today - timedelta(days=10)).isoformat()
        end = (today - timedelta(days=5)).isoformat()
        b = _make_batch(admin_session, bm_target,
                        f"TEST_BM53_expired_{uuid.uuid4().hex[:6]}", start, end, capacity=2)
        try:
            r = admin_session.post(f"{BASE_URL}/api/batches/auto-close/run")
            assert r.status_code == 200, r.text
            d = r.json()
            assert b["id"] in d["closed_ids"]
            # Verify batch is closed and locked
            bd = _get_batch(admin_session, b['id'])
            assert bd.get("closed") == True
            assert bd.get("lifecycle_status") == "Closed"
            for lk in ("basic_locked", "attendance_locked", "assessment_locked", "placement_locked"):
                assert bd.get(lk) == True, f"{lk} should be True"
            # auto_closed_at is stored in DB but stripped by BatchOut response model
            # (not exposed in list endpoint) — verified via closed=True + lifecycle_status
            # lifecycle_history entry from system
            hist = bd.get("lifecycle_history") or []
            assert any(h.get("by_user_id") == "system" for h in hist)
        finally:
            admin_session.delete(f"{BASE_URL}/api/batches/{b['id']}")

    def test_extension_reopens_closed_batch(self, admin_session, bm_target):
        today = date.today()
        start = (today - timedelta(days=10)).isoformat()
        end = (today - timedelta(days=2)).isoformat()
        b = _make_batch(admin_session, bm_target,
                        f"TEST_BM53_reopen_{uuid.uuid4().hex[:6]}", start, end, capacity=2)
        try:
            admin_session.post(f"{BASE_URL}/api/batches/auto-close/run")
            new_end = (today + timedelta(days=5)).isoformat()
            r = admin_session.post(f"{BASE_URL}/api/batch-extension-requests",
                                   json={"batch_id": b["id"], "new_end_date": new_end,
                                         "reason": "reopen for retake"})
            rid = r.json()["id"]
            r = admin_session.patch(f"{BASE_URL}/api/batch-extension-requests/{rid}/approve")
            assert r.status_code == 200
            bd = _get_batch(admin_session, b['id'])
            assert bd.get("closed") == False
            assert bd.get("lifecycle_status") == "Active"
            for lk in ("basic_locked", "attendance_locked", "assessment_locked", "placement_locked"):
                assert bd.get(lk) == False, f"{lk} should be reset to False"
        finally:
            admin_session.delete(f"{BASE_URL}/api/batches/{b['id']}")


# ============ Regression ============
class TestRegression:
    def test_batches_list_ok(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/batches")
        assert r.status_code == 200

    def test_batch_targets_ok(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/batch-targets")
        assert r.status_code == 200

    def test_mis_live_overview_ok(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/mis/live/overview")
        assert r.status_code == 200
