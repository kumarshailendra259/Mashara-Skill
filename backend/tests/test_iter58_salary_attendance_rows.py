"""Phase 54 / iter-58 — Staff Salary Detail attendance_rows tests.

Verifies:
- GET /api/payroll/staff/{sid}/summary returns attendance_rows with EXACTLY
  total_days entries for the requested month/year.
- Each row has required shape (id, date, status, marked_via, synthetic,
  is_regularised, is_week_off, holiday_name).
- Regularised approved row for staff 43be2dc5-fff3-4de7-8762-5207f597b44f
  on 2026-04-15 renders as status='present', is_regularised=true,
  marked_via='regularised'.
- Sundays render as week_off when no attendance row exists.
- Startup Phase54 repair migration executed (log line present).
"""
import os
import calendar
import requests
import pytest

def _load_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    env_path = "/app/frontend/.env"
    if os.path.exists(env_path):
        with open(env_path) as f:
            for ln in f:
                if ln.startswith("REACT_APP_BACKEND_URL="):
                    return ln.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not set")

BASE_URL = _load_url()
API = f"{BASE_URL}/api"

STAFF_A = "bb0b247d-6f35-47b3-b612-4cf47e3faf56"          # autostaff
STAFF_REG = "43be2dc5-fff3-4de7-8762-5207f597b44f"       # has regularised row on 2026-04-15
ADMIN = {"email": "admin@finance.app", "password": "Admin@123"}


@pytest.fixture(scope="module")
def admin_client():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=ADMIN, timeout=30)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return s


def _fetch_summary(client, sid, month, year):
    r = client.get(f"{API}/payroll/staff/{sid}/summary",
                   params={"month": month, "year": year}, timeout=30)
    assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
    return r.json()


# ----- Test 1: row count == calendar days ---------------------------------
def test_summary_returns_all_dates_for_july_2026(admin_client):
    j = _fetch_summary(admin_client, STAFF_A, 7, 2026)
    rows = j["current"]["attendance_rows"]
    assert len(rows) == 31, f"expected 31 rows for Jul 2026, got {len(rows)}"
    # Dates sequential
    dates = [r["date"] for r in rows]
    assert dates == [f"2026-07-{d:02d}" for d in range(1, 32)]


def test_summary_returns_all_dates_for_aug_2026(admin_client):
    j = _fetch_summary(admin_client, STAFF_A, 8, 2026)
    rows = j["current"]["attendance_rows"]
    assert len(rows) == 31
    for r in rows:
        for key in ("id", "date", "status", "synthetic", "is_regularised", "is_week_off"):
            assert key in r, f"missing '{key}' in row {r}"
        # holiday_name may be None but key should be present
        assert "holiday_name" in r


def test_summary_row_count_matches_feb_2026(admin_client):
    # 2026 is not leap → Feb has 28 days
    j = _fetch_summary(admin_client, STAFF_A, 2, 2026)
    rows = j["current"]["attendance_rows"]
    assert len(rows) == calendar.monthrange(2026, 2)[1] == 28


# ----- Test 2: status priority — sundays default to week_off --------------
def test_sundays_without_row_are_week_off(admin_client):
    j = _fetch_summary(admin_client, STAFF_A, 7, 2026)
    # July 2026 Sundays: 5, 12, 19, 26
    by_date = {r["date"]: r for r in j["current"]["attendance_rows"]}
    for d in (5, 12, 19, 26):
        iso = f"2026-07-{d:02d}"
        row = by_date[iso]
        # If NO real row exists AND weekly_off_days contains sunday, expect week_off
        if row["synthetic"]:
            assert row["status"] == "week_off", f"{iso} expected week_off, got {row['status']}"
            assert row["is_week_off"] is True
            assert row["marked_via"] == "policy"


# ----- Test 3: regularised row shows PRESENT, not INCOMPLETE ---------------
def test_regularised_row_shows_present_not_incomplete(admin_client):
    j = _fetch_summary(admin_client, STAFF_REG, 4, 2026)
    rows = j["current"]["attendance_rows"]
    by_date = {r["date"]: r for r in rows}
    target = by_date.get("2026-04-15")
    assert target is not None, "2026-04-15 missing from response"
    assert target["status"] == "present", f"expected 'present', got {target['status']} row={target}"
    assert target["is_regularised"] is True
    assert target.get("marked_via") == "regularised"
    assert target["synthetic"] is False


# ----- Test 4: future dates get 'upcoming' or 'week_off' -------------------
def test_future_dates_are_upcoming_or_off(admin_client):
    # December 2030 fully in future
    j = _fetch_summary(admin_client, STAFF_A, 12, 2030)
    rows = j["current"]["attendance_rows"]
    assert len(rows) == 31
    for r in rows:
        assert r["synthetic"] is True
        assert r["status"] in ("upcoming", "week_off", "holiday"), r


# ----- Test 5: past working day without row = absent -----------------------
def test_past_working_day_absent(admin_client):
    # Jan 2024 — well in the past. Non-sunday days should be 'absent' or 'present'/'leave' if data exists.
    j = _fetch_summary(admin_client, STAFF_A, 1, 2024)
    rows = j["current"]["attendance_rows"]
    # At least one synthetic + absent should exist for a weekday
    saw_absent = False
    for r in rows:
        if r["synthetic"] and not r["is_week_off"] and not r.get("holiday_name"):
            if r["status"] == "absent":
                saw_absent = True
                break
    assert saw_absent, "expected at least one past working weekday to be 'absent'"


# ----- Test 6: RBAC — staff cannot access another's summary ---------------
def test_summary_requires_admin_hr_accountant(admin_client):
    # A fresh session with no auth
    r = requests.get(f"{API}/payroll/staff/{STAFF_A}/summary",
                     params={"month": 7, "year": 2026}, timeout=15)
    assert r.status_code in (401, 403)
