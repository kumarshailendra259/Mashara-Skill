import asyncio, uuid
from datetime import datetime, timezone, timedelta
from motor.motor_asyncio import AsyncIOMotorClient

async def main():
    db = AsyncIOMotorClient("mongodb://localhost:27017")["finance_tracker_db"]
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    await db.candidates.delete_many({"candidate_id": {"$regex": "^ZZCAND"}})
    plan = {"Gumla": 87, "Garhwa": 45, "Ranchi": 30}
    rows = []
    seq = 0
    for dist, n in plan.items():
        for i in range(1, n + 1):
            seq += 1
            rows.append({
                "id": str(uuid.uuid4()), "project": "BOCWW", "candidate_id": f"ZZCAND-{dist}-{i}",
                "name": f"{dist} Cand {i}", "father_or_husband_name": f"Father {i}", "mother_name": f"Mother {i}",
                "aadhaar": f"5966815296{seq:02d}", "registered_labour_name": f"{dist} Cand {i}",
                "registered_labour_aadhaar": f"9999888877{seq:02d}", "relation_with_labour": "SELF",
                "labour_reg_no": f"COW25F00745{seq:05d}", "id_card_valid_upto": "30/01/2027",
                "labour_card_issue_date": "31/01/2026", "date_of_birth": "01/01/1990",
                "gender": "MALE" if i % 2 else "FEMALE", "category": "ST",
                "address": f"Ward {i} {dist} Jharkhand 835203", "mobile": f"76675{seq:05d}",
                "education": "10th", "physically_handicapped": "No",
                "course_code": "COW-GUM-001", "course_duration_hours": "300", "end_time": "06:00 PM",
                "state": "Jharkhand", "district": dist,
                "batch": ("BATCH-DBX" if (dist == "Gumla" and i <= 5) else ""),
                "fy": "FY 2026", "is_deleted": False,
                "created_at": (base + timedelta(minutes=seq)).isoformat(),
            })
    await db.candidates.insert_many(rows)
    print("seeded", len(rows), "candidates:", plan)

asyncio.run(main())
