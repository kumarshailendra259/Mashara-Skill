"""Cleanup for iter89 test data (TEST-IT89 / TEST-UI89 mess receipts, TEST_AUDIT txn, TEST_IT89 quotations)."""
import os
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv('/app/backend/.env')
db = AsyncIOMotorClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]


async def main():
    recs = await db.mess_receipts.find({"invoice_no": {"$regex": "^TEST-(IT89|UI89)-"}}, {"_id": 0}).to_list(100)
    rids = [r["id"] for r in recs]
    print("receipts", len(rids))
    # revert stock via ledger rows tied to these receipts
    led = await db.mess_ledger.find({"ref_id": {"$in": rids}}, {"_id": 0}).to_list(1000)
    if not led:
        led = await db.mess_ledger.find({"$or": [{"receipt_id": {"$in": rids}}, {"source_id": {"$in": rids}}]}, {"_id": 0}).to_list(1000)
    print("ledger rows", len(led), (led[0].keys() if led else None))
    for l in led:
        q = float(l.get("qty_in") or l.get("qty") or 0)
        v = float(l.get("value_delta") or 0)
        st = await db.mess_stock.find_one({"center_id": l["center_id"], "item_id": l["item_id"]})
        if st:
            nq = max(0.0, float(st.get("qty") or 0) - q)
            nv = max(0.0, float(st.get("value") or 0) - v)
            await db.mess_stock.update_one({"_id": st["_id"]}, {"$set": {"qty": nq, "value": nv, "avg_cost": (nv / nq) if nq else 0}})
    if led:
        await db.mess_ledger.delete_many({"id": {"$in": [l["id"] for l in led]}})
    pays = await db.mess_payments.find({"receipt_id": {"$in": rids}}, {"_id": 0}).to_list(100)
    pids = [p["id"] for p in pays]
    bt = await db.bank_transactions.find({"source_id": {"$in": pids}}, {"_id": 0}).to_list(100)
    for b in bt:
        amt = float(b.get("amount") or 0)
        delta = amt if b.get("direction") == "debit" else -amt
        await db.bank_accounts.update_one({"id": b["account_id"]}, {"$inc": {"current_balance": delta}})
    print("bank txns reverted", len(bt))
    await db.bank_transactions.delete_many({"source_id": {"$in": pids}})
    print("txns", (await db.transactions.delete_many({"mess_receipt_id": {"$in": rids}})).deleted_count)
    await db.mess_bills.delete_many({"receipt_id": {"$in": rids}})
    await db.mess_payments.delete_many({"id": {"$in": pids}})
    await db.mess_receipts.delete_many({"id": {"$in": rids}})
    await db.transactions.delete_many({"id": {"$regex": "^TEST_AUDIT_"}})
    await db.audit_corrections.delete_many({"txn_id": {"$regex": "^TEST_AUDIT_"}})
    print("quotes", (await db.quotations.delete_many({"description": "TEST_IT89 quote"})).deleted_count)


asyncio.run(main())
