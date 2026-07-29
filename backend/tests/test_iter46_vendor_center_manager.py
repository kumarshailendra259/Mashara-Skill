"""Iter-46: Center Manager can create/manage Vendors scoped to their centers.

Covers:
 - POST /api/vendors as center_manager (valid / empty / partial-out-of-scope)
 - POST as center_manager with no assigned centers -> 403
 - POST as center_staff -> 403
 - PUT scoped/global/out-of-scope/mixed
 - PUT that would leave no in-scope center -> 400
 - DELETE stays admin-only
 - GET /api/vendors filtering and GET by id
 - HQ regression + legacy global vendor visibility
"""
import os
import uuid
import time
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@finance.app"
ADMIN_PWD = "Admin@123"


def _login(session, email, pwd):
    r = session.post(f"{API}/auth/login", json={"email": email, "password": pwd})
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
    return r


@pytest.fixture(scope="module")
def admin_sess():
    s = requests.Session()
    _login(s, ADMIN_EMAIL, ADMIN_PWD)
    return s


@pytest.fixture(scope="module")
def centers(admin_sess):
    r = admin_sess.get(f"{API}/entities/center")
    assert r.status_code == 200, r.text
    lst = r.json()
    assert len(lst) >= 3, f"Need >=3 centers, got {len(lst)}"
    return lst


def _mk_user(admin_sess, role, assigned_center_ids=None, assigned_partner_id=None):
    email = f"test_iter46_{role}_{uuid.uuid4().hex[:8]}@x.com"
    pwd = "Test@12345"
    # Register (self-register becomes viewer if role=admin, but any other role is honored)
    r = requests.post(f"{API}/auth/register", json={
        "email": email, "password": pwd, "name": f"IT46 {role}", "role": role,
    })
    assert r.status_code == 200, r.text
    uid = r.json()["id"]
    upd = {"role": role}
    if assigned_center_ids is not None:
        upd["assigned_center_ids"] = assigned_center_ids
    if assigned_partner_id is not None:
        upd["assigned_partner_id"] = assigned_partner_id
    r = admin_sess.patch(f"{API}/auth/users/{uid}", json=upd)
    assert r.status_code == 200, r.text
    sess = requests.Session()
    _login(sess, email, pwd)
    # confirm role/assignment
    me = sess.get(f"{API}/auth/me").json()
    assert me["role"] == role
    return {"session": sess, "id": uid, "email": email, "assigned_center_ids": me.get("assigned_center_ids") or []}


@pytest.fixture(scope="module")
def cm_user(admin_sess, centers):
    # center manager with 2 centers
    return _mk_user(admin_sess, "center_manager", [centers[0]["id"], centers[1]["id"]])


@pytest.fixture(scope="module")
def cm_user_no_centers(admin_sess):
    return _mk_user(admin_sess, "center_manager", [])


@pytest.fixture(scope="module")
def cs_user(admin_sess, centers):
    return _mk_user(admin_sess, "center_staff", [centers[0]["id"]])


# ---------------- POST /vendors as center_manager ----------------

class TestVendorCreateAsCM:
    def test_create_valid_scoped(self, cm_user, centers):
        body = {"name": f"TEST_CM_Vendor_{uuid.uuid4().hex[:6]}",
                "center_ids": [centers[0]["id"]]}
        r = cm_user["session"].post(f"{API}/vendors", json=body)
        assert r.status_code == 201, r.text
        v = r.json()
        assert v["name"] == body["name"]
        assert set(v["center_ids"]) == {centers[0]["id"]}
        assert "id" in v
        # Persistence check via GET
        g = cm_user["session"].get(f"{API}/vendors/{v['id']}")
        assert g.status_code == 200
        assert set(g.json()["center_ids"]) == {centers[0]["id"]}

    def test_create_empty_center_ids_auto_fills(self, cm_user):
        body = {"name": f"TEST_CM_Auto_{uuid.uuid4().hex[:6]}", "center_ids": []}
        r = cm_user["session"].post(f"{API}/vendors", json=body)
        assert r.status_code == 201, r.text
        v = r.json()
        assert set(v["center_ids"]) == set(cm_user["assigned_center_ids"])

    def test_create_strips_out_of_scope(self, cm_user, centers):
        # Include one owned + one NOT owned
        out_of_scope = centers[2]["id"]  # cm owns [0] and [1]
        body = {
            "name": f"TEST_CM_Strip_{uuid.uuid4().hex[:6]}",
            "center_ids": [centers[0]["id"], out_of_scope],
        }
        r = cm_user["session"].post(f"{API}/vendors", json=body)
        assert r.status_code == 201, r.text
        v = r.json()
        assert out_of_scope not in v["center_ids"]
        assert centers[0]["id"] in v["center_ids"]

    def test_create_cm_with_no_centers(self, cm_user_no_centers):
        body = {"name": "TEST_CM_NoCenters"}
        r = cm_user_no_centers["session"].post(f"{API}/vendors", json=body)
        assert r.status_code == 403
        assert "no centers assigned" in r.text.lower()

    def test_create_as_center_staff_forbidden(self, cs_user):
        r = cs_user["session"].post(f"{API}/vendors", json={"name": "TEST_CS_Should_Fail"})
        assert r.status_code == 403


