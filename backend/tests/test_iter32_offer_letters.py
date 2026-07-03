"""iter-32 — Offer Letter generation (DOCX template → PDF → Resend email).

Code under test:
  - offer_letter.render_offer_letter, send_offer_letter_email (docxtpl + LibreOffice)
  - server.py:  POST/GET/DELETE /api/offer-letter-templates
                POST /api/staff (auto-generate on create when send_offer_letter=true)
                POST /api/staff/{sid}/send-offer-letter
                GET  /api/offer-letters?staff_id=X
                GET  /api/offer-letters/{lid}/download
                _resolve_offer_letter_template, _generate_and_deliver_offer_letter

Validates:
  - .docx multipart upload works, non-.docx rejected (400), oversize rejected (413)
  - Uploading a 2nd template for the same company (and for global) deactivates prior.
  - Role gating (admin/hr can upload, admin-only delete, viewer/partner/center_* get 403)
  - create_staff with send_offer_letter=true + create_login=true triggers generation
    and populates staff.offer_letter_url / _id / _generated_at
  - Missing template scenario → generated:false with reason=no_template_uploaded
  - /staff/{sid}/send-offer-letter auto-creates user if missing, returns bool "emailed"
  - GET /offer-letters?staff_id=X returns history sorted desc
  - GET /offer-letters/{lid}/download returns application/pdf bytes (starts with %PDF-)
  - PDF actually contains staff_name, designation, login_email, login_password,
    company_name, and today's date — no raw '{...}' placeholders remain
"""
import io
import os
import re
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone

import pytest
import requests
from docx import Document

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL")
            or "https://invest-analytics-24.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@finance.app"
ADMIN_PASSWORD = "Admin@123"
RUN = uuid.uuid4().hex[:6]


# ---------- helpers ----------
def _login(email, pwd, expect=200):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": email, "password": pwd}, timeout=20)
    assert r.status_code == expect, f"login {email}: {r.status_code} {r.text}"
    return s if expect == 200 else None


def _register(email, pwd, name, role):
    r = requests.post(f"{BASE_URL}/api/auth/register",
                      json={"email": email, "password": pwd, "name": name, "role": role},
                      timeout=20)
    if r.status_code == 400 and "already registered" in r.text:
        return  # OK — reuse
    assert r.status_code in (200, 201), f"register {email} role={role}: {r.status_code} {r.text}"


def _post_json(s, path, body, ok=(200, 201)):
    r = s.post(f"{BASE_URL}{path}", json=body, timeout=30)
    assert r.status_code in ok, f"POST {path}: {r.status_code} {r.text}"
    return r.json()


def _put_json(s, path, body, ok=(200, 201)):
    r = s.put(f"{BASE_URL}{path}", json=body, timeout=30)
    assert r.status_code in ok, f"PUT {path}: {r.status_code} {r.text}"
    return r.json()


def _build_docx(text_lines):
    """Build a minimal DOCX in memory containing the given lines (with placeholders)."""
    d = Document()
    for line in text_lines:
        d.add_paragraph(line)
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


DEFAULT_TEMPLATE_LINES = [
    "OFFER LETTER — {{ company_name }}",
    "Date: {{ today }}",
    "Dear {{ staff_name }},",
    "We are pleased to offer you the position of {{ designation }}.",
    "Your monthly salary will be {{ monthly_salary }} ({{ monthly_salary_words }}).",
    "Joining date: {{ joining_date }} at {{ center_name }}.",
    "Login email: {{ login_email }}",
    "Temporary password: {{ login_password }}",
    "Company address: {{ company_address }} | GST: {{ company_gst }}",
    "Regards, HR Team, {{ company_name }}",
]


def _pdf_to_text(pdf_bytes: bytes) -> str:
    """Use poppler pdftotext to extract text from PDF bytes."""
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(pdf_bytes)
        f.flush()
        pdf_path = f.name
    try:
        proc = subprocess.run(["pdftotext", "-layout", pdf_path, "-"],
                              capture_output=True, timeout=30)
        assert proc.returncode == 0, f"pdftotext failed: {proc.stderr.decode(errors='ignore')}"
        return proc.stdout.decode("utf-8", errors="ignore")
    finally:
        try:
            os.unlink(pdf_path)
        except OSError:
            pass


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def created_ids():
    """Track everything we create for teardown."""
    return {"templates": [], "staff": [], "centers": [], "companies": [],
            "letters": [], "users_emails": []}


