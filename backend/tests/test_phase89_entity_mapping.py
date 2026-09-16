"""Phase 89 — Mandatory Unique Entity ID & Relationship Linking test suite.

Covers:
- Unique ID (entity_uid) backfill & format for partner/project/company/center
- Mandatory Partner+Project+Company mapping on center create/update
- Deletion integrity (409 when linked)
- Cascading /entity-mapping-options
- Reverse visibility /entities/{etype}/{eid}/relationships
- /entity-mappings admin table (q, unmapped_only)
- Audit trail /entity-mappings/audit
- Search /entities/center?q=
- entity_uid immutability on PUT
"""
import os
import re
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@finance.app"
ADMIN_PASSWORD = "Admin@123"


@pytest.fixture(scope="module")
def admin_client():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    # CSRF token cookie -> header
    csrf = s.cookies.get("csrf_token")
    if csrf:
        s.headers.update({"X-CSRF-Token": csrf})
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def seed_ids(admin_client):
    """Grab one existing partner/project/company id for use in center mapping tests."""
    partners = admin_client.get(f"{API}/entities/partner", timeout=30).json()
    projects = admin_client.get(f"{API}/entities/project", timeout=30).json()
    companies = admin_client.get(f"{API}/entities/company", timeout=30).json()
    assert partners and projects and companies, "need at least one of each entity type"
    return {"partner": partners[0], "project": projects[0], "company": companies[0]}


@pytest.fixture(scope="module")
def created_ids():
    """Track anything we create to make sure teardown deletes it."""
    return {"partners": [], "projects": [], "centers": []}


@pytest.fixture(scope="module", autouse=True)
def cleanup(admin_client, created_ids):
    yield
    for cid in created_ids["centers"]:
        admin_client.delete(f"{API}/entities/center/{cid}", timeout=15)
    for pid in created_ids["partners"]:
        admin_client.delete(f"{API}/entities/partner/{pid}", timeout=15)
    for pid in created_ids["projects"]:
        admin_client.delete(f"{API}/entities/project/{pid}", timeout=15)


# -------------------- Unique ID backfill / format --------------------
class TestUniqueId:
    def test_partner_entity_uid_format(self, admin_client):
        rows = admin_client.get(f"{API}/entities/partner", timeout=30).json()
        assert rows, "no partners"
        for p in rows:
            uid = p.get("entity_uid")
            assert uid, f"partner {p.get('id')} missing entity_uid"
            assert re.match(r"^PART-[A-Z0-9]{6}$", uid), f"bad partner uid: {uid}"

    def test_project_entity_uid_format(self, admin_client):
        rows = admin_client.get(f"{API}/entities/project", timeout=30).json()
        assert rows
        for p in rows:
            uid = p.get("entity_uid")
            assert uid, f"project {p.get('id')} missing entity_uid"
            assert re.match(r"^PROJ-[A-Z0-9]{6}$", uid), f"bad project uid: {uid}"

    def test_company_entity_uid_present(self, admin_client):
        rows = admin_client.get(f"{API}/entities/company", timeout=30).json()
        assert rows
        for c in rows:
            assert c.get("entity_uid"), f"company {c.get('id')} missing entity_uid"

    def test_center_entity_uid_present(self, admin_client):
        rows = admin_client.get(f"{API}/entities/center", timeout=30).json()
        assert rows
        for c in rows[:20]:
            assert c.get("entity_uid"), f"center {c.get('id')} missing entity_uid"

    def test_entity_uid_immutable_on_put(self, admin_client, created_ids):
        # Create a partner, capture uid, edit name, re-fetch — uid should not change
        r = admin_client.post(f"{API}/entities/partner",
                              json={"name": "TEST_P89_ImmutableUid", "email": ""}, timeout=30)
        assert r.status_code == 200, r.text
        p = r.json()
        pid, uid_before = p["id"], p["entity_uid"]
        created_ids["partners"].append(pid)
        # PUT with a name change (and even attempting to sneak entity_uid)
        r2 = admin_client.put(f"{API}/entities/partner/{pid}",
                              json={"name": "TEST_P89_ImmutableUid_v2",
                                    "entity_uid": "PART-HACKED"}, timeout=30)
        assert r2.status_code == 200, r2.text
        assert r2.json()["entity_uid"] == uid_before
        assert r2.json()["name"] == "TEST_P89_ImmutableUid_v2"


