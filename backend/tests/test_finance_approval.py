"""Iteration-3: role-based scoping + approval workflow tests."""
import os, uuid, pytest, requests

def _read_url():
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL"):
                    return line.split("=",1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    return ""

BASE_URL = (os.environ.get("FINANCE_TEST_BASE_URL") or _read_url()).rstrip("/")
ADMIN_EMAIL = "admin@finance.app"
ADMIN_PASSWORD = "Admin@123"

def _s():
    s = requests.Session(); s.headers.update({"Content-Type":"application/json"}); return s

@pytest.fixture(scope="module")
def admin():
    s = _s()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email":ADMIN_EMAIL,"password":ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return s

@pytest.fixture(scope="module")
def entities(admin):
    out = {}
    for et in ("company","partner","center","project"):
        r = admin.post(f"{BASE_URL}/api/entities/{et}",
                       json={"name": f"TEST_i3_{et}_{uuid.uuid4().hex[:6]}"})
        assert r.status_code == 200, r.text
        out[et] = r.json()["id"]
    # second center for scope test
    r = admin.post(f"{BASE_URL}/api/entities/center",
                   json={"name": f"TEST_i3_center2_{uuid.uuid4().hex[:6]}"})
    out["center2"] = r.json()["id"]
    # second partner
    r = admin.post(f"{BASE_URL}/api/entities/partner",
                   json={"name": f"TEST_i3_partner2_{uuid.uuid4().hex[:6]}"})
    out["partner2"] = r.json()["id"]
    return out

def _register_and_patch(admin, role, **assign):
    email = f"TEST_{role}_{uuid.uuid4().hex[:8]}@x.com"
    s = _s()
    r = s.post(f"{BASE_URL}/api/auth/register",
               json={"email":email,"password":"Pass1234","name":role,"role":"admin"})  # self-register admin gets downgraded
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["role"] == "viewer", f"self-register admin not downgraded: {body['role']}"
    uid = body["id"]
    payload = {"role": role}
    payload.update(assign)
    r2 = admin.patch(f"{BASE_URL}/api/auth/users/{uid}", json=payload)
    assert r2.status_code == 200, r2.text
    # refresh /me on the user session
    r3 = s.get(f"{BASE_URL}/api/auth/me")
    assert r3.status_code == 200
    me = r3.json()
    assert me["role"] == role
    s._uid = uid  # type: ignore
    s._me = me   # type: ignore
    return s

@pytest.fixture(scope="module")
def cm(admin, entities):
    return _register_and_patch(admin, "center_manager", assigned_center_ids=[entities["center"]])

@pytest.fixture(scope="module")
def partner_user(admin, entities):
    return _register_and_patch(admin, "partner", assigned_partner_id=entities["partner"])

@pytest.fixture(scope="module")
def accountant(admin):
    return _register_and_patch(admin, "accountant")

@pytest.fixture(scope="module")
def manager(admin):
    return _register_and_patch(admin, "manager")

@pytest.fixture(scope="module")
def viewer():
    s = _s()
    email = f"TEST_viewer_{uuid.uuid4().hex[:8]}@x.com"
    r = s.post(f"{BASE_URL}/api/auth/register",
               json={"email":email,"password":"Pass1234","name":"V","role":"viewer"})
    assert r.status_code == 200
    return s


# ----- Self-register downgrade & /me fields -----
class TestRegisterAndMe:
    def test_register_admin_downgrades_to_viewer(self):
        s = _s()
        email = f"TEST_dg_{uuid.uuid4().hex[:8]}@x.com"
        r = s.post(f"{BASE_URL}/api/auth/register",
                   json={"email":email,"password":"Pass1234","name":"X","role":"admin"})
        assert r.status_code == 200
        assert r.json()["role"] == "viewer"

    def test_me_has_scope_fields(self, cm, entities):
        r = cm.get(f"{BASE_URL}/api/auth/me")
        body = r.json()
        assert "assigned_center_ids" in body
        assert "assigned_partner_id" in body
        assert entities["center"] in body["assigned_center_ids"]

    def test_non_admin_cannot_patch_user(self, cm):
        r = cm.patch(f"{BASE_URL}/api/auth/users/{cm._uid}", json={"role":"admin"})
        assert r.status_code == 403


# ----- Approval workflow on POST -----
class TestPostStatus:
    def test_admin_post_auto_approved(self, admin, entities):
        r = admin.post(f"{BASE_URL}/api/transactions", json={
            "type":"income","amount":100,"date":"2026-04-01","description":"TEST_admin_post",
            "company_id":entities["company"],"center_id":entities["center"],
            "partner_id":entities["partner"],"project_id":entities["project"]})
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["status"] == "approved"
        assert b["approved_by"]
        assert b["approved_at"]

    def test_cm_post_pending(self, cm, entities):
        r = cm.post(f"{BASE_URL}/api/transactions", json={
            "type":"income","amount":200,"date":"2026-04-02","description":"TEST_cm_post",
            "center_id":entities["center"]})
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["status"] == "pending"
        assert b.get("approved_by") in (None, "")

    def test_partner_post_pending(self, partner_user, entities):
        r = partner_user.post(f"{BASE_URL}/api/transactions", json={
            "type":"expense","amount":50,"date":"2026-04-03","description":"TEST_p_post",
            "partner_id":entities["partner"]})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "pending"

    def test_manager_post_pending(self, manager, entities):
        r = manager.post(f"{BASE_URL}/api/transactions", json={
            "type":"income","amount":75,"date":"2026-04-04","description":"TEST_m_post",
            "center_id":entities["center"]})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "pending"

    def test_accountant_post_pending(self, accountant, entities):
        r = accountant.post(f"{BASE_URL}/api/transactions", json={
            "type":"income","amount":60,"date":"2026-04-05","description":"TEST_a_post"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "pending"

    def test_viewer_post_forbidden(self, viewer):
        r = viewer.post(f"{BASE_URL}/api/transactions",
                        json={"type":"income","amount":10,"date":"2026-04-06"})
        assert r.status_code == 403


# ----- Approve / Reject endpoints -----
class TestApproveReject:
    def test_admin_approves_pending(self, admin, cm, entities):
        r = cm.post(f"{BASE_URL}/api/transactions", json={
            "type":"income","amount":111,"date":"2026-04-10","description":"TEST_to_approve",
            "center_id":entities["center"]})
        tid = r.json()["id"]
        assert r.json()["status"] == "pending"
        r2 = admin.post(f"{BASE_URL}/api/transactions/{tid}/approve")
        assert r2.status_code == 200, r2.text
        assert r2.json()["status"] == "approved"
        assert r2.json()["approved_by"]

    def test_non_admin_cannot_approve(self, admin, cm, manager, entities):
        r = cm.post(f"{BASE_URL}/api/transactions", json={
            "type":"income","amount":12,"date":"2026-04-11","description":"TEST_na_appr",
            "center_id":entities["center"]})
        tid = r.json()["id"]
        r2 = manager.post(f"{BASE_URL}/api/transactions/{tid}/approve")
        assert r2.status_code == 403

    def test_admin_rejects_with_reason(self, admin, cm, entities):
        r = cm.post(f"{BASE_URL}/api/transactions", json={
            "type":"income","amount":13,"date":"2026-04-12","description":"TEST_rej",
            "center_id":entities["center"]})
        tid = r.json()["id"]
        r2 = admin.post(f"{BASE_URL}/api/transactions/{tid}/reject",
                        json={"reason":"bad data"})
        assert r2.status_code == 200, r2.text
        b = r2.json()
        assert b["status"] == "rejected"
        assert b.get("rejected_reason") == "bad data"


# ----- Scoping on GET -----
class TestScoping:
    def test_cm_sees_only_assigned_centers(self, admin, cm, entities):
        # admin creates txn in center2 (not assigned to cm)
        admin.post(f"{BASE_URL}/api/transactions", json={
            "type":"income","amount":999,"date":"2026-04-20",
            "description":"TEST_other_center",
            "center_id":entities["center2"]})
        r = cm.get(f"{BASE_URL}/api/transactions")
        assert r.status_code == 200
        for t in r.json():
            assert t.get("center_id") == entities["center"], f"leak: {t}"

    def test_partner_sees_only_assigned_partner(self, admin, partner_user, entities):
        admin.post(f"{BASE_URL}/api/transactions", json={
            "type":"expense","amount":5,"date":"2026-04-21",
            "description":"TEST_other_partner",
            "partner_id":entities["partner2"]})
        r = partner_user.get(f"{BASE_URL}/api/transactions")
        assert r.status_code == 200
        for t in r.json():
            assert t.get("partner_id") == entities["partner"], f"leak: {t}"

    def test_accountant_sees_all(self, accountant):
        r = accountant.get(f"{BASE_URL}/api/transactions")
        assert r.status_code == 200
        # should be non-empty given prior tests
        assert isinstance(r.json(), list) and len(r.json()) > 0

    def test_viewer_sees_only_own(self, admin, viewer):
        # viewer can't post; should see only own (likely empty)
        r = viewer.get(f"{BASE_URL}/api/transactions")
        assert r.status_code == 200
        me = viewer.get(f"{BASE_URL}/api/auth/me").json()
        for t in r.json():
            assert t.get("created_by") == me["id"]

    def test_status_filter_pending(self, admin):
        r = admin.get(f"{BASE_URL}/api/transactions", params={"status":"pending"})
        assert r.status_code == 200
        for t in r.json():
            assert t["status"] == "pending"


# ----- Edit semantics -----
class TestEditSemantics:
    def test_non_admin_edit_approved_resets_to_pending(self, admin, cm, entities):
        # admin creates approved txn but assigned to cm's center & created_by cm? need cm to be able to edit.
        # Strategy: cm posts (pending) → admin approves → cm edits → should become pending.
        r = cm.post(f"{BASE_URL}/api/transactions", json={
            "type":"income","amount":222,"date":"2026-05-01","description":"TEST_edit_reset",
            "center_id":entities["center"]})
        tid = r.json()["id"]
        r2 = admin.post(f"{BASE_URL}/api/transactions/{tid}/approve")
        assert r2.json()["status"] == "approved"
        # cm edits
        payload = {"type":"income","amount":333,"date":"2026-05-01",
                   "description":"TEST_edit_reset_upd","center_id":entities["center"]}
        r3 = cm.put(f"{BASE_URL}/api/transactions/{tid}", json=payload)
        assert r3.status_code == 200, r3.text
        assert r3.json()["status"] == "pending"
        assert r3.json()["amount"] == 333

    def test_admin_edit_keeps_approved(self, admin, entities):
        r = admin.post(f"{BASE_URL}/api/transactions", json={
            "type":"income","amount":50,"date":"2026-05-02","description":"TEST_admin_edit",
            "center_id":entities["center"]})
        tid = r.json()["id"]
        assert r.json()["status"] == "approved"
        payload = {"type":"income","amount":60,"date":"2026-05-02",
                   "description":"TEST_admin_edit_upd","center_id":entities["center"]}
        r2 = admin.put(f"{BASE_URL}/api/transactions/{tid}", json=payload)
        assert r2.status_code == 200
        assert r2.json()["status"] == "approved"


# ----- Dashboard summary status filter -----
class TestDashboardStatus:
    def test_default_counts_only_approved(self, admin):
        r1 = admin.get(f"{BASE_URL}/api/dashboard/summary")
        r2 = admin.get(f"{BASE_URL}/api/dashboard/summary", params={"include_pending":"true"})
        assert r1.status_code == 200 and r2.status_code == 200
        a = r1.json()["totals"]; b = r2.json()["totals"]
        # include_pending should be >= default in income+expense+investment
        assert (b["income"] + b["expense"] + b["investment"]) >= \
               (a["income"] + a["expense"] + a["investment"])
