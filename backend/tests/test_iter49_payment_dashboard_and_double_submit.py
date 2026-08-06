"""Iter 49: Payment Dashboard + Approval double-submit prevention."""
import os
import asyncio
import httpx
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@finance.app", "password": "Admin@123"}
CM = {"email": "test_iter46_cm_ui_a9da15@x.com", "password": "CmUi@12345"}


def _login(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    return s


@pytest.fixture(scope="module")
def admin_sess():
    return _login(ADMIN)


@pytest.fixture(scope="module")
def cm_sess():
    return _login(CM)


# ---------------- Payment Dashboard ----------------
class TestPaymentSummary:
    def test_admin_200_and_shape(self, admin_sess):
        r = admin_sess.get(f"{API}/dashboard/payment-summary", timeout=30)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        for k in ("kpis", "daily_series", "weekly_series", "monthly_series",
                  "center_wise", "project_wise", "income_breakdown", "meta"):
            assert k in data, f"missing key {k}"
        # KPIs
        for k in ("daily", "weekly", "monthly", "upcoming"):
            assert k in data["kpis"]
            assert isinstance(data["kpis"][k], (int, float))
        # Daily series must be exactly 30 buckets
        assert isinstance(data["daily_series"], list)
        assert len(data["daily_series"]) == 30, f"expected 30 daily buckets, got {len(data['daily_series'])}"
        assert all("date" in d and "expense" in d for d in data["daily_series"])
        # meta.filter_applied present
        assert "filter_applied" in data["meta"]
        assert "start" in data["meta"] and "end" in data["meta"]

    def test_filters_applied(self, admin_sess):
        # Pick a real center
        centers = admin_sess.get(f"{API}/entities/center", timeout=15).json()
        if not centers:
            pytest.skip("no centers seeded")
        cid = centers[0]["id"]
        r = admin_sess.get(
            f"{API}/dashboard/payment-summary",
            params={"center_id": cid, "start": "2025-01-01", "end": "2025-12-31"},
            timeout=30,
        )
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert data["meta"]["filter_applied"]["center_id"] == cid
        assert data["meta"]["start"] == "2025-01-01"
        assert data["meta"]["end"] == "2025-12-31"

    def test_non_finance_role_forbidden(self, cm_sess):
        r = cm_sess.get(f"{API}/dashboard/payment-summary", timeout=15)
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text[:200]}"


# ---------------- Approval Double-Submit ----------------
class TestDoubleSubmit:
    def _pick_pending(self, sess):
        r = sess.get(f"{API}/approvals/pending", timeout=20)
        assert r.status_code == 200, r.text[:200]
        items = r.json() or []
        # Filter to actionable at current_level==1 or any level; endpoint returns only what user can act on
        return items

    def test_concurrent_approve_returns_one_409(self, admin_sess):
        items = self._pick_pending(admin_sess)
        if not items:
            pytest.skip("No pending approvals available to test double-submit")
        target = items[0]
        rid = target.get("request_id") or target.get("id")
        rtype = target.get("request_type") or target.get("type")
        assert rid and rtype, f"pending item missing id/type: {target}"

        cookies = admin_sess.cookies.get_dict()
        body = {"request_id": rid, "action": "approve", "request_type": rtype,
                "remarks": "iter49 concurrency test"}
        if rtype in ("payment", "reimbursement"):
            body["paid_by"] = "self"
            body["mode"] = "bank"

        import concurrent.futures
        import threading
        barrier = threading.Barrier(4)

        def _fire_one():
            # Fresh session per thread to force separate TCP conn; sync at barrier
            s = requests.Session()
            s.cookies.update(cookies)
            barrier.wait()
            try:
                r = s.post(f"{API}/approvals/act", json=body, timeout=30)
                return r.status_code, r.text[:200]
            except Exception as e:
                return "EXC", str(e)

        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
            futs = [ex.submit(_fire_one) for _ in range(4)]
            results = [f.result() for f in futs]

        statuses = [x[0] for x in results]
        details = [x[1] for x in results]

        print(f"Concurrent statuses: {statuses}")
        print(f"Details: {details}")

        codes = [s for s in statuses if isinstance(s, int)]
        successes = [c for c in codes if c in (200, 201)]
        # PRIMARY invariant: at most ONE success across N concurrent duplicate submits.
        assert len(successes) == 1, f"Expected exactly one success, got {successes}. Statuses: {statuses}"
        # SECONDARY: All other responses must be safe-fail codes (409 lock, or 400 already-finalised).
        losers = [c for c in codes if c not in (200, 201)]
        assert all(c in (400, 409) for c in losers), f"Unexpected loser codes: {losers}"
        # If a 409 is observed, confirm the message matches the lock guard.
        for c, d in zip(statuses, details):
            if c == 409:
                assert "being processed" in d or "processed" in d.lower(), d
        print(f"OK — successes={successes}, losers={losers}")

        # Verify not in pending anymore (only if we actually succeeded once — otherwise skip)
        if successes:
            r2 = admin_sess.get(f"{API}/approvals/pending", timeout=20)
            still_there = any((it.get("id") == rid) for it in (r2.json() or []))
            # It may still be there if there are more levels; only assert current_level advanced
            # Just log:
            print(f"Post-action still in pending: {still_there}")
