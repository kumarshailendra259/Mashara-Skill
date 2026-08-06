"""Regression: partner (and center-scoped roles) requesting a SPECIFIC batch/center
must receive results filtered to that specific id — not to the entire scoped list.

Reproduces the production bug where partner "Niranjan Kumar" saw the sum of ALL
his allowed batches' payments on a single-batch page because the backend
overwrote the specific `batch_id` param with `{$in: allowed_batches}`.
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


def test_partner_batch_payments_filter_by_specific_batch():
    db = _db()
    tag = uuid.uuid4().hex[:8]
    partner_id = f"partner-{tag}"
    project_id = f"proj-{tag}"; company_id = f"comp-{tag}"
    center_id = f"ctr-{tag}"
    batch_a = f"batchA-{tag}"; batch_b = f"batchB-{tag}"
    email = f"nk_{tag}@x.com"; pw = "Nk@12345"

    db.partners.insert_one({"id": partner_id, "type": "partner", "name": f"NK {tag}", "created_at": "2026-01-01T00:00:00+00:00"})
    db.projects.insert_one({"id": project_id, "type": "project", "name": f"P {tag}", "created_at": "2026-01-01T00:00:00+00:00"})
    db.companies.insert_one({"id": company_id, "type": "company", "name": f"C {tag}", "created_at": "2026-01-01T00:00:00+00:00"})
    db.centers.insert_one({"id": center_id, "type": "center", "name": f"CT {tag}", "partner_id": partner_id, "created_at": "2026-01-01T00:00:00+00:00"})
    for bid, name in [(batch_a, "A"), (batch_b, "B")]:
        db.batches.insert_one({
            "id": bid, "project_id": project_id, "center_id": center_id,
            "company_id": company_id, "partner_ids": [partner_id],
            "name": f"{name}-{tag}", "job_roles": [],
            "partner_share_percent": 0, "closed": False,
            "created_at": "2026-01-01T00:00:00+00:00",
        })
    # Seed 2 payments in batch A, 3 in batch B
    milestones = ["1st", "2nd", "3rd"]
    for i in range(2):
        db.batch_payments.insert_one({
            "id": f"bpA{i}-{tag}", "batch_id": batch_a, "milestone": milestones[i],
            "amount": 10000, "status": "pending",
            "description": "", "expected_date": "2026-08-15",
            "uniform_amount": 0, "recovery_amount": 0,
            "assessment_fee_total": 0, "assessment_fee_per_candidate": 0,
            "created_at": "2026-01-01T00:00:00+00:00",
        })
    for i in range(3):
        db.batch_payments.insert_one({
            "id": f"bpB{i}-{tag}", "batch_id": batch_b, "milestone": milestones[i],
            "amount": 20000, "status": "pending",
            "description": "", "expected_date": "2026-08-15",
            "uniform_amount": 0, "recovery_amount": 0,
            "assessment_fee_total": 0, "assessment_fee_per_candidate": 0,
            "created_at": "2026-01-01T00:00:00+00:00",
        })
    user_id = f"u-{tag}"
    db.users.insert_one({
        "id": user_id, "email": email,
        "password_hash": hashpw(pw.encode(), gensalt()).decode(),
        "name": f"NK {tag}", "role": "partner",
        "assigned_partner_id": partner_id, "assigned_center_ids": [],
        "created_at": "2026-01-01T00:00:00+00:00",
    })

    try:
        with requests.Session() as s:
            hdrs = _auth(s, email, pw)

            # Requesting all — should return 5 (2+3)
            r_all = s.get(f"{API_BASE}/batch-payments", headers=hdrs)
            assert r_all.status_code == 200, r_all.text
            assert len(r_all.json()) == 5

            # Requesting specific batch_a — MUST return 2 only (the bug returned 5)
            r_a = s.get(f"{API_BASE}/batch-payments", headers=hdrs, params={"batch_id": batch_a})
            assert r_a.status_code == 200
            rows_a = r_a.json()
            assert len(rows_a) == 2, f"Expected 2 payments for batch A, got {len(rows_a)}"
            assert all(p["batch_id"] == batch_a for p in rows_a)

            # Same for batch_b
            r_b = s.get(f"{API_BASE}/batch-payments", headers=hdrs, params={"batch_id": batch_b})
            assert len(r_b.json()) == 3

            # Requesting a batch outside their scope — must be []
            r_other = s.get(f"{API_BASE}/batch-payments", headers=hdrs, params={"batch_id": f"outside-{tag}"})
            assert r_other.status_code == 200
            assert r_other.json() == []

            # Also verify /batches with specific center_id filter is honored
            r_batches = s.get(f"{API_BASE}/batches", headers=hdrs, params={"center_id": center_id})
            assert r_batches.status_code == 200
            for b in r_batches.json():
                assert b["center_id"] == center_id
    finally:
        db.batch_payments.delete_many({"batch_id": {"$in": [batch_a, batch_b]}})
        db.batches.delete_many({"id": {"$in": [batch_a, batch_b]}})
        db.users.delete_one({"id": user_id})
        db.partners.delete_one({"id": partner_id})
        db.projects.delete_one({"id": project_id})
        db.companies.delete_one({"id": company_id})
        db.centers.delete_one({"id": center_id})