# -------------------- Mandatory center mapping --------------------
class TestMandatoryCenterMapping:
    def test_create_center_without_mapping_400(self, admin_client):
        r = admin_client.post(f"{API}/entities/center",
                              json={"name": "TEST_P89_NoMap", "email": ""}, timeout=30)
        assert r.status_code == 400, r.text
        assert "mapping is required" in r.text.lower()

    def test_create_center_non_existent_partner_400(self, admin_client, seed_ids):
        r = admin_client.post(f"{API}/entities/center", json={
            "name": "TEST_P89_BadPartner",
            "partner_id": "nonexistent-id-xyz",
            "project_id": seed_ids["project"]["id"],
            "company_id": seed_ids["company"]["id"],
        }, timeout=30)
        assert r.status_code == 400, r.text
        assert "partner" in r.text.lower() and "not exist" in r.text.lower()

    def test_create_center_full_mapping_ok(self, admin_client, seed_ids, created_ids):
        r = admin_client.post(f"{API}/entities/center", json={
            "name": "TEST_P89_FullMap",
            "email": "",
            "partner_id": seed_ids["partner"]["id"],
            "project_id": seed_ids["project"]["id"],
            "company_id": seed_ids["company"]["id"],
        }, timeout=30)
        assert r.status_code == 200, r.text
        c = r.json()
        assert c.get("entity_uid"), "created center missing entity_uid"
        created_ids["centers"].append(c["id"])

    def test_update_center_clearing_mapping_400(self, admin_client, seed_ids, created_ids):
        # Use previously created (or create one)
        if not created_ids["centers"]:
            r = admin_client.post(f"{API}/entities/center", json={
                "name": "TEST_P89_EditClear",
                "partner_id": seed_ids["partner"]["id"],
                "project_id": seed_ids["project"]["id"],
                "company_id": seed_ids["company"]["id"],
            }, timeout=30)
            created_ids["centers"].append(r.json()["id"])
        cid = created_ids["centers"][-1]
        r = admin_client.put(f"{API}/entities/center/{cid}", json={
            "name": "TEST_P89_EditClear_v2",
            "partner_id": "",
            "project_id": seed_ids["project"]["id"],
            "company_id": seed_ids["company"]["id"],
        }, timeout=30)
        assert r.status_code == 400, r.text
        assert "mapping is required" in r.text.lower()


# -------------------- Deletion integrity --------------------
class TestDeletionIntegrity:
    def test_delete_linked_partner_409(self, admin_client):
        partners = admin_client.get(f"{API}/entities/partner", timeout=30).json()
        # Find a partner with linked centers via /relationships
        target = None
        for p in partners:
            rel = admin_client.get(f"{API}/entities/partner/{p['id']}/relationships", timeout=30).json()
            if rel.get("linked_centers"):
                target = p
                break
        if not target:
            pytest.skip("no linked partner in DB")
        r = admin_client.delete(f"{API}/entities/partner/{target['id']}", timeout=30)
        assert r.status_code == 409, r.text
        assert "linked with existing records" in r.text.lower()

    def test_delete_unlinked_entity_200(self, admin_client):
        # Create fresh, unlinked partner then delete
        r = admin_client.post(f"{API}/entities/partner",
                              json={"name": "TEST_P89_ForDelete", "email": ""}, timeout=30)
        pid = r.json()["id"]
        r2 = admin_client.delete(f"{API}/entities/partner/{pid}", timeout=30)
        assert r2.status_code == 200, r2.text


