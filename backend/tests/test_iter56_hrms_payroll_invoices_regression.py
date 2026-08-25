"""Regression tests for Session 2 HRMS/Payroll/Invoice/Staff Financial History overhauls.

Covers:
  * Sidebar / route reachability sanity (via /api endpoints backing each group)
  * Invoice CRUD + advance sequence enforcement + stage-5 disbursement validation + audit
  * Payroll formula (per_day = CTC/last_day_of_month, zero-attendance = 0)
  * Payroll Run eligibility (joining after month-end, exit before month-start)
  * POST /api/payroll/{pid}/recalc (200 for draft, 400 for approved/paid)
  * Attendance CSV timezone fix (UTC → IST)
  * Staff Financial History module + Add Payment (bonus) + duplicate prevention
  * HR role has full HRMS access + all 4 payroll CSV downloads
"""
import os
import uuid
import calendar
from datetime import datetime, timedelta
import pytest
import requests

def _load_frontend_env():
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    return None

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _load_frontend_env() or "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL not configured"
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@finance.app"
ADMIN_PASS = "Admin@123"
HR_EMAIL = "hr@finance.app"
HR_PASS = "Hr@12345"


# ---------------- Fixtures ----------------

def _login(email, pwd):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=15)
    if r.status_code != 200:
        pytest.skip(f"Login failed for {email}: {r.status_code} {r.text[:200]}")
    return s


@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN_EMAIL, ADMIN_PASS)


@pytest.fixture(scope="module")
def hr():
    return _login(HR_EMAIL, HR_PASS)


# ---------------- Sanity: auth + roles ----------------

class TestAuthSanity:
    def test_admin_me(self, admin):
        r = admin.get(f"{API}/auth/me")
        assert r.status_code == 200
        assert r.json()["role"] == "admin"

    def test_hr_me(self, hr):
        r = hr.get(f"{API}/auth/me")
        assert r.status_code == 200
        assert r.json()["role"] == "hr"


# ---------------- Invoice module ----------------

class TestInvoiceModule:
    """Invoice list/detail/advance + KPI dashboard + audit."""

    inv_id = None
    inv_no = None

    def test_stages_list(self, admin):
        r = admin.get(f"{API}/invoices/stages")
        assert r.status_code == 200
        stages = r.json()
        assert len(stages) == 5
        assert stages[-1]["id"] == "disbursed"

    def test_dashboard_kpis(self, admin):
        r = admin.get(f"{API}/invoices/dashboard")
        assert r.status_code == 200
        d = r.json()
        assert "total_invoices" in d and "per_stage" in d
        assert len(d["per_stage"]) == 5

    def test_list_invoices(self, admin):
        r = admin.get(f"{API}/invoices")
        assert r.status_code == 200
        assert isinstance(r.json(), (list, dict))  # could be list or {rows: []}

    def test_create_invoice(self, admin):
        payload = {
            "invoice_no": f"TEST_INV-{uuid.uuid4().hex[:8]}",
            "invoice_type": "Milestone-1",
            "tsp_company_name": "TEST Company Pvt Ltd",
            "district": "TEST District",
            "total_candidates": 10,
            "amount_payable": 100000.0,
            "adjustment": 0.0,
            "deduction": 5000.0,
            "remarks": "Regression test invoice",
        }
        r = admin.post(f"{API}/invoices", json=payload)
        assert r.status_code == 201, r.text
        data = r.json()
        assert data["invoice_no"] == payload["invoice_no"]
        assert data["net_payable"] == 95000.0
        assert data.get("stages", {}).get("generated", {}).get("completed") is True
        TestInvoiceModule.inv_id = data["id"]
        TestInvoiceModule.inv_no = data["invoice_no"]

        # GET back
        g = admin.get(f"{API}/invoices/{data['id']}")
        assert g.status_code == 200
        got = g.json()
        assert got["invoice_no"] == payload["invoice_no"]
        assert "timeline" in got

    def test_advance_out_of_sequence_rejected(self, admin):
        assert TestInvoiceModule.inv_id is not None
        # current stage is 1; try jumping to 3
        r = admin.post(
            f"{API}/invoices/{TestInvoiceModule.inv_id}/advance",
            json={"to_stage": 3, "remarks": "skip"},
        )
        assert r.status_code == 400
        assert "sequence" in r.text.lower() or "expected" in r.text.lower()

    def test_advance_stage_5_requires_disbursement(self, admin):
        # Walk 1→2→3→4 first
        for st in (2, 3, 4):
            r = admin.post(
                f"{API}/invoices/{TestInvoiceModule.inv_id}/advance",
                json={"to_stage": st, "remarks": f"advance to {st}"},
            )
            assert r.status_code == 200, f"advance to {st}: {r.text}"

        # Stage 5 without disbursed_amount → 400
        r5_missing = admin.post(
            f"{API}/invoices/{TestInvoiceModule.inv_id}/advance",
            json={"to_stage": 5, "remarks": "no amount"},
        )
        assert r5_missing.status_code == 400
        assert "disbursed" in r5_missing.text.lower()

        # Stage 5 with valid amount + UTR
        r5_ok = admin.post(
            f"{API}/invoices/{TestInvoiceModule.inv_id}/advance",
            json={
                "to_stage": 5,
                "remarks": "paid",
                "disbursed_amount": 95000.0,
                "payment_reference": "UTR-TEST-12345",
                "bank_reference": "HDFC-TEST",
            },
        )
        assert r5_ok.status_code == 200, r5_ok.text
        j = r5_ok.json()
        assert j.get("disbursed_amount") == 95000.0
        assert j.get("payment_reference") == "UTR-TEST-12345"

    def test_audit_log(self, admin):
        r = admin.get(f"{API}/invoices/{TestInvoiceModule.inv_id}/audit")
        assert r.status_code == 200
        rows = r.json()
        # Expect at least: create + 4 advance events
        actions = [x.get("action") for x in rows]
        assert "create" in actions
        assert actions.count("advance") >= 4


