import asyncio, uuid
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorClient

async def main():
    db = AsyncIOMotorClient("mongodb://localhost:27017")["finance_tracker_db"]
    now = datetime.now(timezone.utc).isoformat()
    await db.candidates.delete_many({"candidate_id": {"$regex": "^ZZCAND"}})
    rows = [
        {"id": str(uuid.uuid4()), "project": "BOCWW", "candidate_id": "ZZCAND-1",
         "name": "SOMARI ORAON", "father_or_husband_name": "MAHADEO ORAON", "mother_name": "",
         "aadhaar": "596681529630", "registered_labour_name": "SOMARI ORAON",
         "registered_labour_aadhaar": "596681529630", "relation_with_labour": "SELF",
         "labour_reg_no": "COW25F0074533662", "id_card_valid_upto": "30/01/2027",
         "labour_card_issue_date": "31/01/2026", "date_of_birth": "01/01/1980",
         "gender": "FEMALE", "category": "ST", "address": "Kumhro Bharno Gumla Jharkhand 835203",
         "mobile": "7667534430", "education": "5th", "physically_handicapped": "No",
         "course_code": "COW-GUM-001", "course_duration_hours": "300", "end_time": "06:00 PM",
         "state": "Jharkhand", "district": "Gumla", "batch_id": "BOCWW-GUM-001", "batch": "BOCWW-GUM-001",
         "fy": "FY 2026", "is_deleted": False, "created_at": now},
        {"id": str(uuid.uuid4()), "project": "BOCWW", "candidate_id": "ZZCAND-2",
         "name": "RAMESH KUMAR", "father_or_husband_name": "SURESH KUMAR", "mother_name": "SITA DEVI",
         "aadhaar": "123456789012", "registered_labour_name": "SURESH KUMAR",
         "registered_labour_aadhaar": "999988887777", "relation_with_labour": "SON",
         "labour_reg_no": "COW25F0099911122", "id_card_valid_upto": "15/06/2028",
         "labour_card_issue_date": "16/06/2026", "date_of_birth": "12/11/1995",
         "gender": "MALE", "category": "OBC", "address": "Ward 5 Palkot Road Gumla Jharkhand 835207",
         "mobile": "9876543210", "education": "10th", "physically_handicapped": "No",
         "course_code": "COW-GUM-001", "course_duration_hours": "300", "end_time": "06:00 PM",
         "state": "Jharkhand", "district": "Gumla", "batch_id": "BOCWW-GUM-001", "batch": "BOCWW-GUM-001",
         "fy": "FY 2026", "is_deleted": False, "created_at": now},
    ]
    await db.candidates.insert_many(rows)
    print("seeded", len(rows), "BOCWW candidates")

asyncio.run(main())
