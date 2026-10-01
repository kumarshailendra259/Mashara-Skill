import asyncio, uuid, os
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorClient

MONGO = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB = os.environ.get("DB_NAME", "finance_tracker_db")

PREFIX = "ZZPAYTEST"

async def main():
    c = AsyncIOMotorClient(MONGO)
    db = c[DB]
    now = datetime.now(timezone.utc).isoformat()
    cid = f"{PREFIX}-center"
    # center with a mapped partner
    pid = f"{PREFIX}-partner"
    await db.partners.delete_many({"id": pid})
    await db.partners.insert_one({"id": pid, "type": "partner", "name": "ZZ Test Partner", "created_at": now})
    await db.centers.delete_many({"id": cid})
    await db.centers.insert_one({
        "id": cid, "type": "center", "name": "ZZ Pay Test Center", "created_at": now,
        "mappings": [{"partner_id": pid, "project_id": None, "company_id": None, "active": True, "cross_approval": True, "role": "Partner"}],
        "partner_id": pid,
    })
    # 2 staff
    s1 = f"{PREFIX}-staff1"; s2 = f"{PREFIX}-staff2"
    await db.staff.delete_many({"id": {"$in": [s1, s2]}})
    await db.staff.insert_many([
        {"id": s1, "name": "ZZ Emp One", "employee_code": "ZZ-001", "center_id": cid, "is_active": True, "bank_account_no": "111122223333", "ifsc": "HDFC0001"},
        {"id": s2, "name": "ZZ Emp Two", "employee_code": "ZZ-002", "center_id": cid, "is_active": True, "bank_account_no": "444455556666", "ifsc": "HDFC0002"},
    ])
    # batch + rows
    bid = f"{PREFIX}-batch"
    await db.payroll_batches.delete_many({"id": bid})
    await db.payroll.delete_many({"batch_id": bid})
    await db.payroll_batches.insert_one({
        "id": bid, "month": 12, "year": 2099, "center_id": cid, "center_name": "ZZ Pay Test Center",
        "status": "pending_payment", "staff_count": 2, "gross": 8000, "deductions": 0, "net_payable": 8000,
        "created_at": now, "audit_log": [],
    })
    await db.payroll.insert_many([
        {"id": f"{PREFIX}-row1", "batch_id": bid, "staff_id": s1, "month": 12, "year": 2099, "gross": 5000, "deductions": 0, "net": 5000, "status": "finalised"},
        {"id": f"{PREFIX}-row2", "batch_id": bid, "staff_id": s2, "month": 12, "year": 2099, "gross": 3000, "deductions": 0, "net": 3000, "status": "finalised"},
    ])
    print("SEEDED batch", bid, "center", cid, "partner", pid, "staff", s1, s2)

    # Second batch: pending_approval at its FINAL step (1-level chain) so an
    # admin/accountant sees it in Pending Approvals and can one-screen Approve+Pay.
    bid2 = f"{PREFIX}-batch-approval"
    await db.payroll_batches.delete_many({"id": bid2})
    await db.payroll.delete_many({"batch_id": bid2})
    await db.payroll_batches.insert_one({
        "id": bid2, "month": 11, "year": 2099, "center_id": cid, "center_name": "ZZ Pay Test Center",
        "status": "pending_approval", "staff_count": 2, "gross": 8000, "deductions": 0, "net_payable": 8000,
        "created_at": now, "finalised_by_name": "ZZ HR", "audit_log": [],
        "current_level": 1,
        "chain_snapshot": [{"level": 1, "label": "Accounts Approval", "kind": "role", "value": "accountant"}],
        "chain_history": [],
    })
    await db.payroll.insert_many([
        {"id": f"{PREFIX}-a-row1", "batch_id": bid2, "staff_id": s1, "month": 11, "year": 2099, "gross": 5000, "deductions": 0, "net": 5000, "status": "finalised"},
        {"id": f"{PREFIX}-a-row2", "batch_id": bid2, "staff_id": s2, "month": 11, "year": 2099, "gross": 3000, "deductions": 0, "net": 3000, "status": "finalised"},
    ])
    print("SEEDED approval batch", bid2)

asyncio.run(main())
