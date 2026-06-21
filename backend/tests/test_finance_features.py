"""Tests for iteration-2 features: file upload/view + transaction items + dashboard by_item."""
import io
import os
import uuid
import pytest
import requests

def _read_url() -> str:
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL"):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    return ""

BASE_URL = (os.environ.get("FINANCE_TEST_BASE_URL") or _read_url()).rstrip("/")
ADMIN_EMAIL = "admin@finance.app"
ADMIN_PASSWORD = "Admin@123"


def _session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_client():
    s = _session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def viewer_client():
    s = _session()
    email = f"TEST_v2_{uuid.uuid4().hex[:8]}@x.com"
    r = s.post(f"{BASE_URL}/api/auth/register",
               json={"email": email, "password": "Pass1234", "name": "V", "role": "viewer"})
    assert r.status_code == 200, r.text
    return s


# ---------------- FILE UPLOAD ----------------
class TestFileUpload:
    def test_upload_requires_auth(self):
        files = {"file": ("a.txt", io.BytesIO(b"hi"), "text/plain")}
        r = requests.post(f"{BASE_URL}/api/files/upload", files=files)
        assert r.status_code == 401

    def test_viewer_forbidden(self, viewer_client):
        s = requests.Session(); s.cookies.update(viewer_client.cookies)
        files = {"file": ("a.txt", io.BytesIO(b"hi"), "text/plain")}
        r = s.post(f"{BASE_URL}/api/files/upload", files=files)
        assert r.status_code == 403

    def test_admin_upload_and_view(self, admin_client):
        content = b"hello-receipt-" + uuid.uuid4().bytes
        s = requests.Session(); s.cookies.update(admin_client.cookies)
        files = {"file": ("receipt.txt", io.BytesIO(content), "text/plain")}
        r = s.post(f"{BASE_URL}/api/files/upload", files=files)
        assert r.status_code == 200, r.text
        body = r.json()
        for k in ("id", "path", "filename", "content_type", "size"):
            assert k in body, f"missing {k}"
        assert body["filename"] == "receipt.txt"
        assert body["size"] == len(content)
        # view
        r2 = s.get(f"{BASE_URL}/api/files/view", params={"path": body["path"]})
        assert r2.status_code == 200
        assert r2.content == content
        assert "text/plain" in r2.headers.get("Content-Type", "")
        # auth via query token also OK
        # view unauth -> 401
        r3 = requests.get(f"{BASE_URL}/api/files/view", params={"path": body["path"]})
        assert r3.status_code == 401

    def test_view_unknown_path_404(self, admin_client):
        s = requests.Session(); s.cookies.update(admin_client.cookies)
        r = s.get(f"{BASE_URL}/api/files/view", params={"path": "finance-tracker/uploads/nope/none.bin"})
        assert r.status_code == 404


# ---------------- TRANSACTION ITEMS ----------------
@pytest.fixture(scope="module")
def item_tag():
    return f"Widget_{uuid.uuid4().hex[:8]}"


@pytest.fixture(scope="module")
def items_txn_ids(admin_client, item_tag):
    W = item_tag
    # create 2 transactions with overlapping item names
    p1 = {
        "type": "income", "amount": 300, "date": "2026-03-01",
        "description": "TEST_items_1",
        "items": [
            {"name": W, "quantity": 2, "rate": 50, "amount": 100},
            {"name": "Bolt",   "quantity": 5, "rate": 10, "amount": 50},
        ],
        "attachments": [],
    }
    p2 = {
        "type": "income", "amount": 200, "date": "2026-03-02",
        "description": "TEST_items_2",
        "items": [
            {"name": W, "quantity": 3, "rate": 50, "amount": 150},
        ],
    }
    p3 = {  # no items
        "type": "expense", "amount": 20, "date": "2026-03-03",
        "description": "TEST_items_3_noitems",
    }
    ids = []
    for p in (p1, p2, p3):
        r = admin_client.post(f"{BASE_URL}/api/transactions", json=p)
        assert r.status_code == 200, r.text
        ids.append(r.json()["id"])
    return ids


class TestTransactionItems:
    def test_items_persisted(self, admin_client, items_txn_ids, item_tag):
        tid = items_txn_ids[0]
        r = admin_client.get(f"{BASE_URL}/api/transactions", params={"start": "2026-03-01", "end": "2026-03-01"})
        assert r.status_code == 200
        match = [t for t in r.json() if t["id"] == tid]
        assert match and len(match[0]["items"]) == 2
        names = {it["name"] for it in match[0]["items"]}
        assert names == {item_tag, "Bolt"}

    def test_no_items_defaults_empty(self, admin_client, items_txn_ids):
        tid = items_txn_ids[2]
        r = admin_client.get(f"{BASE_URL}/api/transactions", params={"start": "2026-03-03", "end": "2026-03-03"})
        match = [t for t in r.json() if t["id"] == tid][0]
        assert match["items"] == []
        assert match["attachments"] == []

    def test_update_items_and_attachments(self, admin_client, items_txn_ids, item_tag):
        tid = items_txn_ids[0]
        payload = {
            "type": "income", "amount": 300, "date": "2026-03-01",
            "description": "TEST_items_1_upd",
            "items": [{"name": item_tag, "quantity": 4, "rate": 50, "amount": 200}],
            "attachments": [{
                "id": "f1", "path": "finance-tracker/uploads/x/f1.txt",
                "filename": "f1.txt", "content_type": "text/plain", "size": 10
            }],
        }
        r = admin_client.put(f"{BASE_URL}/api/transactions/{tid}", json=payload)
        assert r.status_code == 200, r.text
        body = r.json()
        assert len(body["items"]) == 1
        assert body["items"][0]["amount"] == 200
        assert len(body["attachments"]) == 1
        assert body["attachments"][0]["filename"] == "f1.txt"


# ---------------- DASHBOARD by_item ----------------
class TestDashboardByItem:
    def test_by_item_aggregation(self, admin_client, items_txn_ids, item_tag):
        r = admin_client.get(f"{BASE_URL}/api/dashboard/summary",
                             params={"start": "2026-03-01", "end": "2026-03-31"})
        assert r.status_code == 200
        body = r.json()
        assert "by_item" in body
        assert isinstance(body["by_item"], list)
        by_name = {x["name"]: x for x in body["by_item"]}
        # item_tag appears in txn1 (after update qty=4 amt=200) + txn2 (qty=3 amt=150) = qty7 income350
        assert item_tag in by_name, body["by_item"]
        w = by_name[item_tag]
        for k in ("name", "investment", "income", "expense", "profit", "quantity", "total"):
            assert k in w
        assert w["income"] == 350.0
        assert w["quantity"] == 7
        assert w["profit"] == w["income"] - w["expense"]
        assert w["total"] == w["investment"] + w["income"] + w["expense"]
