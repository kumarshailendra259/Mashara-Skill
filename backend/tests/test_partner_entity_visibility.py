"""Regression: partner role must see the company/project that appears on any batch
they are listed on — even when the batch has no center_id set.

Reproduces the production bug where partner "Shyam Kumar" saw an empty Companies
page because the visibility resolver only walked from centers -> company_id, so
batches without a center_id were skipped.
"""
import os
import uuid

import requests
from bcrypt import hashpw, gensalt
from pymongo import MongoClient

API_BASE = "http://localhost:8001/api"


def _db():
    client = MongoClient(os.environ["MONGO_URL"])
    return client[os.environ["DB_NAME"]]


def test_partner_sees_company_via_batch_without_center():
    db = _db()
    tag = uuid.uuid4().hex[:8]
    partner_id = f"partner-{tag}"
    company_id = f"company-{tag}"
    project_id = f"project-{tag}"
    email = f"shyam_{tag}@x.com"
    pw = "Shyam@12345"

    db.partners.insert_one({"id": partner_id, "type": "partner", "name": f"Shyam {tag}", "created_at": "2026-01-01T00:00:00+00:00"})
    db.companies.insert_one({"id": company_id, "type": "company", "name": f"ACME {tag}", "created_at": "2026-01-01T00:00:00+00:00"})
    db.projects.insert_one({"id": project_id, "type": "project", "name": f"Proj {tag}", "created_at": "2026-01-01T00:00:00+00:00"})
    db.batches.insert_one({
        "id": f"batch-{tag}",
        "project_id": project_id,
        "company_id": company_id,
        "partner_ids": [partner_id],
        "center_id": None,
        "name": f"Batch {tag}",
        "job_roles": [],
        "partner_share_percent": 0,
        "closed": False,
        "created_at": "2026-01-01T00:00:00+00:00",
    })
    user_id = f"user-{tag}"
    db.users.insert_one({
        "id": user_id,
        "email": email,
        "password_hash": hashpw(pw.encode(), gensalt()).decode(),
        "name": f"Shyam {tag}",
        "role": "partner",
        "assigned_partner_id": partner_id,
        "assigned_center_ids": [],
        "created_at": "2026-01-01T00:00:00+00:00",
    })

    try:
        with requests.Session() as s:
            r = s.post(f"{API_BASE}/auth/login", json={"email": email, "password": pw})
            assert r.status_code == 200, r.text
            token = s.cookies.get("access_token")
            assert token, "no access_token cookie"
            hdrs = {"Authorization": f"Bearer {token}"}

            rc = s.get(f"{API_BASE}/entities/company", headers=hdrs)
            assert rc.status_code == 200, rc.text
            ids = [row["id"] for row in rc.json()]
            assert company_id in ids, f"Expected {company_id} in {ids}"

            rp = s.get(f"{API_BASE}/entities/project", headers=hdrs)
            assert rp.status_code == 200
            ids_p = [row["id"] for row in rp.json()]
            assert project_id in ids_p, f"Expected {project_id} in {ids_p}"

            rpn = s.get(f"{API_BASE}/entities/partner", headers=hdrs)
            assert rpn.status_code == 200
            ids_pn = [row["id"] for row in rpn.json()]
            assert partner_id in ids_pn
    finally:
        db.users.delete_one({"id": user_id})
        db.batches.delete_one({"id": f"batch-{tag}"})
        db.partners.delete_one({"id": partner_id})
        db.companies.delete_one({"id": company_id})
        db.projects.delete_one({"id": project_id})
