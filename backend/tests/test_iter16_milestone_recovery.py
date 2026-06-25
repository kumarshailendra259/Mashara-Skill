"""Iter-16 tests: 3-milestone breakdown + 2nd-milestone candidate recovery.

Covers:
 - BatchIn.passed_candidates / placed_candidates persistence
 - GET /batches/{bid}/compute-milestones formula + edge cases
 - BatchPaymentIn.recovery_amount persistence
 - PATCH /batch-payments/{pid}/receive creates separate candidate_recovery + tds_deduction txns
 - Net amount math: gross - tds - recovery (income txn at gross)
 - Backward-compat /compute-1st-milestone
"""
import os
import uuid
import pytest
import requests

def _read_frontend_env():
    p = "/app/frontend/.env"
    if os.path.exists(p):
        for line in open(p):
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip()
    return os.environ.get("REACT_APP_BACKEND_URL", "")


BASE_URL = _read_frontend_env().rstrip("/")
ADMIN_EMAIL = "admin@finance.app"
ADMIN_PWD = "Admin@123"


@pytest.fixture(scope="module")
def admin_client():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PWD})
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def project_center(admin_client):
    pname = f"TEST_proj_{uuid.uuid4().hex[:6]}"
    cname = f"TEST_center_{uuid.uuid4().hex[:6]}"
    p = admin_client.post(f"{BASE_URL}/api/entities/project", json={"name": pname, "description": ""})
    c = admin_client.post(f"{BASE_URL}/api/entities/center", json={"name": cname, "description": ""})
    assert p.status_code == 200 and c.status_code == 200
    return {"project_id": p.json()["id"], "center_id": c.json()["id"]}


def _mk_batch(client, project_center, **overrides):
    body = {
        "name": f"TEST_batch_{uuid.uuid4().hex[:6]}",
        "project_id": project_center["project_id"],
        "center_id": project_center["center_id"],
        "partner_ids": [],
        "start_date": "2025-01-01",
        "end_date": "2025-06-30",
        "candidates_count": 30,
        "passed_candidates": 26,
        "placed_candidates": 20,
        "job_roles": [{"category": "1", "job_role": "Trainer", "candidates": 30, "hours": 200}],
    }
    body.update(overrides)
    r = client.post(f"{BASE_URL}/api/batches", json=body)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- 1. BatchIn passed/placed persist ----------
def test_batch_persists_passed_placed(admin_client, project_center):
    b = _mk_batch(admin_client, project_center)
    assert b["passed_candidates"] == 26
    assert b["placed_candidates"] == 20
    # GET retrieves them
    r = admin_client.get(f"{BASE_URL}/api/batches")
    rec = next(x for x in r.json() if x["id"] == b["id"])
    assert rec["passed_candidates"] == 26
    assert rec["placed_candidates"] == 20


# ---------- 2. Canonical example math (30/26/20, 200hrs Cat1) ----------
def test_compute_milestones_canonical_example(admin_client, project_center):
    b = _mk_batch(admin_client, project_center)
    r = admin_client.get(f"{BASE_URL}/api/batches/{b['id']}/compute-milestones")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["role_total"] == 338100.0
    assert d["uniform_total"] == 30000.0
    assert d["total_candidates"] == 30
    assert d["passed_candidates"] == 26
    assert d["failed_candidates"] == 4
    assert d["placed_candidates"] == 20
    assert d["shares"] == {"1st": 0.30, "2nd": 0.40, "3rd": 0.30}
    bm = d["by_milestone"]
    assert bm["1st"]["amount"] == 131430.0
    assert bm["1st"]["uniform"] == 30000.0
    assert bm["1st"]["role_portion"] == 101430.0
    assert bm["2nd"]["gross"] == 117208.0
    assert bm["2nd"]["recovery"] == 13524.0
    assert bm["2nd"]["amount"] == 103684.0
    assert bm["2nd"]["failed_count"] == 4
    assert bm["3rd"]["amount"] == 67620.0


# ---------- 3. Edge cases ----------
def test_compute_milestones_zero_candidates(admin_client, project_center):
    b = _mk_batch(admin_client, project_center,
                  candidates_count=0, passed_candidates=0, placed_candidates=0,
                  job_roles=[])
    r = admin_client.get(f"{BASE_URL}/api/batches/{b['id']}/compute-milestones")
    assert r.status_code == 200
    d = r.json()
    assert d["role_total"] == 0
    assert d["by_milestone"]["1st"]["amount"] == 0
    assert d["by_milestone"]["2nd"]["amount"] == 0
    assert d["by_milestone"]["2nd"]["gross"] == 0
    assert d["by_milestone"]["2nd"]["recovery"] == 0
    assert d["by_milestone"]["3rd"]["amount"] == 0


def test_compute_passed_equals_total_no_recovery(admin_client, project_center):
    b = _mk_batch(admin_client, project_center, passed_candidates=30, placed_candidates=30)
    d = admin_client.get(f"{BASE_URL}/api/batches/{b['id']}/compute-milestones").json()
    assert d["by_milestone"]["2nd"]["recovery"] == 0.0
    # Full 40% × role
    assert d["by_milestone"]["2nd"]["gross"] == round(338100 * 0.40, 2)
    assert d["by_milestone"]["2nd"]["amount"] == round(338100 * 0.40, 2)
    # 3rd at 100% placed = 30% × role
    assert d["by_milestone"]["3rd"]["amount"] == round(338100 * 0.30, 2)


