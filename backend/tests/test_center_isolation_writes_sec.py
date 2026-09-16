"""Iteration 77: SEC fixes for WRITE/ACTION endpoints + register downgrade + voucher.

Tests:
  SEC-001 register role downgrades to viewer
  SEC-002 voucher download 403 for cross-center scoped user; admin 200 for paid
  SEC-003 write/action 403 for out-of-scope (invoices patch/advance/audit,
          work-orders patch, batch-targets patch + batches, bank-guarantees
          patch/status/renew)
  SEC-004 candidate patch 403 for out-of-scope; in-scope patch works
  Regression: admin still succeeds (or normal validation error, not 403).
"""
import os
import time
import uuid
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE, "REACT_APP_BACKEND_URL not set"
API = f"{BASE}/api"

ADMIN = ("admin@finance.app", "Admin@123")
SCOPED_CM = ("cmtest_salary@x.com", "Test@1234")
SCOPED_CM_CENTER = "10751714-23a9-4afc-96d6-66b0640ac94f"
SCOPED_ACCT = ("test_center_manager_c6912430@x.com", "Test@1234")
SCOPED_ACCT_CENTER = "9cf18e69-312d-488d-a484-2d68d62d48a7"


def _login(email, pwd):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text[:200]}"
    # CSRF: attach header from cookie for mutating requests
    csrf = s.cookies.get("csrf_token")
    if csrf:
        s.headers.update({"X-CSRF-Token": csrf})
    return s


@pytest.fixture(scope="module")
def admin_s():
    return _login(*ADMIN)


@pytest.fixture(scope="module")
def cm_s():
    return _login(*SCOPED_CM)


@pytest.fixture(scope="module")
def acct_s():
    return _login(*SCOPED_ACCT)


def _list(admin, path, **params):
    r = admin.get(f"{API}{path}", params=params or None, timeout=30)
    if r.status_code != 200:
        return []
    body = r.json()
    if isinstance(body, list):
        return body
    for k in ("items", "data", "results", "invoices", "payments", "candidates",
             "work_orders", "targets", "bank_guarantees"):
        v = body.get(k)
        if isinstance(v, list):
            return v
    return []


@pytest.fixture(scope="module")
def discovered(admin_s):
    """Discover docs across collections. For each collection, find docs whose
    center_id is different from BOTH scoped users' centers (OOS for both)."""
    out = {}
    endpoints = {
        "invoices": "/invoices",
        "work-orders": "/work-orders",
        "batch-targets": "/batch-targets",
        "bank-guarantees": "/bank-guarantees",
        "candidates": "/candidates",
        "payments": "/payments",
    }
    for k, ep in endpoints.items():
        items = _list(admin_s, ep)
        oos_for_cm = None
        in_for_cm = None
        paid_payment = None
        for it in items:
            cid = it.get("center_id")
            if k == "payments":
                if (it.get("status") or "").lower() == "paid":
                    if cid and cid != SCOPED_CM_CENTER and paid_payment is None:
                        paid_payment = it
            if cid and cid != SCOPED_CM_CENTER and oos_for_cm is None:
                oos_for_cm = it
            if cid == SCOPED_CM_CENTER and in_for_cm is None:
                in_for_cm = it
        out[k] = {
            "count": len(items),
            "oos_for_cm": oos_for_cm,
            "in_for_cm": in_for_cm,
            "paid_payment_oos": paid_payment,
        }
    print("DISCOVERED SUMMARY:", {k: {"count": v["count"],
                                       "oos": bool(v["oos_for_cm"]),
                                       "in":  bool(v["in_for_cm"])} for k, v in out.items()})
    return out


# ---------------- SEC-001: register downgrade ----------------

@pytest.mark.parametrize("role", ["senior_manager", "admin", "hr", "manager", "partner", "accountant"])
def test_register_role_downgrades_to_viewer(role):
    email = f"TEST_reg_{role}_{uuid.uuid4().hex[:8]}@x.com"
    payload = {"email": email, "password": "Test@1234", "name": f"reg {role}", "role": role}
    r = requests.post(f"{API}/auth/register", json=payload, timeout=30)
    assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text[:200]}"
    body = r.json()
    # Look for role in response (varies by shape)
    stored_role = None
    for key in ("role",):
        if key in body:
            stored_role = body.get(key)
    if stored_role is None and isinstance(body.get("user"), dict):
        stored_role = body["user"].get("role")
    # If not in response, verify via login + /auth/me
    if stored_role is None:
        s = requests.Session()
        lr = s.post(f"{API}/auth/login", json={"email": email, "password": "Test@1234"}, timeout=30)
        assert lr.status_code == 200, lr.text[:200]
        me = s.get(f"{API}/auth/me", timeout=30)
        if me.status_code == 200:
            mb = me.json()
            stored_role = mb.get("role") or (mb.get("user") or {}).get("role")
    assert stored_role == "viewer", f"role={role} stored as {stored_role}, expected 'viewer'"


