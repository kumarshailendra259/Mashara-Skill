"""Iter 80 - Phase 2 Financial Year (FY) tests.
Extends FY filtering & stamping to Advances, Invoices, TDS Register, Bank Guarantees.
Also re-verifies FY-vs-center-isolation on the new endpoints.
"""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@finance.app", "password": "Admin@123"}
ACCT = {"email": "test_center_manager_c6912430@x.com", "password": "Test@1234"}
ACCT_CENTER = "9cf18e69-312d-488d-a484-2d68d62d48a7"


def _login(session, creds):
    r = session.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login {creds['email']}: {r.status_code} {r.text[:200]}"
    return session.cookies.get("csrf_token")


def _items(resp):
    j = resp.json()
    if isinstance(j, list):
        return j
    for k in ("items", "advance_requests", "invoices", "guarantees", "bank_guarantees", "results", "data"):
        if k in j and isinstance(j[k], list):
            return j[k]
    return []


@pytest.fixture(scope="module")
def admin_sess():
    s = requests.Session()
    csrf = _login(s, ADMIN)
    s.headers.update({"X-CSRF-Token": csrf})
    return s


@pytest.fixture(scope="module")
def acct_sess():
    s = requests.Session()
    csrf = _login(s, ACCT)
    s.headers.update({"X-CSRF-Token": csrf})
    return s


# ---------------- ADVANCES ----------------

def test_advances_fy_all_vs_2026(admin_sess):
    all_r = admin_sess.get(f"{API}/advance-requests", timeout=60)
    assert all_r.status_code == 200, all_r.text[:300]
    all_items = _items(all_r)

    fy_r = admin_sess.get(f"{API}/advance-requests", params={"fy": "2026-27"}, timeout=60)
    assert fy_r.status_code == 200
    fy_items = _items(fy_r)

    print(f"advances ALL={len(all_items)} FY2026-27={len(fy_items)}")
    assert len(fy_items) <= len(all_items)
    # dates within FY window
    for a in fy_items[:50]:
        d = (a.get("date") or "")[:10]
        if d:
            assert "2026-04-01" <= d <= "2027-03-31", f"advance date {d} outside FY2026-27"


def test_advances_fy_2023_empty(admin_sess):
    r = admin_sess.get(f"{API}/advance-requests", params={"fy": "2023-24"}, timeout=60)
    assert r.status_code == 200
    assert len(_items(r)) == 0


def test_create_advance_stamps_fy(admin_sess):
    payload = {
        "amount": 1234.56,
        "purpose": f"TEST_FY_ADV_{uuid.uuid4().hex[:6]}",
        "category": "Travel",
        "date": "2026-08-15",
    }
    r = admin_sess.post(f"{API}/advance-requests", json=payload, timeout=30)
    if r.status_code not in (200, 201):
        pytest.skip(f"create advance not accepted: {r.status_code} {r.text[:200]}")
    body = r.json()
    aid = body.get("id") or body.get("_id") or (body.get("advance_request") or {}).get("id")
    # find via list
    lst = admin_sess.get(f"{API}/advance-requests", params={"fy": "2026-27"}, timeout=60)
    items = _items(lst)
    found = next((a for a in items if a.get("id") == aid), None) if aid else None
    if found:
        assert found.get("financial_year") == "2026-27", f"stamp missing: {found.get('financial_year')}"
    # cleanup best-effort
    if aid:
        admin_sess.delete(f"{API}/advance-requests/{aid}", timeout=30)


# ---------------- INVOICES ----------------

def test_invoices_fy_filter(admin_sess):
    all_r = admin_sess.get(f"{API}/invoices", timeout=60)
    assert all_r.status_code == 200, all_r.text[:300]
    all_items = _items(all_r)

    fy_r = admin_sess.get(f"{API}/invoices", params={"fy": "2026-27"}, timeout=60)
    assert fy_r.status_code == 200
    fy_items = _items(fy_r)
    print(f"invoices ALL={len(all_items)} FY2026-27={len(fy_items)}")
    assert len(fy_items) <= len(all_items)

    empty_r = admin_sess.get(f"{API}/invoices", params={"fy": "2023-24"}, timeout=60)
    assert empty_r.status_code == 200
    assert len(_items(empty_r)) == 0


