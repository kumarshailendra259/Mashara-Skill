"""Iteration-19 backend tests: per-batch partner_share_percent + new income-split semantics.

Spec:
- Batch has partner_share_percent (0-100, default 0).
- On milestone receive:
  - If partner_ids empty OR partner_share_percent == 0 → single income txn at GROSS with partner_id=null.
  - Otherwise → ONE company income (gross * (100-pct)/100 if pct < 100) + N partner income txns
    summing to (gross * pct/100), split equally with rounding tail on last partner.
- TDS / recovery / assessment_fee remain single expense txns at company (partner_id=null), NOT pro-rated.
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
    r = admin.post(f"{API}/entities/project", json={"name": f"TEST_iter19_proj_{TAG}"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.fixture(scope="module")
def center_id(admin):
    r = admin.post(f"{API}/entities/center", json={"name": f"TEST_iter19_center_{TAG}"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.fixture(scope="module")
def partner_a(admin):
    r = admin.post(f"{API}/entities/partner", json={"name": f"TEST_iter19_pA_{TAG}"}, timeout=15)
    return r.json()["id"]


@pytest.fixture(scope="module")
def partner_b(admin):
    r = admin.post(f"{API}/entities/partner", json={"name": f"TEST_iter19_pB_{TAG}"}, timeout=15)
    return r.json()["id"]


@pytest.fixture(scope="module")
def partner_c(admin):
    r = admin.post(f"{API}/entities/partner", json={"name": f"TEST_iter19_pC_{TAG}"}, timeout=15)
    return r.json()["id"]


def _create_batch(admin, project_id, center_id, partner_ids, pct, name_suffix):
    r = admin.post(f"{API}/batches", json={
        "project_id": project_id,
        "center_id": center_id,
        "partner_ids": partner_ids,
        "partner_share_percent": pct,
        "name": f"TEST_iter19_{name_suffix}_{TAG}",
    }, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _create_and_receive(admin, batch_id, milestone, amount, tds=None, recovery_amount=None,
                       assessment_fee_total=None, assessment_fee_per_candidate=None):
    payload = {"batch_id": batch_id, "milestone": milestone, "amount": amount}
    if recovery_amount is not None:
        payload["recovery_amount"] = recovery_amount
    if assessment_fee_total is not None:
        payload["assessment_fee_total"] = assessment_fee_total
    if assessment_fee_per_candidate is not None:
        payload["assessment_fee_per_candidate"] = assessment_fee_per_candidate
    r = admin.post(f"{API}/batch-payments", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    pmt_id = r.json()["id"]
    body = {} if tds is None else {"tds_percent": tds}
    rec = admin.patch(f"{API}/batch-payments/{pmt_id}/receive", json=body, timeout=15)
    assert rec.status_code == 200, rec.text
    return pmt_id, rec.json()


def _milestone_txns_for(admin, batch_name_part, milestone):
    """Return all income milestone transactions whose description contains batch_name_part."""
    r = admin.get(f"{API}/transactions", timeout=20)
    assert r.status_code == 200
    return [
        x for x in r.json()
        if x.get("source") == "milestone"
        and x.get("milestone") == milestone
        and x.get("type") == "income"
        and batch_name_part in (x.get("description") or "")
    ]


# ===== Batch model =====

class TestBatchModelPartnerSharePercent:
    def test_create_batch_with_partner_share_percent(self, admin, project_id, center_id, partner_a):
        b = _create_batch(admin, project_id, center_id, [partner_a], 25, "create_pct")
        assert b["partner_share_percent"] == 25
        # GET to verify persistence
        g = admin.get(f"{API}/batches?project_id={project_id}", timeout=15)
        found = next((x for x in g.json() if x["id"] == b["id"]), None)
        assert found is not None
        assert float(found["partner_share_percent"]) == 25.0

    def test_default_partner_share_percent_is_zero(self, admin, project_id, center_id):
        # Create batch WITHOUT supplying partner_share_percent
        r = admin.post(f"{API}/batches", json={
            "project_id": project_id, "center_id": center_id, "partner_ids": [],
            "name": f"TEST_iter19_default_pct_{TAG}",
        }, timeout=15)
        assert r.status_code == 200, r.text
        assert float(r.json().get("partner_share_percent", -1)) == 0.0

    def test_update_batch_partner_share_percent(self, admin, project_id, center_id, partner_a):
        b = _create_batch(admin, project_id, center_id, [partner_a], 10, "upd_pct")
        u = admin.put(f"{API}/batches/{b['id']}", json={
            "project_id": project_id, "center_id": center_id,
            "partner_ids": [partner_a], "partner_share_percent": 40,
            "name": b["name"],
        }, timeout=15)
        assert u.status_code == 200, u.text
        assert float(u.json()["partner_share_percent"]) == 40.0

    def test_validation_below_zero_rejected(self, admin, project_id):
        r = admin.post(f"{API}/batches", json={
            "project_id": project_id, "partner_ids": [],
            "partner_share_percent": -5,
            "name": f"TEST_iter19_neg_{TAG}",
        }, timeout=15)
        assert r.status_code == 422, f"expected 422, got {r.status_code}"

    def test_validation_above_hundred_rejected(self, admin, project_id):
        r = admin.post(f"{API}/batches", json={
            "project_id": project_id, "partner_ids": [],
            "partner_share_percent": 100.1,
            "name": f"TEST_iter19_over_{TAG}",
        }, timeout=15)
        assert r.status_code == 422, f"expected 422, got {r.status_code}"


# ===== Receive: split logic =====

class TestReceiveSplitLogic:
    def test_no_partners_all_to_company(self, admin, project_id, center_id):
        b = _create_batch(admin, project_id, center_id, [], 0, "no_part_zero")
        _, body = _create_and_receive(admin, b["id"], "1st", 100000)
        txns = _milestone_txns_for(admin, f"TEST_iter19_no_part_zero_{TAG}", "1st")
        assert len(txns) == 1, f"expected 1 txn, got {len(txns)}: {txns}"
        assert txns[0]["partner_id"] in (None, "")
        assert abs(float(txns[0]["amount"]) - 100000.0) < 0.01

    def test_partners_present_but_pct_zero_all_to_company(self, admin, project_id, center_id,
                                                          partner_a, partner_b):
        # partner_ids attached but pct=0 → still all to company
        b = _create_batch(admin, project_id, center_id, [partner_a, partner_b], 0, "part_zero")
        _, _ = _create_and_receive(admin, b["id"], "1st", 100000)
        txns = _milestone_txns_for(admin, f"TEST_iter19_part_zero_{TAG}", "1st")
        assert len(txns) == 1
        assert txns[0]["partner_id"] in (None, "")
        assert abs(float(txns[0]["amount"]) - 100000.0) < 0.01

    def test_one_partner_25_pct(self, admin, project_id, center_id, partner_a):
        b = _create_batch(admin, project_id, center_id, [partner_a], 25, "one_25")
        _, _ = _create_and_receive(admin, b["id"], "1st", 100000)
        txns = _milestone_txns_for(admin, f"TEST_iter19_one_25_{TAG}", "1st")
        assert len(txns) == 2
        company = next((t for t in txns if t.get("partner_id") in (None, "")), None)
        partner_t = next((t for t in txns if t.get("partner_id") == partner_a), None)
        assert company is not None and partner_t is not None
        assert abs(float(company["amount"]) - 75000.0) < 0.01
        assert abs(float(partner_t["amount"]) - 25000.0) < 0.01
        total = sum(float(t["amount"]) for t in txns)
        assert abs(total - 100000.0) < 0.01

    def test_two_partners_25_pct(self, admin, project_id, center_id, partner_a, partner_b):
        b = _create_batch(admin, project_id, center_id, [partner_a, partner_b], 25, "two_25")
        _, _ = _create_and_receive(admin, b["id"], "1st", 100000)
        txns = _milestone_txns_for(admin, f"TEST_iter19_two_25_{TAG}", "1st")
        assert len(txns) == 3, f"expected 3 txns, got {len(txns)}"
        company = next((t for t in txns if t.get("partner_id") in (None, "")), None)
        pa = next((t for t in txns if t.get("partner_id") == partner_a), None)
        pb = next((t for t in txns if t.get("partner_id") == partner_b), None)
        assert company and pa and pb
        assert abs(float(company["amount"]) - 75000.0) < 0.01
        assert abs(float(pa["amount"]) - 12500.0) < 0.01
        assert abs(float(pb["amount"]) - 12500.0) < 0.01

    def test_three_partners_30_pct(self, admin, project_id, center_id, partner_a, partner_b, partner_c):
        b = _create_batch(admin, project_id, center_id, [partner_a, partner_b, partner_c], 30,
                          "three_30")
        _, _ = _create_and_receive(admin, b["id"], "1st", 100000)
        txns = _milestone_txns_for(admin, f"TEST_iter19_three_30_{TAG}", "1st")
        assert len(txns) == 4
        company = next((t for t in txns if t.get("partner_id") in (None, "")), None)
        partner_txns = [t for t in txns if t.get("partner_id") in (partner_a, partner_b, partner_c)]
        assert company and len(partner_txns) == 3
        assert abs(float(company["amount"]) - 70000.0) < 0.01
        for pt in partner_txns:
            assert abs(float(pt["amount"]) - 10000.0) < 0.01
        total = sum(float(t["amount"]) for t in txns)
        assert abs(total - 100000.0) < 0.01

    def test_rounding_tail_three_partners_25_pct_odd_amount(self, admin, project_id, center_id,
                                                            partner_a, partner_b, partner_c):
        # Gross 100001 @ 25% / 3 partners; pool = 25000.25 → per=8333.42; last=25000.25 - 16666.84 = 8333.41
        b = _create_batch(admin, project_id, center_id, [partner_a, partner_b, partner_c], 25,
                          "round_tail")
        _, _ = _create_and_receive(admin, b["id"], "2nd", 100001)
        txns = _milestone_txns_for(admin, f"TEST_iter19_round_tail_{TAG}", "2nd")
        assert len(txns) == 4
        total = sum(float(t["amount"]) for t in txns)
        # Exact sum is critical
        assert abs(total - 100001.0) < 0.01, f"sum mismatch {total}"
        # Company gets 75000.75
        company = next((t for t in txns if t.get("partner_id") in (None, "")), None)
        assert abs(float(company["amount"]) - 75000.75) < 0.01
        # Partner amounts should sum to 25000.25
        partner_amounts = [float(t["amount"]) for t in txns
                           if t.get("partner_id") in (partner_a, partner_b, partner_c)]
        assert abs(sum(partner_amounts) - 25000.25) < 0.01
        # First two should be 8333.42, last 8333.41 (or similar, but sum exact)
        # Allow any ordering — assert all are ~8333.4x
        for a in partner_amounts:
            assert abs(a - 8333.42) < 0.02

    def test_full_100_pct_no_company_txn(self, admin, project_id, center_id, partner_a, partner_b):
        b = _create_batch(admin, project_id, center_id, [partner_a, partner_b], 100, "full_100")
        _, _ = _create_and_receive(admin, b["id"], "3rd", 100000)
        txns = _milestone_txns_for(admin, f"TEST_iter19_full_100_{TAG}", "3rd")
        # Only partner txns, no company-null txn
        assert len(txns) == 2
        company = next((t for t in txns if t.get("partner_id") in (None, "")), None)
        assert company is None, f"unexpected company txn when pct=100: {company}"
        for t in txns:
            assert abs(float(t["amount"]) - 50000.0) < 0.01

    def test_description_contains_split_context(self, admin, project_id, center_id, partner_a, partner_b):
        b = _create_batch(admin, project_id, center_id, [partner_a, partner_b], 25, "descstr")
        _, _ = _create_and_receive(admin, b["id"], "1st", 100000)
        txns = _milestone_txns_for(admin, f"TEST_iter19_descstr_{TAG}", "1st")
        company = next((t for t in txns if t.get("partner_id") in (None, "")), None)
        pa = next((t for t in txns if t.get("partner_id") == partner_a), None)
        assert company and pa
        # Company description should mention company share % (75%)
        assert "company" in (company["description"] or "").lower()
        assert "75" in (company["description"] or "")
        # Partner description should mention split divisor
        assert "÷ 2" in (pa["description"] or "") or "/ 2" in (pa["description"] or "")
        assert "25" in (pa["description"] or "")


# ===== TDS / recovery / assessment fee: NOT pro-rated =====

class TestExpenseTxnsNotProrated:
    def test_tds_recovery_remain_single_company_txns(self, admin, project_id, center_id,
                                                     partner_a, partner_b):
        # 2 partners @ 25%, gross 100000, tds=2%, recovery=10000
        b = _create_batch(admin, project_id, center_id, [partner_a, partner_b], 25, "tds_rec")
        pmt_id, body = _create_and_receive(admin, b["id"], "2nd", 100000,
                                           tds=2, recovery_amount=10000)
        # Income split correctness
        income_txns = _milestone_txns_for(admin, f"TEST_iter19_tds_rec_{TAG}", "2nd")
        assert len(income_txns) == 3
        income_sum = sum(float(t["amount"]) for t in income_txns)
        assert abs(income_sum - 100000.0) < 0.01

        # Fetch related expense txns
        all_txns = admin.get(f"{API}/transactions", timeout=20).json()
        rel_exp = [x for x in all_txns
                   if x.get("type") == "expense"
                   and x.get("milestone") == "2nd"
                   and f"TEST_iter19_tds_rec_{TAG}" in (x.get("description") or "")]
        # Should have exactly 2: one TDS, one recovery
        tds_txns = [t for t in rel_exp if t.get("source") == "tds_deduction"]
        rec_txns = [t for t in rel_exp if t.get("source") == "candidate_recovery"]
        assert len(tds_txns) == 1, f"expected 1 TDS txn, got {len(tds_txns)}"
        assert len(rec_txns) == 1, f"expected 1 recovery txn, got {len(rec_txns)}"
        # Each is partner_id=null (company-side)
        assert tds_txns[0].get("partner_id") in (None, "")
        assert rec_txns[0].get("partner_id") in (None, "")
        # TDS = (gross − recovery) * 2% = (100000-10000)*0.02 = 1800
        assert abs(float(tds_txns[0]["amount"]) - 1800.0) < 0.01
        assert abs(float(rec_txns[0]["amount"]) - 10000.0) < 0.01