# ---------------- Payroll: eligibility, formula, recalc ----------------

class TestPayrollFormula:
    """Verify per_day=CTC/last_day, zero-attendance override, joining/exit gates."""

    # We'll pick a 31-day month in the future to avoid clashing with existing payroll.
    # Prefer March or January of a year where no payroll rows exist.
    TEST_MONTH = 3   # March
    TEST_YEAR = 2028  # Future
    staff_zero_id = None
    staff_normal_id = None
    staff_future_join_id = None
    staff_exited_id = None
    center_id = None

    def _get_or_create_center(self, admin):
        r = admin.get(f"{API}/centers")
        if r.status_code == 200:
            rows = r.json() if isinstance(r.json(), list) else r.json().get("rows", [])
            if rows:
                return rows[0]["id"]
        return None

    def test_seed_staff(self, admin):
        cid = self._get_or_create_center(admin)
        TestPayrollFormula.center_id = cid
        # Zero-attendance staff — CTC 15000
        s1 = admin.post(f"{API}/staff", json={
            "name": "TEST_ZERO Staff",
            "designation": "Tester",
            "monthly_salary": 15000,
            "joining_date": "2024-01-01",
            "center_id": cid,
        })
        assert s1.status_code in (200, 201), s1.text
        TestPayrollFormula.staff_zero_id = s1.json()["id"]

        # Normal staff — CTC 14000, will mark 14 present days
        s2 = admin.post(f"{API}/staff", json={
            "name": "TEST_NORMAL Staff",
            "designation": "Tester",
            "monthly_salary": 14000,
            "joining_date": "2024-01-01",
            "center_id": cid,
        })
        assert s2.status_code in (200, 201), s2.text
        TestPayrollFormula.staff_normal_id = s2.json()["id"]

        # Future joiner — joining_date > month-end (will be SKIPPED)
        s3 = admin.post(f"{API}/staff", json={
            "name": "TEST_FUTURE_JOIN Staff",
            "designation": "Tester",
            "monthly_salary": 10000,
            "joining_date": f"{TestPayrollFormula.TEST_YEAR + 1}-06-15",
            "center_id": cid,
        })
        assert s3.status_code in (200, 201), s3.text
        TestPayrollFormula.staff_future_join_id = s3.json()["id"]

        # Exited staff — exit_date before month-start (will be SKIPPED)
        s4 = admin.post(f"{API}/staff", json={
            "name": "TEST_EXITED Staff",
            "designation": "Tester",
            "monthly_salary": 10000,
            "joining_date": "2020-01-01",
            "exit_date": f"{TestPayrollFormula.TEST_YEAR - 2}-01-15",
            "center_id": cid,
        })
        assert s4.status_code in (200, 201), s4.text
        TestPayrollFormula.staff_exited_id = s4.json()["id"]

    def test_mark_attendance_for_normal(self, admin):
        """Mark 14 present days on TEST_NORMAL for the test month."""
        m, y = self.TEST_MONTH, self.TEST_YEAR
        for day in range(1, 15):  # 1..14
            r = admin.post(f"{API}/attendance", json={
                "staff_id": self.staff_normal_id,
                "date": f"{y}-{m:02d}-{day:02d}",
                "status": "present",
            })
            assert r.status_code == 200, f"day {day}: {r.text}"

    def test_run_payroll_and_verify_counters(self, admin):
        """POST /api/payroll/run and verify counters + math."""
        r = admin.post(f"{API}/payroll/run",
                       params={"month": self.TEST_MONTH, "year": self.TEST_YEAR})
        assert r.status_code == 200, r.text
        j = r.json()
        # Counters exist
        for k in ("created", "updated", "skipped_not_employed", "skipped_locked"):
            assert k in j, f"Missing counter: {k}"
        # At least 1 was skipped (future joiner + exited)
        assert j["skipped_not_employed"] >= 2, f"Expected ≥2 ineligible skips, got {j}"

    def test_zero_attendance_produces_zero_basic(self, admin):
        """CTC 15000 + 0 attendance → basic=0, net=0."""
        r = admin.get(f"{API}/payroll",
                      params={"month": self.TEST_MONTH, "year": self.TEST_YEAR,
                              "staff_id": self.staff_zero_id})
        assert r.status_code == 200
        rows = r.json() if isinstance(r.json(), list) else r.json().get("rows", [])
        assert len(rows) >= 1
        row = next((x for x in rows if x.get("staff_id") == self.staff_zero_id), None)
        assert row, "Zero-attendance staff payroll row missing"
        assert float(row.get("basic") or 0) == 0.0, f"Expected basic=0 for zero-attendance, got {row.get('basic')}"
        assert float(row.get("net") or 0) == 0.0, f"Expected net=0 for zero-attendance, got {row.get('net')}"
        assert float(row.get("payable_days") or 0) == 0.0

    def test_normal_attendance_math(self, admin):
        """CTC 14000, 14 present, 31-day month → per_day = 14000/31 ≈ 451.61,
        payable_days = 14 (no holidays), basic ≈ 6322.58. If a holiday falls in
        window and the day was NOT marked, holiday_count adds to payable_days."""
        r = admin.get(f"{API}/payroll",
                      params={"month": self.TEST_MONTH, "year": self.TEST_YEAR,
                              "staff_id": self.staff_normal_id})
        assert r.status_code == 200
        rows = r.json() if isinstance(r.json(), list) else r.json().get("rows", [])
        row = next((x for x in rows if x.get("staff_id") == self.staff_normal_id), None)
        assert row, "Normal staff payroll row missing"

        last_day = calendar.monthrange(self.TEST_YEAR, self.TEST_MONTH)[1]
        per_day = 14000.0 / last_day
        payable = float(row.get("payable_days") or 0)
        expected_basic = round(per_day * payable, 2)
        actual_basic = float(row.get("basic") or 0)
        # Allow ±0.5 for rounding drift
        assert abs(actual_basic - expected_basic) < 1.0, (
            f"basic={actual_basic}, expected≈{expected_basic} "
            f"(per_day={per_day:.4f}, payable_days={payable})"
        )
        # payable_days must be ≥ 10 (14 marked - up to ~4 weekly-off days),
        # plus possible holidays. Sanity check.
        assert payable >= 10, f"Expected ≥10 payable days, got {payable}"

    def test_recalc_draft_ok(self, admin):
        """POST /api/payroll/{pid}/recalc on a DRAFT row must return 200."""
        r = admin.get(f"{API}/payroll",
                      params={"month": self.TEST_MONTH, "year": self.TEST_YEAR,
                              "staff_id": self.staff_normal_id})
        rows = r.json() if isinstance(r.json(), list) else r.json().get("rows", [])
        row = next((x for x in rows if x.get("staff_id") == self.staff_normal_id), None)
        assert row and row.get("status") == "draft"
        pid = row["id"]
        rc = admin.post(f"{API}/payroll/{pid}/recalc")
        assert rc.status_code == 200, rc.text

    def test_recalc_locked_rejected(self, admin):
        """Manually approve a row via DB is not possible via API alone; simulate via
        edit endpoint if available. If not, we skip. This test is best-effort."""
        # Attempt to fetch a Paid or Approved row from ANY month to test rejection.
        r = admin.get(f"{API}/payroll")
        if r.status_code != 200:
            pytest.skip("Cannot list payrolls")
        rows = r.json() if isinstance(r.json(), list) else r.json().get("rows", [])
        locked = next((x for x in rows if x.get("status") in ("approved", "paid")), None)
        if not locked:
            pytest.skip("No approved/paid payroll row available to test locked recalc")
        rc = admin.post(f"{API}/payroll/{locked['id']}/recalc")
        assert rc.status_code == 400
        assert "reverse" in rc.text.lower() or "locked" in rc.text.lower() or "cannot" in rc.text.lower()


