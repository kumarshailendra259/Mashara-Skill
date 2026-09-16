"""Phase 89b — Center → MULTIPLE Partner+Project+Company mappings.

Delta over Phase 89:
- Accepts `mappings:[{partner_id,project_id,company_id},...]`
- ≥1 complete row required; each row complete
- Duplicate rows deduped
- First row synced to legacy partner_id/project_id/company_id
- GET /entities/center returns mapping_count + mappings_resolved
- GET /entity-mappings expands one row per mapping (mapping_index/total)
- GET /entities/partner/{id}/relationships finds via mappings.partner_id
- /entity-mapping-options uses $unwind on mappings
- Delete partner referenced in mappings[] → 409
- Existing legacy centers auto-migrated to mappings[]
"""
import os
import re
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@finance.app"
ADMIN_PASSWORD = "Admin@123"

TEST_TAG = "TEST_P89B_"


@pytest.fixture(scope="module")
def admin_client():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    csrf = s.cookies.get("csrf_token")
    if csrf:
        s.headers.update({"X-CSRF-Token": csrf})
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def seeds(admin_client):
    partners = admin_client.get(f"{API}/entities/partner", timeout=30).json()
    projects = admin_client.get(f"{API}/entities/project", timeout=30).json()
    companies = admin_client.get(f"{API}/entities/company", timeout=30).json()
    assert len(partners) >= 2 and len(projects) >= 2 and len(companies) >= 2, \
        "need >=2 of partners/projects/companies to test multi-mapping"
    return {"p": partners, "pr": projects, "c": companies}


@pytest.fixture(scope="module")
def created():
    return {"centers": [], "partners": []}


@pytest.fixture(scope="module", autouse=True)
def cleanup(admin_client, created):
    yield
    for cid in created["centers"]:
        try: admin_client.delete(f"{API}/entities/center/{cid}", timeout=15)
        except Exception: pass
    for pid in created["partners"]:
        try: admin_client.delete(f"{API}/entities/partner/{pid}", timeout=15)
        except Exception: pass


# ---------------- CREATE with multiple mappings ----------------
class TestMultiMappingCreate:
    def test_create_two_mappings(self, admin_client, seeds, created):
        m0 = {"partner_id": seeds["p"][0]["id"], "project_id": seeds["pr"][0]["id"], "company_id": seeds["c"][0]["id"]}
        m1 = {"partner_id": seeds["p"][1]["id"], "project_id": seeds["pr"][1]["id"], "company_id": seeds["c"][1]["id"]}
        r = admin_client.post(f"{API}/entities/center", json={
            "name": f"{TEST_TAG}TwoMaps", "email": "", "mappings": [m0, m1],
        }, timeout=30)
        assert r.status_code == 200, r.text
        c = r.json()
        created["centers"].append(c["id"])
        # Primary synced to first mapping
        assert c["partner_id"] == m0["partner_id"]
        assert c["project_id"] == m0["project_id"]
        assert c["company_id"] == m0["company_id"]
        assert c.get("entity_uid"), "missing entity_uid"
        # mappings persisted (len 2) — verify via list endpoint
        rows = admin_client.get(f"{API}/entities/center", params={"q": c["entity_uid"]}, timeout=30).json()
        target = next(x for x in rows if x["id"] == c["id"])
        assert target.get("mapping_count") == 2
        assert isinstance(target.get("mappings_resolved"), list) and len(target["mappings_resolved"]) == 2
        # Names resolved
        assert target["mappings_resolved"][0]["partner_name"]
        assert target["mappings_resolved"][1]["partner_name"]
        # Primary partner_name matches first row
        assert target.get("partner_name") == target["mappings_resolved"][0]["partner_name"]

    def test_dedupe_identical_rows(self, admin_client, seeds, created):
        m = {"partner_id": seeds["p"][0]["id"], "project_id": seeds["pr"][0]["id"], "company_id": seeds["c"][0]["id"]}
        r = admin_client.post(f"{API}/entities/center", json={
            "name": f"{TEST_TAG}DedupeMaps", "email": "", "mappings": [m, dict(m)],
        }, timeout=30)
        assert r.status_code == 200, r.text
        c = r.json()
        created["centers"].append(c["id"])
        rows = admin_client.get(f"{API}/entities/center", params={"q": c["entity_uid"]}, timeout=30).json()
        target = next(x for x in rows if x["id"] == c["id"])
        assert target["mapping_count"] == 1, f"dedupe failed: {target['mapping_count']}"


