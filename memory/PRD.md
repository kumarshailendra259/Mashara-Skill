# Mashara Finance HRMS & Operations ERP — Product Requirements Document

## Original Problem Statement
Web application for company-wise, partner-wise, center-wise, project-wise tracking of investments, profit/loss, expenses & income — extended to a full HRMS/ERP with multi-role RBAC, approval workflows, attendance, payroll, stock and Play Store mobile app.

## Production Deployment
- Production URL: https://finance.masharaskills.com
- Preview is separate dev env; user clicks "Deploy" to push code from preview to prod.

## Tech Stack
- Frontend: React 18 + Tailwind + Shadcn UI + Recharts + Sonner toasts
- Backend: FastAPI + Motor (async MongoDB) — single monolith server.py (~5000 lines)
- DB: MongoDB
- Email: Resend (verified domain masharaskills.com)
- PWA: Service worker + manifest ready for Google Play Store via PWA Builder

## User Personas
- **Admin** — system super-admin (full access)
- **Senior Manager** — regional/multi-center oversight
- **Manager** — operational team & center management
- **Center Manager** — single-center administration (scoped data)
- **Center Staff** — self-service on PWA (attendance, leave, payroll)
- **HR** — employee lifecycle, leave, attendance policies
- **Accountant** — payments, payroll, reimbursements, GST/TDS
- **Reporting Authority** — expense + operational verification
- **Center Partner** — financial oversight of centers
- **Partner** — investor with cross-partner txn approval rights

## Implemented Features (Mar 2026)

### Phase 27G — Center Manager Vendor Management (Done, Jul 2026)
- **User reported**: Center Manager role couldn't create/edit vendors (403 forbidden). Task: allow CM to add + manage vendors scoped to their center.
- **Backend**:
  - `VendorIn` extended with `center_ids: List[str]` — empty = global (HQ-only edit), populated = scoped.
  - `_vendor_scope_visible` + `_vendor_scope_editable` helpers centralise the scoping rules.
  - `POST /api/vendors` and `PUT /api/vendors/{vid}` accept `center_manager`. CM's center_ids get restricted to their assigned centers (out-of-scope silently stripped, empty auto-filled). On update, existing out-of-scope centers are preserved (CM can't broaden or narrow beyond their reach).
  - `GET /api/vendors` scopes: HQ sees all; CM/center_staff see overlap + legacy globals; partners keep permissive.
  - DELETE stays admin-only.
