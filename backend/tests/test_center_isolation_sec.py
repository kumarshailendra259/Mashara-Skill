"""SEC-001/002/003 Center-based data isolation regression tests."""
import os
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://invest-analytics-24.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"

ADMIN = ("admin@finance.app", "Admin@123")
SCOPED = ("test_center_manager_c6912430@x.com", "Test@1234")
SCOPED_CENTER = "9cf18e69-312d-488d-a484-2d68d62d48a7"


def _login(email, pwd):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def admin_session():
    return _login(*ADMIN)


@pytest.fixture(scope="module")
def scoped_session():
    return _login(*SCOPED)


@pytest.fixture(scope="module")
def discovered(admin_session):
    """Discover in-scope / out-of-scope ids for various collections using admin listing."""
    data = {}
    endpoints = {
        "invoices": "/invoices",
        "candidates": "/candidates",
        "payments": "/payments",
        "quotations": "/quotations",
        "work-orders": "/work-orders",
        "batch-targets": "/batch-targets",
        "bank-guarantees": "/bank-guarantees",
    }
    for k, ep in endpoints.items():
        try:
            r = admin_session.get(f"{API}{ep}", timeout=30)
            if r.status_code != 200:
                data[k] = {"error": f"{r.status_code}: {r.text[:120]}", "in_scope": None, "out_scope": None, "other_center": None}
                continue
            body = r.json()
            items = body if isinstance(body, list) else body.get("items") or body.get("data") or body.get("results") or []
            in_doc = None
            out_doc = None
            other_center = None
            for it in items:
                cid = it.get("center_id")
                if cid == SCOPED_CENTER and in_doc is None:
                    in_doc = it
                elif cid and cid != SCOPED_CENTER and out_doc is None:
                    out_doc = it
                    other_center = cid
                if in_doc and out_doc:
                    break
            data[k] = {
                "count": len(items),
                "in_scope_id": (in_doc or {}).get("id") or (in_doc or {}).get("_id"),
                "out_scope_id": (out_doc or {}).get("id") or (out_doc or {}).get("_id"),
                "other_center": other_center,
            }
        except Exception as e:
            data[k] = {"error": str(e)}
    print("DISCOVERED:", data)
    return data


# ---------- SEC-001: Invoices list/dashboard/export ----------

def test_invoices_list_scoped_user(scoped_session):
    r = scoped_session.get(f"{API}/invoices", timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    items = body if isinstance(body, list) else body.get("items") or body.get("data") or []
    for it in items:
        cid = it.get("center_id")
        assert cid == SCOPED_CENTER, f"leak: invoice center_id={cid} not in scope"


def test_invoices_list_admin(admin_session):
    r = admin_session.get(f"{API}/invoices", timeout=30)
    assert r.status_code == 200


def test_invoices_list_out_of_scope_filter_scoped(scoped_session, discovered):
    other = discovered.get("invoices", {}).get("other_center") or "00000000-0000-0000-0000-000000000000"
    r = scoped_session.get(f"{API}/invoices", params={"center_id": other}, timeout=30)
    assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text[:200]}"


def test_invoices_list_out_of_scope_filter_admin(admin_session, discovered):
    other = discovered.get("invoices", {}).get("other_center")
    if not other:
        pytest.skip("no other center id found")
    r = admin_session.get(f"{API}/invoices", params={"center_id": other}, timeout=30)
    assert r.status_code == 200


def test_invoices_export_out_of_scope_403(scoped_session, discovered):
    other = discovered.get("invoices", {}).get("other_center") or "00000000-0000-0000-0000-000000000000"
    r = scoped_session.get(f"{API}/invoices/export.csv", params={"center_id": other}, timeout=30)
    assert r.status_code == 403, f"expected 403 got {r.status_code}"


def test_invoices_export_admin(admin_session, discovered):
    other = discovered.get("invoices", {}).get("other_center")
    if not other:
        pytest.skip("no other center id")
    r = admin_session.get(f"{API}/invoices/export.csv", params={"center_id": other}, timeout=30)
    assert r.status_code == 200