# ---------------- SEC-002: voucher ----------------

def test_voucher_oos_scoped_user_403(cm_s, discovered):
    # Find a paid payment whose center is not cm's
    payments = _list_all_payments_admin_paid_oos()
    if not payments:
        pytest.skip("no paid OOS payment found")
    pid = payments[0]["id"]
    r = cm_s.get(f"{API}/payments/{pid}/voucher/download", timeout=30, allow_redirects=False)
    assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text[:200]}"


def _list_all_payments_admin_paid_oos():
    """Helper (not a fixture) - fetches paid OOS payments using admin creds inline."""
    s = _login(*ADMIN)
    items = _list(s, "/payments", limit=500)
    if not items:
        items = _list(s, "/payments")
    out = []
    for it in items:
        if (it.get("status") or "").lower() == "paid" and it.get("center_id") and it.get("center_id") != SCOPED_CM_CENTER:
            out.append(it)
    return out


def test_voucher_admin_downloads_paid(admin_s):
    payments = _list_all_payments_admin_paid_oos()
    if not payments:
        # try any paid payment
        items = _list(admin_s, "/payments")
        paid = [p for p in items if (p.get("status") or "").lower() == "paid"]
        if not paid:
            pytest.skip("no paid payment exists in this env")
        pid = paid[0]["id"]
    else:
        pid = payments[0]["id"]
    r = admin_s.get(f"{API}/payments/{pid}/voucher/download", timeout=60, allow_redirects=False)
    assert r.status_code == 200, f"admin voucher: {r.status_code}: {r.text[:200]}"


# ---------------- SEC-003: invoices write/action ----------------

def test_invoice_patch_oos_403(cm_s, discovered):
    inv = discovered["invoices"]["oos_for_cm"]
    if not inv:
        pytest.skip("no OOS invoice available (collection empty or all in-scope)")
    iid = inv.get("id") or inv.get("_id")
    r = cm_s.patch(f"{API}/invoices/{iid}", json={}, timeout=30)
    assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text[:200]}"


def test_invoice_advance_oos_403(cm_s, discovered):
    inv = discovered["invoices"]["oos_for_cm"]
    if not inv:
        pytest.skip("no OOS invoice")
    iid = inv.get("id") or inv.get("_id")
    r = cm_s.post(f"{API}/invoices/{iid}/advance", json={}, timeout=30)
    assert r.status_code == 403, f"got {r.status_code}: {r.text[:200]}"


def test_invoice_audit_oos_403(cm_s, discovered):
    inv = discovered["invoices"]["oos_for_cm"]
    if not inv:
        pytest.skip("no OOS invoice")
    iid = inv.get("id") or inv.get("_id")
    r = cm_s.get(f"{API}/invoices/{iid}/audit", timeout=30)
    assert r.status_code == 403, f"got {r.status_code}: {r.text[:200]}"


def test_invoice_admin_audit_not_403(admin_s, discovered):
    inv = discovered["invoices"]["oos_for_cm"]
    if not inv:
        pytest.skip("no invoice")
    iid = inv.get("id") or inv.get("_id")
    r = admin_s.get(f"{API}/invoices/{iid}/audit", timeout=30)
    assert r.status_code != 403, f"admin got 403 unexpectedly"


# ---------------- SEC-003: work-orders ----------------

def test_work_order_patch_oos_403(cm_s, discovered):
    wo = discovered["work-orders"]["oos_for_cm"]
    if not wo:
        pytest.skip("no OOS work order")
    wid = wo.get("id") or wo.get("_id")
    r = cm_s.patch(f"{API}/work-orders/{wid}", json={}, timeout=30)
    assert r.status_code == 403, f"got {r.status_code}: {r.text[:200]}"


def test_work_order_patch_admin_not_403(admin_s, discovered):
    wo = discovered["work-orders"]["oos_for_cm"]
    if not wo:
        pytest.skip("no work order")
    wid = wo.get("id") or wo.get("_id")
    r = admin_s.patch(f"{API}/work-orders/{wid}", json={}, timeout=30)
    assert r.status_code != 403


# ---------------- SEC-003: batch-targets ----------------

