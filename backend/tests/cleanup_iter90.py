"""Cleanup for iter90 test data (TEST_IT90 quotations / payments / txns / bank ledger rows / QRN counter)."""
import os
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv('/app/backend/.env')
db = AsyncIOMotorClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
BIRSA = "4d7fc745-c28c-4298-baab-58c63dbe8734"


async def main():
    qs = await db.quotations.find({"description": {"$regex": "^TEST_IT90"}}, {"_id": 0}).to_list(100)
    qids = [q["id"] for q in qs]
    pays = await db.payments.find({"quotation_id": {"$in": qids}}, {"_id": 0}).to_list(100)
    pids = [p["id"] for p in pays]
    bt = await db.bank_transactions.find({"source_id": {"$in": pids}}, {"_id": 0}).to_list(100)
    for b in bt:
        amt = float(b.get("amount") or 0)
        delta = amt if b.get("direction") == "debit" else -amt
        await db.bank_accounts.update_one({"id": b["account_id"]}, {"$inc": {"current_balance": delta}})
    print("bank txns reverted", len(bt), (await db.bank_transactions.delete_many({"source_id": {"$in": pids}})).deleted_count)
    print("txns", (await db.transactions.delete_many({"payment_id": {"$in": pids}})).deleted_count)
    print("payments", (await db.payments.delete_many({"id": {"$in": pids}})).deleted_count)
    approved_birsa = sum(1 for q in qs if q.get("qrn") and q.get("center_id") == BIRSA)
    if approved_birsa:
        await db.qrn_counters.update_one({"center_id": BIRSA}, {"$inc": {"counter": -approved_birsa}})
    print("qrn decremented", approved_birsa)
    await db.notifications.delete_many({"ref_id": {"$in": qids + pids}})
    print("quotes", (await db.quotations.delete_many({"id": {"$in": qids}})).deleted_count)


asyncio.run(main())
