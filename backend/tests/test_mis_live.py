"""Tests for the new /api/mis/live/* Single Source of Truth endpoints
plus regression on existing /api/mis/* endpoints (Phase A + regression)."""
import os
import pytest
import requests
from pathlib import Path

# Load frontend/.env to get REACT_APP_BACKEND_URL (public URL)
_env_path = Path("/app/frontend/.env")
if _env_path.exists():
    for line in _env_path.read_text().splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@finance.app", "password": "Admin@123"}


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=ADMIN, timeout=30)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text[:200]}"
    return s


# ---------------- /api/mis/live/overview ----------------
class TestMisLiveOverview:
    def test_admin_200_and_shape(self, admin_session):
        r = admin_session.get(f"{API}/mis/live/overview", timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d.get("source") == "core-erp-live"
        for k in ("entities", "batches", "training", "bg", "mobilization"):
            assert k in d, f"missing key {k}"
        ent = d["entities"]
        for k in ("projects", "centers", "companies", "partners"):
            assert k in ent and isinstance(ent[k], int)
        ba = d["batches"]
        for k in ("total", "active", "closed"):
            assert k in ba and isinstance(ba[k], int)
        # active + closed should equal total
        assert ba["active"] + ba["closed"] == ba["total"]
        tr = d["training"]
        for k in ("total_target", "total_enrolled", "total_certified",
                  "total_placement", "achievement_pct",
                  "certification_pct", "placement_pct"):
            assert k in tr
        for k in ("expiring_30d", "expired"):
            assert k in d["bg"] and isinstance(d["bg"][k], int)

    def test_matches_core_counts(self, admin_session):
        ov = admin_session.get(f"{API}/mis/live/overview", timeout=30).json()
        # Cross-check projects count against /api/projects if endpoint exists
        r = admin_session.get(f"{API}/projects", timeout=30)
        if r.status_code == 200:
            body = r.json()
            live = body if isinstance(body, list) else body.get("items") or body.get("results") or []
            # allow +/- for pagination diff; if list returned fully compare
            assert isinstance(live, list)
            if len(live) <= 500:  # not paginated
                assert ov["entities"]["projects"] == len(live)


# ---------------- /api/mis/live/project-summary ----------------
class TestMisLiveProjectSummary:
    def test_returns_rows(self, admin_session):
        r = admin_session.get(f"{API}/mis/live/project-summary", timeout=30)
        assert r.status_code == 200, r.text[:300]
        rows = r.json()
        assert isinstance(rows, list)
        if rows:
            row = rows[0]
            for k in ("source", "batch_id", "project", "center_name", "state",
                      "total_target", "total_enrolled", "total_certified",
                      "num_placement", "total_dropout", "status",
                      "certification_pct", "placement_pct", "achievement_pct"):
                assert k in row, f"row missing {k}"
            assert row["source"] == "live"

    def test_filter_options(self, admin_session):
        r = admin_session.get(f"{API}/mis/live/project-summary/filter-options",
                              timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ("projects", "centers", "states", "statuses"):
            assert k in d and isinstance(d[k], list)

    def test_search_filter(self, admin_session):
        # Should not error and return a list
        r = admin_session.get(f"{API}/mis/live/project-summary",
                              params={"search": "xyz_no_match"}, timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---------------- /api/mis/live/rollups ----------------
class TestMisLiveRollups:
    def test_shape(self, admin_session):
        r = admin_session.get(f"{API}/mis/live/rollups", timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ("by_project", "by_center", "by_state"):
            assert k in d and isinstance(d[k], list)


# ---------------- /api/mis/live/reports/daily ----------------
class TestMisLiveReportsDaily:
    def test_daily(self, admin_session):
        r = admin_session.get(f"{API}/mis/live/reports/daily", timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d.get("source") == "core-erp-live"
        assert "executive" in d
        for k in ("by_project", "by_center", "by_state"):
            assert k in d
        exe = d["executive"]
        for k in ("total_projects", "total_centers", "total_batches",
                  "active_batches", "total_target", "total_enrolled",
                  "total_certified", "total_placement", "achievement_pct"):
            assert k in exe, f"executive missing {k}"


# ---------------- /api/mis/live/reports/drilldown/{kpi} ----------------
class TestMisLiveDrilldown:
    @pytest.mark.parametrize("kpi", [
        "enrolled", "certified", "placement", "dropout",
        "active_batches", "centers", "projects",
    ])
    def test_kpi(self, admin_session, kpi):
        r = admin_session.get(f"{API}/mis/live/reports/drilldown/{kpi}",
                              timeout=30)
        assert r.status_code == 200, f"{kpi} → {r.status_code} {r.text[:200]}"
        d = r.json()
        assert "kind" in d and "count" in d and "rows" in d
        assert isinstance(d["rows"], list)
        assert d["count"] == len(d["rows"]) or d["count"] >= len(d["rows"])

    def test_unknown_kpi(self, admin_session):
        r = admin_session.get(f"{API}/mis/live/reports/drilldown/foobar",
                              timeout=30)
        assert r.status_code == 400


# ---------------- RBAC ----------------
class TestMisLiveRBAC:
    def test_unauthenticated_401_or_403(self):
        r = requests.get(f"{API}/mis/live/overview", timeout=30)
        assert r.status_code in (401, 403), r.status_code


# ---------------- Regression: legacy MIS endpoints still work ----------------
class TestLegacyMisRegression:
    def test_legacy_overview(self, admin_session):
        r = admin_session.get(f"{API}/mis/overview", timeout=30)
        assert r.status_code == 200, r.text[:300]

    def test_legacy_projects(self, admin_session):
        r = admin_session.get(f"{API}/mis/projects", timeout=30)
        assert r.status_code == 200, r.text[:300]

    def test_legacy_reports_daily(self, admin_session):
        r = admin_session.get(f"{API}/mis/reports/daily", timeout=30)
        assert r.status_code == 200, r.text[:300]


# ---------------- Regression: batches CRUD ----------------
class TestBatchesRegression:
    def test_batches_list(self, admin_session):
        r = admin_session.get(f"{API}/batches", timeout=30)
        assert r.status_code == 200, r.text[:200]

    def test_candidates_list(self, admin_session):
        r = admin_session.get(f"{API}/candidates", timeout=30)
        # candidates endpoint could 200 or paginated
        assert r.status_code in (200,), r.text[:200]