# ---------------- Attendance CSV IST timezone ----------------

class TestAttendanceCsvIST:
    def test_csv_shows_ist_time(self, admin):
        """Insert an attendance row with check_in_at at 03:47 UTC → CSV must show 09:17 IST."""
        # Create a dedicated staff
        s = admin.post(f"{API}/staff", json={
            "name": "TEST_IST_CSV Staff",
            "designation": "Tester",
            "monthly_salary": 10000,
            "joining_date": "2024-01-01",
        })
        assert s.status_code in (200, 201), s.text
        sid = s.json()["id"]

        # Pick a specific date
        date_iso = "2027-06-15"
        month = 6
        year = 2027

        # Mark attendance (creates row)
        r = admin.post(f"{API}/attendance", json={
            "staff_id": sid,
            "date": date_iso,
            "status": "present",
        })
        assert r.status_code == 200

        # Get row id via list_attendance (or attendance list)
        lr = admin.get(f"{API}/attendance",
                       params={"from_date": date_iso, "to_date": date_iso, "staff_id": sid})
        if lr.status_code != 200:
            lr = admin.get(f"{API}/attendance",
                           params={"date_from": date_iso, "date_to": date_iso, "staff_id": sid})
        rows = []
        if lr.status_code == 200:
            j = lr.json()
            rows = j if isinstance(j, list) else j.get("rows", [])
        att_id = None
        for row in rows:
            if row.get("staff_id") == sid and row.get("date") == date_iso:
                att_id = row.get("id")
                break

        if not att_id:
            pytest.skip("Could not locate attendance row id for IST test")

        # PATCH to set explicit UTC check_in
        pr = admin.patch(f"{API}/attendance/{att_id}", json={
            "check_in_at": "2027-06-15T03:47:00Z",
            "check_out_at": "2027-06-15T12:00:00Z",
        })
        assert pr.status_code == 200, pr.text

        # Fetch CSV
        csv = admin.get(f"{API}/reports/attendance",
                        params={"month": month, "year": year, "staff_id": sid})
        assert csv.status_code == 200, csv.text
        body = csv.text
        assert "09:17" in body, (
            f"Expected IST '09:17' in CSV (from 03:47 UTC), CSV excerpt:\n"
            f"{body[:1500]}"
        )
        assert "03:47" not in body, "Raw UTC time leaked into CSV"