def test_batch_target_patch_oos_403(cm_s, discovered):
    t = discovered["batch-targets"]["oos_for_cm"]
    if not t:
        pytest.skip("no OOS batch target")
    tid = t.get("id") or t.get("_id")
    r = cm_s.patch(f"{API}/batch-targets/{tid}", json={}, timeout=30)
    assert r.status_code == 403, f"got {r.status_code}: {r.text[:200]}"


def test_batch_target_batches_oos_403(cm_s, discovered):
    t = discovered["batch-targets"]["oos_for_cm"]
    if not t:
        pytest.skip("no OOS batch target")
    tid = t.get("id") or t.get("_id")
    r = cm_s.get(f"{API}/batch-targets/{tid}/batches", timeout=30)
    assert r.status_code == 403, f"got {r.status_code}: {r.text[:200]}"


def test_batch_target_admin_not_403(admin_s, discovered):
    t = discovered["batch-targets"]["oos_for_cm"]
    if not t:
        pytest.skip("no batch target")
    tid = t.get("id") or t.get("_id")
    r = admin_s.get(f"{API}/batch-targets/{tid}/batches", timeout=30)
    assert r.status_code != 403


# ---------------- SEC-003: bank-guarantees ----------------

def test_bg_patch_oos_403(cm_s, discovered):
    bg = discovered["bank-guarantees"]["oos_for_cm"]
    if not bg:
        pytest.skip("no OOS BG")
    bid = bg.get("id") or bg.get("_id")
    r = cm_s.patch(f"{API}/bank-guarantees/{bid}", json={}, timeout=30)
    assert r.status_code == 403, f"got {r.status_code}: {r.text[:200]}"


def test_bg_status_oos_403(cm_s, discovered):
    bg = discovered["bank-guarantees"]["oos_for_cm"]
    if not bg:
        pytest.skip("no OOS BG")
    bid = bg.get("id") or bg.get("_id")
    r = cm_s.post(f"{API}/bank-guarantees/{bid}/status", json={"status": "active"}, timeout=30)
    assert r.status_code == 403, f"got {r.status_code}: {r.text[:200]}"


def test_bg_renew_oos_403(cm_s, discovered):
    bg = discovered["bank-guarantees"]["oos_for_cm"]
    if not bg:
        pytest.skip("no OOS BG")
    bid = bg.get("id") or bg.get("_id")
    r = cm_s.patch(f"{API}/bank-guarantees/{bid}/renew", json={}, timeout=30)
    assert r.status_code == 403, f"got {r.status_code}: {r.text[:200]}"


def test_bg_admin_not_403(admin_s, discovered):
    bg = discovered["bank-guarantees"]["oos_for_cm"]
    if not bg:
        pytest.skip("no BG")
    bid = bg.get("id") or bg.get("_id")
    r = admin_s.patch(f"{API}/bank-guarantees/{bid}", json={}, timeout=30)
    assert r.status_code != 403


# ---------------- SEC-004: candidates ----------------

def test_candidate_patch_oos_403(cm_s, discovered):
    c = discovered["candidates"]["oos_for_cm"]
    if not c:
        pytest.skip("no OOS candidate")
    cid = c.get("id") or c.get("_id")
    r = cm_s.patch(f"{API}/candidates/{cid}", json={}, timeout=30)
    assert r.status_code == 403, f"got {r.status_code}: {r.text[:200]}"


def test_candidate_patch_in_scope_not_403(cm_s, discovered):
    c = discovered["candidates"]["in_for_cm"]
    if not c:
        pytest.skip("no in-scope candidate for cm user")
    cid = c.get("id") or c.get("_id")
    r = cm_s.patch(f"{API}/candidates/{cid}", json={}, timeout=30)
    assert r.status_code != 403, f"in-scope PATCH got 403: {r.text[:200]}"


def test_candidate_patch_admin_not_403(admin_s, discovered):
    c = discovered["candidates"]["oos_for_cm"]
    if not c:
        pytest.skip("no candidate")
    cid = c.get("id") or c.get("_id")
    r = admin_s.patch(f"{API}/candidates/{cid}", json={}, timeout=30)
    assert r.status_code != 403


# ---------------- Regression: in-scope invoice PATCH not 403 ----------------

def test_invoice_patch_in_scope_not_403(cm_s, discovered):
    inv = discovered["invoices"]["in_for_cm"]
    if not inv:
        pytest.skip("no in-scope invoice")
    iid = inv.get("id") or inv.get("_id")
    r = cm_s.patch(f"{API}/invoices/{iid}", json={}, timeout=30)
    assert r.status_code != 403, f"in-scope invoice PATCH got 403: {r.text[:200]}"
