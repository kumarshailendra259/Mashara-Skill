"""Iteration-10 backend tests: item suggestions, approval-log, reports_to admin restriction, new roles."""
import os
import uuid
import time
import requests
import pytest


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


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return s


def _register(email, password, name, role="viewer"):
    s = requests.Session()
    r = s.post(f"{API}/auth/register", json={"email": email, "password": password, "name": name, "role": role}, timeout=15)
    return s, r


@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN_EMAIL, ADMIN_PWD)


@pytest.fixture(scope="module")
def manager(admin):
    email = f"TEST_mgr_iter10_{TAG}@x.com"
    s, r = _register(email, "Pass@1234", "Mgr10", role="manager")
    assert r.status_code == 200, r.text
    return s, r.json()


@pytest.fixture(scope="module")
def viewer(admin):
    email = f"TEST_view_iter10_{TAG}@x.com"
    s, r = _register(email, "Pass@1234", "View10", role="viewer")
    assert r.status_code == 200
    return s, r.json()


# ---------- Item Suggestions ----------
class TestItemSuggestions:
    def test_suggestions_requires_auth(self):
        r = requests.get(f"{API}/items/suggestions", timeout=10)
        assert r.status_code == 401

    def test_seed_and_list(self, admin):
        item_name = f"TestItem_{TAG}_alpha"
        # Create a transaction with an item
        body = {
            "type": "expense", "amount": 100, "date": "2025-01-15", "description": f"seed_{TAG}",
            "items": [{"name": item_name, "quantity": 2, "rate": 50, "amount": 100}],
        }
        r = admin.post(f"{API}/transactions", json=body, timeout=15)
        assert r.status_code == 200, r.text

        # No query
        r = admin.get(f"{API}/items/suggestions", timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        if data:
            assert "name" in data[0] and "count" in data[0]
        names = [d["name"] for d in data]
        assert item_name in names

    def test_suggestions_query_filter(self, admin):
        unique = f"UniqueZZ_{TAG}"
        body = {
            "type": "expense", "amount": 50, "date": "2025-01-16", "description": "f",
            "items": [{"name": unique, "quantity": 1, "rate": 50, "amount": 50}],
        }
        r = admin.post(f"{API}/transactions", json=body, timeout=15)
        assert r.status_code == 200

        r = admin.get(f"{API}/items/suggestions", params={"q": "UniqueZZ"}, timeout=10)
        assert r.status_code == 200
        names = [d["name"] for d in r.json()]
        assert any(unique in n for n in names)

        # Negative
        r = admin.get(f"{API}/items/suggestions", params={"q": "_!noMatch_zzzz_!_"}, timeout=10)
        assert r.status_code == 200
        assert r.json() == [] or all("_!noMatch" in d["name"].lower() for d in r.json())


# ---------- Approval Log ----------
class TestApprovalLog:
    def test_admin_only(self, admin, viewer):
        s_v, _ = viewer
        r = s_v.get(f"{API}/approval-log", timeout=15)
        assert r.status_code == 403

        r = admin.get(f"{API}/approval-log", timeout=20)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)

    def test_shape_and_sort(self, admin):
        r = admin.get(f"{API}/approval-log", timeout=20)
        rows = r.json()
        if rows:
            row = rows[0]
            for k in ("type", "action", "ref_id", "at", "by", "amount", "summary", "remarks"):
                assert k in row, f"missing key {k}"
            # Sorted desc by 'at'
            ats = [r2.get("at") or "" for r2 in rows]
            assert ats == sorted(ats, reverse=True)

    def test_type_filter(self, admin):
        r = admin.get(f"{API}/approval-log", params={"type_filter": "transaction"}, timeout=20)
        assert r.status_code == 200
        rows = r.json()
        assert all(r2["type"] == "transaction" for r2 in rows)

    def test_action_filter(self, admin):
        r = admin.get(f"{API}/approval-log", params={"action": "approved"}, timeout=20)
        assert r.status_code == 200
        for row in r.json():
            assert row["action"] == "approved"


