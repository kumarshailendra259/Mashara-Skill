"""iter-30 — Partner-role approval center isolation.

Key code under test:
  - server.py `_resolve_step_user_ids` (partner / center_partner filter by center)
  - server.py `_can_partner_approve` hard center-mapping gate
  - server.py `_user_can_act_on_request` -> POST /api/approvals/act 403 path
  - notification fanout in POST /api/transactions

NOTE: admin auto-approves transactions (`_can_auto_approve`), so all `pending`
transactions in this test are created by a non-admin "manager"-role user.
"""
import os
import uuid
import asyncio
import requests
import pytest

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL")
            or "https://invest-analytics-24.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@finance.app"
ADMIN_PASSWORD = "Admin@123"
RUN = uuid.uuid4().hex[:6]


def _login(email, pwd):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pwd}, timeout=20)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return s


def _post(s, path, body, ok=(200, 201)):
    r = s.post(f"{BASE_URL}{path}", json=body, timeout=20)
    assert r.status_code in ok, f"POST {path}: {r.status_code} {r.text}"
    return r.json()


def _db_run(coro_factory):
    """Run a fresh motor client/coroutine on a fresh loop (avoids cross-loop issues)."""
    async def runner():
        from motor.motor_asyncio import AsyncIOMotorClient
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        try:
            return await coro_factory(client[os.environ["DB_NAME"]])
        finally:
            client.close()
    return asyncio.run(runner())


@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def seeded(admin):
    s = admin
    c1 = _post(s, "/api/entities/center", {"name": f"TEST_iter30_C1_{RUN}", "city": "X", "state": "Y"})["id"]
    c2 = _post(s, "/api/entities/center", {"name": f"TEST_iter30_C2_{RUN}", "city": "X", "state": "Y"})["id"]
    p_a_ent = _post(s, "/api/entities/partner", {"name": f"TEST_iter30_PA_{RUN}"})["id"]
    p_b_ent = _post(s, "/api/entities/partner", {"name": f"TEST_iter30_PB_{RUN}"})["id"]
    proj = _post(s, "/api/entities/project",
                 {"name": f"TEST_iter30_Proj_{RUN}", "project_code": f"T30{RUN[:3]}"})["id"]

    def _register(label, role="partner"):
        email = f"TEST_iter30_{label}_{RUN}@finance.app"
        pwd = "Part@1234"
        r = requests.post(f"{BASE_URL}/api/auth/register",
                          json={"email": email, "password": pwd,
                                "name": f"T30 {label} {RUN}", "role": role}, timeout=20)
        assert r.status_code in (200, 201), f"register {label}: {r.status_code} {r.text}"
        u = r.json().get("user") or r.json()
        return {"id": u["id"], "email": email, "password": pwd}

    u_a = _register("PA")
    u_b = _register("PB")
    u_empty = _register("PEMPTY")
    u_hr = _register("HR", role="hr")
    u_mgr = _register("MGR", role="manager")  # non-admin creator for `pending` txns

    def _patch(uid, body):
        r = s.patch(f"{BASE_URL}/api/auth/users/{uid}", json=body, timeout=15)
        assert r.status_code == 200, f"patch {uid}: {r.status_code} {r.text}"

    _patch(u_a["id"], {"assigned_partner_id": p_a_ent, "assigned_center_ids": [c1], "role": "partner"})
    _patch(u_b["id"], {"assigned_partner_id": p_b_ent, "assigned_center_ids": [c2], "role": "partner"})
    _patch(u_empty["id"], {"assigned_partner_id": p_a_ent, "assigned_center_ids": [], "role": "partner"})

    sess_a = _login(u_a["email"], u_a["password"])
    sess_b = _login(u_b["email"], u_b["password"])
    sess_empty = _login(u_empty["email"], u_empty["password"])
    sess_hr = _login(u_hr["email"], u_hr["password"])
    sess_mgr = _login(u_mgr["email"], u_mgr["password"])

    # transaction chain on C1: partner step
    chain_txn_c1 = _post(s, "/api/approval-chains", {
        "type": "transaction", "active": True, "center_id": c1,
        "name": f"TEST_iter30_chain_txn_{RUN}",
        "steps": [{"level": 1, "kind": "role", "value": "partner", "label": "Partner Approval"}],
    })
    # asset_purchase chain on C1: partner step
    chain_asset_c1 = _post(s, "/api/approval-chains", {
        "type": "asset_purchase", "active": True, "center_id": c1,
        "name": f"TEST_iter30_chain_asset_{RUN}",
        "steps": [{"level": 1, "kind": "role", "value": "partner", "label": "Partner"}],
    })
    # HR chain on C2 for non-partner sanity
    chain_hr_c2 = _post(s, "/api/approval-chains", {
        "type": "transaction", "active": True, "center_id": c2,
        "name": f"TEST_iter30_chain_hr_{RUN}",
        "steps": [{"level": 1, "kind": "role", "value": "hr", "label": "HR"}],
    })

    data = {
        "c1": c1, "c2": c2, "p_a_ent": p_a_ent, "p_b_ent": p_b_ent, "proj": proj,
        "u_a": u_a, "u_b": u_b, "u_empty": u_empty, "u_hr": u_hr, "u_mgr": u_mgr,
        "sess_a": sess_a, "sess_b": sess_b, "sess_empty": sess_empty,
        "sess_hr": sess_hr, "sess_mgr": sess_mgr,
        "chain_txn_c1_id": chain_txn_c1["id"],
        "chain_asset_c1_id": chain_asset_c1["id"],
        "chain_hr_c2_id": chain_hr_c2["id"],
    }
    yield data

    # ---- teardown ----
    for cid in (chain_txn_c1["id"], chain_asset_c1["id"], chain_hr_c2["id"]):
        try:
            s.delete(f"{BASE_URL}/api/approval-chains/{cid}", timeout=10)
        except Exception:
            pass

    async def _cleanup(db):
        await db.users.delete_many({"email": {"$regex": f"TEST_iter30_.*_{RUN}@"}})
        await db.centers.delete_many({"name": {"$regex": f"TEST_iter30_C._{RUN}"}})
        await db.partners.delete_many({"name": {"$regex": f"TEST_iter30_P._{RUN}"}})
        await db.projects.delete_many({"name": {"$regex": f"TEST_iter30_Proj_{RUN}"}})
        await db.transactions.delete_many({"description": {"$regex": "TEST_iter30_"}})
        await db.asset_purchase_requests.delete_many({"name": {"$regex": "TEST_iter30_"}})
        await db.notifications.delete_many({"text": {"$regex": "TEST_iter30_"}})
    _db_run(_cleanup)


