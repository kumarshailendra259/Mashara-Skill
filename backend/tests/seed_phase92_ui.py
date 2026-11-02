"""Seed/cleanup helper for Phase 92 UI test: batch + pending 1st milestone at TEST_Center_Phase72."""
import sys
from pymongo import MongoClient

env = dict(l.strip().split("=", 1) for l in open('/app/backend/.env') if '=' in l)
db = MongoClient(env['MONGO_URL'].strip('"'))[env['DB_NAME'].strip('"')]
CENTER = "668de8a2-1a5a-44cc-9553-25d64befd16a"
BATCH = "TEST_ui92_batch"
BP = "TEST_ui92_bp"
if sys.argv[1] == "seed":
    proj = db.projects.find_one({"name": "BIRSA Palojori"}, {"_id": 0, "id": 1})
    tmpl = db.batches.find_one({"project_id": proj["id"]}, {"_id": 0}) or {}
    tmpl.update({"id": BATCH, "project_id": proj["id"], "center_id": CENTER, "name": "TEST_UI92 Batch",
                 "partner_ids": [], "partner_share_percent": 0, "closed": False,
                 "company_id": "73bb261d-42e9-4aa4-9028-e839280f995c", "created_at": "2026-01-01T00:00:00+00:00"})
    db.batches.delete_many({"id": BATCH})
    db.batches.insert_one(tmpl)
    db.batch_payments.delete_many({"id": BP})
    db.batch_payments.insert_one({"id": BP, "batch_id": BATCH, "milestone": "1st", "amount": 12345, "status": "pending",
                                  "description": "TEST ui92", "expected_date": "2026-01-15", "uniform_amount": 0,
                                  "recovery_amount": 0, "assessment_fee_total": 0, "assessment_fee_per_candidate": 0,
                                  "company_id": "73bb261d-42e9-4aa4-9028-e839280f995c",
                                  "created_at": "2026-01-01T00:00:00+00:00"})
    print("project", proj["id"])
elif sys.argv[1] == "show":
    for t in db.transactions.find({"batch_id": BATCH}, {"_id": 0, "id": 1, "type": 1, "source": 1, "amount": 1, "work_order_id": 1, "work_order_no": 1}):
        print(t)
    print(db.batch_payments.find_one({"id": BP}, {"_id": 0, "status": 1}))
else:
    print(db.transactions.delete_many({"batch_id": BATCH}).deleted_count)
    db.batch_payments.delete_many({"batch_id": BATCH})
    db.batches.delete_many({"id": BATCH})