# -------------------- Cascading options --------------------
class TestCascadingOptions:
    def test_no_params_returns_all(self, admin_client):
        r = admin_client.get(f"{API}/entity-mapping-options", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "projects" in data and "companies" in data
        assert len(data["projects"]) >= 1
        assert len(data["companies"]) >= 1

    def test_with_partner_id(self, admin_client, seed_ids):
        r = admin_client.get(f"{API}/entity-mapping-options",
                             params={"partner_id": seed_ids["partner"]["id"]}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        # Fallback contract: returns all if no mappings for this partner
        assert isinstance(data.get("projects"), list)
        assert isinstance(data.get("companies"), list)


# -------------------- Reverse visibility --------------------
class TestReverseVisibility:
    def test_relationships_has_entity_uid_and_linked_arrays(self, admin_client):
        partners = admin_client.get(f"{API}/entities/partner", timeout=30).json()
        # Prefer one with linked centers
        target = None
        for p in partners:
            rel = admin_client.get(f"{API}/entities/partner/{p['id']}/relationships", timeout=30).json()
            if rel.get("linked_centers"):
                target = (p, rel)
                break
        if not target:
            pytest.skip("no partner has linked centers")
        p, rel = target
        assert rel["entity_uid"] == p["entity_uid"]
        assert isinstance(rel["linked_centers"], list) and len(rel["linked_centers"]) >= 1
        assert "linked_partners" in rel and "linked_projects" in rel and "linked_companies" in rel


# -------------------- Admin entity-mappings --------------------
class TestEntityMappings:
    def test_shape(self, admin_client):
        r = admin_client.get(f"{API}/entity-mappings", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert set(data.keys()) >= {"rows", "total", "unmapped"}
        assert isinstance(data["rows"], list)
        if data["rows"]:
            row = data["rows"][0]
            for k in ("center_id", "center_uid", "center_name", "partner_uid",
                      "project_uid", "company_uid", "mapping_complete"):
                assert k in row

    def test_unmapped_only(self, admin_client):
        r = admin_client.get(f"{API}/entity-mappings", params={"unmapped_only": "true"}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        for row in data["rows"]:
            assert row["mapping_complete"] is False

    def test_search_q(self, admin_client, created_ids, seed_ids):
        # Create a center we can search for
        r = admin_client.post(f"{API}/entities/center", json={
            "name": "TEST_P89_SearchableCenter",
            "partner_id": seed_ids["partner"]["id"],
            "project_id": seed_ids["project"]["id"],
            "company_id": seed_ids["company"]["id"],
        }, timeout=30)
        assert r.status_code == 200
        c = r.json()
        created_ids["centers"].append(c["id"])
        # Search /entity-mappings?q=uid
        r2 = admin_client.get(f"{API}/entity-mappings", params={"q": c["entity_uid"]}, timeout=30)
        assert r2.status_code == 200
        rows = r2.json()["rows"]
        assert any(row["center_id"] == c["id"] for row in rows)


# -------------------- Search on /entities/center?q= --------------------
class TestSearchCenter:
    def test_search_by_uid(self, admin_client, created_ids, seed_ids):
        # Reuse a previously-created test center if we have one; else create
        if not created_ids["centers"]:
            r = admin_client.post(f"{API}/entities/center", json={
                "name": "TEST_P89_Search",
                "partner_id": seed_ids["partner"]["id"],
                "project_id": seed_ids["project"]["id"],
                "company_id": seed_ids["company"]["id"],
            }, timeout=30)
            created_ids["centers"].append(r.json()["id"])
        cid = created_ids["centers"][-1]
        detail = admin_client.get(f"{API}/entities/center", timeout=30).json()
        target = next(c for c in detail if c["id"] == cid)
        uid = target["entity_uid"]
        r = admin_client.get(f"{API}/entities/center", params={"q": uid}, timeout=30)
        assert r.status_code == 200
        rows = r.json()
        assert any(c["id"] == cid for c in rows)


# -------------------- Audit trail --------------------
class TestAudit:
    def test_create_audit_row(self, admin_client, seed_ids, created_ids):
        r = admin_client.post(f"{API}/entities/center", json={
            "name": "TEST_P89_AuditCenter",
            "partner_id": seed_ids["partner"]["id"],
            "project_id": seed_ids["project"]["id"],
            "company_id": seed_ids["company"]["id"],
        }, timeout=30)
        assert r.status_code == 200
        cid = r.json()["id"]
        created_ids["centers"].append(cid)
        a = admin_client.get(f"{API}/entity-mappings/audit", params={"center_id": cid}, timeout=30)
        assert a.status_code == 200
        logs = a.json()
        assert isinstance(logs, list) and len(logs) >= 1
        row = logs[0]
        for k in ("action", "new_mapping", "actor_id", "at"):
            assert k in row
        assert row["new_mapping"]["partner_id"] == seed_ids["partner"]["id"]
