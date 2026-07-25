"""iter-36 Phase-A HRMS backend tests.
Covers:
  - PATCH /api/attendance/{aid}  (edit + role restrictions + 404)
  - PATCH /api/payroll/{pid}     (extended earnings & deductions, net auto-recalc)
  - GET   /api/payroll/staff/{sid}/summary (attendance breakdown + history)
  - GET   /api/reports/attendance | /payroll | /consolidated  (CSV headers)
"""
import os
import io
import csv
import time
import uuid
import pytest
import requests

def _read_env(path: str, key: str):
    try:
        with open(path) as f:
            for line in f:
                if line.startswith(f"{key}="):
                    return line.split("=", 1)[1].strip().strip('"')
    except OSError:
        pass
    return None

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL")
            or _read_env("/app/frontend/.env", "REACT_APP_BACKEND_URL")
            or "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"
ADMIN = {"email": "admin@finance.app", "password": "Admin@123"}
STAFF = {"email": "test_mgr2_e0e668@x.com", "password": "Mgr@12345"}  # role: staff


# --------------------- Fixtures ---------------------
@pytest.fixture(scope="module")
def admin_sess():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=30)
    assert r.status_code == 200, f"admin login failed {r.status_code} {r.text[:200]}"
    return s


@pytest.fixture(scope="module")
def staff_sess():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=STAFF, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"Staff login failed: {r.status_code}")
    return s


@pytest.fixture(scope="module")
def sample_staff_id(admin_sess):
    r = admin_sess.get(f"{BASE_URL}/api/staff", timeout=30)
    assert r.status_code == 200
    docs = r.json()
    assert isinstance(docs, list) and len(docs) > 0, "No staff records to test with"
    # prefer one with monthly_salary set
    with_sal = [d for d in docs if d.get("monthly_salary")]
    return (with_sal[0] if with_sal else docs[0])["id"]


@pytest.fixture(scope="module")
def month_year():
    # Use July 2026 per spec
    return 7, 2026


# --------------------- 1. Salary Summary ---------------------
class TestStaffSalarySummary:
    def test_summary_returns_expected_keys(self, admin_sess, sample_staff_id, month_year):
        m, y = month_year
        r = admin_sess.get(
            f"{BASE_URL}/api/payroll/staff/{sample_staff_id}/summary",
            params={"month": m, "year": y}, timeout=30,
        )
        assert r.status_code == 200, r.text[:200]
        data = r.json()
        # top-level
        for k in ("staff", "current", "history"):
            assert k in data, f"missing key {k}"
        # current shape
        cur = data["current"]
        assert cur["month"] == m and cur["year"] == y
        for k in ("attendance", "attendance_rows", "payroll"):
            assert k in cur
        for k in ("present", "half", "absent", "leave", "working_days", "days_marked"):
            assert k in cur["attendance"], f"attendance.{k} missing"
        assert isinstance(cur["attendance_rows"], list)
        assert isinstance(data["history"], list)

    def test_summary_forbidden_for_staff_role(self, staff_sess, sample_staff_id, month_year):
        m, y = month_year
        r = staff_sess.get(
            f"{BASE_URL}/api/payroll/staff/{sample_staff_id}/summary",
            params={"month": m, "year": y}, timeout=30,
        )
        assert r.status_code == 403, f"expected 403 for staff, got {r.status_code}"

    def test_summary_404_for_unknown_staff(self, admin_sess, month_year):
        m, y = month_year
        r = admin_sess.get(
            f"{BASE_URL}/api/payroll/staff/does-not-exist-{uuid.uuid4().hex}/summary",
            params={"month": m, "year": y}, timeout=30,
        )
        assert r.status_code == 404