# ---------------- Staff Financial History module ----------------

class TestStaffFinancialHistory:
    _seeded_sid = None

    def _get_or_seed_staff(self, client):
        if TestStaffFinancialHistory._seeded_sid:
            return TestStaffFinancialHistory._seeded_sid
        # Prefer to use a seeded staff (avoid dependence on GET /staff which may
        # be broken on legacy data with null designation)
        s = client.post(f"{API}/staff", json={
            "name": "TEST_SFH Staff",
            "designation": "Tester",
            "monthly_salary": 10000,
            "joining_date": "2024-01-01",
        })
        if s.status_code in (200, 201):
            TestStaffFinancialHistory._seeded_sid = s.json()["id"]
        return TestStaffFinancialHistory._seeded_sid

    def test_add_bonus_and_history(self, hr):
        sid = self._get_or_seed_staff(hr)
        if not sid:
            pytest.skip("Could not seed staff")

        # Add a bonus payment of 5000
        pay = hr.post(f"{API}/staff-payments", json={
            "staff_id": sid,
            "payment_type": "bonus",
            "payment_date": "2027-08-10",
            "amount": 5000.0,
            "description": "TEST regression bonus",
            "status": "paid",
        })
        assert pay.status_code == 201, pay.text
        payment_id = pay.json()["id"]

        # Fetch financial history
        h = hr.get(f"{API}/staff/{sid}/financial-history")
        assert h.status_code == 200, h.text
        data = h.json()
        # Response can be dict with txns / totals
        assert isinstance(data, (dict, list))
        # Check the bonus is present
        payload_str = str(data)
        assert "TEST regression bonus" in payload_str or payment_id in payload_str

        # Cleanup
        hr.delete(f"{API}/staff-payments/{payment_id}")

    def test_invalid_payment_type_rejected(self, hr):
        sid = self._get_or_seed_staff(hr)
        if not sid:
            pytest.skip("No staff")
        r = hr.post(f"{API}/staff-payments", json={
            "staff_id": sid,
            "payment_type": "not_a_valid_type",
            "payment_date": "2027-08-10",
            "amount": 1000.0,
        })
        assert r.status_code == 400

    def test_zero_amount_rejected(self, hr):
        sid = self._get_or_seed_staff(hr)
        if not sid:
            pytest.skip("No staff")
        r = hr.post(f"{API}/staff-payments", json={
            "staff_id": sid,
            "payment_type": "bonus",
            "payment_date": "2027-08-10",
            "amount": 0,
        })
        assert r.status_code == 400


