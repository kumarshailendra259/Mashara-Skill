"""Iteration-13 backend tests: mobile attendance — self check-in, location, selfie, /attendance/today, /attendance with extra fields, PWA manifest."""
import os
import uuid
import requests
import pytest
from datetime import datetime, timezone


def _read_url():
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL"):
                    return line.split("=", 1)[1].strip()
    except Exception:
        pass
    return ""


BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _read_url()).rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "admin@finance.app"
ADMIN_PWD = "Admin@123"
TAG = uuid.uuid4().hex[:6]
TODAY = datetime.now(timezone.utc).date().isoformat()


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return s


def _register(email, password, name="TEST mobile user"):
    s = requests.Session()
    r = s.post(f"{API}/auth/register", json={"email": email, "password": password, "name": name}, timeout=15)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    return s, r.json()


@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN_EMAIL, ADMIN_PWD)


@pytest.fixture(scope="module")
def admin_staff_id(admin):
    """Resolve the staff id that the backend itself associates with the admin user.
    Note: prior test iterations may have created multiple TEST_* staff rows
    linked to admin's user_id; Mongo's `find_one` (used by /attendance/today
    and /attendance/self) is non-deterministic among them, so we must trust
    whichever the backend picks for consistency across these tests."""
    r = admin.get(f"{API}/attendance/today", timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    if data.get("staff"):
        return data["staff"]["id"]
    # No linked staff yet — create one
    me = admin.get(f"{API}/auth/me", timeout=15).json()
    body = {"name": f"TEST_AdminStaff_{TAG}", "user_id": me["id"], "per_day_rate": 1000}
    rs = admin.post(f"{API}/staff", json=body, timeout=15)
    assert rs.status_code == 200, rs.text
    return rs.json()["id"]


@pytest.fixture(scope="module")
def unmapped_user():
    """Brand-new user with no staff record."""
    email = f"test_unmapped_{TAG}@finance.app"
    s, _u = _register(email, "P@ssw0rd!", name=f"TEST_Unmapped_{TAG}")
    return s


# ---------------- /attendance/today ----------------
class TestAttendanceToday:
    def test_today_unmapped_user_returns_null_staff(self, unmapped_user):
        r = unmapped_user.get(f"{API}/attendance/today", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data == {"staff": None, "attendance": None}

    def test_today_mapped_user_returns_staff(self, admin, admin_staff_id):
        r = admin.get(f"{API}/attendance/today", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("staff") is not None
        assert data["staff"]["id"] == admin_staff_id


# ---------------- /attendance/self ----------------
class TestSelfCheckIn:
    def test_self_checkin_unmapped_returns_400(self, unmapped_user):
        r = unmapped_user.post(
            f"{API}/attendance/self",
            json={"status": "present", "latitude": 19.07, "longitude": 72.87, "accuracy": 12.5},
            timeout=15,
        )
        assert r.status_code == 400, r.text
        assert "not linked" in r.text.lower() or "staff" in r.text.lower()

    def test_self_checkin_persists_and_today_returns_it(self, admin, admin_staff_id):
        payload = {
            "status": "present",
            "latitude": 19.076090,
            "longitude": 72.877426,
            "accuracy": 8.5,
            "selfie_path": f"finance/uploads/test/{TAG}_selfie.jpg",
            "selfie_filename": f"selfie_{TAG}.jpg",
        }
        r = admin.post(f"{API}/attendance/self", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["staff_id"] == admin_staff_id
        assert body["date"] == TODAY
        assert body.get("marked_at")

        # Verify via /attendance/today
        r2 = admin.get(f"{API}/attendance/today", timeout=15)
        assert r2.status_code == 200
        att = r2.json().get("attendance")
        assert att is not None
        assert att["staff_id"] == admin_staff_id
        assert att["date"] == TODAY
        assert att["status"] == "present"
        assert att["marked_via"] == "self"
        assert att.get("marked_at")
        assert att.get("marked_by")
        assert abs(att["latitude"] - 19.076090) < 1e-5
        assert abs(att["longitude"] - 72.877426) < 1e-5
        assert att["accuracy"] == 8.5
        assert att["selfie_path"] == payload["selfie_path"]
        assert att["selfie_filename"] == payload["selfie_filename"]

    def test_self_checkin_is_upsert_idempotent(self, admin, admin_staff_id):
        # Call twice, second should overwrite (same staff_id+date)
        r1 = admin.post(
            f"{API}/attendance/self",
            json={"status": "half", "latitude": 1.0, "longitude": 2.0, "accuracy": 5},
            timeout=15,
        )
        assert r1.status_code == 200
        r2 = admin.post(
            f"{API}/attendance/self",
            json={"status": "leave", "latitude": 3.0, "longitude": 4.0, "accuracy": 9},
            timeout=15,
        )
        assert r2.status_code == 200
        # Today should reflect the latest one
        today = admin.get(f"{API}/attendance/today", timeout=15).json()["attendance"]
        assert today["status"] == "leave"
        assert today["latitude"] == 3.0
        assert today["marked_via"] == "self"

    def test_self_checkin_minimal_payload_status_only(self, admin):
        r = admin.post(f"{API}/attendance/self", json={"status": "present"}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["date"] == TODAY

    def test_self_checkin_requires_auth(self):
        s = requests.Session()
        r = s.post(f"{API}/attendance/self", json={"status": "present"}, timeout=15)
        assert r.status_code in (401, 403), r.text


# ---------------- /attendance (admin) extended fields ----------------
class TestAdminAttendanceExtended:
    def test_admin_post_accepts_full_extended_fields(self, admin, admin_staff_id):
        # Use a future-ish date to avoid conflicts with self-checkin tests
        d = "2099-01-15"
        payload = {
            "staff_id": admin_staff_id,
            "date": d,
            "status": "present",
            "latitude": 12.971599,
            "longitude": 77.594566,
            "accuracy": 4.2,
            "selfie_path": f"finance/uploads/test/{TAG}_admin_selfie.jpg",
            "selfie_filename": "admin_selfie.jpg",
            "marked_via": "admin",
        }
        r = admin.post(f"{API}/attendance", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        # Read back via list endpoint
        rows = admin.get(f"{API}/attendance", params={"staff_id": admin_staff_id, "start": d, "end": d}, timeout=15).json()
        assert len(rows) >= 1
        row = next((r for r in rows if r["date"] == d), None)
        assert row is not None
        assert row["latitude"] == 12.971599
        assert row["selfie_path"].endswith("admin_selfie.jpg")
        assert row["marked_via"] == "admin"
        assert row.get("marked_by")  # auto-set
        assert row.get("marked_at")  # auto-set

    def test_admin_post_minimal_payload_still_works(self, admin, admin_staff_id):
        d = "2099-01-16"
        r = admin.post(f"{API}/attendance", json={"staff_id": admin_staff_id, "date": d, "status": "absent"}, timeout=15)
        assert r.status_code == 200, r.text
        rows = admin.get(f"{API}/attendance", params={"staff_id": admin_staff_id, "start": d, "end": d}, timeout=15).json()
        row = next((r for r in rows if r["date"] == d), None)
        assert row is not None
        assert row["status"] == "absent"
        assert row.get("marked_via") == "admin"  # default applied by server
        assert row.get("marked_at")


# ---------------- PWA manifest ----------------
class TestPwaManifest:
    def test_manifest_served(self):
        r = requests.get(f"{BASE_URL}/manifest.json", timeout=15)
        assert r.status_code == 200, r.text
        m = r.json()
        assert m.get("start_url") == "/check-in"
        assert m.get("display") == "standalone"
        assert m.get("theme_color") == "#0a3bc5"
        icons = m.get("icons") or []
        sizes = {i.get("sizes") for i in icons}
        assert "192x192" in sizes
        assert "512x512" in sizes

    def test_checkin_page_html_links_manifest(self):
        r = requests.get(f"{BASE_URL}/check-in", timeout=15)
        assert r.status_code == 200
        html = r.text
        assert "manifest.json" in html
        assert "apple-mobile-web-app-capable" in html
