"""Iter 79 - Financial Year (FY) system tests.
Covers: /api/financial-years, FY filtering on transactions/dashboards,
FY stamp on create, CSV export, and FY-vs-center-isolation security.
"""
import os
import re
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@finance.app", "password": "Admin@123"}
ACCT = {"email": "test_center_manager_c6912430@x.com", "password": "Test@1234"}
ACCT_CENTER = "9cf18e69-312d-488d-a484-2d68d62d48a7"
OTHER_CENTER = "20e11e4a-1234-4b6c-9c2c-000000000001"  # a foreign one


def _login(session, creds):
    r = session.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed {creds['email']}: {r.status_code} {r.text[:200]}"
    return session.cookies.get("csrf_token")


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


# ---------- /api/financial-years ----------

def test_financial_years_options(admin_sess):
    r = admin_sess.get(f"{API}/financial-years", timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "options" in data and "current" in data
    values = [o["value"] for o in data["options"]]
    assert values[0] == "all"
    for y in range(2023, 2030):
        assert f"{y}-{str(y+1)[-2:]}" in values, f"missing FY {y}"
    assert data["current"] == "2026-27"


# ---------- Transactions FY filter ----------

def test_transactions_all_vs_2025_26(admin_sess):
    all_r = admin_sess.get(f"{API}/transactions", timeout=60)
    assert all_r.status_code == 200
    all_items = all_r.json() if isinstance(all_r.json(), list) else all_r.json().get("items", all_r.json().get("transactions", []))

    fy_r = admin_sess.get(f"{API}/transactions", params={"fy": "2025-26"}, timeout=60)
    assert fy_r.status_code == 200
    fy_items = fy_r.json() if isinstance(fy_r.json(), list) else fy_r.json().get("items", fy_r.json().get("transactions", []))

    print(f"ALL={len(all_items)} FY2025-26={len(fy_items)}")
    assert len(fy_items) <= len(all_items)
    # dates should fall within window
    for t in fy_items[:50]:
        d = (t.get("date") or t.get("transaction_date") or "")[:10]
        if d:
            assert "2025-04-01" <= d <= "2026-03-31", f"txn date {d} outside FY2025-26"


def test_transactions_fy_2023_24_empty(admin_sess):
    r = admin_sess.get(f"{API}/transactions", params={"fy": "2023-24"}, timeout=60)
    assert r.status_code == 200
    items = r.json() if isinstance(r.json(), list) else r.json().get("items", r.json().get("transactions", []))
    assert len(items) == 0, f"expected empty for FY2023-24, got {len(items)}"


# ---------- Dashboards FY filter ----------

def test_dashboard_summary_fy(admin_sess):
    all_r = admin_sess.get(f"{API}/dashboard/summary", timeout=30)
    fy_r = admin_sess.get(f"{API}/dashboard/summary", params={"fy": "2025-26"}, timeout=30)
    assert all_r.status_code == 200 and fy_r.status_code == 200
    # Totals likely differ
    print("summary all:", all_r.json())
    print("summary fy:", fy_r.json())


def test_payment_summary_window(admin_sess):
    r = admin_sess.get(f"{API}/dashboard/payment-summary", params={"fy": "2026-27"}, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    meta = data.get("meta") or {}
    assert meta.get("start") == "2026-04-01"
    assert meta.get("end") == "2027-03-31"


# ---------- CSV export ----------

def test_transactions_csv_has_fy_column():
    """CSV export is client-side (frontend/src/pages/Transactions.jsx exportCsv).
    Verify the header column list statically instead of hitting backend."""
    with open("/app/frontend/src/pages/Transactions.jsx") as f:
        src = f.read()
    assert "\"financial_year\"" in src, "financial_year column missing from Transactions.jsx CSV header"


# ---------- Create transaction stamps FY ----------

def test_create_txn_stamps_fy(admin_sess):
    payload = {
        "type": "expense",
        "amount": 111.11,
        "category": "Utilities",
        "description": f"TEST_FY_STAMP_{uuid.uuid4().hex[:6]}",
        "date": "2025-08-15",
    }
    r = admin_sess.post(f"{API}/transactions", json=payload, timeout=30)
    assert r.status_code in (200, 201), r.text[:300]
    body = r.json()
    tid = body.get("id") or body.get("_id") or (body.get("transaction") or {}).get("id")
    assert tid, f"no id in {body}"
    # There is no GET /api/transactions/{id} — verify via list
    lst = admin_sess.get(f"{API}/transactions", params={"fy": "2025-26"}, timeout=60).json()
    items = lst if isinstance(lst, list) else lst.get("items", lst.get("transactions", []))
    found = next((t for t in items if t.get("id") == tid), None)
    assert found, f"created txn {tid} not found in FY2025-26 listing"
    assert found.get("financial_year") == "2025-26", found
    # cleanup
    admin_sess.delete(f"{API}/transactions/{tid}", timeout=30)


# ---------- Security: FY must NOT bypass center isolation ----------

def test_fy_does_not_bypass_center_isolation(acct_sess):
    # transactions with fy should still be center-scoped
    r = acct_sess.get(f"{API}/transactions", params={"fy": "2025-26"}, timeout=60)
    assert r.status_code == 200
    items = r.json() if isinstance(r.json(), list) else r.json().get("items", r.json().get("transactions", []))
    for t in items[:100]:
        c = t.get("center_id") or t.get("centre_id")
        if c:
            assert c == ACCT_CENTER, f"center leak: got {c}"

    # dashboard summary + fy — must return 200 with own data
    for ep in ["/dashboard/summary", "/dashboard/payment-summary", "/dashboard/settlement"]:
        r = acct_sess.get(f"{API}{ep}", params={"fy": "2025-26"}, timeout=30)
        assert r.status_code in (200, 404), f"{ep} -> {r.status_code}"

    # passing another center_id must 403
    r = acct_sess.get(
        f"{API}/dashboard/summary",
        params={"fy": "2025-26", "center_id": OTHER_CENTER},
        timeout=30,
    )
    assert r.status_code == 403, f"expected 403 cross-center, got {r.status_code} {r.text[:200]}"