# ---------------- PUT /vendors/{vid} as center_manager ----------------

class TestVendorUpdateAsCM:
    def test_put_own_scoped(self, cm_user, centers):
        # create scoped vendor as CM
        r = cm_user["session"].post(f"{API}/vendors", json={
            "name": f"TEST_CM_Put_{uuid.uuid4().hex[:6]}", "center_ids": [centers[0]["id"]]})
        vid = r.json()["id"]
        r = cm_user["session"].put(f"{API}/vendors/{vid}", json={
            "name": "TEST_CM_Put_Renamed", "center_ids": [centers[1]["id"]]})
        assert r.status_code == 200, r.text
        v = r.json()
        assert v["name"] == "TEST_CM_Put_Renamed"
        assert centers[1]["id"] in v["center_ids"]

    def test_put_hq_only_vendor_forbidden(self, admin_sess, cm_user):
        r = admin_sess.post(f"{API}/vendors", json={"name": f"TEST_HQ_{uuid.uuid4().hex[:6]}", "center_ids": []})
        vid = r.json()["id"]
        r = cm_user["session"].put(f"{API}/vendors/{vid}", json={"name": "TEST_HQ_shouldfail"})
        assert r.status_code == 403

    def test_put_out_of_scope_forbidden(self, admin_sess, cm_user, centers):
        # vendor scoped to a center CM doesn't own
        r = admin_sess.post(f"{API}/vendors", json={
            "name": f"TEST_OOS_{uuid.uuid4().hex[:6]}", "center_ids": [centers[2]["id"]]})
        vid = r.json()["id"]
        r = cm_user["session"].put(f"{API}/vendors/{vid}", json={"name": "should_fail"})
        assert r.status_code == 403

    def test_put_mixed_preserves_out_of_scope(self, admin_sess, cm_user, centers):
        # vendor has centers [0] (owned) + [2] (not owned)
        r = admin_sess.post(f"{API}/vendors", json={
            "name": f"TEST_Mix_{uuid.uuid4().hex[:6]}",
            "center_ids": [centers[0]["id"], centers[2]["id"]],
        })
        vid = r.json()["id"]
        # CM submits only its own center [0], but out-of-scope [2] must be preserved
        r = cm_user["session"].put(f"{API}/vendors/{vid}", json={
            "name": "TEST_Mix_Updated", "center_ids": [centers[0]["id"]]})
        assert r.status_code == 200, r.text
        v = r.json()
        assert centers[2]["id"] in v["center_ids"], "Out-of-scope center must be preserved"
        assert centers[0]["id"] in v["center_ids"]
        # verify via GET as admin
        g = admin_sess.get(f"{API}/vendors/{vid}").json()
        assert set(g["center_ids"]) == {centers[0]["id"], centers[2]["id"]}

    def test_put_removing_all_own_centers_fails(self, cm_user, centers):
        r = cm_user["session"].post(f"{API}/vendors", json={
            "name": f"TEST_RemoveAll_{uuid.uuid4().hex[:6]}", "center_ids": [centers[0]["id"]]})
        vid = r.json()["id"]
        # Submit only out-of-scope center — after filtering, nothing owned remains
        r = cm_user["session"].put(f"{API}/vendors/{vid}", json={
            "name": "x", "center_ids": [centers[2]["id"]]})
        assert r.status_code == 400
        assert "at least one" in r.text.lower()


