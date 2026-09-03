"""Phase 72: Company Centers + Multi-Company Users - backend regression tests."""
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')

ADMIN = {"email": "admin@finance.app", "password": "Admin@123"}
HR = {"email": "hr@finance.app", "password": "Hr@12345"}


def _login(creds):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed {r.status_code}: {r.text}"
    csrf = s.cookies.get("csrf_token")
    assert csrf, "no csrf cookie"
    s.headers.update({"X-CSRF-Token": csrf, "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_client():
    return _login(ADMIN)


@pytest.fixture(scope="module")
def hr_client():
    return _login(HR)


# ---------- 1. Super admin lists companies + centers ----------
def test_super_admin_my_companies(admin_client):
    r = admin_client.get(f"{BASE_URL}/api/auth/my-companies")
    assert r.status_code == 200
    d = r.json()
    assert d.get("is_super_admin") is True
    assert isinstance(d.get("companies"), list) and len(d["companies"]) >= 1


def test_super_admin_lists_centers_with_codes(admin_client):
    # Pick first company
    comps = admin_client.get(f"{BASE_URL}/api/auth/my-companies").json()["companies"]
    cid = comps[0]["id"]
    r = admin_client.get(f"{BASE_URL}/api/centers", params={"company_id": cid})
    assert r.status_code == 200
    centers = r.json()
    assert isinstance(centers, list)
    if centers:
        c = centers[0]
        assert "center_code" in c and c["center_code"]
        # code format like PREFIX-XXXX
        assert "-" in c["center_code"]


# ---------- 2. Create a center (auto-code) ----------
def test_super_admin_creates_center_auto_code(admin_client):
    comps = admin_client.get(f"{BASE_URL}/api/auth/my-companies").json()["companies"]
    # Find 3YJW4A if present, else first
    target = next((c for c in comps if c.get("company_code") == "3YJW4A"), comps[0])
    cid = target["id"]
    payload = {"company_id": cid, "name": "TEST_Center_Phase72", "city": "Testville"}
    r = admin_client.post(f"{BASE_URL}/api/centers", json=payload)
    assert r.status_code in (200, 201), r.text
    d = r.json()
    assert d.get("center_code") and "-" in d["center_code"]
    assert d["name"] == "TEST_Center_Phase72"
    # cleanup
    admin_client.patch(f"{BASE_URL}/api/centers/{d['id']}", json={"center_status": "inactive"})


# ---------- 3. Bulk set-access ----------
def test_super_admin_set_access_bulk(admin_client):
    comps = admin_client.get(f"{BASE_URL}/api/auth/my-companies").json()["companies"]
    target = next((c for c in comps if c.get("company_code") == "3YJW4A"), comps[0])
    cid = target["id"]
    centers = admin_client.get(f"{BASE_URL}/api/centers", params={"company_id": cid}).json()
    if len(centers) < 2:
        pytest.skip("not enough centers to bulk toggle")
    enabled_ids = [centers[0]["id"]]
    r = admin_client.post(f"{BASE_URL}/api/centers/set-access",
                          json={"company_id": cid, "enabled_center_ids": enabled_ids, "access_type": "free"})
    assert r.status_code == 200
    d = r.json()
    assert d.get("enabled_count") == 1
    assert d.get("disabled_count") >= 1
    # Verify persistence
    after = admin_client.get(f"{BASE_URL}/api/centers", params={"company_id": cid}).json()
    by_id = {c["id"]: c for c in after}
    assert by_id[centers[0]["id"]]["access_status"] == "enabled"
    # Re-enable all for cleanliness (best-effort)
    all_ids = [c["id"] for c in after]
    admin_client.post(f"{BASE_URL}/api/centers/set-access",
                      json={"company_id": cid, "enabled_center_ids": all_ids, "access_type": "free"})


# ---------- 4. Multi-company user login ----------
def test_hr_my_companies_returns_two(hr_client):
    r = hr_client.get(f"{BASE_URL}/api/auth/my-companies")
    assert r.status_code == 200
    d = r.json()
    assert d.get("is_super_admin") is False
    codes = {c.get("company_code") for c in d["companies"]}
    assert {"3YJW4A", "4GV4LG"}.issubset(codes), f"got {codes}"
    roles_by_code = {c["company_code"]: c["role"] for c in d["companies"]}
    assert roles_by_code["3YJW4A"] == "company_admin"
    assert roles_by_code["4GV4LG"] == "manager"


def test_hr_switch_company_role_change(hr_client):
    comps = hr_client.get(f"{BASE_URL}/api/auth/my-companies").json()["companies"]
    c_admin = next(c for c in comps if c["company_code"] == "3YJW4A")
    c_mgr = next(c for c in comps if c["company_code"] == "4GV4LG")

    r = hr_client.post(f"{BASE_URL}/api/auth/switch-company", json={"company_id": c_admin["id"]})
    assert r.status_code == 200, r.text
    assert r.json().get("role") == "company_admin"
    scope = hr_client.get(f"{BASE_URL}/api/auth/me/scope").json()
    assert scope.get("role") == "company_admin"
    admin_centers = scope.get("assigned_center_ids", [])

    r = hr_client.post(f"{BASE_URL}/api/auth/switch-company", json={"company_id": c_mgr["id"]})
    assert r.status_code == 200
    assert r.json().get("role") == "manager"
    scope2 = hr_client.get(f"{BASE_URL}/api/auth/me/scope").json()
    assert scope2.get("role") == "manager"
    mgr_centers = scope2.get("assigned_center_ids", [])
    # Centers should differ (different companies)
    assert set(admin_centers) != set(mgr_centers) or admin_centers == [] or mgr_centers == []


# ---------- 5. Security: cannot switch to unrelated company ----------
def test_hr_cannot_switch_to_unrelated_company(hr_client, admin_client):
    all_comps = admin_client.get(f"{BASE_URL}/api/auth/my-companies").json()["companies"]
    my = {c["company_code"] for c in hr_client.get(f"{BASE_URL}/api/auth/my-companies").json()["companies"]}
    unrelated = next((c for c in all_comps if c["company_code"] not in my), None)
    if not unrelated:
        pytest.skip("no unrelated company available")
    r = hr_client.post(f"{BASE_URL}/api/auth/switch-company", json={"company_id": unrelated["id"]})
    assert r.status_code == 403, f"expected 403, got {r.status_code}"


# ---------- 6. Security: company_admin cannot create center in other company ----------
def test_hr_cannot_create_center_for_other_company(hr_client, admin_client):
    # Ensure hr is on 3YJW4A (company_admin)
    comps = hr_client.get(f"{BASE_URL}/api/auth/my-companies").json()["companies"]
    c_admin = next(c for c in comps if c["company_code"] == "3YJW4A")
    hr_client.post(f"{BASE_URL}/api/auth/switch-company", json={"company_id": c_admin["id"]})

    all_comps = admin_client.get(f"{BASE_URL}/api/auth/my-companies").json()["companies"]
    other = next((c for c in all_comps if c["company_code"] not in ("3YJW4A", "4GV4LG")), None)
    if not other:
        pytest.skip("no other company")
    r = hr_client.post(f"{BASE_URL}/api/centers",
                       json={"company_id": other["id"], "name": "TEST_Illegal", "city": "X"})
    assert r.status_code == 403


# ---------- 7. Memberships GET/PUT ----------
def test_memberships_get_hr(admin_client):
    # find hr user id
    users = admin_client.get(f"{BASE_URL}/api/auth/users").json()
    if isinstance(users, dict):
        users = users.get("users") or users.get("items") or []
    hr_user = next((u for u in users if u.get("email") == "hr@finance.app"), None)
    assert hr_user, "hr user not found"
    r = admin_client.get(f"{BASE_URL}/api/users/{hr_user['id']}/memberships")
    assert r.status_code == 200
    mems = r.json().get("memberships", [])
    codes = {m["company_code"]: m["role"] for m in mems}
    assert codes.get("3YJW4A") == "company_admin"
    assert codes.get("4GV4LG") == "manager"