def _mk_pending_txn(seeded, label, center_id=None, partner_id=None, amount=1000):
    """Create a pending transaction via the MANAGER session (no auto-approve)."""
    body = {
        "amount": amount, "type": "investment", "date": "2025-11-15",
        "description": f"TEST_iter30_{label}_{RUN}",
        "center_id": center_id if center_id is not None else seeded["c1"],
        "partner_id": partner_id if partner_id is not None else seeded["p_a_ent"],
        "project_id": seeded["proj"],
    }
    r = seeded["sess_mgr"].post(f"{BASE_URL}/api/transactions", json=body, timeout=15)
    assert r.status_code in (200, 201), f"mk_txn {label}: {r.status_code} {r.text}"
    t = r.json()
    assert t.get("status") == "pending", f"expected pending, got {t.get('status')} for {label}"
    return t


# =================================================================
class TestResolveStepIsolation:
    def test_pending_txn_visible_to_PA_only(self, seeded):
        t = _mk_pending_txn(seeded, "PEND")
        ids_a = [x["request_id"] for x in seeded["sess_a"].get(
            f"{BASE_URL}/api/approvals/pending", timeout=20).json()
            if x["request_type"] == "transaction"]
        assert t["id"] in ids_a, f"PA must see C1 txn, ids={ids_a[:5]}…"
        ids_b = [x["request_id"] for x in seeded["sess_b"].get(
            f"{BASE_URL}/api/approvals/pending", timeout=20).json()
            if x["request_type"] == "transaction"]
        assert t["id"] not in ids_b, f"PB MUST NOT see C1 txn"

    def test_PB_act_on_C1_txn_403(self, seeded):
        t = _mk_pending_txn(seeded, "ACTPB")
        r = seeded["sess_b"].post(f"{BASE_URL}/api/approvals/act",
                                  json={"request_type": "transaction", "request_id": t["id"],
                                        "action": "approve", "remarks": "should not pass"}, timeout=15)
        assert r.status_code == 403, f"expected 403 got {r.status_code} {r.text}"

    def test_PA_can_approve_C1_txn(self, seeded):
        t = _mk_pending_txn(seeded, "ACTPA")
        r = seeded["sess_a"].post(f"{BASE_URL}/api/approvals/act",
                                  json={"request_type": "transaction", "request_id": t["id"],
                                        "action": "approve", "remarks": "approved by PA"}, timeout=15)
        assert r.status_code == 200, f"PA should approve: {r.status_code} {r.text}"