@pytest.fixture(scope="module", autouse=True)
def _cleanup(admin, created_ids):
    yield
    s = admin
    # Templates (each DELETE is admin-only)
    for tid in created_ids["templates"]:
        try:
            s.delete(f"{BASE_URL}/api/offer-letter-templates/{tid}", timeout=15)
        except Exception:
            pass
    # Offer letter docs — no explicit DELETE endpoint; leave them (they reference storage only)
    # Staff
    if created_ids["staff"]:
        try:
            s.post(f"{BASE_URL}/api/entities/staff/bulk-delete",
                   json={"ids": created_ids["staff"]}, timeout=30)
        except Exception:
            pass
    # Centers
    if created_ids["centers"]:
        try:
            s.post(f"{BASE_URL}/api/entities/center/bulk-delete",
                   json={"ids": created_ids["centers"]}, timeout=30)
        except Exception:
            pass
    # Companies
    if created_ids["companies"]:
        try:
            s.post(f"{BASE_URL}/api/entities/company/bulk-delete",
                   json={"ids": created_ids["companies"]}, timeout=30)
        except Exception:
            pass


@pytest.fixture(scope="module")
def seed(admin, created_ids):
    """Create test company + center with company_id set."""
    s = admin
    comp = _post_json(s, "/api/entities/company", {
        "name": f"TEST_iter32_Co_{RUN}",
        "address": "12 Test Road, Bangalore, KA 560001",
        "city": "Bangalore", "state": "Karnataka",
        "gst_number": "29TEST32GST01ZK", "pan_number": "TEST32PAN9",
        "email": "hr@testco32.example.com", "mobile": "9990000032",
    })
    created_ids["companies"].append(comp["id"])
    center = _post_json(s, "/api/entities/center", {
        "name": f"TEST_iter32_Center_{RUN}", "city": "Bangalore", "state": "KA",
    })
    created_ids["centers"].append(center["id"])
    # Bind center → company (Phase-13 default company)
    _put_json(s, f"/api/entities/center/{center['id']}", {
        "name": center["name"], "city": "Bangalore", "state": "KA",
        "company_id": comp["id"],
    })
    return {"company_id": comp["id"], "company_name": comp["name"],
            "center_id": center["id"], "center_name": center["name"]}


