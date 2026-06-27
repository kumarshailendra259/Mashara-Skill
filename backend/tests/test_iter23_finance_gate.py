"""Iter-23 backend tests: Finance-visibility gating + GET /auth/users 500 fix.

Verifies:
  - GET /api/auth/users returns 200 (no more 500 from RFC-6761 reserved-TLD emails).
  - Finance-visible endpoints return 200 for {admin, partner, senior_manager, hr, accountant}.
  - SAME endpoints return 403 for {center_manager, center_staff, manager, viewer,
    reporting_authority, center_partner}.
  - Operational endpoints (auth/me, staff, leaves, notifications, attendance,
    reimbursements, entities/center, pending-approvals, assets, asset-purchase-requests,
    asset-transfers, employee-transfers) continue to return 200 for ALL roles.
  - Regression: admin still sees /dashboard/summary and all finance endpoints.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@finance.app")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Admin@123")

RUN = uuid.uuid4().hex[:8]

FINANCE_ROLES = ["admin", "partner", "senior_manager", "hr", "accountant"]
RESTRICTED_ROLES = ["manager", "center_manager", "center_staff", "viewer",
                    "reporting_authority", "center_partner"]

# Endpoints that should 200 for finance roles, 403 for restricted roles.
# Each: (method, path, body|None)
FINANCE_ENDPOINTS = [
    ("GET", "/api/dashboard/summary", None),
    ("GET", "/api/dashboard/milestone-income", None),
    ("GET", "/api/dashboard/fooding-income", None),
    ("GET", "/api/dashboard/settlement", None),
    ("GET", "/api/transactions", None),
    ("GET", "/api/batches", None),
    ("GET", "/api/batch-payments", None),
    ("GET", "/api/reports/tds-register", None),
    ("GET", "/api/reports/tds-register/csv", None),
]

# Operational endpoints — must be 200 for ALL authenticated roles.
OPERATIONAL_ENDPOINTS = [
    ("GET", "/api/auth/me"),
    ("GET", "/api/staff"),
    ("GET", "/api/notifications"),
    ("GET", "/api/leaves"),
    ("GET", "/api/reimbursements"),
    ("GET", "/api/attendance"),
    ("GET", "/api/approvals/pending"),
    ("GET", "/api/assets"),
    ("GET", "/api/asset-purchase-requests"),
    ("GET", "/api/asset-transfers"),
    ("GET", "/api/employee-transfers"),
]


# ---------------- session fixtures ----------------
@pytest.fixture(scope="session")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return s


def _register_and_login(role: str) -> requests.Session:
    """Register a brand-new ephemeral user with the given role and return a logged-in session."""
    s = requests.Session()
    email = f"TEST_iter23_{role}_{RUN}@example.com"
    pw = "Passw0rd!"
    reg = s.post(f"{BASE_URL}/api/auth/register",
                 json={"email": email, "password": pw, "name": f"T{role}", "role": role},
                 timeout=15)
    assert reg.status_code in (200, 201), f"register({role}) failed: {reg.status_code} {reg.text}"
    # Some auth implementations don't set cookie on register — explicit login to be safe.
    lr = s.post(f"{BASE_URL}/api/auth/login",
                json={"email": email, "password": pw}, timeout=15)
    assert lr.status_code == 200, f"login({role}) failed: {lr.status_code} {lr.text}"
    body = lr.json()
    assert body.get("role") == role, f"role on /login = {body.get('role')} (expected {role})"
    return s


@pytest.fixture(scope="session")
def sessions_by_role():
    """One logged-in Session per role (finance + restricted). Admin re-used."""
    out = {}
    # Admin via real creds.
    admin = requests.Session()
    admin.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    out["admin"] = admin
    for role in FINANCE_ROLES + RESTRICTED_ROLES:
        if role == "admin":
            continue
        out[role] = _register_and_login(role)
    return out


# ============================================================================
# 1) /api/auth/users no longer 500 (RFC-6761 reserved-TLD emails tolerated)
# ============================================================================
class TestAuthUsersNo500:
    def test_auth_users_returns_200_and_lists_users(self, admin_session, sessions_by_role):
        # sessions_by_role created several ephemeral users which now live in db.users.
        r = admin_session.get(f"{BASE_URL}/api/auth/users", timeout=15)
        assert r.status_code == 200, f"/api/auth/users -> {r.status_code} {r.text[:300]}"
        data = r.json()
        assert isinstance(data, list), f"expected list, got {type(data).__name__}"
        assert len(data) >= 1, "no users returned"
        # Validate shape on at least one entry.
        admin_row = next((u for u in data if u.get("email") == ADMIN_EMAIL), None)
        assert admin_row is not None, "admin user missing from /auth/users response"
        for k in ("id", "email", "name", "role"):
            assert k in admin_row, f"missing field {k} in UserOut"


# ============================================================================
# 2) Finance endpoints — 200 for finance roles
# ============================================================================
class TestFinanceEndpointsAllowed:
    @pytest.mark.parametrize("role", FINANCE_ROLES)
    @pytest.mark.parametrize("method,path,body", FINANCE_ENDPOINTS)
    def test_finance_role_can_access(self, sessions_by_role, role, method, path, body):
        s = sessions_by_role[role]
        r = s.request(method, f"{BASE_URL}{path}", json=body, timeout=20)
        assert r.status_code == 200, (
            f"role={role} {method} {path} expected 200 got {r.status_code}: {r.text[:200]}"
        )


# ============================================================================
# 3) Finance endpoints — 403 for restricted roles
# ============================================================================
class TestFinanceEndpointsBlocked:
    @pytest.mark.parametrize("role", RESTRICTED_ROLES)
    @pytest.mark.parametrize("method,path,body", FINANCE_ENDPOINTS)
    def test_restricted_role_gets_403(self, sessions_by_role, role, method, path, body):
        s = sessions_by_role[role]
        r = s.request(method, f"{BASE_URL}{path}", json=body, timeout=20)
        assert r.status_code == 403, (
            f"role={role} {method} {path} expected 403 got {r.status_code}: {r.text[:200]}"
        )


# ============================================================================
# 4) Operational endpoints — 200 for ALL roles
# ============================================================================
class TestOperationalEndpointsAllRoles:
    @pytest.mark.parametrize("role", FINANCE_ROLES + RESTRICTED_ROLES)
    @pytest.mark.parametrize("method,path", OPERATIONAL_ENDPOINTS)
    def test_operational_endpoint_open(self, sessions_by_role, role, method, path):
        s = sessions_by_role[role]
        r = s.request(method, f"{BASE_URL}{path}", timeout=20)
        # Allow 200; if the endpoint is implemented as role-scoped + happens to
        # return empty list, that's still 200. 403 here is a FAIL.
        assert r.status_code == 200, (
            f"role={role} {method} {path} expected 200 got {r.status_code}: {r.text[:200]}"
        )


# ============================================================================
# 5) role-widgets behaviour (not gated by require_finance_visible — returns
#    role-specific shape; just assert it 200's for every role).
# ============================================================================
class TestRoleWidgetsAllRoles:
    @pytest.mark.parametrize("role", FINANCE_ROLES + RESTRICTED_ROLES)
    def test_role_widgets_200(self, sessions_by_role, role):
        s = sessions_by_role[role]
        r = s.get(f"{BASE_URL}/api/dashboard/role-widgets", timeout=15)
        assert r.status_code == 200, f"role={role} role-widgets {r.status_code} {r.text[:200]}"
        body = r.json()
        assert body.get("role") == role


# ============================================================================
# 6) Regression — admin still sees finance data; sanity for dashboard/summary
# ============================================================================
class TestAdminRegression:
    def test_dashboard_summary_admin(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/dashboard/summary", timeout=15)
        assert r.status_code == 200
        body = r.json()
        # finance keys live under "totals"
        totals = body.get("totals") or {}
        assert any(k in totals for k in ("investment", "income", "expense", "profit")), \
            f"dashboard/summary.totals missing finance keys: {list(totals.keys())[:10]}"

    def test_approval_workflows_admin_no_500(self, admin_session):
        # The bug that triggered iter-23: the Approval Workflows page calls
        # /api/auth/users + /api/approval-chains. Both must be 200.
        r1 = admin_session.get(f"{BASE_URL}/api/auth/users", timeout=15)
        r2 = admin_session.get(f"{BASE_URL}/api/approval-chains", timeout=15)
        assert r1.status_code == 200, f"/auth/users {r1.status_code}"
        assert r2.status_code == 200, f"/approval-chains {r2.status_code} {r2.text[:200]}"
        chains = r2.json()
        # The 3 default chains + the iter-22 additions (asset_purchase, employee_transfer).
        chain_types = {c.get("type") for c in chains if isinstance(c, dict)}
        for req_type in ("reimbursement", "leave", "transaction"):
            assert req_type in chain_types, f"default chain {req_type} missing; chains={chain_types}"
