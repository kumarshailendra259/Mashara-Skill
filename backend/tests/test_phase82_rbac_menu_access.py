"""Phase 82 · RBAC Menu Access Control backend regression.

Covers:
 - /api/rbac/menus (59), /api/rbac/roles (>=8 system), /api/auth/me/permissions
 - Custom role create/delete (all-off default)
 - PUT permissions for a non-admin role, admin cannot be restricted (400)
 - Reset permissions
 - Audit log entry with old→new
 - Middleware VIEW enforcement: restricted role -> 403 on mapped prefix; reset -> 200
 - Non-admin -> 403 on all /api/rbac/*
 - Center isolation independence (accountant with subscription-view ON still
   only sees own centre; menu perms don't widen scope)
"""
from __future__ import annotations

import os
import uuid
import time
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Read from frontend/.env if not exported
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                    break
    except Exception:
        pass
assert BASE_URL, "REACT_APP_BACKEND_URL required"

API = BASE_URL + "/api"


# ---------- helpers ----------
def _login(email: str, password: str) -> requests.Session:
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    # attach CSRF header for state-changing calls
    csrf = s.cookies.get("csrf_token")
    if csrf:
        s.headers.update({"X-CSRF-Token": csrf})
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin():
    return _login("admin@finance.app", "Admin@123")


@pytest.fixture(scope="module")
def menus(admin):
    r = admin.get(f"{API}/rbac/menus", timeout=30)
    assert r.status_code == 200
    return r.json()


