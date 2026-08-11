"""Security regression (Phase 30B): center_staff must not be able to spoof
'admin' attendance rows for themselves or anyone else. center_manager can only
mark/edit attendance for staff at their assigned centers. Server always forces
marked_via='admin' on POST /attendance so client cannot pretend to be self.
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
    return {"Authorization": f"Bearer {session.cookies.get('access_token')}"}


def test_center_staff_cannot_spoof_admin_attendance():
    db = _db()
    tag = uuid.uuid4().hex[:8]
    email = f"anand_{tag}@x.com"; pw = "Anand@12345"
    victim_email = f"victim_{tag}@x.com"
    user_id = f"u-{tag}"; staff_id = f"s-{tag}"
    v_user_id = f"vu-{tag}"; v_staff_id = f"vs-{tag}"

    for uid, e, name, sid in [
        (user_id, email, f"Anand {tag}", staff_id),
        (v_user_id, victim_email, f"Victim {tag}", v_staff_id),
    ]:
        db.users.insert_one({
            "id": uid, "email": e,
            "password_hash": hashpw(pw.encode(), gensalt()).decode(),
            "name": name, "role": "center_staff",
            "assigned_center_ids": [], "created_at": "2026-01-01T00:00:00+00:00",
        })
        db.staff.insert_one({
            "id": sid, "user_id": uid, "name": name,
            "center_id": None, "is_active": True,
            "created_at": "2026-01-01T00:00:00+00:00",
        })

    try:
        with requests.Session() as s:
            hdrs = _auth(s, email, pw)

            # 1) center_staff MUST NOT be able to POST /attendance at all — 403
            r = s.post(f"{API_BASE}/attendance", headers=hdrs, json={
                "staff_id": staff_id, "date": "2026-08-11",
                "status": "present", "marked_via": "self",
                "check_in_at": "2026-08-11T02:00:00+00:00",
            })
            assert r.status_code == 403, f"center_staff should be blocked, got {r.status_code}: {r.text}"

            # 2) center_staff cannot spoof another user's attendance either
            r = s.post(f"{API_BASE}/attendance", headers=hdrs, json={
                "staff_id": v_staff_id, "date": "2026-08-11", "status": "present",
            })
            assert r.status_code == 403

        # 3) Admin CAN post, but marked_via is FORCED to "admin" regardless of client input
        with requests.Session() as s2:
            ahdrs = _auth(s2, "admin@finance.app", "Admin@123")
            r = s2.post(f"{API_BASE}/attendance", headers=ahdrs, json={
                "staff_id": staff_id, "date": "2026-08-11", "status": "present",
                "marked_via": "self",  # spoof attempt
                "check_out_at": "2026-08-11T04:13:00+00:00",
            })
            assert r.status_code == 200
            row = db.attendance.find_one({"staff_id": staff_id, "date": "2026-08-11"}, {"_id": 0})
            assert row["marked_via"] == "admin", f"marked_via must be forced to 'admin', got {row['marked_via']}"
            assert row.get("marked_by")  # audit trail present
    finally:
        db.attendance.delete_many({"staff_id": {"$in": [staff_id, v_staff_id]}})
        db.staff.delete_many({"id": {"$in": [staff_id, v_staff_id]}})
        db.users.delete_many({"id": {"$in": [user_id, v_user_id]}})


def test_center_manager_scoped_to_own_center():
    db = _db()
    tag = uuid.uuid4().hex[:8]
    my_center = f"my-{tag}"; other_center = f"other-{tag}"
    cm_email = f"cm_{tag}@x.com"; pw = "Cm@12345"
    my_staff = f"my-staff-{tag}"; other_staff = f"other-staff-{tag}"
    cm_user = f"cm-u-{tag}"
    my_su = f"my-su-{tag}"; other_su = f"other-su-{tag}"

    db.centers.insert_one({"id": my_center, "type": "center", "name": "MyC", "created_at": "2026-01-01T00:00:00+00:00"})
    db.centers.insert_one({"id": other_center, "type": "center", "name": "OtherC", "created_at": "2026-01-01T00:00:00+00:00"})
    db.users.insert_one({
        "id": cm_user, "email": cm_email,
        "password_hash": hashpw(pw.encode(), gensalt()).decode(),
        "name": f"CM {tag}", "role": "center_manager",
        "assigned_center_ids": [my_center], "created_at": "2026-01-01T00:00:00+00:00",
    })
    for uid, sid, cid, name in [(my_su, my_staff, my_center, "S1"), (other_su, other_staff, other_center, "S2")]:
        db.users.insert_one({
            "id": uid, "email": f"s{tag}_{sid}@x.com",
            "password_hash": hashpw(b"x", gensalt()).decode(),
            "name": name, "role": "center_staff",
            "assigned_center_ids": [cid], "created_at": "2026-01-01T00:00:00+00:00",
        })
        db.staff.insert_one({
            "id": sid, "user_id": uid, "name": name,
            "center_id": cid, "is_active": True,
            "created_at": "2026-01-01T00:00:00+00:00",
        })

    try:
        with requests.Session() as s:
            hdrs = _auth(s, cm_email, pw)

            # CM CAN mark for own-center staff
            r = s.post(f"{API_BASE}/attendance", headers=hdrs, json={
                "staff_id": my_staff, "date": "2026-08-11", "status": "present",
            })
            assert r.status_code == 200

            # CM CANNOT mark for other-center staff — 403
            r = s.post(f"{API_BASE}/attendance", headers=hdrs, json={
                "staff_id": other_staff, "date": "2026-08-11", "status": "present",
            })
            assert r.status_code == 403
    finally:
        db.attendance.delete_many({"staff_id": {"$in": [my_staff, other_staff]}})
        db.staff.delete_many({"id": {"$in": [my_staff, other_staff]}})
        db.users.delete_many({"id": {"$in": [cm_user, my_su, other_su]}})
        db.centers.delete_many({"id": {"$in": [my_center, other_center]}})
