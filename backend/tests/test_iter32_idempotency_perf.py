"""Phase 32 — Backend Idempotency + Fast Pending Approvals tests."""
import os
import uuid
import pytest
import requests


def _url():
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL"):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    return ""


BASE = (os.environ.get("FINANCE_TEST_BASE_URL") or _url()).rstrip("/")


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE}/api/auth/login",
               json={"email": os.environ.get("FINANCE_TEST_ADMIN_EMAIL", "admin@finance.app"),
                     "password": os.environ.get("FINANCE_TEST_ADMIN_PASSWORD", "Admin@123")})
    assert r.status_code == 200, r.text
    yield s


class TestIdempotency:
    def test_same_key_returns_same_txn(self, admin):
        key = str(uuid.uuid4())
        body = {"type": "expense", "amount": 111, "date": "2026-08-13", "description": "IDEMPY test A"}
        r1 = admin.post(f"{BASE}/api/transactions", json=body, headers={"Idempotency-Key": key})
        r2 = admin.post(f"{BASE}/api/transactions", json=body, headers={"Idempotency-Key": key})
        assert r1.status_code == 200 and r2.status_code == 200
        id1, id2 = r1.json()["id"], r2.json()["id"]
        assert id1 == id2, "Idempotency key must return the same txn on repeat"

    def test_different_key_creates_new_txn(self, admin):
        body = {"type": "expense", "amount": 222, "date": "2026-08-13", "description": "IDEMPY test B"}
        r1 = admin.post(f"{BASE}/api/transactions", json=body, headers={"Idempotency-Key": str(uuid.uuid4())})
        r2 = admin.post(f"{BASE}/api/transactions", json=body, headers={"Idempotency-Key": str(uuid.uuid4())})
        assert r1.json()["id"] != r2.json()["id"]

    def test_missing_key_still_creates_txns(self, admin):
        """Backwards-compat — clients that don't send the header still work."""
        body = {"type": "expense", "amount": 333, "date": "2026-08-13", "description": "IDEMPY test C"}
        r1 = admin.post(f"{BASE}/api/transactions", json=body)
        r2 = admin.post(f"{BASE}/api/transactions", json=body)
        assert r1.status_code == 200 and r2.status_code == 200
        # Note: axios interceptor auto-adds keys client-side; this raw-requests path
        # doesn't have one, so both must produce fresh IDs
        assert r1.json()["id"] != r2.json()["id"]


class TestPendingApprovalsFastPath:
    def test_endpoint_returns_within_2s_for_admin(self, admin):
        import time
        start = time.monotonic()
        r = admin.get(f"{BASE}/api/approvals/pending")
        elapsed = time.monotonic() - start
        assert r.status_code == 200
        assert elapsed < 2.0, f"Pending approvals took {elapsed:.2f}s — too slow"
        # response must be a list of dicts with request_type
        body = r.json()
        assert isinstance(body, list)
        if body:
            assert all("request_type" in x and "request_id" in x for x in body)
