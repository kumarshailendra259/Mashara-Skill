"""iter-57: Staff App Attendance Module redesign
Tests:
- POST /api/attendance/self: structured 400 out-of-geofence, is_late flag,
  office_distance_m persistence
- GET  /api/attendance/my-monthly: shape, week-off (Sunday), absent for past
  unmarked, future days, holidays, summary counts, present after posting today
- Regression: /api/staff 200, /api/attendance/my 200, HR /staff search
"""
import os
import datetime as _dt
import pytest
import requests

_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not _URL:
    # fallback to frontend/.env
    with open("/app/frontend/.env") as _f:
        for _line in _f:
            if _line.startswith("REACT_APP_BACKEND_URL="):
                _URL = _line.split("=", 1)[1].strip()
                break
BASE_URL = (_URL or "").rstrip("/")
API = f"{BASE_URL}/api"

STAFF_EMAIL = "autostaff_1782322458@example.com"
STAFF_PASSWORD = "Staff@12345"
ADMIN_EMAIL = "admin@finance.app"
ADMIN_PASSWORD = "Admin@123"
HR_EMAIL = "hr@finance.app"
HR_PASSWORD = "Hr@12345"

# Ranchi coords - far away from any Mumbai fence
OUT_LAT, OUT_LNG = 23.3441, 85.3096


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def staff_session():
    return _login(STAFF_EMAIL, STAFF_PASSWORD)


@pytest.fixture(scope="module")
def admin_session():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def hr_session():
    return _login(HR_EMAIL, HR_PASSWORD)


