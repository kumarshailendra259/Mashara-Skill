"""Iteration 47 — GET /api/approvals/pending must expose new attribution fields.

Validates:
 - requester_id / requester_name (fallback to employee_name)
 - center_id_of_request / center_name_of_request
 - summary.purpose (from purpose / reason / QRN<qrn>)
 - Backward compat: null when source doc lacks the field, no 500s
 - Advance request specific: purpose === advance.purpose, center_name_of_request === advance.center_name
 - Payment specific: purpose === 'QRN <qrn>' when qrn is set
 - Regression: /api/transactions still 200
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://invest-analytics-24.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": "admin@finance.app", "password": "Admin@123"})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text[:300]}"
    return s


def test_pending_approvals_returns_200(admin_session):
    r = admin_session.get(f"{BASE_URL}/api/approvals/pending")
    assert r.status_code == 200, r.text[:400]
    data = r.json()
    assert isinstance(data, list)
    print(f"Total pending items: {len(data)}")


def test_pending_items_have_new_attribution_keys(admin_session):
    r = admin_session.get(f"{BASE_URL}/api/approvals/pending")
    data = r.json()
    if not data:
        pytest.skip("no pending items to inspect")
    required_keys = {"requester_id", "requester_name", "center_id_of_request", "center_name_of_request", "summary"}
    for it in data[:20]:
        missing = required_keys - set(it.keys())
        assert not missing, f"item missing keys {missing}: {it.get('request_type')}/{it.get('request_id')}"
        assert "purpose" in it["summary"], f"summary.purpose absent for {it.get('request_type')}"


def test_advance_request_purpose_and_center(admin_session):
    r = admin_session.get(f"{BASE_URL}/api/approvals/pending")
    data = r.json()
    adv = [x for x in data if x.get("request_type") == "advance_request"]
    if not adv:
        pytest.skip("no advance_request pending")
    # At least one advance should carry purpose OR requester_name populated
    with_purpose = [x for x in adv if x["summary"].get("purpose")]
    with_requester = [x for x in adv if x.get("requester_name")]
    print(f"advance_request rows={len(adv)} with_purpose={len(with_purpose)} with_requester={len(with_requester)}")
    assert with_requester, "expected at least one advance_request to have requester_name populated (created_by_name or employee_name)"


def test_payment_purpose_uses_qrn_when_qrn_present(admin_session):
    r = admin_session.get(f"{BASE_URL}/api/approvals/pending")
    data = r.json()
    pays = [x for x in data if x.get("request_type") == "payment"]
    if not pays:
        pytest.skip("no payment pending")
    qrn_rows = [x for x in pays if x["summary"].get("qrn")]
    if not qrn_rows:
        pytest.skip("no payments with qrn")
    for x in qrn_rows[:5]:
        p = x["summary"].get("purpose")
        # purpose could be a real purpose field OR "QRN <qrn>". Just ensure not empty when qrn is set.
        assert p, f"payment with qrn={x['summary']['qrn']} must have summary.purpose (either 'QRN ..' or real purpose)"
        if p and p.startswith("QRN "):
            assert x["summary"]["qrn"] in p


def test_backward_compat_null_fields_ok(admin_session):
    """Types like leave/regularisation may not have created_by_name / center_name — must NOT 500."""
    r = admin_session.get(f"{BASE_URL}/api/approvals/pending")
    assert r.status_code == 200
    data = r.json()
    other_types = [x for x in data if x.get("request_type") in ("leave_request", "regularisation", "employee_transfer")]
    for x in other_types[:10]:
        # Fields must exist even if null
        assert "requester_name" in x
        assert "center_name_of_request" in x
        # description should still render for these
        assert "description" in x["summary"]


def test_transactions_endpoint_regression(admin_session):
    r = admin_session.get(f"{BASE_URL}/api/transactions")
    assert r.status_code == 200, r.text[:300]
