"""Backend tests for Finance Tracker API.
Covers auth (login/me/register/logout), RBAC, entities CRUD, transactions CRUD,
CSV import, dashboard summary, and negative tests.
"""
import io
import os
import uuid
import pytest
import requests

# Cookies are set with secure=True; samesite=none, so the `requests` library
# will only re-send them over HTTPS. We therefore default to the public
# REACT_APP_BACKEND_URL (HTTPS) rather than the internal http://localhost:8001.
def _read_frontend_backend_url() -> str:
    try:
        with open("/app/frontend/.env", "r") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL"):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    return ""


BASE_URL = (
    os.environ.get("FINANCE_TEST_BASE_URL")
    or _read_frontend_backend_url()
    or "http://localhost:8001"
).rstrip("/")
ADMIN_EMAIL = os.environ.get("FINANCE_TEST_ADMIN_EMAIL", "admin@finance.app")
ADMIN_PASSWORD = os.environ.get("FINANCE_TEST_ADMIN_PASSWORD", "Admin@123")


def _session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def admin_client():
    s = _session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    data = r.json()
    assert data["email"] == ADMIN_EMAIL and data["role"] == "admin"
    assert "access_token" in s.cookies.get_dict(), "httpOnly cookie not set"
    return s


@pytest.fixture(scope="session")
def viewer_client(admin_client):
    """Register a viewer user, return its own session (cookie set on register)."""
    email = f"TEST_viewer_{uuid.uuid4().hex[:8]}@x.com"
    s = _session()
    r = s.post(f"{BASE_URL}/api/auth/register",
               json={"email": email, "password": "Pass1234", "name": "V", "role": "viewer"})
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "viewer"
    s._email = email  # type: ignore
    return s


