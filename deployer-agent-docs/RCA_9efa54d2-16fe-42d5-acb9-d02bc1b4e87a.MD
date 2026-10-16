# RCA — Mashara Finance: Transactions page shows 0 / "No data yet"

**Deployment:** invest-analytics-24 (finance.masharaskills.com)
**Active run:** 9efa54d2-16fe-42d5-acb9-d02bc1b4e87a
**Mode:** Read-only production diagnosis. No data changed.

## Verdict
This is NOT a DB-binding, Financial-Year, or company/center-scope problem. The live backend is correctly bound to the populated production DB. The real cause is a **Pydantic response-model enum mismatch against production data**: `GET /api/transactions` returns **HTTP 500** for the whole result set because one transaction has a `type` value the `TransactionOut` model does not allow. The frontend then renders the failed call as empty (0 / "No data yet").

## Evidence

### 1. Production DB binding & record count (ruled DB-binding OUT)
- Live backend DB (returned by read-only query, resolved server-side): `invest-analytics-24-finance_tracker_db` — the real populated prod DB.
- `transactions` collection count: **501 documents**. Data is present; backend is bound to the right DB.

### 2. Live API behavior (the actual failure)
- `GET /api/transactions` on production returns **HTTP 500 Internal Server Error** (repeatedly, across multiple client IPs) — not an empty list, not 403.
- (An unauthenticated probe of the live URL returns 401 "Not authenticated" as expected — auth gate is working.)
- Production stack trace:
  ```
  pydantic_core._pydantic_core.ValidationError: 1 validation error for TransactionOut
  type
    Input should be 'investment', 'income' or 'expense'
    [type=literal_error, input_value='asset', input_type=str]
    File "/app/backend/server.py", line 3840, in list_transactions
      return [TransactionOut(**d) for d in docs]
  ```
- The endpoint serializes the entire result list in one comprehension. A single invalid document raises `ValidationError`, which fails the whole request → all list/summary counts become 0.

### 3. The offending data (quantified, read-only)
- `distinct(type)` on prod `transactions` = `["asset", "expense", "income", "investment"]`.
- Documents with `type` NOT in `('investment','income','expense')` = **1** (the `type='asset'` record).
- `TransactionOut.type` is a `Literal['investment','income','expense']` — it does not include `asset`. That one row poisons the entire `/api/transactions` response whenever it falls in the queried set.

### 4. Why preview looked healthy
Preview uses different data (~1160 records) that evidently contains no `type='asset'` row, so the Literal never fails there. The bug is triggered by prod-specific data, which is why it did not reproduce in preview. The FY selector observation (1160 → 16) in preview is a legitimate filter effect and is a red herring for this symptom.

## Root cause (single sentence)
`TransactionOut.type` (`Literal['investment','income','expense']`) cannot validate the production transaction whose `type='asset'`, so `list_transactions` at `server.py:3840` throws and returns 500 for the whole list; the frontend's silent error-swallowing then shows 0 / "No data yet".

## Suggested fixes

### Code (E1) — primary, requires redeploy
1. In `server.py`, make `TransactionOut.type` tolerate the `asset` value — either add `'asset'` to the `Literal`, or change it to a plain `str`, or build the response per-item with a try/except that skips/logs bad rows instead of failing the whole list. Serializing the list element-by-element defensively (so one bad row cannot 500 the entire endpoint) is the robust fix.
2. Deploy the already-made frontend fix that adds error handling to the transactions fetch (so a future API error surfaces instead of silently becoming an empty table). This fix exists in preview but is NOT yet in production.

### User — data (optional / confirm intent)
If `asset` is not a valid transaction type for this product, the single `type='asset'` document in prod should be corrected (DB Manager / manual edit). If `asset` IS a legitimate type, the Code fix above is mandatory and the data is fine. Recommend deciding intent, but the Code fix is required regardless so one stray value can never take the page down again.

## Not the cause (explicitly ruled out)
- DB binding: correct DB, 501 records present.
- FY clamp `_fy_clamp`: not implicated — failure is response serialization, independent of the date window (the 500 fires whenever the bad row is in range).
- Scope `_txn_scope_for_user` / role gate `require_finance_visible` / `_enrich_user_with_associations`: not implicated — the request reaches the query and returns rows; it fails only at response-model validation.
