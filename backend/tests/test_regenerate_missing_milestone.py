"""Regression: POST /batches/regenerate-missing-milestone-txns reconstructs
missing income txns for received batch_payments that lost their transactions,
and is idempotent on re-run.
"""
import os
import uuid

import requests
from pymongo import MongoClient

API_BASE = "http://localhost:8001/api"


def _db():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def _auth(session):
    r = session.post(f"{API_BASE}/auth/login", json={"email": "admin@finance.app", "password": "Admin@123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {session.cookies.get('access_token')}"}


def test_regenerate_missing_milestone_txns():
    db = _db()
    tag = uuid.uuid4().hex[:8]
    project_id = f"proj-{tag}"; company_id = f"comp-{tag}"; center_id = f"ctr-{tag}"
    batch_id = f"batch-{tag}"; bp_id = f"bp-{tag}"

    db.projects.insert_one({"id": project_id, "type": "project", "name": f"P {tag}", "created_at": "2026-01-01T00:00:00+00:00"})
    db.companies.insert_one({"id": company_id, "type": "company", "name": f"C {tag}", "created_at": "2026-01-01T00:00:00+00:00"})
    db.centers.insert_one({"id": center_id, "type": "center", "name": f"CT {tag}", "created_at": "2026-01-01T00:00:00+00:00"})
    db.batches.insert_one({
        "id": batch_id, "project_id": project_id, "center_id": center_id,
        "company_id": company_id, "partner_ids": [], "name": f"B {tag}",
        "job_roles": [], "partner_share_percent": 0, "closed": False,
        "passed_candidates": 0,
        "created_at": "2026-01-01T00:00:00+00:00",
    })
    # Simulate the bug: batch_payment is marked 'received' but its
    # milestone transactions were lost (permissive-backfill → dedup collateral).
    db.batch_payments.insert_one({
        "id": bp_id, "batch_id": batch_id, "milestone": "1st",
        "amount": 50000, "status": "received",
        "received_date": "2026-07-01", "received_by": "seed",
        "company_id": company_id,
        "description": f"seed {tag}",
        "expected_date": "2026-06-30",
        "uniform_amount": 0, "recovery_amount": 0,
        "assessment_fee_total": 0, "assessment_fee_per_candidate": 0,
        "tds_percent": 0, "tds_amount": 0,
        "created_at": "2026-06-01T00:00:00+00:00",
    })

    try:
        with requests.Session() as s:
            hdrs = _auth(s)

            # Verify txns are missing
            n_before = db.transactions.count_documents({"batch_payment_id": bp_id, "source": "milestone"})
            assert n_before == 0

            # Dry run
            r1 = s.post(f"{API_BASE}/batches/regenerate-missing-milestone-txns?dry_run=true", headers=hdrs)
            assert r1.status_code == 200, r1.text
            d = r1.json()
            assert d["dry_run"] is True
            assert d["regenerated_payments"] >= 1
            assert d["transactions_created"] >= 1
            # DB should still be empty since it's a dry run
            assert db.transactions.count_documents({"batch_payment_id": bp_id, "source": "milestone"}) == 0

            # Real run
            r2 = s.post(f"{API_BASE}/batches/regenerate-missing-milestone-txns", headers=hdrs)
            assert r2.status_code == 200
            n_after = db.transactions.count_documents({"batch_payment_id": bp_id, "source": "milestone"})
            assert n_after == 1
            # Verify txn is tagged and amount matches
            txn = db.transactions.find_one({"batch_payment_id": bp_id}, {"_id": 0})
            assert txn["batch_id"] == batch_id
            assert txn["amount"] == 50000
            assert txn["source"] == "milestone"

            # Idempotent re-run — should not create duplicates
            r3 = s.post(f"{API_BASE}/batches/regenerate-missing-milestone-txns", headers=hdrs)
            assert r3.status_code == 200
            # Still exactly 1
            assert db.transactions.count_documents({"batch_payment_id": bp_id, "source": "milestone"}) == 1

    finally:
        db.transactions.delete_many({"batch_payment_id": bp_id})
        db.batch_payments.delete_one({"id": bp_id})
        db.batches.delete_one({"id": batch_id})
        db.projects.delete_one({"id": project_id})
        db.companies.delete_one({"id": company_id})
        db.centers.delete_one({"id": center_id})