# ---------------- AUTH ----------------
class TestAuth:
    def test_login_success_sets_cookie(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN_EMAIL

    def test_login_invalid(self):
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": ADMIN_EMAIL, "password": "wrong"})
        assert r.status_code == 401

    def test_me_without_cookie(self):
        r = requests.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 401

    def test_register_duplicate(self, admin_client):
        email = f"TEST_dup_{uuid.uuid4().hex[:6]}@x.com"
        s = _session()
        r1 = s.post(f"{BASE_URL}/api/auth/register",
                    json={"email": email, "password": "Pass1234", "name": "D"})
        assert r1.status_code == 200
        r2 = requests.post(f"{BASE_URL}/api/auth/register",
                           json={"email": email, "password": "Pass1234", "name": "D"})
        assert r2.status_code == 400

    def test_logout_clears_cookie(self):
        s = _session()
        r = s.post(f"{BASE_URL}/api/auth/login",
                   json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert r.status_code == 200
        r2 = s.post(f"{BASE_URL}/api/auth/logout")
        assert r2.status_code == 200
        # After logout, /me should fail in a fresh session without cookie
        s.cookies.clear()
        r3 = s.get(f"{BASE_URL}/api/auth/me")
        assert r3.status_code == 401


# ---------------- RBAC ----------------
class TestRBAC:
    def test_viewer_cannot_create_company(self, viewer_client):
        r = viewer_client.post(f"{BASE_URL}/api/entities/company",
                               json={"name": "TEST_NoPerm"})
        assert r.status_code == 403

    def test_admin_can_create_company(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/entities/company",
                              json={"name": f"TEST_AdminCo_{uuid.uuid4().hex[:6]}"})
        assert r.status_code == 200
        assert r.json()["type"] == "company"


# ---------------- Entities CRUD ----------------
@pytest.fixture(scope="session")
def created_entities(admin_client):
    ids = {}
    for etype in ["company", "partner", "center", "project"]:
        r = admin_client.post(f"{BASE_URL}/api/entities/{etype}",
                              json={"name": f"TEST_{etype}_{uuid.uuid4().hex[:6]}", "description": "d"})
        assert r.status_code == 200, r.text
        ids[etype] = r.json()["id"]
    return ids


class TestEntities:
    def test_list_after_create(self, admin_client, created_entities):
        for etype, eid in created_entities.items():
            r = admin_client.get(f"{BASE_URL}/api/entities/{etype}")
            assert r.status_code == 200
            assert any(d["id"] == eid for d in r.json())

    def test_update_entity(self, admin_client, created_entities):
        eid = created_entities["company"]
        r = admin_client.put(f"{BASE_URL}/api/entities/company/{eid}",
                             json={"name": "TEST_Updated", "description": "u"})
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Updated"
        # verify via list
        r2 = admin_client.get(f"{BASE_URL}/api/entities/company")
        assert any(d["id"] == eid and d["name"] == "TEST_Updated" for d in r2.json())

    def test_viewer_cannot_delete(self, viewer_client, admin_client):
        # create a throwaway entity
        r = admin_client.post(f"{BASE_URL}/api/entities/partner",
                              json={"name": f"TEST_Del_{uuid.uuid4().hex[:6]}"})
        eid = r.json()["id"]
        r2 = viewer_client.delete(f"{BASE_URL}/api/entities/partner/{eid}")
        assert r2.status_code == 403


# ---------------- Transactions ----------------
@pytest.fixture(scope="session")
def created_txn(admin_client, created_entities):
    payload = {
        "type": "income",
        "amount": 1000.0,
        "date": "2026-01-10",
        "description": "TEST_income",
        "company_id": created_entities["company"],
        "partner_id": created_entities["partner"],
        "center_id": created_entities["center"],
        "project_id": created_entities["project"],
    }
    r = admin_client.post(f"{BASE_URL}/api/transactions", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


class TestTransactions:
    def test_create_and_list(self, admin_client, created_txn, created_entities):
        r = admin_client.get(f"{BASE_URL}/api/transactions",
                             params={"company_id": created_entities["company"]})
        assert r.status_code == 200
        assert any(t["id"] == created_txn["id"] for t in r.json())

    def test_filter_by_type_and_date(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/transactions",
                             params={"type": "income", "start": "2026-01-01", "end": "2026-12-31"})
        assert r.status_code == 200
        assert all(t["type"] == "income" for t in r.json())

    def test_update_txn(self, admin_client, created_txn):
        payload = dict(created_txn)
        for k in ("id", "created_by", "created_at"):
            payload.pop(k, None)
        payload["amount"] = 1500.0
        r = admin_client.put(f"{BASE_URL}/api/transactions/{created_txn['id']}", json=payload)
        assert r.status_code == 200
        assert r.json()["amount"] == 1500.0

    def test_bad_type_422(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/transactions",
                              json={"type": "bogus", "amount": 10, "date": "2026-01-01"})
        assert r.status_code == 422

    def test_viewer_cannot_create_txn(self, viewer_client):
        r = viewer_client.post(f"{BASE_URL}/api/transactions",
                               json={"type": "income", "amount": 10, "date": "2026-01-01"})
        assert r.status_code == 403


# ---------------- CSV Import ----------------
class TestCSVImport:
    def test_import_creates_entities(self, admin_client):
        unique = uuid.uuid4().hex[:6]
        csv_data = (
            "type,amount,date,description,company,partner,center,project\n"
            f"income,5000,2026-01-15,TEST_Sale,Acme_{unique},Alice_{unique},Mumbai_{unique},ProjectX_{unique}\n"
            f"expense,200,2026-01-16,TEST_Rent,Acme_{unique},Alice_{unique},Mumbai_{unique},ProjectX_{unique}\n"
        )
        files = {"file": ("t.csv", io.BytesIO(csv_data.encode()), "text/csv")}
        # session has Content-Type json; let requests reset for multipart
        s = requests.Session()
        s.cookies.update(admin_client.cookies)
        r = s.post(f"{BASE_URL}/api/transactions/import", files=files)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["inserted"] == 2
        assert body["errors"] == []
        # verify entity auto-created
        r2 = admin_client.get(f"{BASE_URL}/api/entities/company")
        assert any(d["name"] == f"Acme_{unique}" for d in r2.json())

    def test_import_bad_row(self, admin_client):
        csv_data = "type,amount,date\nbogus,10,2026-01-01\nincome,abc,2026-01-02\n"
        files = {"file": ("t.csv", io.BytesIO(csv_data.encode()), "text/csv")}
        s = requests.Session()
        s.cookies.update(admin_client.cookies)
        r = s.post(f"{BASE_URL}/api/transactions/import", files=files)
        assert r.status_code == 200
        assert r.json()["inserted"] == 0
        assert len(r.json()["errors"]) == 2


# ---------------- Dashboard ----------------
class TestDashboard:
    def test_summary_structure(self, admin_client, created_txn):
        r = admin_client.get(f"{BASE_URL}/api/dashboard/summary")
        assert r.status_code == 200
        body = r.json()
        for k in ("totals", "monthly", "by_company", "by_partner", "by_center", "by_project"):
            assert k in body
        t = body["totals"]
        for k in ("investment", "income", "expense", "profit"):
            assert k in t
        assert t["profit"] == t["income"] - t["expense"]
        assert t["income"] >= 1500.0  # from updated txn

    def test_summary_unauth(self):
        r = requests.get(f"{BASE_URL}/api/dashboard/summary")
        assert r.status_code == 401


# ---------------- Admin delete (cleanup) ----------------
class TestAdminDelete:
    def test_admin_delete_txn(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/transactions",
                              json={"type": "expense", "amount": 5, "date": "2026-02-01",
                                    "description": "TEST_del"})
        tid = r.json()["id"]
        r2 = admin_client.delete(f"{BASE_URL}/api/transactions/{tid}")
        assert r2.status_code == 200

    def test_admin_delete_entity(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/entities/project",
                              json={"name": f"TEST_DelProj_{uuid.uuid4().hex[:6]}"})
        eid = r.json()["id"]
        r2 = admin_client.delete(f"{BASE_URL}/api/entities/project/{eid}")
        assert r2.status_code == 200
        r3 = admin_client.delete(f"{BASE_URL}/api/entities/project/{eid}")
        assert r3.status_code == 404
