"""RBAC regression: center_manager can create batches (only at their assigned centers)
and accountant can update batches. Delete stays admin-only.
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
    token = session.cookies.get("access_token")
    return {"Authorization": f"Bearer {token}"}


def test_batch_rbac_center_manager_create_and_accountant_update():
    db = _db()
    tag = uuid.uuid4().hex[:8]
    project_id = f"proj-{tag}"
    company_id = f"comp-{tag}"
    my_center_id = f"my-ctr-{tag}"
    other_center_id = f"other-ctr-{tag}"
    cm_email = f"cm_{tag}@x.com"
    cm_pw = "Cm@12345"
    acc_email = f"acc_{tag}@x.com"
    acc_pw = "Acc@12345"

    db.projects.insert_one({"id": project_id, "type": "project", "name": f"Proj {tag}", "created_at": "2026-01-01T00:00:00+00:00"})
    db.companies.insert_one({"id": company_id, "type": "company", "name": f"Co {tag}", "created_at": "2026-01-01T00:00:00+00:00"})
    db.centers.insert_one({"id": my_center_id, "type": "center", "name": f"MyC {tag}", "created_at": "2026-01-01T00:00:00+00:00"})
    db.centers.insert_one({"id": other_center_id, "type": "center", "name": f"OtherC {tag}", "created_at": "2026-01-01T00:00:00+00:00"})

    cm_user = f"u-cm-{tag}"
    acc_user = f"u-acc-{tag}"
    db.users.insert_one({
        "id": cm_user, "email": cm_email,
        "password_hash": hashpw(cm_pw.encode(), gensalt()).decode(),
        "name": f"CM {tag}", "role": "center_manager",
        "assigned_center_ids": [my_center_id],
        "assigned_partner_id": None,
        "created_at": "2026-01-01T00:00:00+00:00",
    })
    db.users.insert_one({
        "id": acc_user, "email": acc_email,
        "password_hash": hashpw(acc_pw.encode(), gensalt()).decode(),
        "name": f"ACC {tag}", "role": "accountant",
        "assigned_center_ids": [], "assigned_partner_id": None,
        "created_at": "2026-01-01T00:00:00+00:00",
    })

    created_bid = None
    try:
        # --- Center Manager can CREATE batch at own center ---
        with requests.Session() as s:
            hdrs = _auth(s, cm_email, cm_pw)
            r = s.post(f"{API_BASE}/batches", headers=hdrs, json={
                "project_id": project_id, "center_id": my_center_id,
                "company_id": company_id, "partner_ids": [],
                "name": f"CM-Batch-{tag}",
            })
            assert r.status_code == 200, f"CM should create at own center: {r.status_code} {r.text}"
            created_bid = r.json()["id"]

            # CM CANNOT create at another center
            r2 = s.post(f"{API_BASE}/batches", headers=hdrs, json={
                "project_id": project_id, "center_id": other_center_id,
                "company_id": company_id, "partner_ids": [],
                "name": f"CM-Bad-{tag}",
            })
            assert r2.status_code == 403, f"CM should be 403 at other center: {r2.status_code} {r2.text}"

            # CM CANNOT update (only accountant/admin/manager/senior_manager can)
            r3 = s.put(f"{API_BASE}/batches/{created_bid}", headers=hdrs, json={
                "project_id": project_id, "center_id": my_center_id,
                "company_id": company_id, "partner_ids": [],
                "name": f"CM-Batch-{tag}-edit",
            })
            assert r3.status_code == 403, f"CM must not update: {r3.status_code} {r3.text}"

            # CM CANNOT delete
            r4 = s.delete(f"{API_BASE}/batches/{created_bid}", headers=hdrs)
            assert r4.status_code == 403, f"CM must not delete: {r4.status_code}"

        # --- Accountant CAN update, cannot create/delete ---
        with requests.Session() as s2:
            hdrs = _auth(s2, acc_email, acc_pw)
            rU = s2.put(f"{API_BASE}/batches/{created_bid}", headers=hdrs, json={
                "project_id": project_id, "center_id": my_center_id,
                "company_id": company_id, "partner_ids": [],
                "name": f"Acc-Edited-{tag}",
            })
            assert rU.status_code == 200, f"Accountant must update: {rU.status_code} {rU.text}"
            assert rU.json()["name"] == f"Acc-Edited-{tag}"

            rC = s2.post(f"{API_BASE}/batches", headers=hdrs, json={
                "project_id": project_id, "center_id": my_center_id,
                "company_id": company_id, "partner_ids": [],
                "name": f"Acc-Create-{tag}",
            })
            assert rC.status_code == 403, f"Accountant must NOT create: {rC.status_code}"

            rD = s2.delete(f"{API_BASE}/batches/{created_bid}", headers=hdrs)
            assert rD.status_code == 403, f"Accountant must NOT delete: {rD.status_code}"

    finally:
        db.batches.delete_many({"id": created_bid} if created_bid else {"project_id": project_id})
        db.users.delete_many({"id": {"$in": [cm_user, acc_user]}})
        db.projects.delete_one({"id": project_id})
        db.companies.delete_one({"id": company_id})
        db.centers.delete_many({"id": {"$in": [my_center_id, other_center_id]}})