# --------------------- 2. PATCH /attendance ---------------------
class TestAttendanceEdit:
    @pytest.fixture(scope="class")
    def att_row(self, admin_sess, sample_staff_id):
        """Ensure at least one attendance row exists for the sample staff."""
        # Try to find an existing row first
        r = admin_sess.get(f"{BASE_URL}/api/attendance",
                           params={"staff_id": sample_staff_id}, timeout=30)
        if r.status_code == 200 and isinstance(r.json(), list) and r.json():
            return r.json()[0]
        # Create one via admin mark
        payload = {
            "staff_id": sample_staff_id,
            "date": "2026-07-15",
            "status": "present",
        }
        r = admin_sess.post(f"{BASE_URL}/api/attendance", json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text[:200]
        # fetch again
        r = admin_sess.get(f"{BASE_URL}/api/attendance",
                           params={"staff_id": sample_staff_id}, timeout=30)
        assert r.status_code == 200 and r.json()
        return r.json()[0]

    def test_patch_updates_status_and_stamps(self, admin_sess, att_row):
        aid = att_row["id"]
        r = admin_sess.patch(
            f"{BASE_URL}/api/attendance/{aid}",
            json={"status": "half", "remarks": "TEST_iter36 half-day"},
            timeout=30,
        )
        assert r.status_code == 200, r.text[:200]
        doc = r.json()
        assert doc["status"] == "half"
        assert doc["remarks"] == "TEST_iter36 half-day"
        assert doc.get("edited_by")
        assert doc.get("edited_at")

    def test_patch_404_for_unknown_aid(self, admin_sess):
        r = admin_sess.patch(
            f"{BASE_URL}/api/attendance/nope-{uuid.uuid4().hex}",
            json={"status": "absent"}, timeout=30,
        )
        assert r.status_code == 404

    def test_patch_forbidden_when_unauthenticated(self, att_row):
        # No login → 401/403 (verifies auth guard)
        aid = att_row["id"]
        r = requests.patch(
            f"{BASE_URL}/api/attendance/{aid}",
            json={"status": "absent"}, timeout=30,
        )
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"


# --------------------- 3. Payroll extended fields ---------------------
class TestPayrollExtended:
    @pytest.fixture(scope="class")
    def payroll_row(self, admin_sess, sample_staff_id, month_year):
        m, y = month_year
        # Try run — will no-op if already exists
        admin_sess.post(f"{BASE_URL}/api/payroll/run",
                        params={"month": m, "year": y}, timeout=60)
        # Fetch
        r = admin_sess.get(f"{BASE_URL}/api/payroll",
                           params={"month": m, "year": y}, timeout=30)
        assert r.status_code == 200, r.text[:200]
        rows = [p for p in r.json() if p.get("staff_id") == sample_staff_id]
        if not rows:
            pytest.skip("payroll_run did not create a row for the sample staff")
        return rows[0]

    def test_extended_fields_recalc(self, admin_sess, payroll_row):
        pid = payroll_row["id"]
        # Zero-out any prior components so we can assert deltas cleanly.
        reset_payload = {
            "basic": 0, "hra": 0, "da": 0, "conveyance": 0, "bonus": 0, "incentive": 0,
            "overtime_pay": 0, "other_earnings": 0, "reimbursements_paid": 0,
            "pf_deduction": 0, "esi_deduction": 0, "late_deduction": 0,
            "early_fine": 0, "advance": 0, "loan_deduction": 0,
        }
        r = admin_sess.patch(f"{BASE_URL}/api/payroll/{pid}", json=reset_payload, timeout=30)
        # Skip if backend enforces status='paid' — but a fresh draft should be editable.
        assert r.status_code == 200, r.text[:200]

        payload = {
            "overtime_pay": 1000, "advance": 500, "loan_deduction": 200,
            "early_fine": 50, "other_earnings": 300, "reimbursements_paid": 250,
        }
        r = admin_sess.patch(f"{BASE_URL}/api/payroll/{pid}", json=payload, timeout=30)
        assert r.status_code == 200, r.text[:200]
        doc = r.json()

        # gross should equal 1000 + 300 + 250 = 1550 (all other earnings are 0)
        assert abs(doc["gross"] - 1550) < 0.01, f"gross={doc['gross']}"
        # deductions = 500 + 200 + 50 = 750
        assert abs(doc["deductions"] - 750) < 0.01, f"deductions={doc['deductions']}"
        # net = 1550 - 750 = 800
        assert abs(doc["net"] - 800) < 0.01, f"net={doc['net']}"
        assert doc.get("edited_by")

    def test_patch_404(self, admin_sess):
        r = admin_sess.patch(f"{BASE_URL}/api/payroll/nope-{uuid.uuid4().hex}",
                             json={"advance": 1}, timeout=30)
        assert r.status_code == 404


# --------------------- 4. Reports (CSV) ---------------------
class TestReports:
    def _parse_csv(self, resp) -> list:
        assert resp.headers.get("content-type", "").startswith("text/csv"), \
            f"content-type={resp.headers.get('content-type')}"
        return list(csv.reader(io.StringIO(resp.text)))

    def test_attendance_report(self, admin_sess, month_year):
        m, y = month_year
        r = admin_sess.get(f"{BASE_URL}/api/reports/attendance",
                           params={"month": m, "year": y}, timeout=60)
        assert r.status_code == 200, r.text[:200]
        rows = self._parse_csv(r)
        expected = ["Emp Code", "Name", "Designation", "Center", "Date",
                    "Status", "Punch In", "Punch Out", "Hours", "Marked Via"]
        assert rows[0] == expected

    def test_payroll_report(self, admin_sess, month_year):
        m, y = month_year
        r = admin_sess.get(f"{BASE_URL}/api/reports/payroll",
                           params={"month": m, "year": y}, timeout=60)
        assert r.status_code == 200, r.text[:200]
        rows = self._parse_csv(r)
        hdr = rows[0]
        for col in ("Basic", "HRA", "DA", "Conveyance", "Bonus", "Incentive",
                    "Overtime", "Other Earnings", "Reimb Paid", "Gross",
                    "PF", "ESI", "Late Fine", "Early Fine", "Advance", "Loan EMI",
                    "Total Deductions", "Net", "Status", "Paid At",
                    "Bank Name", "Account #", "IFSC", "PAN"):
            assert col in hdr, f"missing column {col} in {hdr}"

    def test_consolidated_report(self, admin_sess, month_year):
        m, y = month_year
        r = admin_sess.get(f"{BASE_URL}/api/reports/consolidated",
                           params={"month": m, "year": y}, timeout=60)
        assert r.status_code == 200, r.text[:200]
        rows = self._parse_csv(r)
        hdr = rows[0]
        for col in ("Emp Code", "Name", "Present", "Half", "Absent", "Leave",
                    "Gross", "Deductions", "Net", "Bank Name", "Account #", "IFSC"):
            assert col in hdr, f"missing column {col}"
        # At least header row
        assert len(rows) >= 1

    def test_reports_forbidden_for_staff(self, staff_sess, month_year):
        m, y = month_year
        # payroll report is HR/Admin only
        r = staff_sess.get(f"{BASE_URL}/api/reports/payroll",
                          params={"month": m, "year": y}, timeout=30)
        assert r.status_code == 403