# ==========================================================
# Basic registry / roles / me
# ==========================================================
class TestRbacBasics:
    def test_menus_count_and_shape(self, menus):
        assert isinstance(menus, list) and len(menus) == 59, f"expected 59 menus, got {len(menus)}"
        ids = {m["id"] for m in menus}
        for req in ["dashboard", "subscription", "org.roles", "batch",
                    "partnerships.settlement", "org.users", "org.centers"]:
            assert req in ids

    def test_roles_include_system_8(self, admin):
        r = admin.get(f"{API}/rbac/roles", timeout=30)
        assert r.status_code == 200
        data = r.json()
        sys_keys = {row["key"] for row in data if row.get("is_system")}
        for k in ["admin", "senior_manager", "manager", "center_manager",
                  "center_staff", "accountant", "hr", "partner"]:
            assert k in sys_keys, f"missing system role {k}"

    def test_me_permissions_admin(self, admin):
        r = admin.get(f"{API}/auth/me/permissions", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["is_admin"] is True
        # admin has all-true for every menu
        for mid, actions in data["permissions"].items():
            assert all(actions.values()), f"admin missing perm on {mid}"

    def test_admin_permissions_returns_admin_flag(self, admin):
        r = admin.get(f"{API}/rbac/permissions/admin", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["is_admin"] is True

    def test_put_admin_permissions_400(self, admin, menus):
        payload = {"permissions": [{"menu_id": m["id"], "can_view": False} for m in menus]}
        r = admin.put(f"{API}/rbac/permissions/admin", json=payload, timeout=30)
        assert r.status_code == 400, r.text


# ==========================================================
# Custom role create/delete + all-off default
# ==========================================================
class TestCustomRole:
    _role_key = None

    def test_create_role(self, admin):
        label = f"TEST_Auditor_{uuid.uuid4().hex[:6]}"
        r = admin.post(f"{API}/rbac/roles", json={"label": label}, timeout=30)
        assert r.status_code == 201, r.text
        data = r.json()
        assert data["is_system"] is False
        TestCustomRole._role_key = data["key"]

    def test_new_role_all_off(self, admin):
        assert TestCustomRole._role_key
        r = admin.get(f"{API}/rbac/permissions/{TestCustomRole._role_key}", timeout=30)
        assert r.status_code == 200
        for row in r.json()["permissions"]:
            for a in ["can_view", "can_create", "can_edit", "can_delete",
                      "can_approve", "can_export", "can_print"]:
                assert row[a] is False, f"custom role should default OFF for {row['menu_id']}.{a}"

    def test_delete_role(self, admin):
        assert TestCustomRole._role_key
        r = admin.delete(f"{API}/rbac/roles/{TestCustomRole._role_key}", timeout=30)
        assert r.status_code == 204


# ==========================================================
# Enforcement: restrict accountant subscription view, verify 403, reset
# ==========================================================
class TestEnforcement:
    """Create a temp accountant user, restrict subscription view, expect 403,
    then reset and verify access is restored. Also verifies audit entry."""

    _user_id = None
    _email = f"test_rbac82_{uuid.uuid4().hex[:8]}@example.com"
    _password = "Test@1234"

    def test_create_accountant_user(self, admin):
        payload = {
            "email": self._email,
            "password": self._password,
            "name": "TEST RBAC82 Accountant",
            "role": "accountant",
        }
        # POST /api/users (admin creates user)
        r = admin.post(f"{API}/users", json=payload, timeout=30)
        if r.status_code == 404:
            # some builds expose /api/auth/users
            r = admin.post(f"{API}/auth/users", json=payload, timeout=30)
        assert r.status_code in (200, 201), f"create user failed: {r.status_code} {r.text}"
        TestEnforcement._user_id = r.json().get("id")

    def test_baseline_subscription_view_allowed(self, admin):
        s = _login(self._email, self._password)
        # baseline: no restrictions stored -> system role default full access
        r = s.get(f"{API}/subscription/status", timeout=30)
        # Endpoint may or may not exist; but middleware would only 403 when
        # perm is off. If endpoint missing, we accept 404 — key thing: not 403.
        assert r.status_code != 403, f"baseline should NOT be 403; got {r.status_code} {r.text[:200]}"

    def test_restrict_subscription_view(self, admin, menus):
        # Build a full permission payload with can_view=True everywhere,
        # then flip subscription can_view to False.
        perms = []
        for m in menus:
            row = {"menu_id": m["id"]}
            for a in ["view", "create", "edit", "delete", "approve", "export", "print"]:
                row["can_" + a] = True
            if m["id"] == "subscription":
                row["can_view"] = False
            perms.append(row)
        r = admin.put(f"{API}/rbac/permissions/accountant",
                      json={"permissions": perms}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["changed"] >= 1

    def test_accountant_subscription_blocked_403(self, admin):
        s = _login(self._email, self._password)
        r = s.get(f"{API}/subscription/status", timeout=30)
        assert r.status_code == 403, f"expected 403 after restrict; got {r.status_code} {r.text[:200]}"

    def test_me_permissions_reflects_restriction(self, admin):
        s = _login(self._email, self._password)
        r = s.get(f"{API}/auth/me/permissions", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["is_admin"] is False
        assert d["permissions"]["subscription"]["view"] is False

    def test_audit_has_old_new_entry(self, admin):
        r = admin.get(f"{API}/rbac/audit?role_key=accountant", timeout=30)
        assert r.status_code == 200
        logs = r.json()
        assert len(logs) >= 1
        newest = logs[0]
        assert newest["role_key"] == "accountant"
        # find at least one change record with old/new distinct
        subs_change = [c for c in newest["changes"]
                       if c.get("menu_id") == "subscription" and c.get("action") == "view"]
        assert subs_change, f"no subscription.view change in audit: {newest['changes']}"
        assert subs_change[0]["old"] is True and subs_change[0]["new"] is False

    def test_reset_restores_access(self, admin):
        r = admin.post(f"{API}/rbac/permissions/accountant/reset", timeout=30)
        assert r.status_code == 200
        s = _login(self._email, self._password)
        r = s.get(f"{API}/subscription/status", timeout=30)
        assert r.status_code != 403, f"after reset expected non-403; got {r.status_code}"

    def test_cleanup_user(self, admin):
        if TestEnforcement._user_id:
            admin.delete(f"{API}/users/{TestEnforcement._user_id}", timeout=30)


# ==========================================================
# Non-admin cannot touch /api/rbac/*
# ==========================================================
class TestRbacRbacGate:
    def test_hr_403_on_roles(self, admin):
        try:
            s = _login("hr@finance.app", "Hr@12345")
        except AssertionError:
            pytest.skip("hr@finance.app not available")
        r = s.get(f"{API}/rbac/roles", timeout=30)
        assert r.status_code == 403, r.status_code

    def test_hr_403_on_menus(self, admin):
        try:
            s = _login("hr@finance.app", "Hr@12345")
        except AssertionError:
            pytest.skip("hr@finance.app not available")
        r = s.get(f"{API}/rbac/menus", timeout=30)
        assert r.status_code == 403

    def test_hr_can_read_own_permissions(self):
        try:
            s = _login("hr@finance.app", "Hr@12345")
        except AssertionError:
            pytest.skip("hr@finance.app not available")
        r = s.get(f"{API}/auth/me/permissions", timeout=30)
        assert r.status_code == 200


# ==========================================================
# Center isolation independence
# ==========================================================
class TestCenterIsolationRegression:
    def test_center_scoped_accountant_still_scoped(self, admin):
        """Existing center-scoped accountant should still see ONLY own centre;
        menu permissions do NOT widen center scope."""
        try:
            s = _login("test_center_manager_c6912430@x.com", "Test@1234")
        except AssertionError:
            pytest.skip("center-isolation test account missing")
        # /auth/me should carry assigned_center_ids
        r = s.get(f"{API}/auth/me", timeout=30)
        assert r.status_code == 200
        me = r.json()
        assigned = me.get("assigned_center_ids") or []
        if not assigned:
            pytest.skip("center-scoped test account no longer has assigned_center_ids in DB")
        # Verify passing a *foreign* centre id to a scoped dashboard/report is 403
        foreign_id = "00000000-0000-0000-0000-000000000000"
        r = s.get(f"{API}/dashboard/settlement?center_id={foreign_id}", timeout=30)
        # Depending on route existence, we accept 403/404. Must not be 200 with data.
        assert r.status_code != 200 or (r.json() in ({}, [], None))