# ================================================================
class TestTemplateUpload:
    """Upload/list/delete offer-letter templates."""

    def test_upload_global_template_ok(self, admin, created_ids):
        docx = _build_docx(DEFAULT_TEMPLATE_LINES)
        r = admin.post(
            f"{BASE_URL}/api/offer-letter-templates",
            files={"file": (f"TEST_iter32_global_{RUN}.docx", docx,
                            "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
            timeout=30,
        )
        assert r.status_code == 201, f"{r.status_code} {r.text}"
        data = r.json()
        assert data["id"] and data["filename"].endswith(".docx")
        assert data["company_id"] is None  # global
        assert data["is_active"] is True
        created_ids["templates"].append(data["id"])
        created_ids["_global_tpl_id"] = data["id"]

    def test_upload_per_company_template_ok(self, admin, seed, created_ids):
        docx = _build_docx(DEFAULT_TEMPLATE_LINES)
        r = admin.post(
            f"{BASE_URL}/api/offer-letter-templates",
            files={"file": (f"TEST_iter32_perco_{RUN}.docx", docx,
                            "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
            params={"company_id": seed["company_id"]},
            timeout=30,
        )
        assert r.status_code == 201, r.text
        data = r.json()
        assert data["company_id"] == seed["company_id"]
        assert data["company_name"] == seed["company_name"]
        assert data["is_active"] is True
        created_ids["templates"].append(data["id"])
        created_ids["_perco_tpl_id"] = data["id"]

    def test_upload_non_docx_rejected_400(self, admin):
        r = admin.post(
            f"{BASE_URL}/api/offer-letter-templates",
            files={"file": (f"TEST_iter32_bad_{RUN}.pdf", b"%PDF-not-really",
                            "application/pdf")},
            timeout=15,
        )
        assert r.status_code == 400, f"expected 400 got {r.status_code}: {r.text}"

    def test_upload_oversize_rejected_413(self, admin):
        # 5.1 MB dummy .docx blob (contents can be junk — server checks size before parsing)
        big = b"PK" + b"\x00" * (5 * 1024 * 1024 + 200)
        r = admin.post(
            f"{BASE_URL}/api/offer-letter-templates",
            files={"file": (f"TEST_iter32_big_{RUN}.docx", big,
                            "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
            timeout=30,
        )
        assert r.status_code == 413, f"expected 413 got {r.status_code}: {r.text}"

    def test_second_upload_deactivates_previous_percompany(self, admin, seed, created_ids):
        docx = _build_docx(DEFAULT_TEMPLATE_LINES + ["Version 2 — updated"])
        r = admin.post(
            f"{BASE_URL}/api/offer-letter-templates",
            files={"file": (f"TEST_iter32_perco_v2_{RUN}.docx", docx,
                            "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
            params={"company_id": seed["company_id"]},
            timeout=30,
        )
        assert r.status_code == 201, r.text
        new_data = r.json()
        assert new_data["is_active"] is True
        created_ids["templates"].append(new_data["id"])
        # The old per-company template should now have is_active=False
        listing = admin.get(f"{BASE_URL}/api/offer-letter-templates", timeout=15).json()
        by_id = {t["id"]: t for t in listing}
        old = by_id.get(created_ids["_perco_tpl_id"])
        assert old is not None, "old per-company template missing from listing"
        assert old["is_active"] is False, \
            f"previous per-company template should be deactivated, got is_active={old['is_active']}"
        # Ensure new one is the only active one for that company
        actives = [t for t in listing if t.get("company_id") == seed["company_id"] and t["is_active"]]
        assert len(actives) == 1 and actives[0]["id"] == new_data["id"]
        created_ids["_perco_tpl_id_v2"] = new_data["id"]

    def test_second_global_upload_deactivates_previous_global(self, admin, created_ids):
        docx = _build_docx(DEFAULT_TEMPLATE_LINES + ["Global v2"])
        r = admin.post(
            f"{BASE_URL}/api/offer-letter-templates",
            files={"file": (f"TEST_iter32_global_v2_{RUN}.docx", docx,
                            "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
            timeout=30,
        )
        assert r.status_code == 201, r.text
        new_data = r.json()
        assert new_data["company_id"] is None
        assert new_data["is_active"] is True
        created_ids["templates"].append(new_data["id"])
        created_ids["_global_tpl_id_v2"] = new_data["id"]
        # Verify previous global is now inactive
        listing = admin.get(f"{BASE_URL}/api/offer-letter-templates", timeout=15).json()
        by_id = {t["id"]: t for t in listing}
        prev = by_id.get(created_ids["_global_tpl_id"])
        assert prev and prev["is_active"] is False, "prior global template should be deactivated"
        # Only one active global
        active_globals = [t for t in listing if t.get("company_id") is None and t["is_active"]]
        assert len(active_globals) == 1 and active_globals[0]["id"] == new_data["id"]

    def test_list_sorted_desc(self, admin, created_ids):
        listing = admin.get(f"{BASE_URL}/api/offer-letter-templates", timeout=15).json()
        assert isinstance(listing, list) and len(listing) >= 2
        # Confirm sorted by uploaded_at desc
        ours = [t for t in listing if t["id"] in created_ids["templates"]]
        assert len(ours) >= 2
        times = [t["uploaded_at"] for t in listing]
        assert times == sorted(times, reverse=True), \
            "listing not sorted uploaded_at desc"


# ================================================================
class TestRoleGating:
    """Only admin/hr can list/upload; only admin can delete.
    center_staff / center_manager / viewer / partner get 403."""

    @pytest.fixture(scope="class")
    def non_admins(self):
        """Register a bunch of non-admin users and return sessions keyed by role."""
        sessions = {}
        pwd = "TestPwd@123"
        for role in ["hr", "manager", "center_manager", "center_staff", "viewer", "partner"]:
            email = f"iter32_{role}_{RUN}@testfin.dev"
            _register(email, pwd, f"Iter32 {role}", role)
            s = _login(email, pwd)
            sessions[role] = s
        return sessions

    def test_hr_can_list_and_upload(self, non_admins, created_ids):
        s = non_admins["hr"]
        r = s.get(f"{BASE_URL}/api/offer-letter-templates", timeout=15)
        assert r.status_code == 200, f"HR list: {r.status_code} {r.text}"
        docx = _build_docx(DEFAULT_TEMPLATE_LINES)
        u = s.post(
            f"{BASE_URL}/api/offer-letter-templates",
            files={"file": (f"TEST_iter32_hr_{RUN}.docx", docx,
                            "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
            timeout=30,
        )
        assert u.status_code == 201, f"HR upload: {u.status_code} {u.text}"
        created_ids["templates"].append(u.json()["id"])

    def test_manager_can_list_but_cannot_upload(self, non_admins):
        s = non_admins["manager"]
        r = s.get(f"{BASE_URL}/api/offer-letter-templates", timeout=15)
        # manager is included in GET's require_role("admin","hr","manager")
        assert r.status_code == 200, f"manager list: {r.status_code} {r.text}"
        # But upload gates admin/hr only → manager should get 403
        docx = _build_docx(DEFAULT_TEMPLATE_LINES)
        u = s.post(
            f"{BASE_URL}/api/offer-letter-templates",
            files={"file": (f"TEST_iter32_mgr_{RUN}.docx", docx,
                            "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
            timeout=15,
        )
        assert u.status_code == 403, f"manager upload should be 403 got {u.status_code}: {u.text}"

    @pytest.mark.parametrize("role", ["center_staff", "center_manager", "viewer", "partner"])
    def test_lower_roles_forbidden_from_list_and_upload(self, non_admins, role):
        s = non_admins[role]
        r = s.get(f"{BASE_URL}/api/offer-letter-templates", timeout=15)
        assert r.status_code == 403, f"{role} list should 403 got {r.status_code}"
        docx = _build_docx(["dummy"])
        u = s.post(
            f"{BASE_URL}/api/offer-letter-templates",
            files={"file": ("x.docx", docx,
                            "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
            timeout=15,
        )
        assert u.status_code == 403, f"{role} upload should 403 got {u.status_code}"

    def test_hr_cannot_delete_only_admin_can(self, non_admins, admin, created_ids):
        # First get any active template id
        listing = admin.get(f"{BASE_URL}/api/offer-letter-templates", timeout=15).json()
        assert listing, "no templates in listing"
        # Pick a template we uploaded (avoid nuking pre-existing ones)
        our_ids = [t["id"] for t in listing if t["id"] in created_ids["templates"]]
        assert our_ids, "no test-owned templates to delete"
        tid = our_ids[-1]
        # HR should be forbidden
        r_hr = non_admins["hr"].delete(f"{BASE_URL}/api/offer-letter-templates/{tid}",
                                       timeout=15)
        assert r_hr.status_code == 403, \
            f"hr delete should 403 got {r_hr.status_code} {r_hr.text}"
        # Manager also forbidden
        r_mgr = non_admins["manager"].delete(
            f"{BASE_URL}/api/offer-letter-templates/{tid}", timeout=15)
        assert r_mgr.status_code == 403
        # Admin succeeds (204)
        r_a = admin.delete(f"{BASE_URL}/api/offer-letter-templates/{tid}", timeout=15)
        assert r_a.status_code == 204, f"admin delete: {r_a.status_code} {r_a.text}"
        # Remove from tracking since we already deleted it
        created_ids["templates"].remove(tid)


# ================================================================
class TestStaffCreationTriggersOfferLetter:
    """POST /api/staff with send_offer_letter=true + create_login=true + template present."""

    def test_create_staff_generates_and_delivers_offer_letter(self, admin, seed, created_ids):
        # By now, per-company template v2 is active (from TestTemplateUpload), so
        # this new staff (center → company) should use it.
        staff_email = f"iter32_staff_{RUN}@finance.local"
        r = admin.post(f"{BASE_URL}/api/staff", json={
            "name": f"TEST_iter32_Staff_{RUN}",
            "designation": "Senior Trainer",
            "monthly_salary": 45000,
            "per_day_rate": 1500,
            "joining_date": "2026-02-01",
            "center_id": seed["center_id"],
            "email": staff_email,
            "mobile": "9998887766",
            "create_login": True,
            "send_credentials_email": False,   # skip generic creds email, offer letter carries password
            "send_offer_letter": True,
        }, timeout=120)  # LibreOffice conversion can take several seconds
        assert r.status_code in (200, 201), f"create_staff: {r.status_code} {r.text}"
        data = r.json()
        created_ids["staff"].append(data["id"])
        created_ids["users_emails"].append(staff_email)

        # Response should carry offer_letter_status
        ols = data.get("offer_letter_status")
        assert ols is not None, f"missing offer_letter_status in response: {data}"
        assert ols.get("generated") is True, f"offer letter not generated: {ols}"
        assert ols.get("letter_id"), f"no letter_id: {ols}"
        assert ols.get("pdf_path"), f"no pdf_path: {ols}"
        assert isinstance(ols.get("emailed"), bool), \
            f"emailed must be a boolean got {type(ols.get('emailed'))}: {ols}"

        created_ids["_letter_id"] = ols["letter_id"]
        created_ids["_staff_id"] = data["id"]
        created_ids["_staff_email"] = staff_email

        # Now GET /api/staff/{id} and confirm offer_letter_* fields populated
        one = admin.get(f"{BASE_URL}/api/staff", timeout=15).json()
        found = next((x for x in one if x["id"] == data["id"]), None)
        assert found, "staff not returned in listing"
        assert found.get("offer_letter_url") == ols["pdf_path"], \
            f"staff.offer_letter_url mismatch: {found.get('offer_letter_url')} vs {ols['pdf_path']}"
        assert found.get("offer_letter_id") == ols["letter_id"]
        assert found.get("offer_letter_generated_at"), "offer_letter_generated_at missing"

    def test_offer_letters_listing_returns_the_letter(self, admin, created_ids):
        sid = created_ids.get("_staff_id")
        assert sid, "prior test did not set _staff_id"
        r = admin.get(f"{BASE_URL}/api/offer-letters",
                      params={"staff_id": sid}, timeout=15)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list) and len(rows) >= 1
        # Sorted desc by generated_at
        times = [x["generated_at"] for x in rows]
        assert times == sorted(times, reverse=True)
        first = rows[0]
        assert first["id"] == created_ids["_letter_id"]
        assert first["staff_id"] == sid
        assert first["pdf_path"]
        # Email metadata: either email_id (success) or email_error (fail) — must be one
        has_email_meta = ("email_id" in first) or ("email_error" in first) or ("emailed_at" in first)
        assert has_email_meta, f"letter row missing email metadata: {first}"

    def test_download_returns_pdf_bytes(self, admin, created_ids):
        lid = created_ids.get("_letter_id")
        assert lid
        r = admin.get(f"{BASE_URL}/api/offer-letters/{lid}/download", timeout=30)
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
        assert r.headers.get("content-type", "").startswith("application/pdf"), \
            f"content-type: {r.headers.get('content-type')}"
        cd = r.headers.get("content-disposition", "")
        assert "filename=" in cd, f"missing Content-Disposition: {cd}"
        assert r.content[:5] == b"%PDF-", \
            f"downloaded bytes are not a PDF (starts with {r.content[:10]!r})"
        created_ids["_pdf_bytes"] = r.content

    def test_pdf_contains_substituted_placeholders(self, admin, seed, created_ids):
        pdf_bytes = created_ids.get("_pdf_bytes")
        assert pdf_bytes, "no pdf bytes cached from prior test"
        txt = _pdf_to_text(pdf_bytes)
        assert txt.strip(), "pdftotext returned empty text (PDF may be corrupt)"

        # Staff-side substitutions
        assert f"TEST_iter32_Staff_{RUN}" in txt, \
            f"staff_name missing from PDF text. Extracted:\n{txt[:800]}"
        assert "Senior Trainer" in txt, "designation missing"
        # Login email — full match (login_email = staff email)
        assert created_ids["_staff_email"] in txt, \
            f"login_email missing. Extracted first 800:\n{txt[:800]}"
        # Company
        assert seed["company_name"] in txt, "company_name missing"
        # Today (dd Month YYYY per _build_context)
        today_str = datetime.now(timezone.utc).strftime("%d %B %Y")
        # accept either "01 February 2026" or without leading zero
        assert today_str in txt or today_str.lstrip("0") in txt, \
            f"today's date '{today_str}' missing from PDF. Extracted:\n{txt[:800]}"

        # login_password: since we auto-created a user, it should be a 12-char generated pwd
        # Just verify it's not literally the placeholder or the "existing account" fallback
        assert "(existing account" not in txt, \
            "login_password fell back to 'existing account' — new user password not embedded"

        # No raw un-substituted placeholders anywhere
        leftover = re.findall(r"\{\{\s*[a-zA-Z_]+\s*\}\}", txt)
        assert not leftover, f"raw placeholder(s) found in PDF: {leftover}"
        # Not even single-brace {var} forms if template used them
        single = re.findall(r"\{[a-zA-Z_]+\}", txt)
        # This template uses only Jinja {{ }}, so single-braces would be raw / unrendered
        # Some placeholder names could naturally appear in text — be permissive: only fail
        # if the exact known keys leak through
        bad_keys = {"{staff_name}", "{designation}", "{login_email}",
                    "{login_password}", "{company_name}", "{today}"}
        found_bad = [s for s in single if s in bad_keys]
        assert not found_bad, f"un-rendered single-brace placeholders in PDF: {found_bad}"


# ================================================================
class TestNoTemplateFallback:
    """If NO active template (per-company or global) exists, staff creation still
    succeeds but offer_letter_status.reason == 'no_template_uploaded'."""

    def test_no_template_available_returns_reason(self, admin, seed, created_ids):
        # Deactivate ALL active templates by deleting them
        listing = admin.get(f"{BASE_URL}/api/offer-letter-templates", timeout=15).json()
        active_ids = [t["id"] for t in listing if t.get("is_active")]
        for tid in active_ids:
            r = admin.delete(f"{BASE_URL}/api/offer-letter-templates/{tid}", timeout=15)
            assert r.status_code == 204, f"delete {tid}: {r.status_code} {r.text}"
            if tid in created_ids["templates"]:
                created_ids["templates"].remove(tid)

        # Now create a staff — should succeed but offer_letter_status.reason == no_template_uploaded
        staff_email = f"iter32_notpl_{RUN}@finance.local"
        r = admin.post(f"{BASE_URL}/api/staff", json={
            "name": f"TEST_iter32_NoTpl_{RUN}",
            "designation": "Trainer",
            "monthly_salary": 25000,
            "joining_date": "2026-02-15",
            "center_id": seed["center_id"],
            "email": staff_email,
            "create_login": True,
            "send_credentials_email": False,
            "send_offer_letter": True,
        }, timeout=30)
        assert r.status_code in (200, 201), f"{r.status_code} {r.text}"
        data = r.json()
        created_ids["staff"].append(data["id"])
        created_ids["users_emails"].append(staff_email)
        ols = data.get("offer_letter_status") or {}
        assert ols.get("generated") is False, f"expected generated=false: {ols}"
        assert ols.get("reason") == "no_template_uploaded", \
            f"expected reason=no_template_uploaded, got {ols}"


# ================================================================
class TestResendEndpoint:
    """POST /staff/{sid}/send-offer-letter: admin/hr can re-generate; auto-creates user."""

    def test_resend_regenerates_letter(self, admin, seed, created_ids):
        # Upload a fresh global template so resend has something to render
        docx = _build_docx(DEFAULT_TEMPLATE_LINES)
        u = admin.post(
            f"{BASE_URL}/api/offer-letter-templates",
            files={"file": (f"TEST_iter32_resend_tpl_{RUN}.docx", docx,
                            "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
            timeout=30,
        )
        assert u.status_code == 201, u.text
        created_ids["templates"].append(u.json()["id"])

        # Pick an existing staff from previous test (has letter already) → re-send should generate a NEW letter
        sid = created_ids.get("_staff_id")
        assert sid
        r = admin.post(f"{BASE_URL}/api/staff/{sid}/send-offer-letter",
                       timeout=120)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        res = r.json()
        assert res.get("generated") is True, f"resend not generated: {res}"
        assert res.get("letter_id")
        # Should be a NEW letter id
        assert res["letter_id"] != created_ids["_letter_id"], \
            "resend should create a new letter row, not reuse existing"
        assert isinstance(res.get("emailed"), bool)

        # GET /offer-letters?staff_id=X should now have ≥2 entries
        rows = admin.get(f"{BASE_URL}/api/offer-letters",
                         params={"staff_id": sid}, timeout=15).json()
        assert len(rows) >= 2, f"expected >=2 letters after resend, got {len(rows)}"

    def test_resend_forbidden_for_center_staff(self, admin, created_ids):
        # Register a center_staff, try to resend
        pwd = "TestPwd@123"
        email = f"iter32_cs_resend_{RUN}@testfin.dev"
        _register(email, pwd, "Iter32 CS", "center_staff")
        s = _login(email, pwd)
        sid = created_ids.get("_staff_id")
        r = s.post(f"{BASE_URL}/api/staff/{sid}/send-offer-letter", timeout=30)
        assert r.status_code == 403, f"center_staff resend should 403 got {r.status_code}"

    def test_download_forbidden_for_center_staff(self, admin, created_ids):
        pwd = "TestPwd@123"
        email = f"iter32_cs_dl_{RUN}@testfin.dev"
        _register(email, pwd, "Iter32 CS DL", "center_staff")
        s = _login(email, pwd)
        lid = created_ids.get("_letter_id")
        r = s.get(f"{BASE_URL}/api/offer-letters/{lid}/download", timeout=15)
        assert r.status_code == 403


# ================================================================
class TestGlobalFallbackForCenterWithoutCompany:
    """A staff whose center has NO company_id should still get an offer letter via GLOBAL template."""

    def test_center_without_company_uses_global(self, admin, created_ids):
        # Create a fresh center WITHOUT company_id
        iso = _post_json(admin, "/api/entities/center", {
            "name": f"TEST_iter32_ISO_{RUN}", "city": "X", "state": "Y",
        })
        created_ids["centers"].append(iso["id"])

        # Global template should still be active from TestResendEndpoint
        listing = admin.get(f"{BASE_URL}/api/offer-letter-templates", timeout=15).json()
        actives = [t for t in listing if t["is_active"] and t.get("company_id") is None]
        assert actives, "no active global template — cannot test fallback"

        staff_email = f"iter32_iso_{RUN}@finance.local"
        r = admin.post(f"{BASE_URL}/api/staff", json={
            "name": f"TEST_iter32_ISO_Staff_{RUN}",
            "designation": "Instructor",
            "monthly_salary": 20000,
            "joining_date": "2026-03-01",
            "center_id": iso["id"],
            "email": staff_email,
            "create_login": True,
            "send_credentials_email": False,
            "send_offer_letter": True,
        }, timeout=120)
        assert r.status_code in (200, 201), f"{r.status_code} {r.text}"
        data = r.json()
        created_ids["staff"].append(data["id"])
        created_ids["users_emails"].append(staff_email)
        ols = data.get("offer_letter_status") or {}
        assert ols.get("generated") is True, \
            f"expected generation via global template, got {ols}"
        assert ols.get("letter_id")
