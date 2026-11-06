import os, sys, uuid
from pymongo import MongoClient
from dotenv import load_dotenv
load_dotenv('/app/backend/.env')
db=MongoClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
M,Y=11,2027
CID="TEST_p93ui_center"
SIDS={k:f"TEST_p93ui_{k}" for k in "ABZ"}
if sys.argv[1]=="seed":
    assert db.payroll.count_documents({"month":M,"year":Y})==0
    assert db.payroll_batches.count_documents({"month":M,"year":Y})==0
    db.centers.insert_one({"id":CID,"type":"center","name":"TEST_P93 UI Center","center_status":"active","created_at":"2026-01-01T00:00:00+00:00","description":"","mappings":[],"company_id":"6447f857-8d53-4c36-94b6-64ff1c6c2227","access_status":"enabled"})
    for k,s in SIDS.items():
        db.staff.insert_one({"id":s,"name":s,"monthly_salary":30000.0,"per_day_rate":1000.0,"joining_date":"2025-01-01","center_id":CID,"active":True,"created_at":"2026-01-01T00:00:00+00:00","designation":"Teacher","company_id":"6447f857-8d53-4c36-94b6-64ff1c6c2227"})
    db.payroll_batches.insert_one({"id":"TEST_p93ui_prebatch","month":M,"year":Y,"center_id":CID,"center_name":"TEST_P93 UI Center","staff_count":1,"payroll_ids":["TEST_p93ui_rowA"],"net_payable":20000,"status":"pending_approval","audit_log":[{"action":"finalised"}]})
    base=dict(month=M,year=Y,working_days=30,base_salary=30000.0,deductions=0.0,status="draft")
    db.payroll.insert_many([
      {**base,"id":"TEST_p93ui_rowA","staff_id":SIDS["A"],"staff_name":SIDS["A"],"present_days":20,"days_present":20,"gross":20000,"net":20000,"batch_id":"TEST_p93ui_prebatch","batch_status":"pending_approval","locked":True},
      {**base,"id":"TEST_p93ui_rowB","staff_id":SIDS["B"],"staff_name":SIDS["B"],"present_days":30,"days_present":30,"gross":30000,"net":30000},
      {**base,"id":"TEST_p93ui_rowZ","staff_id":SIDS["Z"],"staff_name":SIDS["Z"],"present_days":0,"days_present":0,"gross":0,"net":0},
    ])
    db.attendance.insert_many([{"id":f"TEST_p93ui_att_{uuid.uuid4().hex}","staff_id":SIDS["B"],"center_id":CID,"date":f"{Y}-{M:02d}-{d:02d}","status":"present"} for d in range(1,31)])
    print("seeded")
else:
    print(db.payroll_batches.count_documents({"month":M,"year":Y}), [ (r["staff_name"], r.get("batch_status")) for r in db.payroll.find({"month":M,"year":Y})])
    if sys.argv[1]=="clean":
        db.payroll.delete_many({"month":M,"year":Y,"staff_id":{"$in":list(SIDS.values())}})
        print("other rows left:", db.payroll.count_documents({"month":M,"year":Y}))
        db.payroll_batches.delete_many({"month":M,"year":Y,"center_id":CID})
        db.attendance_locks.delete_many({"month":M,"year":Y,"center_id":CID})
        db.attendance.delete_many({"staff_id":{"$in":list(SIDS.values())},"date":{"$regex":f"^{Y}-{M:02d}-"}})
        db.staff.delete_many({"id":{"$in":list(SIDS.values())}})
        db.centers.delete_many({"id":CID})
        print("cleaned")