# ---------- Reports-to admin restriction ----------
class TestReportsToRestriction:
    def test_admin_can_set_reports_to(self, admin):
        # First create a "boss" staff
        boss = admin.post(f"{API}/staff", json={"name": f"Boss_{TAG}", "designation": "GM"}, timeout=15).json()
        # Then create staff reporting to boss
        sub = admin.post(f"{API}/staff", json={"name": f"Sub_{TAG}", "designation": "Eng", "reports_to_id": boss["id"]}, timeout=15)
        assert sub.status_code == 200
        assert sub.json().get("reports_to_id") == boss["id"]

    def test_manager_cannot_set_reports_to_on_create(self, admin, manager):
        s_m, mu = manager
        # Promote the manager user (registration sets role=manager already, but ensure)
        admin.patch(f"{API}/auth/users/{mu['id']}", json={"role": "manager"}, timeout=10)
        boss = admin.post(f"{API}/staff", json={"name": f"BossM_{TAG}", "designation": "GM"}, timeout=15).json()
        r = s_m.post(f"{API}/staff", json={"name": f"SubM_{TAG}", "designation": "Eng", "reports_to_id": boss["id"]}, timeout=15)
        assert r.status_code == 200
        assert r.json().get("reports_to_id") is None, "manager should not be able to set reports_to_id"

    def test_manager_cannot_change_reports_to_on_update(self, admin, manager):
        s_m, _mu = manager
        boss1 = admin.post(f"{API}/staff", json={"name": f"Boss1_{TAG}", "designation": "GM"}, timeout=15).json()
        boss2 = admin.post(f"{API}/staff", json={"name": f"Boss2_{TAG}", "designation": "GM"}, timeout=15).json()
        sub = admin.post(f"{API}/staff", json={"name": f"Sub2_{TAG}", "designation": "Eng", "reports_to_id": boss1["id"]}, timeout=15).json()
        # Manager attempts to change reports_to to boss2
        r = s_m.put(f"{API}/staff/{sub['id']}", json={
            "name": sub["name"], "designation": "Eng",
            "reports_to_id": boss2["id"],
        }, timeout=15)
        assert r.status_code == 200
        assert r.json().get("reports_to_id") == boss1["id"], "manager update must preserve original reports_to_id"


# ---------- New Roles ----------
class TestNewRoles:
    @pytest.mark.parametrize("role", ["hr", "senior_manager", "center_staff"])
    def test_admin_patch_to_new_role(self, admin, role):
        email = f"TEST_role_{role}_{TAG}@x.com"
        _, reg = _register(email, "Pass@1234", f"Role_{role}", role="viewer")
        assert reg.status_code == 200
        uid = reg.json()["id"]
        r = admin.patch(f"{API}/auth/users/{uid}", json={"role": role}, timeout=10)
        assert r.status_code == 200, r.text
        assert r.json()["role"] == role

    def test_register_with_new_role(self):
        for role in ["hr", "senior_manager", "center_staff"]:
            email = f"TEST_reg_{role}_{TAG}_{uuid.uuid4().hex[:4]}@x.com"
            _, r = _register(email, "Pass@1234", f"Reg_{role}", role=role)
            assert r.status_code == 200, f"{role}: {r.status_code} {r.text}"
            assert r.json()["role"] == role


# ---------- Regression smoke ----------
class TestRegression:
    def test_health(self, admin):
        r = admin.get(f"{API}/auth/me", timeout=10)
        assert r.status_code == 200

    def test_list_txn(self, admin):
        r = admin.get(f"{API}/transactions", timeout=15)
        assert r.status_code == 200

    def test_dashboard(self, admin):
        r = admin.get(f"{API}/dashboard/summary", timeout=20)
        assert r.status_code == 200
        assert "totals" in r.json()

    def test_stock(self, admin):
        r = admin.get(f"{API}/stock", timeout=20)
        assert r.status_code == 200

    def test_leaves(self, admin):
        r = admin.get(f"{API}/leaves", timeout=10)
        assert r.status_code == 200

    def test_payroll(self, admin):
        r = admin.get(f"{API}/payroll", timeout=10)
        assert r.status_code == 200

    def test_notifications(self, admin):
        r = admin.get(f"{API}/notifications", timeout=10)
        assert r.status_code == 200