# ---------------- Enforcement ----------------
class TestEnforcement:
    def test_empty_mappings_400(self, admin_client):
        r = admin_client.post(f"{API}/entities/center",
                              json={"name": f"{TEST_TAG}Empty", "mappings": []}, timeout=30)
        assert r.status_code == 400
        assert "mapping is required" in r.text.lower()

    def test_incomplete_row_400(self, admin_client, seeds):
        r = admin_client.post(f"{API}/entities/center", json={
            "name": f"{TEST_TAG}Incomplete",
            "mappings": [{"partner_id": seeds["p"][0]["id"], "project_id": "", "company_id": seeds["c"][0]["id"]}],
        }, timeout=30)
        assert r.status_code == 400
        assert "each partner mapping must have partner, project and company" in r.text.lower()

    def test_bogus_partner_row_400(self, admin_client, seeds):
        r = admin_client.post(f"{API}/entities/center", json={
            "name": f"{TEST_TAG}Bogus",
            "mappings": [{"partner_id": "nonexistent-xyz",
                          "project_id": seeds["pr"][0]["id"],
                          "company_id": seeds["c"][0]["id"]}],
        }, timeout=30)
        assert r.status_code == 400
        assert "partner" in r.text.lower() and "not exist" in r.text.lower()


# ---------------- EDIT ----------------
class TestEdit:
    def test_add_second_mapping_via_put(self, admin_client, seeds, created):
        m0 = {"partner_id": seeds["p"][0]["id"], "project_id": seeds["pr"][0]["id"], "company_id": seeds["c"][0]["id"]}
        r = admin_client.post(f"{API}/entities/center", json={
            "name": f"{TEST_TAG}EditAdd", "mappings": [m0],
        }, timeout=30)
        assert r.status_code == 200
        cid = r.json()["id"]; created["centers"].append(cid)
        # PUT with 2 mappings
        m1 = {"partner_id": seeds["p"][1]["id"], "project_id": seeds["pr"][1]["id"], "company_id": seeds["c"][1]["id"]}
        r2 = admin_client.put(f"{API}/entities/center/{cid}", json={
            "name": f"{TEST_TAG}EditAdd_v2", "mappings": [m0, m1],
        }, timeout=30)
        assert r2.status_code == 200, r2.text
        # Verify persistence via list
        rows = admin_client.get(f"{API}/entities/center", params={"q": r2.json()["entity_uid"]}, timeout=30).json()
        target = next(x for x in rows if x["id"] == cid)
        assert target["mapping_count"] == 2

    def test_clear_all_mappings_put_400(self, admin_client, seeds, created):
        m0 = {"partner_id": seeds["p"][0]["id"], "project_id": seeds["pr"][0]["id"], "company_id": seeds["c"][0]["id"]}
        r = admin_client.post(f"{API}/entities/center", json={"name": f"{TEST_TAG}Clear", "mappings": [m0]}, timeout=30)
        cid = r.json()["id"]; created["centers"].append(cid)
        r2 = admin_client.put(f"{API}/entities/center/{cid}", json={"name": f"{TEST_TAG}Clear", "mappings": []}, timeout=30)
        assert r2.status_code == 400
        assert "mapping is required" in r2.text.lower()

    def test_legacy_single_mapping_update_still_works(self, admin_client, seeds, created):
        # Create using legacy single-field API
        r = admin_client.post(f"{API}/entities/center", json={
            "name": f"{TEST_TAG}Legacy",
            "partner_id": seeds["p"][0]["id"],
            "project_id": seeds["pr"][0]["id"],
            "company_id": seeds["c"][0]["id"],
        }, timeout=30)
        assert r.status_code == 200
        cid = r.json()["id"]; created["centers"].append(cid)
        # PUT with just a name change (no mappings sent) — should keep existing
        r2 = admin_client.put(f"{API}/entities/center/{cid}",
                              json={"name": f"{TEST_TAG}Legacy_v2"}, timeout=30)
        assert r2.status_code == 200, r2.text
        rows = admin_client.get(f"{API}/entities/center", params={"q": r2.json()["entity_uid"]}, timeout=30).json()
        target = next(x for x in rows if x["id"] == cid)
        assert target["mapping_count"] >= 1
        assert target["partner_id"] == seeds["p"][0]["id"]