class TestCenterPartnerRole:
    """kind='role' value='center_partner' must also center-filter."""
    def test_center_partner_value_filters_by_center(self, admin, seeded):
        # swap chain to center_partner
        upd = {"type": "transaction", "active": True, "center_id": seeded["c1"],
               "name": f"TEST_iter30_chain_txn_{RUN}",
               "steps": [{"level": 1, "kind": "role", "value": "center_partner", "label": "CP"}]}
        r = admin.put(f"{BASE_URL}/api/approval-chains/{seeded['chain_txn_c1_id']}", json=upd, timeout=15)
        assert r.status_code == 200, r.text
        admin.patch(f"{BASE_URL}/api/auth/users/{seeded['u_a']['id']}", json={"role": "center_partner"}, timeout=15)
        admin.patch(f"{BASE_URL}/api/auth/users/{seeded['u_b']['id']}", json={"role": "center_partner"}, timeout=15)
        sess_a = _login(seeded["u_a"]["email"], seeded["u_a"]["password"])
        sess_b = _login(seeded["u_b"]["email"], seeded["u_b"]["password"])
        try:
            t = _mk_pending_txn(seeded, "CP")
            ids_a = [x["request_id"] for x in sess_a.get(f"{BASE_URL}/api/approvals/pending", timeout=20).json()
                     if x["request_type"] == "transaction"]
            ids_b = [x["request_id"] for x in sess_b.get(f"{BASE_URL}/api/approvals/pending", timeout=20).json()
                     if x["request_type"] == "transaction"]
            assert t["id"] in ids_a, "center_partner@C1 should see"
            assert t["id"] not in ids_b, "center_partner@C2 must NOT see"
        finally:
            # restore
            admin.patch(f"{BASE_URL}/api/auth/users/{seeded['u_a']['id']}", json={"role": "partner"}, timeout=15)
            admin.patch(f"{BASE_URL}/api/auth/users/{seeded['u_b']['id']}", json={"role": "partner"}, timeout=15)
            rest = {"type": "transaction", "active": True, "center_id": seeded["c1"],
                    "name": f"TEST_iter30_chain_txn_{RUN}",
                    "steps": [{"level": 1, "kind": "role", "value": "partner", "label": "Partner"}]}
            admin.put(f"{BASE_URL}/api/approval-chains/{seeded['chain_txn_c1_id']}", json=rest, timeout=15)


class TestCrossApproveGate:
    """Hard-gate: PB with past C1 history STILL blocked because not center-mapped."""
    def test_PB_with_fake_C1_history_still_blocked(self, seeded):
        fake_id = str(uuid.uuid4())

        async def _ins(db):
            await db.transactions.insert_one({
                "id": fake_id, "type": "investment", "amount": 999, "date": "2025-01-01",
                "description": f"TEST_iter30_FAKEHIST_{RUN}",
                "center_id": seeded["c1"], "partner_id": seeded["p_b_ent"],
                "project_id": seeded["proj"], "status": "approved",
                "created_by": seeded["u_b"]["id"],
                "created_at": "2025-01-01T00:00:00+00:00",
            })
        _db_run(_ins)

        t = _mk_pending_txn(seeded, "GATE")
        ids_b = [x["request_id"] for x in seeded["sess_b"].get(
            f"{BASE_URL}/api/approvals/pending", timeout=20).json()
            if x["request_type"] == "transaction"]
        assert t["id"] not in ids_b, "Hard gate: PB must not see C1 txn even with history"
        r = seeded["sess_b"].post(f"{BASE_URL}/api/approvals/act",
                                  json={"request_type": "transaction", "request_id": t["id"],
                                        "action": "approve", "remarks": "should be blocked"}, timeout=15)
        assert r.status_code == 403, f"expected 403 (hard gate), got {r.status_code} {r.text}"


class TestNotificationFanout:
    def test_only_center_mapped_partners_notified(self, seeded):
        t = _mk_pending_txn(seeded, "NOTIF")

        async def _query(db):
            return await db.notifications.find({"ref_id": t["id"]}, {"_id": 0}).to_list(200)
        notifs = _db_run(_query)
        target_ids = {n.get("user_id") for n in notifs}
        # PB must never appear
        assert seeded["u_b"]["id"] not in target_ids, f"PB notified! target_ids={target_ids}"
        # Empty-center partner must not appear either
        assert seeded["u_empty"]["id"] not in target_ids, "Empty-center partner notified!"

        # Any partner who DID get notified must be mapped to C1
        async def _check(db):
            partner_uids = await db.users.find(
                {"role": "partner", "id": {"$in": list(target_ids)}},
                {"_id": 0, "id": 1, "assigned_center_ids": 1}).to_list(200)
            for u in partner_uids:
                assert seeded["c1"] in (u.get("assigned_center_ids") or []), \
                    f"partner {u['id']} got notified but not mapped to C1"
        _db_run(_check)