- **Frontend `Vendors.jsx`**:
  - `canEdit` now includes `center_manager`.
  - New 'Assigned Centers' checklist in the Add/Edit dialog (auto-preselects CM's centers, HQ can leave empty for global).
  - New 'Centers' column showing cyan chips or italic 'Global' badge.
  - HQ-owned vendors show inline 'HQ' badge instead of Edit icon for CM.
  - Fixed endpoint bug — was calling `/centers` (404), now correctly `/entities/center`.
- **Verified**: testing_agent iter-46 — **19/19 backend pytest + full Playwright E2E green** (frontend endpoint bug caught + fixed by testing agent, re-verified).

### Phase 27F — Advance Request Approval Dialog Fix (Done, Jul 2026)
- **User reported bug**: Accounts team login me Advance Request approve karte samay Payee Details (bank/UPI) show nahi ho rahe the AND Center/Partner/Paid-By choose karne ka option nahi tha.
- **Root cause**: `/approvals/pending` summary was missing payee_* fields for advance_request rows; PendingApprovals dialog's amber Payee Details block only rendered for `request_type == 'payment'`; emerald Payment Attribution (Center/Partner/Paid-By) block was hidden for advance_request; filter tab strip missing advance/quotation/payment chips.
- **Fix (backend)**: `/approvals/pending` summary now maps `employee_name → vendor_name`, `advance_no → qrn`, `preferred_payment_mode → payment_mode` and passes through all `payee_*` fields for advance_request items. `/approvals/act` new advance_request branch stamps `approved_center_id`, `approved_center_name`, `approved_company_id`, `approved_partner_id`, `approved_paid_by_user_id`, `approved_paid_by_name` on the row when accounts picks them during final approval (all OPTIONAL). `release_advance` now uses these as defaults for the auto-created release transaction (release body values win if provided).
- **Fix (frontend)**: PendingApprovals dialog now shows amber "Payee Details (from Advance Request)" block for advance_request. Emerald Payment Attribution block appears at final-step with '(optional — can be filled at Release)' label + skips validation. TYPE_META includes advance_request (Wallet icon, cyan). Filter tab strip extended with `tab-quotation`, `tab-payment`, `tab-advance_request` chips with live counts. openDetail navigates to /advances.
- **Verified**: iter-44 — 7/7 backend pytest passed (payee-surfacing + optional attribution + approved_* propagation + release-txn defaults + regression on mandatory payment/reimbursement). iter-45 — frontend follow-up 100% (all 10 filter tabs render with counts: All=129, Advances=42, Payments=4 etc, dropdown lazy-fetch works for advance_request finals).
- **Minor cosmetic**: React dev-only hydration warning `<span> in <option>` inside native <select> — non-blocking, no user impact.

### Phase 27E — Advance Payee/Bank Details Capture (Done, Jul 2026)
- **User ask**: Advance Request creation par bank details capture ho, taki accounts release ke waqt sara payee info + proof auto-flow ho aur transaction par bhi jud jaye.
- **Backend**:
  - `AdvanceRequestIn` extended with `preferred_payment_mode` + `payee_account_holder` / `payee_account_no` / `payee_ifsc` / `payee_bank_name` / `payee_upi_id` / `payee_proof_attachments[]`. All optional — legacy advances stay compatible.
  - `release_advance` propagates every payee field + `payee_proof_attachments` + original `request_attachments` + `advance_no` + `vendor_name(=employee_name)` onto the auto-created advance-release transaction.
  - `TransactionOut` model expanded to surface `payee_account_holder/no/ifsc/bank_name/upi_id/proof_attachments` + `vendor_name` + `payment_mode` + `transaction_ref` + `paid_by_user_id/name` + `category` — ledger UI can now render a complete payee block without extra DB reads.
- **Frontend Advances.jsx**:
  - Raise Advance dialog: new indigo "Payee / Payment Details" section (data-testid `adv-payee-section`) with contextual fields per mode (bank/cheque → holder/bank/account/IFSC + proof; upi → UPI ID + proof; cash → info callout).
  - Client-side Hinglish validation: bank/cheque needs all 4 fields; UPI needs UPI ID.
  - Release dialog: new amber "Payee Details (from advance request)" summary panel (data-testid `rel-payee-summary`) with pre-filled payment_mode from advance's preferred mode.
- **Verified**: testing_agent iter-43 — **12/12 backend pytest + full Playwright E2E green**. Category field also exposed on TransactionOut post-testing (iter-43 minor item).

### Phase 27D — Settlement Module + Payroll Auto-Deduction (Done, Jul 2026)
**Standalone Settlement Module** — settle an advance without going through a Payment Request:
- New `AdvanceSettleIn` model with 4 types: `cash_repayment` (income txn), `write_off` (expense adj), `salary_deduction` (scheduled next payroll), `manual_adjustment` (audit-only).
- New endpoint `POST /api/advance-requests/{aid}/settle` (admin/accountant). Guards: only released/adjusting rows, balance>0, amount ≤ balance.
- Behaviour: `settlements[]` array appended with full audit entry; `adjusted_amount` +=amount; `balance_amount` -=amount; status → `adjusting` or `settled` (with `settled_at` + `settlement_reason`). `pending_salary_deduction` tracked for salary-deduction schedules. Notification fires to requester (`advance_settled` / `advance_settlement_partial`).
- Cash-repayment creates income txn tagged `source='advance_settlement'`, `is_advance_settlement=true`, `advance_no`, `advance_request_id`, `settlement_id`. Write-off mirrors as expense with `is_advance_writeoff=true`.

**Payroll Auto-Deduction** — recovery of open advances from monthly salary:
- `POST /api/payroll/run` now scans each staff's linked user for released/adjusting advances with balance>0 and auto-populates the payroll row's `advance` field + new `advance_deductions_details[]` (advance_id, advance_no, balance_before, amount, reason ∈ {scheduled, auto_full_balance}). Prefers `pending_salary_deduction` when set.
- `PATCH /api/payroll/{pid}/pay` now consumes those planned deductions on payment: reduces advance balance, appends settlement entry (settlement_type='salary_deduction' + payroll_id + txn_id), clears matching `pending_salary_deduction`, flips status to `settled` if balance closes. Extracted into `_consume_advance_deductions()` helper so the zero-net short-circuit path also honours the plan (fix from iter-42 minor item).

**New helper endpoint**: `GET /api/staff/{staff_id}/open-advances` (admin/hr/accountant/manager/sr-mgr) — returns open advances for a staff's linked user, enriched with overdue flags. Powers upcoming Advance Ledger view.

**Model additions**: `TransactionOut` now exposes `is_advance_settlement`, `is_advance_writeoff`, `is_advance_adjustment`, `funded_by_advance_id`, `advance_request_id`, `advance_no`, `settlement_id`, `source` so the ledger UI can label/filter settlement txns without extra DB reads.

**Frontend `Advances.jsx`**: New emerald "Settle" button (data-testid `adv-settle-<id>`) on released/adjusting rows with balance>0 (finance-role only). Settle Dialog (`settle-modal`) with settlement-type dropdown + contextual explanation, amount pre-filled to full balance, payment-mode/ref (cash_repayment only), date, remarks, live "Balance after this settlement" + fully-SETTLED badge preview.

**Verified**: testing_agent iter-42 — **18/18 backend pytest + full Playwright E2E green**. Both minor issues surfaced (payroll_pay zero-net short-circuit + TransactionOut missing fields) fixed same-session and self-verified via curl.

### Phase 27C — Advance Request Approval Workflow Fix (Done, Jul 2026)
- **Bug reported by user**: Advance Requests were NOT following the multi-level approval workflow that reimbursements/leaves used. Every pending advance was auto-approved by admin-only default chain.
- **Root cause**: `ApprovalWorkflows.jsx` TYPES array was missing the `advance_request` entry, so the New Chain dialog dropdown never exposed the option. Admins could therefore never create a multi-level advance chain via UI — leaving the auto-seeded 1-step "Admin only" default as the only active chain.
- **Fix**:
  - Added `{ v: "advance_request", label: "Advance Request" }` to TYPES in ApprovalWorkflows.jsx (line 24).
  - New backend endpoint `POST /api/advance-requests/reroute-pending` (admin-only) that re-runs `_find_active_chain('advance_request', center_id=...)` for every non-terminal advance and rebuilds snapshot/current_level/chain_history + notifies new first-step approvers. Returns `{ scanned, rerouted, already_on_current_chain }`.
  - Added admin-only `🔄 Reroute Pending` button on Advances page (data-testid `advance-reroute-btn`) with confirmation dialog + toast on completion.
- **Verified**: testing_agent iter-41 — **9/9 backend pytest + full frontend E2E passed**. Reproduction steps: login as admin → /approval-workflows → New Chain → dropdown lists "Advance Request" → create 2+ step chain → /advances → Reroute Pending → pending advances migrate.

### Phase 27B — Payment Voucher + Overdue Alerts (Done, Jul 2026)
**Payment Voucher — auto-generated proof-of-payment PDF (trust document for vendors):**
- New module `/app/backend/payment_voucher.py` — professional single-page A4 layout via ReportLab (no external template file needed). Layout: Company header (name + GST + PAN + Center), thick brand divider, big "PAYMENT VOUCHER" title, voucher meta strip (Voucher No, Date, QRN, Mode, Payment Ref, Category), Payee Details box (Vendor, Bank/UPI), highlighted Amount box (₹ + Indian lakh/crore formatting + words), Purpose section, Approval Chain table (Level · Approver · Action · Date · Remarks), signature footer (Prepared By / Approved By / Received By) + system-generated footer with Voucher No + Payment ID.
- New collection `payment_vouchers` (id, voucher_no, payment_id, quotation_id, amount, vendor_name, qrn, center_id, company_id, file_path, content_type, generated_at, generated_by, emailed_to_vendor_at, emailed_to, emailed_by). Voucher number format `PV-YY-NNNN` per financial year.
- Auto-generation: fires on FINAL approval of a Payment (in `/api/approvals/act`) — best-effort, exceptions logged but do NOT fail payment finalisation.
- New endpoints:
  - `GET /api/payments/{pid}/voucher/download` — streams PDF (application/pdf). Also LAZY-GENERATES for legacy paid payments that were finalised before this feature shipped (backfills the payment doc with voucher_id/voucher_no/voucher_path/voucher_generated_at).
  - `POST /api/payments/{pid}/voucher/email` — role-gated (admin/accountant/hr/sr-mgr). Sends PDF as attachment via Resend + records `emailed_to_vendor_at` / `emailed_to` / `emailed_by`.
  - `GET /api/payment-vouchers` — role-gated list with `q` search on voucher_no/vendor_name/qrn + `X-Total-Count` header.
- New email util `send_email_with_attachment` in `/app/backend/email_utils.py` — generic Resend helper for PDF attachments.
- **Frontend `Quotations.jsx`** — paid payment rows now show a green "Voucher" download button (`voucher-download-<pid>`) + email icon (`voucher-email-<pid>`) for finance roles. Email dialog (`voucher-email-modal`) with To/CC/Subject/Custom-Message fields.

**Overdue Alerts — red banner + email nudge for advances past Required Till:**
- Helper `_annotate_overdue(row)` — sets `is_overdue` + `days_overdue` on any advance row where status ∈ {released, adjusting} AND `required_till < today`. Applied on `list_advance_requests`, `my_advance_requests`, and single `get_advance_request` responses.
- New endpoints:
  - `GET /api/advance-requests/overdue` — role-scoped list of overdue advances.
  - `POST /api/advance-requests/overdue/notify` — admin/finance can trigger; sends in-app notification (`advance_overdue` type) to each overdue-holder + best-effort Resend email. Returns `{ total_overdue, notified, skipped_no_email }`.
- **Frontend `Advances.jsx`** — red left-border banner (`overdue-banner`) when overdue rows exist, with chip preview (`overdue-chip-<id>`), "📧 Send Reminders" button (`overdue-notify-btn`) for finance roles, and "Filter Overdue" toggle (`overdue-filter-toggle`). Rows carry a red highlight + "⚠ Xd overdue" badge (`adv-overdue-<id>`) + red Required Till text.

**Pre-existing bug fix**: Advance release path was writing `status="posted"` which isn't in the `TransactionOut` Literal enum, causing `GET /api/transactions` to 500 for admin. Fixed to `status="approved"` + `source="advance_release"`; migrated 10 legacy `posted` rows in Mongo.

**Verified**: testing_agent iter-40 — **10/10 backend pytest passed** + full Playwright E2E on overdue banner + voucher download/email dialog. GET /api/transactions now returns 200.

### Phase 27A — Advance Payment & Adjustment Module, Phase 2 (Done, Jul 2026)
**Expense Against Advance — link a released advance to a Payment Request so it offsets the balance:**
- **New endpoint**: `GET /api/advance-requests/adjustable` — returns the caller's own advances that are `released` or `adjusting` with `balance_amount > 0`. Slim payload (id, advance_no, voucher_no, amount, paid_amount, adjusted_amount, balance_amount, purpose, released_at, status). Powers the Payment Request "Adjust against Advance" picker.
- **`PaymentIn` model extended** with `advance_request_id: Optional[str]`. Special payment_mode `advance_adjustment` short-circuits `_validate_payment_payee` (no bank/UPI/cheque payee details required for advance-funded payments).
- **`create_payment` validation**: 404 if advance not found, 403 if not owner, 400 if status not in {released, adjusting}, 400 if actual_amount > balance_amount.
- **`resubmit_payment` guardrail**: re-validates linked advance is still adjustable and new actual_amount fits within balance.
- **Final-approval branch** for payments (`/api/approvals/act`): `_is_adv_adjust_payment` gate skips `paid_by_name` + `txn_center_id` requirements when advance_request_id is set (auto-defaults from advance requester). On final approve:
  - Creates the expense transaction tagged with `is_advance_adjustment=true`, `funded_by_advance_id`, `advance_no` so ledger/reports can net the outflow (advance was already an outflow at release time).
  - Increments advance `adjusted_amount`, decrements `balance_amount`, appends to `adjustments[]` (payment_id, quotation_id, qrn, amount, at, vendor_name, txn_id).
  - Flips advance status → `adjusting` (partial) or `settled` (balance ≤ 0.01, stamps `settled_at`).
  - Notifies advance requester (`advance_adjusted` notification type).
- **Frontend `Quotations.jsx`** — Raise Payment dialog now fetches adjustable advances on open. When any exist, shows an indigo "Adjust this payment against my open advance" checkbox (`p-advance-toggle`). Toggling: (a) sets payment_mode to `advance_adjustment`, (b) hides payee bank/UPI/cheque payee-detail sections, (c) shows a Select dropdown (`p-advance-select`) with each advance's balance + purpose, (d) live "After this payment" balance preview with red warning if amount exceeds balance, (e) informational "No fresh outflow will be created" indigo callout.
- **Frontend `Advances.jsx`** — new `Adjusted` + `Balance` columns (data-testids `adv-adjusted-<id>` / `adv-balance-<id>`). "SETTLED" badge shown for settled rows. New `Adjusted / Balance` roll-up stat card at the top.
- **Verified**: testing_agent iter-39 — **12/12 backend pytest passed** + full Playwright E2E on Quotations dialog + Advances columns. Happy-path (partial → settled), 403 on other-user advance, 400 on cancelled/settled advance, 400 on amount>balance, 400 on resubmit exceed, non-regression on standard bank/UPI/cheque payee validation — all green.

### Phase 26C — Advance Payment & Adjustment Module, Phase 1 (Done, Jul 2026)
- **Advance Request lifecycle**: draft → pending → approved → released → adjusting → settled (or cancelled). `ADV-YY-N` financial-year numbering.
- New collections: `advance_requests` (with fields: advance_no, purpose, category, amount, required_till, adjusted_amount, balance_amount, paid_amount, voucher_no, released_at, status, adjustments[]).
- Approval chain integration via `_attach_chain_to_request("advance_request", ...)`; default chain seeded (single-step admin).
- **Endpoints**: `POST/GET/PATCH/DELETE /api/advance-requests`, `GET /api/advance-requests/my`, `POST /api/advance-requests/{aid}/release` (Finance-only; creates matching expense txn + voucher no. `ADV-VCHR-YY-N`).
- **Frontend `Advances.jsx`**: List with pagination/status filter/search; Raise Advance dialog; Release dialog (Finance); Track modal for approval timeline; Cancel flow.

## Implemented Features (Mar 2026)

### Phase 26B — Full-Automatic HRMS, Phase B (Done, Jul 2026)
**Salary Slip Template System:**
- New backend module `/app/backend/salary_slip.py` — DOCX template rendering via `docxtpl` + PDF conversion via headless LibreOffice with DOCX fallback. Amount-to-words in Indian lakh/crore.
- New endpoints:
  - `POST /api/salary-slip-templates` — upload `.docx` (5MB cap), optionally scoped by `company_id`; global fallback if none configured for a company. Uploading a new template deactivates the old one.
  - `GET /api/salary-slip-templates` — list (admin/hr/manager).
  - `DELETE /api/salary-slip-templates/{tid}` — admin only.
  - `POST /api/payroll/{pid}/generate-slip` — renders + stores slip (admin/hr/accountant).
  - `PATCH /api/payroll/{pid}/release-slip?released=true|false` — HR toggles visibility to staff.
  - `GET /api/payroll/{pid}/slip/download` — RBAC-gated: admin/hr/accountant bypass release check, staff can only download their own + only after release.
- Frontend:
  - `SalarySlipTemplatesTab.jsx` in HR Settings → new "Salary Slips" tab with upload form + 40+ placeholder reference + templates list.
  - HRMS Payroll rows now have `slip-gen-<pid>` / `slip-dl-<pid>` / `slip-release-<pid>` action buttons.
  - `/check-in` Salary tab shows a "Download HR Slip" link when `slip_released_at` is set on the row.

**Historical Employment Filter (payroll_run):**
- `payroll_run` rewritten to skip staff not employed in the target month AND prorate `working_days` for mid-month joiners / exits. New `staff.exit_date` and `staff.exit_reason` fields.
- Example verified: Staff joining 2026-06-15 → June `working_days=16`; staff exiting 2026-07-15 → July `working_days=15 + is_partial_month=true`; August payroll skips them. Response includes `skipped_not_employed` count.

**HRMS Pagination + Search:**
- `GET /api/staff` and `GET /api/payroll` now accept `q`, `skip`, `limit` and emit `X-Total-Count` header (CORS-exposed).
- HRMS Staff tab: `staff-search`, `staff-prev`, `staff-next` + "Showing N of M" text.
- HRMS Payroll tab: `payroll-search`, `payroll-status-filter`, `payroll-prev`, `payroll-next`.
- Staff Add/Edit dialog: new `Exit / Last Working Date` field (`staff-exit-date`).

**Verified**: testing_agent iter-37 — **17/17 backend pytest passed** + full E2E. Payroll table now paginates through 1013 rows across 41 pages instead of loading in one shot.

### Phase 26A — Full-Automatic HRMS (SalaryBox-style), Phase A (Done, Jul 2026)
- **New Salary Components** on payroll model: `overtime_pay`, `other_earnings`, `reimbursements_paid` (earnings) + `early_fine`, `advance`, `loan_deduction` (deductions). `_recalc_payroll` auto-updates gross/deductions/net. `PATCH /api/payroll/{pid}` allow-list expanded to include all new fields.
- **HR Attendance Edit**: New `PATCH /api/attendance/{aid}` endpoint (roles: admin, hr, manager, center_manager) letting HR retro-edit status / punch-in / punch-out / remarks with an `edited_by` + `edited_at` audit trail. 404 for non-existent rows.
- **Employee Salary Detail Page** (`/hrms/staff/:sid/salary`): month + year selector, meta strip (CTC/Joining/Center/Bank masked), summary card with net + status + Finalize/Edit/Pay actions, attendance breakdown (Present/Half/Absent/Leave/Working Days/Marked), 3-column earnings vs deductions grid showing all 9 earnings + 6 deductions, per-day attendance rows table with per-row Edit button, and 12-month history table (CTC/Payables/Deductions/Net/Paid/Pending/Status/Slip).
- **New Endpoint** `GET /api/payroll/staff/{sid}/summary?month=X&year=Y` — one-shot data for the detail page (admin/hr/accountant/senior_manager only).
- **Downloadable Reports** (Admin/HR/Accountant/Senior Manager scoped):
  - `GET /api/reports/attendance?month&year&staff_id?&center_id?` → per-day CSV (Emp Code, Name, Designation, Center, Date, Status, Punch In, Punch Out, Hours, Marked Via).
  - `GET /api/reports/payroll?month&year&staff_id?` → full CSV (Basic, HRA, DA, Conveyance, Bonus, Incentive, Overtime, Other Earnings, Reimb Paid, Gross, PF, ESI, Late Fine, Early Fine, Advance, Loan EMI, Total Deductions, Net, Status, Paid At, Bank Name, Account #, IFSC, PAN).
  - `GET /api/reports/consolidated?month&year&staff_id?&center_id?` → one row per staff (attendance summary + payroll + bank).
  - Also surfaces as **3 buttons** on `/hrms` Payroll tab (Attendance / Payroll / Consolidated) alongside existing Bank Transfer CSV, plus a Reports strip on the Salary Detail page.
- **HRMS Navigation**: `[data-testid=staff-salary-<id>]` icon on Staff rows + `[data-testid=view-detail-<id>]` on Payroll rows → open the new detail page.
- **Verified**: testing_agent iter-36 → **12/12 backend pytest passed** + full frontend E2E (edit modal, CSV downloads, view-detail navigation). Regression on Check-in staff app clean.

### Phase 25 — Approval Tracking Visibility Fix on Staff App (Done, Jul 2026)
- **Reported bug**: On `/check-in`, submitted Leave / Reimbursement / Regularisation rows showed only a `SUBMITTED` badge — no way to see the approval chain, current pending approver, or a Track button. The user couldn't tell where the request was stuck.
- **Root cause**: (a) `GET /api/leaves/my` and `GET /api/reimbursements/my` did not run the lazy `_attach_chain_to_request` migration that `/api/regularisations/my` already did, so any request created before an approval chain was configured for the center kept `chain_snapshot=[]` forever. (b) Frontend gated the Track button on `current_level > 0 && chain_snapshot.length > 0`, so items without a snapshot never rendered any tracking UI.
- **Fix**:
  - Backend `/api/leaves/my`: lazy-attach chain for `pending` items missing snapshot; persist chain_id/current_level/chain_snapshot/chain_history back to Mongo.
  - Backend `/api/reimbursements/my`: same lazy-attach for `pending / in_progress / submitted` status items.
  - Frontend `CheckIn.jsx` (LeaveTab, ReimburseTab, AttendanceTab): switched to `hasChain = chain_snapshot.length > 0 || chain_history.length > 0` and added an italic fallback `Awaiting approval — no chain configured yet` when truly no chain exists. New per-request `My Regularisation Requests` list with Track buttons. `ApprovalTimelineModal` reused for `type=regularisation` too.
  - Also: `Pending with` banner now has a graceful fallback showing the step *kind* (`Pending at step: Direct Manager (approver not resolved)`) when `pending_with` is empty. `ApprovalTimelineModal` gets a `DialogDescription` to silence a Radix a11y warning.
- **Verified**: testing_agent iter-35 — 8/8 pytest cases pass, mobile UI verified end-to-end. Track button + timeline modal work for all 3 request types. No regression on manager Pending Approvals inbox.

### Phase 24 — My Team & Pending Approvals in Staff App (Done, Jul 2026)
- **`/api/me/summary`** extended with `is_manager`, `team_size`, `is_approver` flags — the mobile Staff App uses them to conditionally show the two new menu entries.
- **New endpoint `GET /api/staff/my-team`** returns each direct report's name, employee_code, designation, center, mobile, email + today's effective attendance status (`present` / `incomplete` / `absent` / `leave` / `half`). Salary + bank fields are stripped for privacy.
- **`CheckIn.jsx` — new tabs**:
  - **My Team** — grid of avatar cards for each direct report with attendance badge, contact links (`tel:` / `mailto:`), and "View Profile" modal that shows profile details but explicitly hides salary/bank (compliance).
  - **Pending Approvals** — pulls `/api/approvals/pending` and shows every approval type (leave, reimbursement, regularisation, quotation, payment, asset_purchase, employee_transfer, tour, advance, expense, daily_report) with a badge, request summary, amount, step-progress + three actions: **Approve · Send Back · Reject**. Send Back / Reject require mandatory remarks; approvals send remarks straight to `POST /api/approvals/act`, so the workflow's history + notifications continue seamlessly.
- Menu entries are auto-hidden for regular staff and shown for managers/approvers. Bottom tab-bar on mobile swaps in "Approvals" + "More" (drawer) for managers.

### Phase 23 — Staff App Login Redesign + Reverse Geocoding (Done, Jul 2026)
- **`CheckIn.jsx` login hero**: Redesigned the plain blue login area into an immersive brand hero — gradient (`#0b1f4d → #1E3A8A → #2E64C7`), city-silhouette SVG overlay, decorative gradient blobs, grid pattern, then a white card that lifts over the hero with EMAIL / PASSWORD / Sign-In. Feature strip below (Geo Check-in · Leaves · Salary) + brand footer.
- **Reverse Geocoding**: After `navigator.geolocation.getCurrentPosition`, the app calls OpenStreetMap Nominatim (`https://nominatim.openstreetmap.org/reverse`) to fetch the full address + pincode. UI shows the full address on top and a smaller line of lat/lng + accuracy + Refresh below. Falls back gracefully to coordinates if the reverse-geocode call fails.
- **Backend**: Added `address` field to `SelfCheckInIn` and `CheckOutIn`; persisted into the `attendance` document (`address` at check-in, `check_out_address` at check-out). Useful for audit trails / dispute resolution.
- Tested via curl: coordinates `23.35236, 85.31140` correctly resolve to `"Delābaritoli, Namkum, Ranchi, Jharkhand, 834002, India"` with pincode `834002`.

### Phase 22 — Mobile App-Like Layout + Global Drawer (Done, Jul 2026)
- **`Layout.jsx`** (all non-CheckIn pages): Added a hamburger button in the header (mobile only) that opens a slide-in Sheet drawer containing the full role-filtered sidebar. Added a 5-cell **bottom tab-bar** (Dashboard · Check-in · Pending Approvals · HRMS · Menu) with active-state indicators, badges, and `env(safe-area-inset-bottom)` padding for iOS. `<main>` gets extra bottom padding on mobile so content isn't hidden behind the tab-bar. Sticky top header (`z-30`).
- **`CheckIn.jsx`**: Added a hamburger in the mobile blue hero → opens a Sheet drawer showing user info (name, email, center), all Staff-App tabs (Dashboard/Attendance/Leave/Claims/Salary), a "Go to Workspace" link for non-staff roles, and a red Sign-Out button. Desktop sidebar unchanged.
- Result: whole app feels native-app-like on phones (drawer + bottom tab-bar) while the desktop 260-px sidebar remains for larger screens.

### Phase 21 — Login Page Redesign + Scoped Entity Visibility (Done, Jul 2026)
- **Login Page**: Two-column layout on desktop — left panel with brand, rotating finance quotes (auto-rotates every 5 s over 4 quotes), and feature highlights (Investments, HRMS, Geo Check-in, RBAC, P&L). Right panel is a clean centered form. Mobile keeps single-card layout with gradient banner at top. File: `/app/frontend/src/pages/Login.jsx`.
- **Scoped Entity Visibility (`GET /api/entities/{etype}`)**: Companies, partners, centers and projects are now filtered per user:
  - `admin / manager / senior_manager / hr / accountant` → full unrestricted list (unchanged).
  - `partner` → sees only own partner, own mapped centers (via batches / legacy `centers.partner_id` / txn history), and the companies/projects referenced at those centers.
  - `center_manager / center_staff / staff` → sees only assigned centers, partners mapped to those centers, and companies/projects transacted at those centers.
  - `viewer / other` → sees nothing.
- Helper `_visible_entity_ids(user, etype)` added just after `_can_auto_approve`. Tested with fresh partner + center-manager logins (both saw only their own scoped rows out of 122 partners / 111 centers in the DB).

### Phase 16 — Quotation → QRN → Payment Procurement Workflow (Done, Jul 2026):
- **Feature**: Two-stage procurement flow. Any non-partner role raises a QUOTATION with vendor + estimated amount + category + purpose. Approval chain routes it. On final approve, a per-center **QRN** (Quotation Request Number, format `{CENTER_PREFIX}-QRN-{NNNN}`) is stamped. User then raises a PAYMENT request against the QRN with editable actual amount. Payment goes through its own approval chain. On final approve, an approved EXPENSE transaction is auto-created in the center's ledger, tagged with the QRN + quotation_id + payment_id.
- **New models**: `QuotationIn`, `PaymentIn`. `ApprovalType` Literal extended with `"quotation"` and `"payment"`. `APPROVAL_TYPE_COLL` gets new entries.
- **New endpoints**: `POST/GET/DELETE /api/quotations`, `POST/GET /api/payments`, integrated into existing `/api/approvals/act` with dedicated final-approval branches for both types.
- **New collections + indexes**: `quotations`, `payments`, `qrn_counters`. Compound unique index `(qrn, center_id)` allows different centers with same 8-char prefix to safely share QRN counter values. Migration drops legacy `qrn_1` global index on startup.
- **Default approval chains** seeded: quotation (CM → Senior Manager → Admin), payment (Senior Manager → Admin → Accountant). Both configurable per-center via HR Settings.
- **Role gating**: `QUOTATION_CREATORS = admin, hr, manager, senior_manager, accountant, center_manager, center_staff`. Partners cannot raise; center_manager/center_staff restricted to their assigned centers.
- **Transaction linkage**: TransactionOut now surfaces `qrn`, `quotation_id`, `payment_id`. Ledger UI can filter/show these directly.
- **Payment rejection** reverts quotation status → `approved` and clears `payment_id` so a fresh payment can be raised.
- **Frontend**:
  - New page `/quotations` — table with QRN, center, vendor, amounts, status badges, per-row "Raise Payment" button (only when quotation is approved and no payment yet exists), filter by status, "How this works" info banner.
  - Two dialogs: New Quotation (all fields) + Raise Payment (pre-fills amount from quotation estimate, editable).
  - Sidebar link visible to all non-partner roles.
- Verified by iter-34: 17/17 backend pytest PASS. Testing agent fixed 2 latent bugs during testing (qrn:null sparse-index duplicate; qrn_counters.id:null duplicate). Main agent post-fix upgraded qrn index to compound (qrn, center_id) to prevent slug-collision 500s.

### Phase 15 — Offer-Letter DOCX Fallback (Production Hot-Fix, Jul 2026):
- **Bug**: User reported production toast "render_failed: LibreOffice (soffice) not installed on server" when triggering /staff/{sid}/send-offer-letter — Emergent's deploy image ships without the `libreoffice-writer` package, so PDF conversion raised FileNotFoundError.
- **Fix**:
  - `offer_letter.render_offer_letter` now returns `(bytes, mime_type, extension)` tuple — falls back to shipping the rendered DOCX when LibreOffice is unavailable. Rendered DOCX still has the letterhead + all substituted placeholders (viewable in Word / Google Docs).
  - `_docx_to_pdf` returns `Optional[str]` — no more RuntimeError, graceful None on missing binary or non-zero exit.
  - `_find_soffice()` re-detects on every call, so a delayed apt install becomes visible without restarting the app.
  - Email sender accepts `content_type` param, storage path + filename extension mirror actual format (`.pdf` vs `.docx`), download endpoint honours stored content_type.
  - `offer_letters` collection now carries `content_type` + `extension` fields alongside `pdf_path`.
- **`_ensure_libreoffice_installed`** — background async task fires on backend startup. Silently runs `apt-get install libreoffice-writer libreoffice-core` with 180s timeout, `--no-install-recommends`, `DEBIAN_FRONTEND=noninteractive`. Never blocks startup, never raises. Once installed, next offer letter delivers as PDF.
- Verified by iter-33: 9/9 new fallback tests + 23/23 iter-32 regression PASS (100%). PDF path unchanged when LibreOffice present; DOCX fallback works when absent. Zero user-facing failures either way.

### Phase 14 — Auto Offer-Letter Generation (Done, Jul 2026):
- **Feature**: On Add Staff, the system auto-generates an offer letter PDF from an admin-uploaded DOCX template (letterhead + placeholders inside the DOCX), embeds the auto-created login credentials, saves a PDF copy to object storage, and emails it to the staff via Resend.
- **DOCX template placeholders**: `{{staff_name}}`, `{{designation}}`, `{{joining_date}}`, `{{monthly_salary}}` (`₹ 25,000.00`), `{{monthly_salary_words}}` ("Twenty Five Thousand Only Rupees"), `{{per_day_rate}}`, `{{email}}`, `{{mobile}}`, `{{address}}`, `{{login_email}}`, `{{login_password}}`, `{{company_name}}`, `{{company_address}}`, `{{company_city}}`, `{{company_state}}`, `{{company_gst}}`, `{{company_pan}}`, `{{center_name}}`, `{{today}}`, `{{generated_at}}`.
- **PDF conversion**: headless LibreOffice (`soffice --headless --convert-to pdf`), ~2-4s per staff.
- **New module** `/app/backend/offer_letter.py` — docxtpl rendering + LibreOffice subprocess + Resend email with base64 PDF attachment.
- **New collections**: `offer_letter_templates` (uploaded DOCX registry), `offer_letters` (per-staff generated letters).
- **New endpoints**:
  - `POST /api/offer-letter-templates` (multipart .docx, optional `?company_id=`) — admin/HR upload
  - `GET /api/offer-letter-templates` — list all
  - `DELETE /api/offer-letter-templates/{id}` — admin only
  - `POST /api/staff/{sid}/send-offer-letter` — re-generate & email; auto-creates linked user if absent
  - `GET /api/offer-letters?staff_id=` — history
  - `GET /api/offer-letters/{lid}/download` — stream PDF
- **`create_staff`** extended with `send_offer_letter` flag (defaults true) — fires `_generate_and_deliver_offer_letter` after user account is provisioned. Response carries `offer_letter_status: {generated, emailed, pdf_path, letter_id, reason}`.
- **Company resolution**: uses Phase-13 `_derive_context_for_center` to pick the matching template (per-company or global fallback).
- **StaffOut** now surfaces `offer_letter_url`, `offer_letter_id`, `offer_letter_generated_at`.
- **Frontend**:
  - HR Settings → new "Offer Letters" tab with upload form + placeholder reference + template history table.
  - Add Staff dialog → new "Send offer letter (PDF)" checkbox (default checked).
  - HRMS staff row → new **Mail** icon button (regenerate & email) + **FileDown** icon (download last PDF, only when a letter exists).
- **New dependencies**: `docxtpl==0.20.2`, `python-docx==1.2.0`, `lxml==6.1.1`; LibreOffice apt package.
- Verified by iter-32: 22/23 backend pytest PASS (+1 fixed post-run — StaffOut field exposure). Rendered PDFs contain fully-substituted placeholders (verified via pdftotext extraction) — no raw `{{...}}` leaks.

### Phase 13 — Company / Partner Auto-Tag on Center Transactions (Done, Jun 2026):
- **Bug fix**: Auto-created transactions (Reimbursement approve/pay, Asset Purchase final approve, Payroll pay, Milestone recovery/assessment_fee/TDS deduction, Stock quick-add) were leaving `company_id` and `partner_id` as null — ledger UI showed dangling "—" columns and dashboard rollups couldn't attribute the amounts.
- New helper **`_derive_context_for_center(center_id)`** returns best-effort `{company_id, partner_id}` from (1) center's batches (most-common company; single-partner unambiguous), (2) legacy `centers.partner_id` / `centers.company_id`, (3) existing txn history at that center.
- **`POST /api/transactions`** now auto-derives company_id + partner_id when the caller passes center_id but leaves those blank (caller-provided values are never overwritten).
- All 5 auto-txn creation sites updated: reimbursement approve-chain, reimbursement legacy pay, asset purchase final approve, payroll pay, milestone-payment recovery/assessment/TDS.
- **`POST /api/transactions/backfill-company-partner`** (admin-only) — one-shot repair for historical dangling txns. Idempotent — re-runs are safe no-ops. Returns `{scanned, updated, distinct_centers}`.
- **Frontend**: Entities center form now has **Default Company** + **Default Partner** dropdowns (stored on the center doc via `ConfigDict(extra='allow')`) — admin can explicitly set these to unblock centers that have no batches / txn history.
- Verified by iter-31 testing: 9/9 backend pytest PASS. Preview backfill: 115 rows updated on first run; remaining ~300 rows need admin to set center.company_id manually because those centers have zero resolvable context.

### Phase 12 — Partner-Role Approval Center Isolation (Done, Jun 2026):
- **Bug fix (HIGH)**: Approval requests with a `kind=role, value=partner` (or `center_partner`) chain step were being routed to ALL partners regardless of their User Management center mapping. Now the resolver hard-filters partners by `assigned_center_ids` containing the request's `center_id`.
- `_resolve_step_user_ids` now adds `{assigned_center_ids: center_id}` clause whenever the step's role value is `partner` or `center_partner` AND the request has a `center_id`.
- `_can_partner_approve` (cross-approve path) now has an early hard gate — even if a partner shares project/center history or has a custom pairing with the owner, they are blocked when the txn's `center_id` is not in their `assigned_center_ids`.
- Fixed truthy-tuple bug at `/api/approvals/pending` line 3811 — `_can_partner_approve` returns `(bool, reason)` but the call site was treating the tuple as truthy. Now correctly unpacks `allowed, _reason = await _can_partner_approve(...)`.
- Applies to ALL workflows (transactions, leaves, asset_purchase, employee_transfer, reimbursement, regularisation) — anywhere a partner-role chain step exists.
- Non-partner roles (admin, hr, accountant, manager, senior_manager) remain GLOBAL (no center filter) as designed.
- Verified by iter-30 testing agent: 10/10 pytest including notification fanout, asset_purchase isolation, empty-center isolation, center_partner role filter, HR global routing, no-center fallback, and the cross-approve hard gate.

### Phase 11 — Partner Settlement Record & Cutoff Logic (Done, Jun 2026):
- **Partner-to-partner settlement payments are now recordable** — once a partner pays another partner, the recorded `date` becomes a CUTOFF; subsequent settlement views only count transactions strictly AFTER that date, so balances naturally reset.
- New `partner_settlements` MongoDB collection — id, center_id, from_partner_id/name, to_partner_id/name, amount, date (YYYY-MM-DD validated), note, recorded_by/_name, created_at.
- New endpoints:
  - `POST /api/dashboard/settlement/record` — admin/manager/senior_manager/accountant for any center; partner only for own mapped centers AND only if they are payer or receiver
  - `GET /api/dashboard/settlement/history?center_id=` — list past settlements (partner-scoped to own centers)
  - `DELETE /api/dashboard/settlement/record/{id}` — admin/senior_manager/manager/accountant only (undo & re-expose pre-cutoff balances)
- `GET /api/dashboard/settlement` enhanced — auto-applies latest settlement.date as `$gt` filter on transaction `date`; supports `include_history=true` to return `lifetime` (pre-cutoff) totals alongside current; each center carries `settled_till` and `last_settlement`
- Frontend: new `SettlementSection` component — per-partner "Settle Dues" button (visible when adjustment > 0), modal with payer auto-filled, receiver dropdown filtered to those owed, amount pre-filled from adjustment, date defaulting to today
- "View Settled History" toggle reveals (a) lifetime totals table and (b) past settlements list with admin "Undo" button per record
- "Settled till YYYY-MM-DD" green badge in each center header when a cutoff is active
- Verified by iter-29 testing agent: 16/16 backend pytest + full E2E (37 settle buttons rendered, modal flow, badge appearance, history toggle, undo button)

### Phase 10 — Center Manager Operations Dashboard (Done, Mar 2026):
- **Center Manager ab `/` par apna Operations Dashboard dekhta hai** — pehle wahan se redirect ho jata tha
- New backend endpoint `GET /api/dashboard/center-ops` — center-scoped operational KPIs (NO finance fields):
  - Staff total, today's attendance (present/absent/%), pending leaves & regularisations
  - Active batches count, total assets, upcoming holidays
  - "My Pending Approvals" badge (counts requests where this user is the next approver)
  - Recent leave activity table + list of managed centers
- App.js `RoleHome` dispatcher: `/` route picks Dashboard vs CenterManagerDashboard based on role
- ProtectedRoute: `OPS_DASHBOARD_ROLES = ['center_manager']` — gets to stay on / despite `requireFinance` flag
- Layout sidebar: Dashboard link visible to finance roles + center_manager only (not to viewers/center_staff/etc.)
- **Finance gating still strict**: center_manager 403s on /dashboard/summary, /transactions, /batches, /reports, etc.

### Phase 9 — Partner Center-Based Visibility (Done, Mar 2026):
- **Partner-role users now scoped to their mapped centers** across dashboard, transactions, settlement, milestone-income, fooding-income, batches, batch-payments
- Mapping auto-derived from 3 sources: `batches.partner_ids`, `centers.partner_id`, and approved transactions where the partner has center-level history
- Example: Partner X (at center A with Y, at center B with Z) sees both A+B; Partner Z (only at B) sees only B — Y's txns at C never leak
- New endpoint `/api/partners/{pid}/centers` returns the auto-derived center list (admin/hr/manager/senior_manager)
- User Management dialog: when admin picks role=partner + assigns a partner, a live preview panel shows exactly which centers the user will see
- Helper `_centers_for_partner(partner_id)` is the single source of truth, called via `_enrich_user_with_associations` and cached on the request user object

### Phase 8 — Regularisation Workflow + Leave Balance Bug Fix (Done, Mar 2026):
- **BUG FIX (HIGH)**: Mobile /check-in LeaveTab was not sending `leave_type_id` — that's why approved leaves never deducted from balance. Now leave type is mandatory in the mobile dialog with a live balance hint (`X/Y left`) per type.
- **Regularisation is now a first-class Approval Workflow type**:
  - Added to `APPROVAL_TYPE_COLL` mapping; default 1-level chain (HR/Admin) seeded
  - POST `/api/regularisations` attaches the configured chain + enriches `center_id`
  - Appears in **/pending-approvals** under a new "Regularisations" tab (was hidden in HR Settings before)
  - Final-approve via `/api/approvals/act` upserts the attendance row (status=present/half/leave from the request's `attendance_status`)
  - Configurable through `/approval-workflows` like any other type
- **Schema rename**: `RegularisationIn.status` → saved as `attendance_status` to avoid clash with the chain `status` field (pending/approved/rejected)
- Legacy PATCH `/api/regularisations/{rid}` endpoint kept for back-compat with mobile clients

### Phase 7 — Leave Routing Fix + Mobile Dashboard + Map Picker (Done, Mar 2026):
- **BUG FIX (HIGH)**: Leave & reimbursement requests now route through center-bound approval chains correctly. Earlier the doc had no `center_id`, so `_attach_chain_to_request` always fell back to the global default chain. Fix: enrich the request doc with `staff.center_id` (+ `staff.name`) BEFORE attaching the chain.
- **Mobile Staff App (/check-in)** HomeTab now shows:
  - **Leave Balances card** — per-type tiles for the current year (CL/SL/PL/COMP/LWP) with balance/allocated/used
  - **Holidays section** — upcoming (next 3) with a "SEE ALL" toggle that expands to the full year list, past holidays dimmed
- `/me/summary` extended with `all_holidays` (full year) + `leave_balances` (decorated with name + color); empty-staff branch returns shape-stable empty arrays
- **Geofence Map Picker** — HR Settings → Geofences dialog now embeds a Leaflet map (OpenStreetMap tiles, no API key). Click anywhere to drop a marker, drag the marker for precision, radius circle previews the geofence boundary live. New `MapPicker` component reusable elsewhere.

### Phase 6 — Leave Allocation + Approval Chain Fix (Done, Mar 2026):
- **Bug fix**: Approval chains with `kind=staff` (Specific Staff) used to silently dead-end if the staff had no linked user account. Now:
  - POST/PUT `/approval-chains` validates each step at save time — rejects with helpful 400 if the chosen staff/user can't be resolved
  - Runtime resolver auto-heals broken `staff→user` linkage via email match (case-insensitive) → `staff.user_id` is auto-populated on first resolution
  - Frontend dropdown filters out staff without login + clear empty-state message
- **Leave Allocation module** (new HR Settings tab):
  - **Leave Types CRUD**: 5 defaults auto-seeded (CL, SL, PL, COMP, LWP) with annual quota / paid / carry-forward / color
  - **Bulk Allocate**: pick type + year + days + scope (all staff / by center / individual multi-select) + mode (set vs add) + audit remarks
  - **Balance Table**: per-staff per-type per-year `allocated / used / balance` with quick `Adjust` dialog (delta + remarks)
  - **Auto-deduction**: when a leave with `leave_type_id` is final-approved through its chain, `used` increments by inclusive day-count and `balance` is recomputed
  - HRMS "Apply Leave" dialog now picks a Leave Type and shows live balance hint (`x/y left`)
- New endpoints: `/api/leave-types` (GET/POST/PUT/DELETE), `/api/leave-balances` (GET), `/api/leave-balances/my`, `/api/leave-balances/allocate` (POST), `/api/leave-balances/{id}` (PATCH)

### Phase 5 — Finance Visibility Gate (Done, Mar 2026):
- **Bug fix**: GET /api/auth/users no longer 500s on legacy users with RFC-6761 reserved-TLD emails (UserOut.email → plain `str`)
- **Role gating** for investments / income / expense / profit-loss / TDS / milestone income:
  - FULL ACCESS: `admin`, `partner`, `senior_manager`, `hr`, `accountant`
  - RESTRICTED (403 + nav hidden + route redirect): `manager`, `center_manager`, `center_staff`, `viewer`, `reporting_authority`, `center_partner`
- Backend: `require_finance_visible` dependency on /transactions, /batches, /batch-payments, /dashboard/{summary, milestone-income, fooding-income, settlement}, /reports/tds-register
- Frontend: `financeOnly` flag on sidebar nav items (Dashboard, Programs, Transactions, Reports, TDS Register) + `<ProtectedRoute requireFinance>` redirects to per-role landing (`/check-in` for center_staff, `/hrms` for manager/center_manager, `/pending-approvals` for viewer/reporting_authority/center_partner)
- Approval Workflows page now also configurable for `asset_purchase` and `employee_transfer` chains

### Phase 3 — Asset Management (Done, Mar 2026):
- **Asset Purchase Workflow** — 4-level approval chain (Center Manager → Senior Manager → Accountant → Admin)
- On final approve: Asset row added to `/assets` registry + offsetting expense transaction recorded
- **Asset Registry** with serial no, vendor, depreciation %, useful life, status (active/transferred/disposed/maintenance)
- **Inter-center Asset Transfer** with admin/sr-mgr decision; approval moves asset.center_id, reject keeps it
- Frontend: `/assets` page with 3 tabs (Purchase Requests / Registry / Transfers) + KPI strip

### Phase 4 — Employee Transfer (Done, Mar 2026):
- 3-level approval chain (HR → Senior Manager → Admin)
- On final approve: `staff.center_id` updated to destination
- Initiator scope: admin, hr, senior_manager, manager, center_manager
- Frontend: `/employee-transfers` page with status pills + cancel-while-pending

### Unified Approvals Inbox extended:
- `/pending-approvals` now shows 5 tabs: Transactions / Leaves / Reimbursements / **Asset Purchase** / **Employee Transfer**
- Summary block shows est_amount for assets and meaningful description fallbacks

### Phase 0 — Core (Done):
- All 11 roles defined + RBAC enforcement
- Configurable approval chains (N-level, type-scoped, center-scoped)
- Center-wise data segregation for /staff, /stock, /batches, /transactions, /dashboard
- Geo + Selfie attendance via PWA (`/check-in`)
- Leave management with multi-level chain
- Reimbursement L1 → Accountant → Pay flow
- Payroll auto-generation + payment
- HRMS (employees, attendance regularisation, leave, payroll, reimb, documents)
- Inventory/Stock with duplicate-detection
- Projects + Batches + Milestone income (complex 30/40/30 splits, TDS, recovery, assessment fee)
- Fooding Income (month-wise, partner_share split, batch-closable)
- TDS Register Q1-Q4 reports
- Bulk select/delete on all major list pages
- Partner cross-approval (associated partners can approve each other's txns)
- Forgot Password OTP flow (Resend email)
- Audit trail + Approval timeline per request
- Notification center (in-app)
- Hindi/Hinglish + English i18n
- Print buttons on all major pages
- PWA installable + Play Store ready (icons + manifest + service worker)

### Phase 1 — Quick wins (Done, Mar 2026):
- **Pending Approvals** unified inbox (all types, tabs, KPIs, approve/reject with remarks)
- **Login History page** with IP + user-agent tracking + KPI summary
- **Reporting Authority** + **Center Partner** roles added to enum (chain steps `kind: role` resolve them)
- **Auto-create user** on Center/Partner entity save:
  - 12-char random password generated
  - Email sent via Resend with credentials
  - "Login Credentials Created" modal shows password ONCE
  - Mail send audit fields persisted (`credentials_mail_sent`, `_mail_at`, `_mail_error`)
  - Re-send credentials button per entity (generates new password)
- **Entity extra fields**: GST, PAN, CIN, RegNo (company); Email/Mobile (partner); ManagerName/Email (center); ProjectType/Code/Funding (project)
- **Project Types CRUD** with admin-configurable list (auto-seeds 8 defaults)
- **Center-wise approval chains** (different approvers per center)
- **Company selection in Batch dialog** + Dashboard Company/Partner separate charts

## Pending Backlog (Phased)

### Phase 27 — Advance Module, Phase 3 (P1):
- Auto-Adjustment math against payroll (monthly deduction of open balance)
- Standalone Settlement Module — repay cash / write off / bulk-settle
- Advance Ledger view (per employee, per center)
- Dashboard widgets for Advances (open, overdue, top holders)
- Reports / CSV exports & overdue alerts

### Phase 5 — Quick wins (P1):
- Privacy Policy page (`/privacy.html`) for Play Store PWA submission
- SEO Audit re-run on production URL
- Announcement Broadcast module (HR push to all/center)
- Performance Reviews / Warning Letters / Exit-process workflow

### Phase 6 — HR Lifecycle Extras (P2):
- Recruitment pipeline (job posts → applicants → interview → offer)
- Onboarding checklist
- Performance Reviews

### Phase 7 — Compliance Auto-Alerts (P2):
- PAN missing, GST expiring, document expiry alerts
- Bulk CSV import for Centers/Partners/Companies

### Phase 8 — Extras (P3):
- WhatsApp/SMS notifications (Twilio/Telegram)
- Device Binding (lock attendance to first registered device)
- Backup Management UI
- Penny-drop bank verification (Razorpay/Cashfree)

## Key Files
```
/app/backend/server.py        # ~5000 lines, monolith
/app/backend/email_utils.py   # Resend integration
/app/frontend/src/pages/
   PendingApprovals.jsx       # Unified approval inbox
   LoginHistory.jsx           # Audit page
   Programs.jsx, Dashboard.jsx, Entities.jsx, Transactions.jsx, HRMS.jsx, Stock.jsx
/app/frontend/src/components/
   FoodingTab.jsx
   BulkDeleteDialog.jsx
   Layout.jsx
/app/frontend/public/manifest.json + sw.js + icons/* + screenshots/*
```

## Test Credentials
See `/app/memory/test_credentials.md`

## Notes for Future Agents
- DO NOT refactor `server.py` `compute_milestones` / `receive_batch_payment` — extremely delicate math
- DO NOT modify React hook `[]` mount patterns flagged by lint as "missing deps" — they're intentional
- ALL 3rd-party integrations go via `integration_playbook_expert_v2`
- Resend domain `masharaskills.com` is fully verified; daily quota limits apply on free tier
- Production env vars sync via `.env` files during deployment