# ---------------- Migration ----------------
class TestMigration:
    def test_existing_mapped_centers_have_mappings(self, admin_client):
        rows = admin_client.get(f"{API}/entities/center", timeout=30).json()
        # Find at least one center with a legacy partner_id (backfilled)
        mapped = [r for r in rows if r.get("mapping_count", 0) >= 1]
        # Not all centers need be mapped, but at least legacy ones should be migrated
        assert len(mapped) >= 1, "no migrated centers found"

    def test_unmapped_centers_have_flag_false(self, admin_client):
        rows = admin_client.get(f"{API}/entities/center", timeout=30).json()
        unmapped = [r for r in rows if r.get("mapping_count", 0) == 0]
        for u in unmapped[:5]:
            assert u.get("mapping_complete") in (False, None)


# ---------------- Admin entity-mappings row-per-mapping ----------------
class TestEntityMappingsExpansion:
    def test_two_mapping_center_yields_two_rows(self, admin_client, seeds, created):
        m0 = {"partner_id": seeds["p"][0]["id"], "project_id": seeds["pr"][0]["id"], "company_id": seeds["c"][0]["id"]}
        m1 = {"partner_id": seeds["p"][1]["id"], "project_id": seeds["pr"][1]["id"], "company_id": seeds["c"][1]["id"]}
        r = admin_client.post(f"{API}/entities/center",
                              json={"name": f"{TEST_TAG}EMRows", "mappings": [m0, m1]}, timeout=30)
        assert r.status_code == 200
        cid = r.json()["id"]; created["centers"].append(cid)
        uid = r.json()["entity_uid"]
        data = admin_client.get(f"{API}/entity-mappings", params={"q": uid}, timeout=30).json()
        rows = [x for x in data["rows"] if x["center_id"] == cid]
        assert len(rows) == 2, f"expected 2 rows, got {len(rows)}"
        idxs = sorted(r["mapping_index"] for r in rows)
        assert idxs == [0, 1]
        for row in rows:
            assert row["mapping_total"] == 2
            assert row["mapping_complete"] is True

    def test_unmapped_center_yields_single_row(self, admin_client):
        data = admin_client.get(f"{API}/entity-mappings", params={"unmapped_only": "true"}, timeout=30).json()
        # each unmapped center yields exactly one row
        seen = {}
        for row in data["rows"]:
            seen.setdefault(row["center_id"], 0)
            seen[row["center_id"]] += 1
            assert row["mapping_complete"] is False
            assert row["mapping_total"] == 0
        for cid, cnt in seen.items():
            assert cnt == 1, f"unmapped center {cid} has {cnt} rows"

    def test_filter_by_partner_matches_any_mapping_row(self, admin_client, seeds, created):
        # Create center where seeds.p[1] is the SECOND mapping (not primary)
        m0 = {"partner_id": seeds["p"][0]["id"], "project_id": seeds["pr"][0]["id"], "company_id": seeds["c"][0]["id"]}
        m1 = {"partner_id": seeds["p"][1]["id"], "project_id": seeds["pr"][1]["id"], "company_id": seeds["c"][1]["id"]}
        r = admin_client.post(f"{API}/entities/center",
                              json={"name": f"{TEST_TAG}PFilter", "mappings": [m0, m1]}, timeout=30)
        assert r.status_code == 200
        cid = r.json()["id"]; created["centers"].append(cid)
        # Query by the second-row partner — should still match
        data = admin_client.get(f"{API}/entity-mappings",
                                params={"partner_id": seeds["p"][1]["id"]}, timeout=30).json()
        assert any(row["center_id"] == cid for row in data["rows"]), \
            "partner_id filter did not match a center where partner is in secondary mapping row"