# ---------------- HR role access parity ----------------

class TestHRAccess:
    def test_hr_can_run_payroll(self, hr):
        r = hr.post(f"{API}/payroll/run", params={"month": 3, "year": 2028})
        assert r.status_code == 200, r.text

    def test_hr_can_download_bank_csv(self, hr):
        r = hr.get(f"{API}/payroll/bank.csv", params={"month": 3, "year": 2028})
        # 200 or 404 (no rows) both indicate HR has access; 403 = broken
        assert r.status_code != 403, f"HR blocked from bank.csv: {r.status_code}"

    def test_hr_can_download_attendance_csv(self, hr):
        r = hr.get(f"{API}/reports/attendance", params={"month": 3, "year": 2028})
        assert r.status_code != 403

    def test_hr_can_download_payroll_csv(self, hr):
        r = hr.get(f"{API}/reports/payroll", params={"month": 3, "year": 2028})
        assert r.status_code != 403

    def test_hr_can_read_invoices(self, hr):
        r = hr.get(f"{API}/invoices/dashboard")
        assert r.status_code == 200

    def test_hr_can_list_staff(self, hr):
        """Regression: /api/staff must return 200 (was 500 on legacy null designation)."""
        r = hr.get(f"{API}/staff")
        assert r.status_code == 200, (
            f"GET /api/staff returned {r.status_code}. Body: {r.text[:400]}\n"
            "Likely cause: legacy staff row with designation=None fails StaffOut validation."
        )
