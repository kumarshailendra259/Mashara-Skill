"""Regression: attendance uses IST-based date (not UTC), and previous-day open
rows are auto-closed to 'incomplete' when the staff checks in on a new day.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import requests
from bcrypt import hashpw, gensalt
from pymongo import MongoClient

API_BASE = "http://localhost:8001/api"
IST = ZoneInfo("Asia/Kolkata")


def _db():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def _auth(session, email, pw):
    r = session.post(f"{API_BASE}/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {session.cookies.get('access_token')}"}


def test_previous_open_row_is_closed_and_today_is_ist():
    db = _db()
    tag = uuid.uuid4().hex[:8]
    email = f"anand_{tag}@x.com"; pw = "Anand@12345"
    user_id = f"u-{tag}"; staff_id = f"s-{tag}"

    db.users.insert_one({
        "id": user_id, "email": email,
        "password_hash": hashpw(pw.encode(), gensalt()).decode(),
        "name": f"Anand {tag}", "role": "center_staff",
        "assigned_center_ids": [], "created_at": "2026-01-01T00:00:00+00:00",
    })
    db.staff.insert_one({
        "id": staff_id, "user_id": user_id, "name": f"Anand {tag}",
        "center_id": None, "is_active": True,
        "created_at": "2026-01-01T00:00:00+00:00",
    })

    # Seed yesterday (IST) attendance: check-in only, no check-out
    yesterday_ist = (datetime.now(IST) - timedelta(days=1)).date().isoformat()
    y_check_in_utc = datetime.now(timezone.utc).replace(hour=17, minute=45).isoformat()
    seed_row_id = f"att-{tag}"
    db.attendance.insert_one({
        "id": seed_row_id,
        "staff_id": staff_id,
        "date": yesterday_ist,
        "status": "present",
        "check_in_at": y_check_in_utc,
        "check_out_at": None,
        "marked_via": "self",
        "created_at": y_check_in_utc,
    })

    try:
        with requests.Session() as s:
            hdrs = _auth(s, email, pw)

            # /attendance/today should NOT return yesterday's open row
            r = s.get(f"{API_BASE}/attendance/today", headers=hdrs)
            assert r.status_code == 200, r.text
            today_att = r.json().get("attendance")
            assert today_att is None, f"Today should be empty, got {today_att}"

            # Simulate check-in — this should also auto-close yesterday's open row.
            # Skip lat/lng to bypass the global geofence (Mashara HQ Mumbai) for the test.
            r = s.post(f"{API_BASE}/attendance/self", headers=hdrs, json={
                "status": "present",
            })
            assert r.status_code == 200, r.text
            body = r.json()
            today_ist_str = datetime.now(IST).date().isoformat()
            assert body["date"] == today_ist_str, f"Expected date={today_ist_str}, got {body['date']}"

            # Yesterday's row must now be marked 'incomplete' + have auto_closed_at
            y_row = db.attendance.find_one({"id": seed_row_id}, {"_id": 0})
            assert y_row["status"] == "incomplete", f"Expected 'incomplete', got {y_row['status']}"
            assert "auto_closed_at" in y_row
            assert y_row["check_out_at"] in (None, ""), "yesterday's row must NOT auto-fill check_out_at"

            # A fresh row must exist for today (IST)
            today_row = db.attendance.find_one({"staff_id": staff_id, "date": today_ist_str}, {"_id": 0})
            assert today_row is not None
            assert today_row["check_in_at"]  # fresh check-in

            # /attendance/today should now return the fresh today row
            r = s.get(f"{API_BASE}/attendance/today", headers=hdrs)
            att = r.json()["attendance"]
            assert att is not None
            assert att["date"] == today_ist_str
            # The check_in_at on today's row must be TODAY (IST) — not yesterday's ISO
            ci_utc = datetime.fromisoformat(att["check_in_at"].replace("Z", "+00:00"))
            ci_ist_date = ci_utc.astimezone(IST).date().isoformat()
            assert ci_ist_date == today_ist_str, f"check_in_at IST date {ci_ist_date} must equal today {today_ist_str}"

            # Now check-out — should succeed and mark today as present
            r = s.post(f"{API_BASE}/attendance/checkout", headers=hdrs, json={})
            assert r.status_code == 200, r.text

            # Attendance list must show yesterday as 'incomplete' + today as 'present'
            r = s.get(f"{API_BASE}/attendance", headers=hdrs, params={"staff_id": staff_id})
            rows = {row["date"]: row for row in r.json()}
            assert rows[yesterday_ist]["effective_status"] == "incomplete"
            assert rows[today_ist_str]["effective_status"] == "present"

    finally:
        db.attendance.delete_many({"staff_id": staff_id})
        db.staff.delete_one({"id": staff_id})
        db.users.delete_one({"id": user_id})
