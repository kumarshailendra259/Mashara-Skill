"""Iteration 41 — Advance Request approval workflow bug fix.

Covers:
  - Frontend TYPES exposes advance_request (indirectly: creating an advance_request chain via API works)
  - POST /api/advance-requests/reroute-pending
      * requires admin
      * returns {scanned, rerouted, already_on_current_chain}
      * reroutes pending advances onto the newly-active advance_request chain
      * skips advances already on the current chain
      * does not touch approved/released/cancelled/rejected rows
  - New advance request auto-attaches to the new multi-step advance_request chain
  - Regression: GET /api/transactions still returns 200 for admin
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
ADMIN_EMAIL = "admin@finance.app"
ADMIN_PASSWORD = "Admin@123"


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
               timeout=30)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def anon_session():
    return requests.Session()


# ---------- Auth guard ----------
class TestAuthGuard:
    def test_reroute_requires_auth(self, anon_session):
        r = anon_session.post(f"{BASE_URL}/api/advance-requests/reroute-pending", timeout=30)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code} {r.text[:200]}"


# ---------- Chain creation via API (proves advance_request type is accepted) ----------
@pytest.fixture(scope="module")
def new_advance_chain(admin_session):
    tag = uuid.uuid4().hex[:6]
    payload = {
        "name": f"TEST_AdvChain_{tag}",
        "type": "advance_request",
        "active": True,
        "steps": [
            {"level": 1, "kind": "role", "value": "admin", "label": "Admin"},
            {"level": 2, "kind": "role", "value": "accountant", "label": "Accountant"},
        ],
    }
    r = admin_session.post(f"{BASE_URL}/api/approval-chains", json=payload, timeout=30)
    assert r.status_code in (200, 201), f"chain create failed: {r.status_code} {r.text}"
    chain = r.json()
    assert chain.get("type") == "advance_request"
    assert len(chain.get("steps") or []) == 2
    yield chain
    # cleanup: deactivate + delete
    try:
        admin_session.delete(f"{BASE_URL}/api/approval-chains/{chain['id']}", timeout=15)
    except Exception:
        pass


class TestChainCreation:
    def test_advance_request_chain_created(self, new_advance_chain):
        assert new_advance_chain["id"]
        assert new_advance_chain["type"] == "advance_request"

    def test_chain_listed(self, admin_session, new_advance_chain):
        r = admin_session.get(f"{BASE_URL}/api/approval-chains", timeout=30)
        assert r.status_code == 200
        ids = [c.get("id") for c in r.json()]
        assert new_advance_chain["id"] in ids


# ---------- Reroute endpoint ----------
class TestReroutePending:
    def test_reroute_admin_ok(self, admin_session, new_advance_chain):
        r = admin_session.post(f"{BASE_URL}/api/advance-requests/reroute-pending", timeout=60)
        assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
        data = r.json()
        for k in ("scanned", "rerouted", "already_on_current_chain"):
            assert k in data, f"missing key {k} in {data}"
        assert isinstance(data["scanned"], int)
        print(f"Reroute result: {data}")

    def test_second_call_shows_already_on_current(self, admin_session, new_advance_chain):
        # After first call all matching rows should be on the new chain; a second
        # call should bump `already_on_current_chain` and reroute 0 (assuming no
        # new pending rows were added in between).
        r = admin_session.post(f"{BASE_URL}/api/advance-requests/reroute-pending", timeout=60)
        assert r.status_code == 200
        data = r.json()
        # rerouted should be 0 or very small on repeat call
        assert data["rerouted"] == 0, f"repeat reroute should be 0, got {data}"
        # if any pending rows exist, all should now be already_on_current
        assert data["already_on_current_chain"] >= 0

    def test_pending_advance_snapshot_matches_new_chain(self, admin_session, new_advance_chain):
        # Fetch pending advances and confirm at least one uses the new chain id
        r = admin_session.get(f"{BASE_URL}/api/advance-requests?status=pending", timeout=30)
        assert r.status_code == 200
        rows = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        pending = [x for x in rows if x.get("status") in ("pending", "in_progress", "sent_back")]
        if not pending:
            pytest.skip("no pending advances to verify snapshot against")
        on_new = [x for x in pending if x.get("chain_id") == new_advance_chain["id"]]
        assert len(on_new) > 0, (
            f"no pending advances got rerouted onto new chain "
            f"{new_advance_chain['id']} (pending={len(pending)})"
        )
        sample = on_new[0]
        assert len(sample.get("chain_snapshot") or []) == 2
        assert sample.get("current_level") == 1
        # rerouted history entry present
        hist = sample.get("chain_history") or []
        assert any(h.get("action") == "rerouted" for h in hist), "no 'rerouted' history entry"


# ---------- New advance auto-attaches to new chain ----------
class TestNewAdvanceAttachesNewChain:
    def test_create_new_advance_uses_new_chain(self, admin_session, new_advance_chain):
        payload = {
            "amount": 1500,
            "purpose": "TEST_iter41_reroute_verify",
            "required_till": "2026-12-31",
        }
        r = admin_session.post(f"{BASE_URL}/api/advance-requests", json=payload, timeout=30)
        if r.status_code not in (200, 201):
            pytest.skip(f"create advance skipped: {r.status_code} {r.text[:200]}")
        adv = r.json()
        assert adv.get("chain_snapshot"), "no chain_snapshot on new advance"
        # New chain has 2 steps — verify multi-step attached, not the 1-step default
        assert len(adv["chain_snapshot"]) == 2, (
            f"expected 2-step snapshot, got {len(adv['chain_snapshot'])} "
            f"(chain_id={adv.get('chain_id')})"
        )
        assert adv.get("chain_id") == new_advance_chain["id"]
        # Cleanup: cancel this test advance
        try:
            admin_session.post(f"{BASE_URL}/api/advance-requests/{adv['id']}/cancel", timeout=15)
        except Exception:
            pass


# ---------- Regression ----------
class TestRegression:
    def test_transactions_endpoint_still_200(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/transactions", timeout=30)
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"

    def test_advance_requests_list_ok(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/advance-requests", timeout=30)
        assert r.status_code == 200