def test_compute_passed_zero_full_recovery(admin_client, project_center):
    b = _mk_batch(admin_client, project_center, passed_candidates=0, placed_candidates=0)
    d = admin_client.get(f"{BASE_URL}/api/batches/{b['id']}/compute-milestones").json()
    assert d["by_milestone"]["2nd"]["gross"] == 0.0
    assert d["by_milestone"]["2nd"]["recovery"] == round(338100 * 0.30, 2)
    # net is negative
    assert d["by_milestone"]["2nd"]["amount"] == round(0 - 338100 * 0.30, 2)


def test_compute_passed_over_total_clamped(admin_client, project_center):
    """passed > total should be clamped (no 422)."""
    b = _mk_batch(admin_client, project_center, passed_candidates=50, placed_candidates=50)
    d = admin_client.get(f"{BASE_URL}/api/batches/{b['id']}/compute-milestones").json()
    assert d["passed_candidates"] == 30
    assert d["placed_candidates"] == 30


def test_negative_inputs_rejected(admin_client, project_center):
    body = {
        "name": "TEST_neg",
        "project_id": project_center["project_id"],
        "center_id": project_center["center_id"],
        "partner_ids": [],
        "start_date": "2025-01-01",
        "end_date": "2025-06-30",
        "candidates_count": 30,
        "passed_candidates": -5,
        "placed_candidates": 0,
        "job_roles": [{"category": "1", "job_role": "Trainer", "candidates": 30, "hours": 200}],
    }
    r = admin_client.post(f"{BASE_URL}/api/batches", json=body)
    assert r.status_code == 422


# ---------- 4. Backward compat ----------
def test_compute_1st_milestone_legacy(admin_client, project_center):
    b = _mk_batch(admin_client, project_center)
    r = admin_client.get(f"{BASE_URL}/api/batches/{b['id']}/compute-1st-milestone")
    assert r.status_code == 200
    d = r.json()
    assert d["role_total"] == 338100.0
    assert d["uniform_total"] == 30000.0
    assert d["total"] == 131430.0


# ---------- 5. BatchPayment recovery persistence ----------
def test_batch_payment_persists_recovery(admin_client, project_center):
    b = _mk_batch(admin_client, project_center)
    p = admin_client.post(f"{BASE_URL}/api/batch-payments", json={
        "batch_id": b["id"],
        "milestone": "2nd",
        "amount": 117208,
        "expected_date": "2025-04-01",
        "description": "2nd milestone gross",
        "uniform_amount": 0,
        "recovery_amount": 13524,
    })
    assert p.status_code == 200, p.text
    assert p.json()["recovery_amount"] == 13524


# ---------- 6. Receive flow with recovery + TDS ----------
def test_receive_creates_recovery_and_tds_txns(admin_client, project_center):
    b = _mk_batch(admin_client, project_center)
    p = admin_client.post(f"{BASE_URL}/api/batch-payments", json={
        "batch_id": b["id"],
        "milestone": "2nd",
        "amount": 117208,
        "expected_date": "2025-04-01",
        "description": "2nd milestone gross",
        "uniform_amount": 0,
        "recovery_amount": 13524,
    }).json()
    r = admin_client.patch(f"{BASE_URL}/api/batch-payments/{p['id']}/receive",
                           json={"tds_percent": 2})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "received"
    # NOTE: Iter-18 spec change — TDS taxable now = (gross − uniform − recovery), not just (gross − uniform).
    # So taxable = 117208 − 0 − 13524 = 103684, TDS @ 2% = 2073.68.
    assert d["tds_amount"] == pytest.approx(2073.68, abs=0.01)
    assert d["recovery_amount"] == 13524
    assert d["net_amount"] == pytest.approx(117208 - 2073.68 - 13524, abs=0.01)
    # Verify both expense txns exist
    txns = admin_client.get(f"{BASE_URL}/api/transactions",
                            params={"project_id": project_center["project_id"], "type": "expense"}).json()
    sources = {t.get("source"): t for t in txns if t.get("milestone") == "2nd"
               and t.get("center_id") == project_center["center_id"]}
    assert "candidate_recovery" in sources
    assert "tds_deduction" in sources
    assert sources["candidate_recovery"]["amount"] == 13524
    assert sources["tds_deduction"]["amount"] == pytest.approx(2073.68, abs=0.01)
    # Income at gross
    inc = admin_client.get(f"{BASE_URL}/api/transactions",
                           params={"project_id": project_center["project_id"], "type": "income"}).json()
    inc_2nd = [t for t in inc if t.get("milestone") == "2nd"
               and t.get("center_id") == project_center["center_id"]]
    assert len(inc_2nd) == 1
    assert inc_2nd[0]["amount"] == 117208


def test_receive_no_recovery_skips_recovery_txn(admin_client, project_center):
    b = _mk_batch(admin_client, project_center)
    p = admin_client.post(f"{BASE_URL}/api/batch-payments", json={
        "batch_id": b["id"],
        "milestone": "1st",
        "amount": 131430,
        "expected_date": "2025-02-01",
        "description": "1st milestone",
        "uniform_amount": 30000,
        "recovery_amount": 0,
    }).json()
    r = admin_client.patch(f"{BASE_URL}/api/batch-payments/{p['id']}/receive",
                           json={"tds_percent": 0})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["recovery_amount"] == 0
    # recovery_txn_id is not yet in BatchPaymentOut schema (minor) — verify via txn list instead
    # Confirm no candidate_recovery txn exists for THIS batch's 1st milestone
    txns = admin_client.get(f"{BASE_URL}/api/transactions",
                            params={"project_id": project_center["project_id"], "type": "expense"}).json()
    rec_for_this = [t for t in txns if t.get("source") == "candidate_recovery"
                    and t.get("milestone") == "1st"
                    and t.get("center_id") == project_center["center_id"]]
    assert rec_for_this == []
