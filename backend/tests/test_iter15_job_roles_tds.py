"""Iteration-15 backend tests:
- BatchIn.job_roles (rows: category 1|2|3, job_role, candidates, hours) persistence + update
- GET /api/batches/{bid}/compute-1st-milestone: math + rates dict + uniform_per_candidate
- BatchPaymentIn.uniform_amount persistence (1st milestone)
- PATCH /api/batch-payments/{pid}/receive with body {tds_percent: 0|2|10}
   * uniform excluded from taxable
   * tds_amount / net_amount on BatchPaymentOut
   * separate expense txn source='tds_deduction' when tds>0
   * income txn still GROSS, not net
- 422 on invalid tds_percent
- backfill: legacy batches without job_roles still load
"""
import os
import uuid
import requests
import pytest


def _read_url():
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL"):
                    return line.split("=", 1)[1].strip()
    except Exception:
        pass
    return ""


BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _read_url()).rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "admin@finance.app"
ADMIN_PWD = "Admin@123"
TAG = uuid.uuid4().hex[:6]

# Canonical math per spec
CAT_RATES = {"1": 56.35, "2": 52.50, "3": 36.85}
UNIFORM_PER_CAND = 1000.0


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN_EMAIL, ADMIN_PWD)


@pytest.fixture(scope="module")
def project_id(admin):
    r = admin.post(f"{API}/entities/project", json={"name": f"TEST_iter15_proj_{TAG}"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.fixture(scope="module")
def center_id(admin):
    r = admin.post(f"{API}/entities/center", json={"name": f"TEST_iter15_center_{TAG}"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["id"]


# ---------- Helpers ----------
def _spec_rows():
    """Reference example from the spec: 10×Cat1×200h + 5×Cat2×150h + 8×Cat3×100h."""
    return [
        {"category": "1", "job_role": "Trainer", "candidates": 10, "hours": 200},
        {"category": "2", "job_role": "Assistant", "candidates": 5, "hours": 150},
        {"category": "3", "job_role": "Helper", "candidates": 8, "hours": 100},
    ]


def _create_batch(admin, project_id, center_id, job_roles, name_suffix=""):
    r = admin.post(f"{API}/batches", json={
        "project_id": project_id,
        "center_id": center_id,
        "partner_ids": [],
        "name": f"TEST_iter15_batch_{TAG}_{name_suffix or uuid.uuid4().hex[:4]}",
        "total_beneficiaries": 23,
        "job_roles": job_roles,
    }, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


# ============ Batch job_roles persistence ============
class TestBatchJobRolesPersistence:
    def test_create_batch_with_job_roles_persists(self, admin, project_id, center_id):
        rows = _spec_rows()
        b = _create_batch(admin, project_id, center_id, rows, "create")
        assert "id" in b
        assert isinstance(b.get("job_roles"), list)
        assert len(b["job_roles"]) == 3
        # verify category, job_role, candidates, hours echoed back exactly
        for src, got in zip(rows, b["job_roles"]):
            assert got["category"] == src["category"]
            assert got["job_role"] == src["job_role"]
            assert int(got["candidates"]) == src["candidates"]
            assert float(got["hours"]) == float(src["hours"])

        # GET also persists
        gr = admin.get(f"{API}/batches", params={"project_id": project_id}, timeout=15)
        assert gr.status_code == 200
        found = next((x for x in gr.json() if x["id"] == b["id"]), None)
        assert found, "batch not in list"
        assert len(found.get("job_roles") or []) == 3

    def test_update_batch_job_roles(self, admin, project_id, center_id):
        b = _create_batch(admin, project_id, center_id, _spec_rows(), "update")
        bid = b["id"]
        # update with only 1 row
        new_rows = [{"category": "2", "job_role": "Lead", "candidates": 3, "hours": 80}]
        r = admin.put(f"{API}/batches/{bid}", json={
            "project_id": b["project_id"],
            "center_id": b.get("center_id"),
            "partner_ids": b.get("partner_ids") or [],
            "name": b["name"],
            "total_beneficiaries": b.get("total_beneficiaries", 0),
            "job_roles": new_rows,
        }, timeout=15)
        assert r.status_code == 200, r.text
        out = r.json()
        assert len(out["job_roles"]) == 1
        assert out["job_roles"][0]["job_role"] == "Lead"
        assert int(out["job_roles"][0]["candidates"]) == 3

    def test_backfill_batch_without_job_roles_loads(self, admin, project_id, center_id):
        """Legacy batch (no job_roles in payload) must still create + read back fine."""
        r = admin.post(f"{API}/batches", json={
            "project_id": project_id,
            "center_id": center_id,
            "partner_ids": [],
            "name": f"TEST_iter15_legacy_{TAG}",
            "total_beneficiaries": 0,
        }, timeout=15)
        assert r.status_code == 200, r.text
        out = r.json()
        # default empty list
        assert out.get("job_roles") == []
        # GET endpoint also OK
        bid = out["id"]
        ls = admin.get(f"{API}/batches", params={"project_id": project_id}, timeout=15)
        assert ls.status_code == 200
        assert any(x["id"] == bid for x in ls.json())


# ============ /compute-1st-milestone math ============
class TestComputeFirstMilestone:
    def test_compute_spec_example_exact(self, admin, project_id, center_id):
        """10×Cat1×200 + 5×Cat2×150 + 8×Cat3×100 + 23×1000 = ₹2,04,555."""
        b = _create_batch(admin, project_id, center_id, _spec_rows(), "spec")
        r = admin.get(f"{API}/batches/{b['id']}/compute-1st-milestone", timeout=15)
        assert r.status_code == 200, r.text
        out = r.json()
        # core fields
        for k in ("rows", "role_total", "uniform_total", "total", "total_candidates", "rates", "uniform_per_candidate"):
            assert k in out, f"missing {k}"
        # math
        expected_role = round(10*56.35*200 + 5*52.50*150 + 8*36.85*100, 2)
        assert out["role_total"] == expected_role
        assert out["total_candidates"] == 23
        assert out["uniform_total"] == 23 * 1000.0
        # NOTE: Legacy endpoint /compute-1st-milestone — under iter-16 spec change,
        # 'total' represents the 1st-milestone amount = 30% × role + uniform
        # (no longer 100% × role + uniform). Use /compute-milestones for full breakdown.
        expected_first = round(expected_role * 0.30 + 23*1000.0, 2)
        assert out["total"] == expected_first
        assert out["role_total"] == 181555.0
        assert out["uniform_total"] == 23000.0
        # rates + uniform constant
        assert out["rates"] == CAT_RATES
        assert out["uniform_per_candidate"] == UNIFORM_PER_CAND
        # rows have row_total + rate
        assert len(out["rows"]) == 3
        r0 = out["rows"][0]
        assert r0["rate"] == 56.35
        assert r0["row_total"] == round(10*56.35*200, 2)

    def test_compute_with_zero_candidates_row(self, admin, project_id, center_id):
        rows = [
            {"category": "1", "job_role": "X", "candidates": 0, "hours": 200},
            {"category": "2", "job_role": "Y", "candidates": 5, "hours": 100},
        ]
        b = _create_batch(admin, project_id, center_id, rows, "zerocand")
        r = admin.get(f"{API}/batches/{b['id']}/compute-1st-milestone", timeout=15)
        assert r.status_code == 200
        out = r.json()
        # zero row contributes 0
        assert out["total_candidates"] == 5
        assert out["role_total"] == round(5*52.50*100, 2)
        assert out["uniform_total"] == 5000.0

    def test_compute_empty_job_roles_returns_zeros(self, admin, project_id, center_id):
        b = _create_batch(admin, project_id, center_id, [], "empty")
        r = admin.get(f"{API}/batches/{b['id']}/compute-1st-milestone", timeout=15)
        assert r.status_code == 200
        out = r.json()
        assert out["rows"] == []
        assert out["role_total"] == 0
        assert out["uniform_total"] == 0
        assert out["total"] == 0
        assert out["total_candidates"] == 0


# ============ BatchPayment uniform_amount + TDS receive ============
@pytest.fixture(scope="module")
def first_milestone_payment(admin, project_id, center_id):
    """Create a 1st milestone payment matching the spec gross/uniform."""
    b = _create_batch(admin, project_id, center_id, _spec_rows(), "pay1")
    r = admin.post(f"{API}/batch-payments", json={
        "batch_id": b["id"],
        "milestone": "1st",
        "amount": 204555.0,
        "uniform_amount": 23000.0,
        "description": "TEST_iter15_1st_pay",
    }, timeout=15)
    assert r.status_code == 200, r.text
    p = r.json()
    return {"batch": b, "payment": p}


class TestBatchPaymentUniformPersistence:
    def test_create_batch_payment_persists_uniform(self, first_milestone_payment):
        p = first_milestone_payment["payment"]
        assert p["amount"] == 204555.0
        assert p["uniform_amount"] == 23000.0
        assert p["status"] == "pending"
        # default tds fields
        assert p["tds_percent"] == 0
        assert p["tds_amount"] == 0

    def test_get_batch_payments_returns_uniform(self, admin, first_milestone_payment):
        bid = first_milestone_payment["batch"]["id"]
        r = admin.get(f"{API}/batch-payments", params={"batch_id": bid}, timeout=15)
        assert r.status_code == 200
        pays = r.json()
        first = next((x for x in pays if x["milestone"] == "1st"), None)
        assert first is not None
        assert first["uniform_amount"] == 23000.0


class TestReceiveWithTDS:
    def test_invalid_tds_percent_422(self, admin, project_id, center_id):
        b = _create_batch(admin, project_id, center_id, _spec_rows(), "tdsinvalid")
        r = admin.post(f"{API}/batch-payments", json={
            "batch_id": b["id"], "milestone": "1st",
            "amount": 100.0, "uniform_amount": 0,
        }, timeout=15)
        assert r.status_code == 200, r.text
        pid = r.json()["id"]
        # invalid value 5
        bad = admin.patch(f"{API}/batch-payments/{pid}/receive",
                          json={"tds_percent": 5}, timeout=15)
        assert bad.status_code == 422, f"expected 422 got {bad.status_code}: {bad.text}"

    def test_receive_no_tds_default_body(self, admin, project_id, center_id):
        """tds_percent=0 → no TDS expense txn; net = gross; income txn = gross."""
        b = _create_batch(admin, project_id, center_id, _spec_rows(), "notds")
        cp = admin.post(f"{API}/batch-payments", json={
            "batch_id": b["id"], "milestone": "1st",
            "amount": 204555.0, "uniform_amount": 23000.0,
        }, timeout=15)
        assert cp.status_code == 200
        pid = cp.json()["id"]
        # call with no body (default ReceivePaymentIn → tds_percent=0)
        r = admin.patch(f"{API}/batch-payments/{pid}/receive", timeout=15)
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["status"] == "received"
        assert out["tds_percent"] == 0
        assert out["tds_amount"] == 0
        assert out["net_amount"] == 204555.0
        # No tds_deduction txn should be created for this batch's project
        txns = admin.get(f"{API}/transactions",
                         params={"project_id": b["project_id"]}, timeout=15)
        assert txns.status_code == 200
        rows = txns.json()
        tds_rows = [t for t in rows if t.get("source") == "tds_deduction"]
        assert tds_rows == [], f"unexpected tds txn(s): {tds_rows}"
        # Income txn = gross amount
        inc = [t for t in rows if t.get("source") == "milestone" and t.get("milestone") == "1st"]
        assert any(round(t["amount"], 2) == 204555.0 for t in inc), \
            f"income txn @ gross 204555 not found in {[t['amount'] for t in inc]}"

    def test_receive_tds_2_pct_spec_math(self, admin, first_milestone_payment):
        """gross=2,04,555, uniform=23,000, tds=2% → tds_amount=3,631.10, net=2,00,923.90."""
        pid = first_milestone_payment["payment"]["id"]
        batch = first_milestone_payment["batch"]
        r = admin.patch(f"{API}/batch-payments/{pid}/receive",
                        json={"tds_percent": 2}, timeout=15)
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["status"] == "received"
        assert out["tds_percent"] == 2
        assert out["tds_amount"] == 3631.10
        assert out["net_amount"] == 200923.90

        # An expense txn with source='tds_deduction' must exist
        txns = admin.get(f"{API}/transactions",
                         params={"project_id": batch["project_id"]}, timeout=15)
        assert txns.status_code == 200
        rows = txns.json()
        tds = [t for t in rows if t.get("source") == "tds_deduction"
               and round(t.get("amount", 0), 2) == 3631.10]
        assert tds, "expected tds_deduction expense txn ₹3631.10 not found"
        t = tds[0]
        assert t["type"] == "expense"
        assert t["status"] == "approved"

        # Income txn(s) sum to GROSS not net
        inc = [t for t in rows if t.get("source") == "milestone"
               and t.get("milestone") == "1st"
               and t.get("project_id") == batch["project_id"]]
        # filter to this batch by description match (name)
        inc = [t for t in inc if batch["name"] in (t.get("description") or "")]
        assert inc, "no income txns for this batch"
        s = round(sum(t["amount"] for t in inc), 2)
        assert s == 204555.0, f"income sum {s} != gross 204555"

    def test_receive_tds_10_pct_no_uniform(self, admin, project_id, center_id):
        """uniform=0, tds=10 → tds = gross × 0.10 exactly."""
        b = _create_batch(admin, project_id, center_id, [], "tds10")
        cp = admin.post(f"{API}/batch-payments", json={
            "batch_id": b["id"], "milestone": "2nd",
            "amount": 50000.0, "uniform_amount": 0,
        }, timeout=15)
        assert cp.status_code == 200, cp.text
        pid = cp.json()["id"]
        r = admin.patch(f"{API}/batch-payments/{pid}/receive",
                        json={"tds_percent": 10}, timeout=15)
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["tds_amount"] == 5000.0
        assert out["net_amount"] == 45000.0
        assert out["tds_percent"] == 10

    def test_receive_already_received_400(self, admin, first_milestone_payment):
        pid = first_milestone_payment["payment"]["id"]
        r = admin.patch(f"{API}/batch-payments/{pid}/receive",
                        json={"tds_percent": 2}, timeout=15)
        assert r.status_code == 400