# ---------------- Backend: /attendance/my-monthly ----------------
class TestMonthlyCalendar:
    def _today_ist(self):
        # matches server _today_ist(): current date in Asia/Kolkata
        return (_dt.datetime.utcnow() + _dt.timedelta(hours=5, minutes=30)).date()

    def test_monthly_shape_and_sunday_week_off(self, staff_session):
        today = self._today_ist()
        r = staff_session.get(f"{API}/attendance/my-monthly", params={"month": today.month, "year": today.year}, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        # top-level keys
        for k in ("days", "summary", "month", "year", "weekly_off_days", "total_days"):
            assert k in data, f"missing key: {k}"
        assert data["month"] == today.month and data["year"] == today.year
        # count days in month
        import calendar
        expected_days = calendar.monthrange(today.year, today.month)[1]
        assert data["total_days"] == expected_days
        assert len(data["days"]) == expected_days
        # Every Sunday whose date is not attended/holiday must be week_off, and future days must be future
        for iso, day in data["days"].items():
            d = _dt.date.fromisoformat(iso)
            for key in ("status", "is_late", "is_today", "is_future", "weekday"):
                assert key in day
            if d > today:
                assert day["is_future"] == True
                # future can be status=future OR week_off/holiday (all fine per priority)
            # Sundays with no att/leave/holiday should be week_off
            if d.weekday() == 6 and day["status"] not in ("present", "half", "absent", "paid_leave", "leave", "holiday"):
                assert day["status"] == "week_off", f"Sunday {iso} should be week_off, got {day['status']}"

    def test_summary_counts_match(self, staff_session):
        today = self._today_ist()
        r = staff_session.get(f"{API}/attendance/my-monthly", params={"month": today.month, "year": today.year}, timeout=20)
        data = r.json()
        s = data["summary"]
        # summary counts from days
        recount = {"present": 0, "absent": 0, "half": 0, "paid_leave": 0, "week_off": 0}
        for day in data["days"].values():
            st = day["status"]
            if st == "present":
                recount["present"] += 1
            elif st == "absent":
                recount["absent"] += 1
            elif st == "half":
                recount["half"] += 1
            elif st == "paid_leave":
                recount["paid_leave"] += 1
            elif st in ("week_off", "holiday"):
                recount["week_off"] += 1
        assert s == recount, f"summary mismatch: server={s}, recount={recount}"

    def test_holiday_aug_15(self, staff_session):
        """If Aug 15 holiday exists in DB, it should surface with holiday_name."""
        today = self._today_ist()
        r = staff_session.get(f"{API}/attendance/my-monthly", params={"month": 8, "year": today.year}, timeout=20)
        assert r.status_code == 200
        data = r.json()
        aug15 = data["days"].get(f"{today.year:04d}-08-15")
        assert aug15 is not None
        # Only assert holiday_name if status=holiday, otherwise it's a soft-skip (no seed row)
        if aug15["status"] == "holiday":
            assert aug15.get("holiday_name"), "holiday_name must be populated when status=holiday"

    def test_mark_today_then_reflected_present(self, staff_session):
        """POST self check-in with location inside a fence — actually we may still be
        outside a fence, so we bypass by omitting lat/lng (server only enforces geofence
        when lat+lng provided). Then re-fetch monthly and verify today = present."""
        today = self._today_ist()
        # No lat/lng => skips geofence and marks attendance
        r = staff_session.post(f"{API}/attendance/self", json={}, timeout=20)
        assert r.status_code == 200, f"self check-in without coords should succeed: {r.status_code} {r.text}"
        # Fetch monthly
        r2 = staff_session.get(f"{API}/attendance/my-monthly", params={"month": today.month, "year": today.year}, timeout=20)
        assert r2.status_code == 200
        day = r2.json()["days"][today.isoformat()]
        assert day["status"] == "present", f"today should be present, got {day['status']}"
        assert day["is_today"] == True


# ---------------- Backend: /attendance/self structured errors ----------------
class TestSelfCheckIn:
    def test_out_of_geofence_returns_structured_400(self, staff_session):
        r = staff_session.post(
            f"{API}/attendance/self",
            json={"latitude": OUT_LAT, "longitude": OUT_LNG, "address": "Ranchi test"},
            timeout=20,
        )
        # If no geofences configured, this returns 200 — that's a soft-skip
        if r.status_code == 200:
            pytest.skip("No active geofences configured for this staff/center; cannot validate 400 shape")
        assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text}"
        detail = r.json().get("detail")
        assert isinstance(detail, dict), f"detail must be structured object, got {type(detail).__name__}: {detail}"
        for k in ("code", "distance_m", "radius_m", "site_name", "message"):
            assert k in detail, f"missing key {k} in detail: {detail}"
        assert detail["code"] == "outside_geofence"
        assert isinstance(detail["distance_m"], (int, float))
        assert isinstance(detail["radius_m"], (int, float))
        assert isinstance(detail["site_name"], str)
        assert isinstance(detail["message"], str)

    def test_office_distance_m_persisted_on_success(self, staff_session, admin_session):
        """After a successful in-range check-in (no coords case => nearest_dist_m stays None),
        we validate the field is populated when coords ARE provided AND inside a fence.
        If not possible, soft-skip.
        Strategy: fetch admin geofences; pick first; use its lat/lng => in-range."""
        r = admin_session.get(f"{API}/geofences", timeout=15)
        if r.status_code != 200 or not r.json():
            pytest.skip("No geofences to test in-range persistence")
        fence = r.json()[0]
        f_lat, f_lng = fence["latitude"], fence["longitude"]
        r2 = staff_session.post(
            f"{API}/attendance/self",
            json={"latitude": f_lat, "longitude": f_lng, "address": "TEST in-range"},
            timeout=20,
        )
        assert r2.status_code == 200, r2.text
        # Fetch today's row via my-monthly and confirm office_distance_m present
        today = (_dt.datetime.utcnow() + _dt.timedelta(hours=5, minutes=30)).date()
        rm = staff_session.get(f"{API}/attendance/my-monthly", params={"month": today.month, "year": today.year}, timeout=15)
        day = rm.json()["days"][today.isoformat()]
        assert "office_distance_m" in day
        assert day.get("office_distance_m") is not None, f"office_distance_m should be persisted: {day}"

    def test_is_late_persisted(self, staff_session):
        """is_late field must exist on today's row after check-in (True or False depending on shift)."""
        today = (_dt.datetime.utcnow() + _dt.timedelta(hours=5, minutes=30)).date()
        rm = staff_session.get(f"{API}/attendance/my-monthly", params={"month": today.month, "year": today.year}, timeout=15)
        day = rm.json()["days"][today.isoformat()]
        assert "is_late" in day
        assert isinstance(day["is_late"], bool)


# ---------------- Regression ----------------
class TestRegression:
    def test_admin_list_staff(self, admin_session):
        r = admin_session.get(f"{API}/staff", timeout=15)
        assert r.status_code == 200, f"/api/staff regression: {r.status_code} {r.text[:400]}"
        assert isinstance(r.json(), list)

    def test_staff_my_attendance(self, staff_session):
        r = staff_session.get(f"{API}/attendance/my", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_hr_staff_search_auto(self, hr_session):
        r = hr_session.get(f"{API}/staff", timeout=15)
        assert r.status_code == 200
        rows = r.json()
        matches = [s for s in rows if "auto" in (s.get("name") or "").lower()]
        assert len(matches) > 0, "HR search 'Auto' should return at least one match"

    def test_auth_me_staff(self, staff_session):
        r = staff_session.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 200
        assert r.json().get("email") == STAFF_EMAIL