class TestAssetPurchaseIsolation:
    def test_asset_purchase_isolation(self, admin, seeded):
        body = {"name": f"TEST_iter30_ASSET_{RUN}", "category": "computer",
                "est_amount": 5000, "quantity": 1, "reason": "testing iter30",
                "center_id": seeded["c1"]}
        r = admin.post(f"{BASE_URL}/api/asset-purchase-requests", json=body, timeout=15)
        assert r.status_code in (200, 201), r.text
        req = r.json()
        assert req.get("current_level") == 1, f"asset request should be pending, got {req}"
        ids_a = [x["request_id"] for x in seeded["sess_a"].get(
            f"{BASE_URL}/api/approvals/pending", timeout=20).json()
            if x["request_type"] == "asset_purchase"]
        ids_b = [x["request_id"] for x in seeded["sess_b"].get(
            f"{BASE_URL}/api/approvals/pending", timeout=20).json()
            if x["request_type"] == "asset_purchase"]
        assert req["id"] in ids_a, "PA should see C1 asset_purchase request"
        assert req["id"] not in ids_b, "PB must NOT see C1 asset_purchase request"


class TestEmptyAssignedCenters:
    def test_empty_partner_sees_nothing_iter30_centered(self, seeded):
        _mk_pending_txn(seeded, "FOR_EMPTY")
        r = seeded["sess_empty"].get(f"{BASE_URL}/api/approvals/pending", timeout=20)
        assert r.status_code == 200
        rows = [x for x in r.json()
                if (x.get("summary") or {}).get("description", "").startswith(f"TEST_iter30_")
                and x["request_type"] == "transaction" and x.get("via") != "partner_cross"]
        assert rows == [], f"Empty-center partner sees iter30 chain rows: {rows}"


class TestNoCenterFallback:
    """Edge: request without center_id falls back to all partner-role users."""
    def test_uncentered_txn_visible_to_both_partners(self, admin, seeded):
        # Temporary GLOBAL transaction chain
        g = _post(admin, "/api/approval-chains", {
            "type": "transaction", "active": True, "center_id": None,
            "name": f"TEST_iter30_chain_global_{RUN}",
            "steps": [{"level": 1, "kind": "role", "value": "partner", "label": "Global Partner"}],
        })
        try:
            body = {
                "amount": 77, "type": "investment", "date": "2025-11-15",
                "description": f"TEST_iter30_NOCENTER_{RUN}",
                "partner_id": seeded["p_a_ent"], "project_id": seeded["proj"],
            }
            r = seeded["sess_mgr"].post(f"{BASE_URL}/api/transactions", json=body, timeout=15)
            if r.status_code not in (200, 201):
                pytest.skip(f"txn without center_id not allowed: {r.status_code} {r.text}")
            t = r.json()
            if t.get("status") != "pending":
                pytest.skip(f"txn not pending: {t.get('status')}")
            ids_a = [x["request_id"] for x in seeded["sess_a"].get(
                f"{BASE_URL}/api/approvals/pending", timeout=20).json()
                if x["request_type"] == "transaction"]
            ids_b = [x["request_id"] for x in seeded["sess_b"].get(
                f"{BASE_URL}/api/approvals/pending", timeout=20).json()
                if x["request_type"] == "transaction"]
            assert t["id"] in ids_a, "PA should see uncentered txn (no filter)"
            assert t["id"] in ids_b, "PB should ALSO see uncentered txn (no filter)"
        finally:
            admin.delete(f"{BASE_URL}/api/approval-chains/{g['id']}", timeout=10)


class TestNonPartnerRolesGlobal:
    """HR role step on C2 -> HR sees regardless of center mapping (HR is global)."""
    def test_hr_sees_C2_txn_with_no_assigned_centers(self, seeded):
        t = _mk_pending_txn(seeded, "HRSCAN",
                             center_id=seeded["c2"], partner_id=seeded["p_b_ent"])
        ids_hr = [x["request_id"] for x in seeded["sess_hr"].get(
            f"{BASE_URL}/api/approvals/pending", timeout=20).json()
            if x["request_type"] == "transaction"]
        assert t["id"] in ids_hr, "HR (global role) must see regardless of assigned_center_ids"
