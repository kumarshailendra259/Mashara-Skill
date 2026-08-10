"""Regression: Bank/Cash Reconciliation module — CRUD + deposit + payment/advance debit.
"""
import os
import uuid

import requests
from pymongo import MongoClient

API_BASE = "http://localhost:8001/api"


def _db():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def _auth(session, email="admin@finance.app", pw="Admin@123"):
    r = session.post(f"{API_BASE}/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {session.cookies.get('access_token')}"}


def test_bank_account_crud_deposit_and_ledger():
    db = _db()
    tag = uuid.uuid4().hex[:8]
    with requests.Session() as s:
        hdrs = _auth(s)
        # Create bank account with opening balance
        r = s.post(f"{API_BASE}/bank-accounts", headers=hdrs, json={
            "name": f"Test SBI {tag}", "type": "bank",
            "bank_name": "SBI", "account_no": f"1234{tag}", "ifsc": "SBIN0000123",
            "opening_balance": 100000,
        })
        assert r.status_code == 200, r.text
        acct = r.json()
        assert acct["current_balance"] == 100000
        aid = acct["id"]

        try:
            # List
            r = s.get(f"{API_BASE}/bank-accounts", headers=hdrs)
            assert r.status_code == 200
            assert any(a["id"] == aid for a in r.json())

            # Deposit
            r = s.post(f"{API_BASE}/bank-accounts/{aid}/deposit", headers=hdrs,
                       json={"amount": 25000, "remarks": "Manual top-up test"})
            assert r.status_code == 200
            # Verify balance updated
            r = s.get(f"{API_BASE}/bank-accounts", headers=hdrs)
            a = next(x for x in r.json() if x["id"] == aid)
            assert a["current_balance"] == 125000

            # Deposit with amount 0 should fail
            r = s.post(f"{API_BASE}/bank-accounts/{aid}/deposit", headers=hdrs,
                       json={"amount": 0, "remarks": "bad"})
            assert r.status_code == 422 or r.status_code == 400

            # Ledger — should have opening + 1 deposit
            r = s.get(f"{API_BASE}/bank-transactions", headers=hdrs, params={"account_id": aid})
            assert r.status_code == 200
            data = r.json()
            assert len(data["rows"]) == 2
            assert data["total_credit"] == 125000
            assert data["total_debit"] == 0

            # Admin adjustment — debit ₹5,000
            r = s.post(f"{API_BASE}/bank-accounts/{aid}/adjust", headers=hdrs,
                       json={"delta": -5000, "remarks": "Bank fee reversal"})
            assert r.status_code == 200
            r = s.get(f"{API_BASE}/bank-accounts", headers=hdrs)
            a = next(x for x in r.json() if x["id"] == aid)
            assert a["current_balance"] == 120000

            # Overdraft prevention — try to debit more than balance
            r = s.post(f"{API_BASE}/bank-accounts/{aid}/adjust", headers=hdrs,
                       json={"delta": -999999, "remarks": "overdraft attempt"})
            assert r.status_code == 400
            assert "Insufficient" in r.text or "insufficient" in r.text.lower()

            # Non-admin/accountant can't list
            with requests.Session() as s2:
                # Create a viewer-role user quickly
                from bcrypt import hashpw, gensalt
                uid = f"u-viewer-{tag}"
                db.users.insert_one({
                    "id": uid, "email": f"viewer_{tag}@x.com",
                    "password_hash": hashpw(b"Viewer@12345", gensalt()).decode(),
                    "name": "Viewer", "role": "viewer",
                    "created_at": "2026-01-01T00:00:00+00:00",
                })
                try:
                    hdrs2 = _auth(s2, f"viewer_{tag}@x.com", "Viewer@12345")
                    r = s2.get(f"{API_BASE}/bank-accounts", headers=hdrs2)
                    assert r.status_code == 403
                finally:
                    db.users.delete_one({"id": uid})

            # Cannot delete account with ledger entries
            r = s.delete(f"{API_BASE}/bank-accounts/{aid}", headers=hdrs)
            assert r.status_code == 400
        finally:
            db.bank_transactions.delete_many({"account_id": aid})
            db.bank_accounts.delete_one({"id": aid})