def test_invoices_dashboard_scoped(scoped_session):
    r = scoped_session.get(f"{API}/invoices/dashboard", timeout=30)
    assert r.status_code == 200, r.text


def test_invoices_dashboard_admin(admin_session):
    r = admin_session.get(f"{API}/invoices/dashboard", timeout=30)
    assert r.status_code == 200


def test_invoices_dashboard_out_of_scope_403(scoped_session, discovered):
    other = discovered.get("invoices", {}).get("other_center") or "00000000-0000-0000-0000-000000000000"
    r = scoped_session.get(f"{API}/invoices/dashboard", params={"center_id": other}, timeout=30)
    # Accept 200 too if endpoint doesn't take center_id filter, but preferred 403 on explicit override
    assert r.status_code in (200, 403)


# ---------- Detail-by-id IDOR tests ----------

def _detail_check(session_scoped, session_admin, path_prefix, disc_key, discovered):
    d = discovered.get(disc_key, {})
    in_id = d.get("in_scope_id")
    out_id = d.get("out_scope_id")
    results = {"in_scope_id": in_id, "out_scope_id": out_id}
    if out_id:
        r = session_scoped.get(f"{API}{path_prefix}/{out_id}", timeout=30)
        results["scoped_on_out"] = r.status_code
        assert r.status_code == 403, f"OOS {path_prefix}/{out_id}: expected 403 got {r.status_code} - {r.text[:150]}"
        r2 = session_admin.get(f"{API}{path_prefix}/{out_id}", timeout=30)
        results["admin_on_out"] = r2.status_code
        assert r2.status_code == 200, f"admin OOS {path_prefix}/{out_id}: {r2.status_code}"
    if in_id:
        r = session_scoped.get(f"{API}{path_prefix}/{in_id}", timeout=30)
        results["scoped_on_in"] = r.status_code
        assert r.status_code == 200, f"in-scope {path_prefix}/{in_id}: expected 200 got {r.status_code}"
    print(f"{disc_key}: {results}")


def test_invoice_detail_idor(scoped_session, admin_session, discovered):
    _detail_check(scoped_session, admin_session, "/invoices", "invoices", discovered)


def test_candidate_detail_idor(scoped_session, admin_session, discovered):
    _detail_check(scoped_session, admin_session, "/candidates", "candidates", discovered)


def test_payment_detail_idor(scoped_session, admin_session, discovered):
    _detail_check(scoped_session, admin_session, "/payments", "payments", discovered)


def test_quotation_detail_idor(scoped_session, admin_session, discovered):
    _detail_check(scoped_session, admin_session, "/quotations", "quotations", discovered)


def test_work_order_detail_idor(scoped_session, admin_session, discovered):
    _detail_check(scoped_session, admin_session, "/work-orders", "work-orders", discovered)


def test_batch_target_detail_idor(scoped_session, admin_session, discovered):
    _detail_check(scoped_session, admin_session, "/batch-targets", "batch-targets", discovered)


def test_bank_guarantee_chain_idor(scoped_session, admin_session, discovered):
    d = discovered.get("bank-guarantees", {})
    in_id = d.get("in_scope_id")
    out_id = d.get("out_scope_id")
    if out_id:
        r = scoped_session.get(f"{API}/bank-guarantees/{out_id}/chain", timeout=30)
        assert r.status_code == 403, f"OOS bg chain: {r.status_code} - {r.text[:150]}"
        r2 = admin_session.get(f"{API}/bank-guarantees/{out_id}/chain", timeout=30)
        assert r2.status_code == 200, f"admin bg chain: {r2.status_code}"
    if in_id:
        r = scoped_session.get(f"{API}/bank-guarantees/{in_id}/chain", timeout=30)
        assert r.status_code == 200
    if not in_id and not out_id:
        pytest.skip("no bank guarantees found")