# ---------------- Reverse visibility across rows ----------------
class TestReverseVisibilityMulti:
    def test_partner_relationships_finds_center_via_any_row(self, admin_client, seeds, created):
        m0 = {"partner_id": seeds["p"][0]["id"], "project_id": seeds["pr"][0]["id"], "company_id": seeds["c"][0]["id"]}
        m1 = {"partner_id": seeds["p"][1]["id"], "project_id": seeds["pr"][1]["id"], "company_id": seeds["c"][1]["id"]}
        r = admin_client.post(f"{API}/entities/center",
                              json={"name": f"{TEST_TAG}RevVis", "mappings": [m0, m1]}, timeout=30)
        cid = r.json()["id"]; created["centers"].append(cid)
        rel = admin_client.get(f"{API}/entities/partner/{seeds['p'][1]['id']}/relationships", timeout=30).json()
        assert any(lc["id"] == cid for lc in rel.get("linked_centers", [])), \
            "partner in secondary mapping row not found in linked_centers"
        # Aggregated linked_projects should include BOTH projects from the two rows
        proj_ids = {p["id"] for p in rel.get("linked_projects", [])}
        assert seeds["pr"][1]["id"] in proj_ids


# ---------------- Cascading via $unwind ----------------
class TestCascadingUnwind:
    def test_partner_returns_row_scoped_projects(self, admin_client, seeds, created):
        # Create a center with a specific (partner, project, company) triple
        m0 = {"partner_id": seeds["p"][0]["id"], "project_id": seeds["pr"][0]["id"], "company_id": seeds["c"][0]["id"]}
        # And a second row where the SAME partner maps to a different project
        # If seeds has >=2 projects this exercises the $unwind path
        r = admin_client.post(f"{API}/entities/center",
                              json={"name": f"{TEST_TAG}Casc", "mappings": [m0]}, timeout=30)
        assert r.status_code == 200
        created["centers"].append(r.json()["id"])
        data = admin_client.get(f"{API}/entity-mapping-options",
                                params={"partner_id": seeds["p"][0]["id"]}, timeout=30).json()
        assert isinstance(data.get("projects"), list) and isinstance(data.get("companies"), list)
        # The mapped project should be included
        assert any(p["id"] == seeds["pr"][0]["id"] for p in data["projects"])


# ---------------- Deletion integrity via mappings.partner_id ----------------
class TestDeletionMulti:
    def test_delete_partner_used_only_in_secondary_row_409(self, admin_client, seeds, created):
        # Create a fresh partner used ONLY as a secondary mapping — not as primary (partner_id top-level)
        p = admin_client.post(f"{API}/entities/partner",
                              json={"name": f"{TEST_TAG}SecOnly", "email": ""}, timeout=30).json()
        pid = p["id"]
        # Center where seeds.p[0] is primary (row 0) and NEW partner is in row 1
        m0 = {"partner_id": seeds["p"][0]["id"], "project_id": seeds["pr"][0]["id"], "company_id": seeds["c"][0]["id"]}
        m1 = {"partner_id": pid, "project_id": seeds["pr"][0]["id"], "company_id": seeds["c"][0]["id"]}
        r = admin_client.post(f"{API}/entities/center",
                              json={"name": f"{TEST_TAG}DelSec", "mappings": [m0, m1]}, timeout=30)
        assert r.status_code == 200, r.text
        created["centers"].append(r.json()["id"])
        # Try delete the secondary-only partner — must 409 because centers.mappings.partner_id references it
        d = admin_client.delete(f"{API}/entities/partner/{pid}", timeout=30)
        assert d.status_code == 409, f"expected 409 for referenced partner, got {d.status_code}: {d.text}"
        # Register for cleanup only if it wasn't deleted (409 = still exists)
        created["partners"].append(pid)
