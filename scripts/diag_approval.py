import asyncio, os
from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME")

async def main():
    c = AsyncIOMotorClient(MONGO_URL)
    db = c[DB_NAME]

    print("=== Partners matching rajiv/rajeev ===")
    async for p in db.partners.find({"name": {"$regex": "raj", "$options": "i"}}, {"_id":0,"id":1,"name":1}):
        print(p)

    print("\n=== Users matching rajiv/rajeev ===")
    async for u in db.users.find({"$or":[{"name":{"$regex":"raj","$options":"i"}},{"email":{"$regex":"raj","$options":"i"}}]},
                                 {"_id":0,"id":1,"name":1,"email":1,"role":1,"assigned_partner_id":1,"assigned_center_ids":1}):
        print(u)

    print("\n=== The pending txn (For Partition Payment / 50000) ===")
    async for t in db.transactions.find({"status":"pending","amount":50000}, {"_id":0,"id":1,"description":1,"partner_id":1,"center_id":1,"project_id":1,"company_id":1,"created_by":1,"status":1}):
        print(t)
        cid = t.get("center_id")
        ctr = await db.centers.find_one({"id":cid},{"_id":0,"id":1,"name":1,"partner_id":1,"mappings":1})
        print("  CENTER:", {"id":ctr.get("id"),"name":ctr.get("name"),"partner_id":ctr.get("partner_id")} if ctr else None)
        if ctr:
            for m in (ctr.get("mappings") or []):
                pn = await db.partners.find_one({"id":m.get("partner_id")},{"_id":0,"name":1})
                print("    MAP partner_id=",m.get("partner_id"),"name=",(pn or {}).get("name"),"active=",m.get("active"),"cross_approval=",m.get("cross_approval"))

    c.close()

asyncio.run(main())
