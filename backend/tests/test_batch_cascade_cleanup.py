"""Regression: milestone-family transactions are tagged with batch_id + batch_payment_id
on receive, and cascade-deleted when the batch or batch_payment is deleted.
Also: the /batches/cleanup-orphan-txns admin endpoint removes legacy orphans.
"""
import os
import uuid

import requests
from bcrypt import hashpw, gensalt
from pymongo import MongoClient

API_BASE = "http://localhost:8001/api"


def _db():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def _auth(session, email, pw):
    r = session.post(f"{API_BASE}/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {session.cookies.get('access_token')}"}


def test_batch_delete_cascades_milestone_txns_and_cleanup_endpoint():
    db = _db()
    tag = uuid.uuid4().hex[:8]
    project_id = f"proj-{tag}"
    company_id = f"comp-{tag}"
    center_id = f"ctr-{tag}"

    # Seed project/company/center
    db.projects.insert_one({"id": project_id, "type": "project", "name": f"Proj {tag}", "created_at": "2026-01-01T00:00:00+00:00"})
    db.companies.insert_one({"id": company_id, "type": "company", "name": f"Co {tag}", "created_at": "2026-01-01T00:00:00+00:00"})
    db.centers.insert_one({"id": center_id, "type": "center", "name": f"Ctr {tag}", "created_at": "2026-01-01T00:00:00+00:00"})

    seed_ids = {"project_id": project_id, "company_id": company_id, "center_id": center_id, "batch_id": None, "orphan_txn_id": None}

    try:
        with requests.Session() as s:
            hdrs = _auth(s, "admin@finance.app", "Admin@123")

            # Create batch
            rb = s.post(f"{API_BASE}/batches", headers=hdrs, json={
                "project_id": project_id, "center_id": center_id,
                "company_id": company_id, "partner_ids": [],
                "name": f"Batch-{tag}",
            })
            assert rb.status_code == 200, rb.text
            batch_id = rb.json()["id"]
            seed_ids["batch_id"] = batch_id

            # Create milestone payment
            rp = s.post(f"{API_BASE}/batch-payments", headers=hdrs, json={
                "batch_id": batch_id, "milestone": "1st", "amount": 50000,
                "expected_date": "2026-08-15", "description": f"test-{tag}",
            })
            assert rp.status_code == 200, rp.text
            bp_id = rp.json()["id"]

            # Mark received (should create milestone income txn with batch_id + batch_payment_id)
            rr = s.patch(f"{API_BASE}/batch-payments/{bp_id}/receive", headers=hdrs, json={
                "company_id": company_id, "tds_percent": 0,
            })
            assert rr.status_code == 200, rr.text

            # Verify txn is tagged
            txn = db.transactions.find_one({"batch_payment_id": bp_id}, {"_id": 0})
            assert txn is not None, "Milestone txn not created"
            assert txn.get("batch_id") == batch_id, "batch_id not tagged"
            assert txn.get("batch_payment_id") == bp_id, "batch_payment_id not tagged"
            assert txn.get("source") == "milestone"

            # Seed a legacy-style orphan (no batch_id / batch_payment_id, no live batch match)
            orphan_txn_id = f"orphan-txn-{tag}"
            seed_ids["orphan_txn_id"] = orphan_txn_id
            db.transactions.insert_one({
                "id": orphan_txn_id,
                "type": "income",
                "amount": 99999,
                "date": "2026-08-01",
                "description": "legacy orphan",
                "company_id": company_id,
                "partner_id": None,
                "center_id": f"nonexistent-center-{tag}",
                "project_id": f"nonexistent-project-{tag}",
                "items": [], "attachments": [],
                "source": "milestone",
                "milestone": "1st",
                "status": "approved",
                "created_at": "2026-08-01T00:00:00+00:00",
            })

            # Cleanup dry-run should identify the orphan
            rc = s.post(f"{API_BASE}/batches/cleanup-orphan-txns?dry_run=true", headers=hdrs)
            assert rc.status_code == 200
            body = rc.json()
            assert body["orphans"] >= 1, body
            assert body["deleted"] == 0
            assert body["dry_run"] is True

            # Real cleanup should delete it
            rc2 = s.post(f"{API_BASE}/batches/cleanup-orphan-txns", headers=hdrs)
            assert rc2.status_code == 200
            assert rc2.json()["deleted"] >= 1
            # Verify orphan is gone
            assert db.transactions.find_one({"id": orphan_txn_id}) is None

            # Delete batch -> cascade should remove the tagged milestone txn
            rd = s.delete(f"{API_BASE}/batches/{batch_id}", headers=hdrs)
            assert rd.status_code == 200, rd.text
            assert rd.json()["transactions_deleted"] >= 1

            # Verify all downstream data gone
            assert db.batches.find_one({"id": batch_id}) is None
            assert db.batch_payments.find_one({"id": bp_id}) is None
            assert db.transactions.find_one({"batch_id": batch_id}) is None

    finally:
        # Cleanup any leftovers
        if seed_ids["batch_id"]:
            db.batches.delete_one({"id": seed_ids["batch_id"]})
            db.batch_payments.delete_many({"batch_id": seed_ids["batch_id"]})
            db.transactions.delete_many({"batch_id": seed_ids["batch_id"]})
        if seed_ids["orphan_txn_id"]:
            db.transactions.delete_one({"id": seed_ids["orphan_txn_id"]})
        db.projects.delete_one({"id": project_id})
        db.companies.delete_one({"id": company_id})
        db.centers.delete_one({"id": center_id})