# ---------------- DELETE stays admin-only ----------------

class TestVendorDelete:
    def test_delete_cm_forbidden(self, cm_user, centers):
        r = cm_user["session"].post(f"{API}/vendors", json={
            "name": f"TEST_Del_{uuid.uuid4().hex[:6]}", "center_ids": [centers[0]["id"]]})
        vid = r.json()["id"]
        r = cm_user["session"].delete(f"{API}/vendors/{vid}")
        assert r.status_code == 403

    def test_delete_admin_ok(self, admin_sess):
        r = admin_sess.post(f"{API}/vendors", json={"name": f"TEST_DelAdmin_{uuid.uuid4().hex[:6]}"})
        vid = r.json()["id"]
        r = admin_sess.delete(f"{API}/vendors/{vid}")
        assert r.status_code in (200, 204)
        g = admin_sess.get(f"{API}/vendors/{vid}")
        assert g.status_code == 404


# ---------------- GET listing scope ----------------

class TestVendorListing:
    def test_cm_list_scope(self, admin_sess, cm_user, centers):
        # create: (a) global legacy (empty), (b) scoped to CM center [0], (c) scoped to unowned [2]
        a = admin_sess.post(f"{API}/vendors", json={"name": f"TEST_List_Global_{uuid.uuid4().hex[:6]}", "center_ids": []}).json()
        b = admin_sess.post(f"{API}/vendors", json={"name": f"TEST_List_Own_{uuid.uuid4().hex[:6]}", "center_ids": [centers[1]["id"]]}).json()
        c = admin_sess.post(f"{API}/vendors", json={"name": f"TEST_List_Other_{uuid.uuid4().hex[:6]}", "center_ids": [centers[2]["id"]]}).json()

        r = cm_user["session"].get(f"{API}/vendors")
        assert r.status_code == 200
        ids = {v["id"] for v in r.json()}
        assert a["id"] in ids, "Legacy global should be visible to CM"
        assert b["id"] in ids, "Own-scoped should be visible"
        assert c["id"] not in ids, "Out-of-scope must NOT be visible"

    def test_cm_get_out_of_scope_403(self, admin_sess, cm_user, centers):
        v = admin_sess.post(f"{API}/vendors", json={
            "name": f"TEST_Get_OOS_{uuid.uuid4().hex[:6]}", "center_ids": [centers[2]["id"]]}).json()
        r = cm_user["session"].get(f"{API}/vendors/{v['id']}")
        assert r.status_code == 403

    def test_cm_get_global_ok(self, admin_sess, cm_user):
        v = admin_sess.post(f"{API}/vendors", json={
            "name": f"TEST_Get_Global_{uuid.uuid4().hex[:6]}", "center_ids": []}).json()
        r = cm_user["session"].get(f"{API}/vendors/{v['id']}")
        assert r.status_code == 200


# ---------------- HQ regression ----------------

class TestHQRegression:
    def test_admin_create_and_center_ids_field(self, admin_sess):
        r = admin_sess.post(f"{API}/vendors", json={"name": f"TEST_HQReg_{uuid.uuid4().hex[:6]}"})
        assert r.status_code == 201
        v = r.json()
        assert "center_ids" in v
        assert v["center_ids"] == []

    def test_admin_list_and_get(self, admin_sess):
        r = admin_sess.get(f"{API}/vendors")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_legacy_global_backwards_compat(self, admin_sess, cm_user):
        # Insert a legacy vendor doc directly-ish by creating one with empty center_ids —
        # simulates old vendor created before this feature. CM should see it.
        v = admin_sess.post(f"{API}/vendors", json={"name": f"TEST_LegacyBC_{uuid.uuid4().hex[:6]}", "center_ids": []}).json()
        r = cm_user["session"].get(f"{API}/vendors")
        ids = {x["id"] for x in r.json()}
        assert v["id"] in ids


# ---------------- Cleanup ----------------

def test_cleanup_all(admin_sess):
    """Best-effort cleanup: delete anything starting with TEST_ we created."""
    r = admin_sess.get(f"{API}/vendors")
    for v in r.json():
        if (v.get("name") or "").startswith("TEST_"):
            admin_sess.delete(f"{API}/vendors/{v['id']}")
