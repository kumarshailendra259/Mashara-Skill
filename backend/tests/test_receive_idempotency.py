"""Regression: receive_batch_payment is idempotent — a rapid double-click cannot
create duplicate milestone transactions. Also verifies the unique index blocks
any attempt to insert a duplicate directly.
"""
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import requests
from pymongo import MongoClient

API_BASE = "http://localhost:8001/api"


def _db():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def _auth(session, email, pw):
    r = session.post(f"{API_BASE}/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {session.cookies.get('access_token')}"}


def _seed_batch_and_payment(db, tag):
    project_id = f"proj-{tag}"
    company_id = f"comp-{tag}"
    center_id = f"ctr-{tag}"
    batch_id = f"batch-{tag}"
    bp_id = f"bp-{tag}"
    db.projects.insert_one({"id": project_id, "type": "project", "name": f"P {tag}", "created_at": "2026-01-01T00:00:00+00:00"})
    db.companies.insert_one({"id": company_id, "type": "company", "name": f"C {tag}", "created_at": "2026-01-01T00:00:00+00:00"})
    db.centers.insert_one({"id": center_id, "type": "center", "name": f"CT {tag}", "created_at": "2026-01-01T00:00:00+00:00"})
    db.batches.insert_one({
        "id": batch_id, "project_id": project_id, "center_id": center_id,
        "company_id": company_id, "partner_ids": [], "name": f"B {tag}",
        "job_roles": [], "partner_share_percent": 0, "closed": False,
        "created_at": "2026-01-01T00:00:00+00:00",
    })
    db.batch_payments.insert_one({
        "id": bp_id, "batch_id": batch_id, "milestone": "1st",
        "amount": 25000, "status": "planned",
        "description": f"seed {tag}",
        "expected_date": "2026-08-15",
        "uniform_amount": 0, "recovery_amount": 0,
        "assessment_fee_total": 0, "assessment_fee_per_candidate": 0,
        "created_at": "2026-01-01T00:00:00+00:00",
    })
    return {
        "project_id": project_id, "company_id": company_id, "center_id": center_id,
        "batch_id": batch_id, "bp_id": bp_id,
    }


def test_receive_batch_payment_is_idempotent():
    db = _db()
    tag = uuid.uuid4().hex[:8]
    ids = _seed_batch_and_payment(db, tag)
    try:
        with requests.Session() as s:
            hdrs = _auth(s, "admin@finance.app", "Admin@123")

            # Fire 5 concurrent receive calls
            def _hit(_i):
                with requests.Session() as ss:
                    h = _auth(ss, "admin@finance.app", "Admin@123")
                    r = ss.patch(f"{API_BASE}/batch-payments/{ids['bp_id']}/receive",
                                 headers=h, json={"tds_percent": 0})
                    return r.status_code

            with ThreadPoolExecutor(max_workers=5) as ex:
                results = list(ex.map(_hit, range(5)))

            successes = [c for c in results if c == 200]
            already = [c for c in results if c == 400]
            assert len(successes) == 1, f"Only 1 concurrent call should succeed, got {results}"
            assert len(already) == 4, f"Rest should be 400 'Already received', got {results}"

            # Exactly ONE income txn should exist for this batch_payment.
            time.sleep(0.5)
            txns = list(db.transactions.find({"batch_payment_id": ids["bp_id"], "source": "milestone"}))
            assert len(txns) == 1, f"Expected 1 income txn, got {len(txns)}"
            assert txns[0]["amount"] == 25000

            # Unique index should reject a direct duplicate insert.
            from pymongo.errors import DuplicateKeyError
            dup = dict(txns[0]); dup["_id"] = None; dup.pop("_id", None); dup["id"] = f"dup-{tag}"
            try:
                db.transactions.insert_one(dup)
                raise AssertionError("Unique index did not block duplicate insert")
            except DuplicateKeyError:
                pass  # expected
    finally:
        db.transactions.delete_many({"batch_payment_id": ids["bp_id"]})
        db.batch_payments.delete_one({"id": ids["bp_id"]})
        db.batches.delete_one({"id": ids["batch_id"]})
        db.projects.delete_one({"id": ids["project_id"]})
        db.companies.delete_one({"id": ids["company_id"]})
        db.centers.delete_one({"id": ids["center_id"]})