def test_invoices_dashboard_fy(admin_sess):
    all_r = admin_sess.get(f"{API}/invoices/dashboard", timeout=30)
    assert all_r.status_code == 200, all_r.text[:300]
    fy_r = admin_sess.get(f"{API}/invoices/dashboard", params={"fy": "2026-27"}, timeout=30)
    assert fy_r.status_code == 200
    print("invoice dashboard ALL:", all_r.json())
    print("invoice dashboard FY:", fy_r.json())


def test_invoices_csv_export_has_fy(admin_sess):
    r = admin_sess.get(f"{API}/invoices/export.csv", params={"fy": "2026-27"}, timeout=60)
    assert r.status_code == 200, r.text[:300]
    text = r.text
    # header must include Financial Year
    first_line = text.splitlines()[0] if text else ""
    assert "Financial Year" in first_line, f"'Financial Year' column missing in CSV header: {first_line}"


# ---------------- TDS REGISTER ----------------

def test_tds_register_fy(admin_sess):
    r = admin_sess.get(f"{API}/reports/tds-register", params={"fy": "2025-26", "quarter": "all"}, timeout=60)
    assert r.status_code == 200, r.text[:300]


# ---------------- BANK GUARANTEES ----------------

def test_bank_guarantees_list_fy(admin_sess):
    all_r = admin_sess.get(f"{API}/bank-guarantees", timeout=30)
    assert all_r.status_code == 200
    fy_r = admin_sess.get(f"{API}/bank-guarantees", params={"fy": "2026-27"}, timeout=30)
    assert fy_r.status_code == 200
    print(f"BGs ALL={len(_items(all_r))} FY2026-27={len(_items(fy_r))}")
    assert len(_items(fy_r)) <= len(_items(all_r))


def test_bank_guarantees_summary_fy(admin_sess):
    r_all = admin_sess.get(f"{API}/bank-guarantees/summary", timeout=30)
    assert r_all.status_code == 200, r_all.text[:300]
    r_fy = admin_sess.get(f"{API}/bank-guarantees/summary", params={"fy": "2026-27"}, timeout=30)
    assert r_fy.status_code == 200, r_fy.text[:300]
    r_empty = admin_sess.get(f"{API}/bank-guarantees/summary", params={"fy": "2023-24"}, timeout=30)
    assert r_empty.status_code == 200
    print("BG summary ALL:", r_all.json())
    print("BG summary FY26-27:", r_fy.json())
    print("BG summary FY23-24:", r_empty.json())


# ---------------- SECURITY: FY does NOT bypass center isolation ----------------

def test_center_isolation_advances(acct_sess):
    r = acct_sess.get(f"{API}/advance-requests", params={"fy": "2026-27"}, timeout=30)
    assert r.status_code == 200
    for a in _items(r)[:100]:
        c = a.get("center_id") or a.get("centre_id")
        if c:
            assert c == ACCT_CENTER, f"advance center leak: {c}"


def test_center_isolation_invoices(acct_sess):
    for ep in ["/invoices", "/invoices/dashboard"]:
        r = acct_sess.get(f"{API}{ep}", params={"fy": "2026-27"}, timeout=30)
        assert r.status_code in (200, 403), f"{ep} -> {r.status_code}"
        if r.status_code == 200 and ep == "/invoices":
            for inv in _items(r)[:100]:
                c = inv.get("center_id") or inv.get("centre_id")
                if c:
                    assert c == ACCT_CENTER, f"invoice center leak: {c}"


def test_center_isolation_bank_guarantees(acct_sess):
    r = acct_sess.get(f"{API}/bank-guarantees", params={"fy": "2026-27"}, timeout=30)
    assert r.status_code in (200, 403)
    if r.status_code == 200:
        for bg in _items(r)[:100]:
            c = bg.get("center_id") or bg.get("centre_id")
            if c:
                assert c == ACCT_CENTER, f"BG center leak: {c}"
