"""
Center-scope data isolation tests (multi-tenant finance/HRMS).

Verifies:
  - Center-scoped user (accountant mapped to 1 center) can only access mapped-center data
  - Passing an UNMAPPED center_id via URL to any scoped endpoint returns 403
  - Head-level admin remains unrestricted (regression)

Endpoints under test:
  /api/dashboard/settlement (+ ?center_id)
  /api/dashboard/settlement/txns
  /api/dashboard/settlement/history
  /api/dashboard/summary
  /api/dashboard/payment-summary
  /api/reports/attendance
  /api/reports/consolidated
  /api/reports/payroll
"""

import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

SCOPED_EMAIL = "test_center_manager_c6912430@x.com"
SCOPED_PWD = "Test@1234"
MAPPED_CENTER = "9cf18e69-312d-488d-a484-2d68d62d48a7"
UNMAPPED_CENTER = "0161ac10-0e67-4c92-966b-5cd01628d028"

ADMIN_EMAIL = "admin@finance.app"
ADMIN_PWD = "Admin@123"


def _login(email: str, pwd: str) -> requests.Session:
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    csrf = s.cookies.get("csrf_token")
    assert csrf, "csrf cookie missing after login"
    s.headers.update({"X-CSRF-Token": csrf, "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def scoped():
    return _login(SCOPED_EMAIL, SCOPED_PWD)


@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN_EMAIL, ADMIN_PWD)


# ---------- Sanity: correct user identity ----------
def test_scoped_user_identity(scoped):
    r = scoped.get(f"{API}/auth/me")
    assert r.status_code == 200
    me = r.json()
    assert me.get("email") == SCOPED_EMAIL
    assert me.get("role") == "accountant", f"role={me.get('role')}"
    # assigned centers should include the mapped center only
    assigned = me.get("assigned_center_ids") or me.get("_associated_center_ids") or []
    assert MAPPED_CENTER in assigned, f"mapped center not in assigned={assigned}"
    assert UNMAPPED_CENTER not in assigned


# ---------- Settlement dashboard ----------
def test_settlement_scoped_returns_only_mapped(scoped):
    r = scoped.get(f"{API}/dashboard/settlement")
    assert r.status_code == 200, r.text
    data = r.json()
    centers = data.get("centers") or []
    assert len(centers) == 1, f"expected 1 center, got {len(centers)}"
    assert centers[0].get("center_id") == MAPPED_CENTER


def test_settlement_unmapped_center_403(scoped):
    r = scoped.get(f"{API}/dashboard/settlement", params={"center_id": UNMAPPED_CENTER})
    assert r.status_code == 403, f"expected 403 got {r.status_code} {r.text[:200]}"


def test_settlement_mapped_center_200(scoped):
    r = scoped.get(f"{API}/dashboard/settlement", params={"center_id": MAPPED_CENTER})
    assert r.status_code == 200, r.text


def test_settlement_txns_unmapped_403(scoped):
    r = scoped.get(f"{API}/dashboard/settlement/txns", params={"center_id": UNMAPPED_CENTER})
    assert r.status_code == 403


def test_settlement_txns_mapped_200(scoped):
    r = scoped.get(f"{API}/dashboard/settlement/txns", params={"center_id": MAPPED_CENTER})
    assert r.status_code == 200


def test_settlement_history_unmapped_403(scoped):
    r = scoped.get(f"{API}/dashboard/settlement/history", params={"center_id": UNMAPPED_CENTER})
    assert r.status_code == 403


def test_settlement_history_no_param_only_mapped(scoped):
    r = scoped.get(f"{API}/dashboard/settlement/history")
    assert r.status_code == 200, r.text
    payload = r.json()
    # payload may be a list or dict {items: [...]}
    items = payload if isinstance(payload, list) else (
        payload.get("items") or payload.get("records") or payload.get("history") or []
    )
    leaked = [it for it in items if it.get("center_id") and it["center_id"] != MAPPED_CENTER]
    assert not leaked, f"history leaked unmapped centers: {leaked[:3]}"


# ---------- Dashboard summary / payment summary ----------
def test_dashboard_summary_unmapped_403(scoped):
    r = scoped.get(f"{API}/dashboard/summary", params={"center_id": UNMAPPED_CENTER})
    assert r.status_code == 403, f"got {r.status_code}: {r.text[:200]}"


def test_dashboard_summary_no_param_200(scoped):
    r = scoped.get(f"{API}/dashboard/summary")
    assert r.status_code == 200


def test_payment_summary_unmapped_403(scoped):
    r = scoped.get(f"{API}/dashboard/payment-summary", params={"center_id": UNMAPPED_CENTER})
    assert r.status_code == 403


def test_payment_summary_mapped_200(scoped):
    r = scoped.get(f"{API}/dashboard/payment-summary", params={"center_id": MAPPED_CENTER})
    assert r.status_code == 200


# ---------- Reports ----------
def test_reports_attendance_unmapped_403(scoped):
    r = scoped.get(f"{API}/reports/attendance", params={"month": 6, "year": 2026, "center_id": UNMAPPED_CENTER})
    assert r.status_code == 403


def test_reports_attendance_mapped_200(scoped):
    r = scoped.get(f"{API}/reports/attendance", params={"month": 6, "year": 2026, "center_id": MAPPED_CENTER})
    assert r.status_code == 200


def test_reports_consolidated_unmapped_403(scoped):
    r = scoped.get(f"{API}/reports/consolidated", params={"month": 6, "year": 2026, "center_id": UNMAPPED_CENTER})
    assert r.status_code == 403


def test_reports_payroll_scoped_to_mapped(scoped, admin):
    """/reports/payroll returns CSV. Scoped user's rows must be a subset of
    mapped-center staff. We compare Center column against admin's full CSV
    to confirm no unmapped-center staff leaked."""
    import csv, io
    r = scoped.get(f"{API}/reports/payroll", params={"month": 6, "year": 2026})
    assert r.status_code == 200, r.text
    text = r.text
    reader = csv.reader(io.StringIO(text))
    rows = list(reader)
    if len(rows) <= 1:
        pytest.skip("no payroll rows for month=6/2026 to validate scope against")
    header = rows[0]
    assert "Center" in header, header
    center_col = header.index("Center")
    # Get mapped center's name from admin's dashboard
    r2 = admin.get(f"{API}/dashboard/settlement", params={"center_id": MAPPED_CENTER})
    mapped_name = None
    if r2.status_code == 200:
        cs = r2.json().get("centers") or []
        if cs:
            mapped_name = cs[0].get("center_name") or cs[0].get("name")
    seen = {row[center_col] for row in rows[1:] if row[center_col]}
    if mapped_name:
        leaked = seen - {mapped_name, ""}
        assert not leaked, f"payroll CSV leaked unmapped centers: {leaked}"
    else:
        # Fallback: at most 1 distinct non-empty center
        assert len(seen - {""}) <= 1, f"payroll CSV leaked multiple centers: {seen}"


# ---------- Admin regression (head-level unrestricted) ----------
def test_admin_settlement_many_centers(admin):
    r = admin.get(f"{API}/dashboard/settlement")
    assert r.status_code == 200
    centers = r.json().get("centers") or []
    assert len(centers) > 10, f"admin should see many centers, got {len(centers)}"


def test_admin_can_pass_any_center_id(admin):
    for cid in (MAPPED_CENTER, UNMAPPED_CENTER):
        r = admin.get(f"{API}/dashboard/settlement", params={"center_id": cid})
        assert r.status_code == 200, f"admin blocked on {cid}: {r.status_code}"
        r2 = admin.get(f"{API}/dashboard/summary", params={"center_id": cid})
        assert r2.status_code == 200, f"admin blocked on summary {cid}"
        r3 = admin.get(f"{API}/dashboard/payment-summary", params={"center_id": cid})
        assert r3.status_code == 200
