"""Helper: push the UI-created 'TEST_IT90 UI quote' through quotation+payment approval (admin) and print txn."""
import os
import requests

API = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
CID = "4d7fc745-c28c-4298-baab-58c63dbe8734"
s = requests.Session()
s.post(f"{API}/auth/login", json={"email": "admin@finance.app", "password": "Admin@123"}).raise_for_status()
s.headers["X-CSRF-Token"] = s.cookies.get("csrf_token")
q = next(x for x in s.get(f"{API}/quotations").json() if x.get("description") == "TEST_IT90 UI quote")
print("quote", q["id"], q["status"], q.get("work_order_no"))
for _ in range(6):
    if q["status"] == "approved":
        break
    r = s.post(f"{API}/approvals/act", json={"request_type": "quotation", "request_id": q["id"], "action": "approve", "remarks": "ok ui test"})
    print("q act", r.status_code, r.text[:120] if r.status_code != 200 else "")
    q = next(x for x in s.get(f"{API}/quotations").json() if x["id"] == q["id"])
if not q.get("payment_id"):
    r = s.post(f"{API}/payments", json={"quotation_id": q["id"], "actual_amount": 77, "payment_mode": "cash"})
    print("pay", r.status_code, r.json().get("work_order_no"))
    pid = r.json()["id"]
else:
    pid = q["payment_id"]
banks = s.get(f"{API}/bank-accounts").json()
bank = banks[0]["id"] if banks else None
for _ in range(6):
    p = next(x for x in s.get(f"{API}/payments").json() if x["id"] == pid)
    if p.get("txn_id"):
        break
    r = s.post(f"{API}/approvals/act", json={"request_type": "payment", "request_id": pid, "action": "approve", "remarks": "ok ui test",
                                             "paid_by_name": "Admin", "txn_center_id": CID, "bank_account_id": bank})
    print("p act", r.status_code, r.text[:120] if r.status_code != 200 else "")
print("TXN_ID", p.get("txn_id"))
