# Finance Tracker — PRD

## Problem Statement
Need a web application where company-wise, partner-wise, center-wise, project-wise investment, profit/loss, expenses, income can be tracked.

## User Personas
- **Admin** — Manages users + entities, full CRUD, can delete.
- **Manager** — Creates/edits entities + transactions; cannot delete or manage users.
- **Viewer** — Read-only access to dashboards, reports & lists.

## Stack
- Backend: FastAPI + MongoDB (motor)
- Frontend: React 19 + react-router 7 + Tailwind + shadcn/ui + Recharts
- Auth: JWT (httpOnly cookies) + bcrypt
- Charts: Recharts; Icons: lucide-react; Fonts: Chivo + IBM Plex Sans + JetBrains Mono

## Implemented (2026-06-21)
- JWT auth (login, register, logout, /me) with secure httpOnly cookies + admin seed (`admin@finance.app / Admin@123`)
- **6 roles** — admin, manager, center_manager, partner, accountant, viewer
- **Approval workflow** for transactions: non-admin entries start as `pending`, admin approves/rejects; admin-created entries auto-approved; editing an approved entry by non-admin resets to `pending`
- **Bulk approve** transactions — backend endpoint `POST /api/transactions/bulk-approve` ready (frontend UI deferred)
- **Role-based data scoping** — center_manager sees only assigned centers, partner sees only assigned partner profile, accountant/manager/admin see all, viewer sees only own entries
- **Admin User Management** UI — assign role + centers + partner profile
- Self-register cannot escalate to admin (downgraded to viewer)
- Entity CRUD for company / partner / center / project
- Line items per transaction (name, quantity, rate, amount) with item-wise aggregation
- Document attachments per transaction (≤10MB) via Emergent Object Storage
- CSV import + CSV export from transactions and per-dimension reports
- Dashboard with KPI cards, monthly trend, distribution pie, breakdown tabs (company / partner / center / project / item) — counts approved entries only by default
- Reports page with per-dimension P&L tables + CSV export
- **Partner Settlement view** (`/api/dashboard/settlement`) — when a partner logs in they see all co-partners at their shared center(s), with each partner's investment/expense/income, net contribution, fair-share, and adjustment (who pays whom) computed on equal-split basis. Admin can inspect any center via `?center_id=`.
- **HRMS module** — Staff master (designation, reports_to, monthly_salary, per_day_rate, linked user_id)
- **Attendance UI** (NEW 2026-06-21) — date picker, per-staff status select (present/absent/half/leave), Mark all Present/Absent, Save Attendance, Recent 30-day view
- **Leaves UI** (NEW 2026-06-21) — Apply Leave dialog, list with status badges, admin/manager approve/reject inline
- **Attendance Calendar View** (NEW 2026-06-21) — month grid per staff with colored day cells (P=green/A=red/H=yellow/L=blue), click-to-cycle marking for admin/manager, summary counts + Days Present total
- **Reimbursement 3-stage approval** — staff submits → L1 (snapshot of staff.reports_to, only that user can approve) → Accountant → Pay. On Pay, auto-creates an approved `expense` transaction so the dashboard P&L stays in sync. Step-wise badge UI visible to all roles.
- **Payroll** — admin/accountant runs monthly payroll; per-staff gross computed as `per_day_rate × days_present` (falls back to prorated monthly_salary). Pay action auto-creates the offsetting expense transaction.
- Bilingual UI (English / Hindi) toggle in header, persists in localStorage
- Swiss-style high-contrast light theme with International Klein Blue accents
- **Stock module** (NEW 2026-06-21) — `/stock` page + sidebar item. Aggregates all transaction line-items into a stock list with Purchase Date, Center, Item, Qty, Rate, Amount, Type, Status. Includes filters (center / type / date range / item search), 4 summary cards (rows, total qty, total amount, duplicates count), totals row, and Quick-Add dialog that creates a 1-line expense/investment/income transaction. Global duplicate detection: items with the same lower-cased name across any earlier transaction are flagged "Duplicate" (orange) — first occurrence shown as "First" (green).
- **Print-everywhere** (NEW 2026-06-21) — reusable `<PrintButton />` component + global `@media print` CSS hides sidebar / header / filters / action buttons and renders only the page content cleanly. Print buttons added to: Dashboard, Transactions, Reports, Stock, Entities (Companies/Partners/Centers/Projects), HRMS (all sub-tabs since they share header), Users.
- **Item-name autocomplete** (NEW 2026-06-21) — Transactions line-items and Stock quick-add inputs now use HTML `<datalist>` populated from `GET /api/items/suggestions` (distinct lowercased names + usage count, regex-escaped `?q=` filter, case-insensitive grouping).
- **Extended Roles** (NEW 2026-06-21) — added `hr`, `senior_manager`, `center_staff` to `ROLE_LITERAL`. Scope helper `_txn_scope_for_user` updated: hr/senior_manager see global data (like manager/accountant), center_staff scoped like center_manager. Available in Register + Users dropdowns.
- **Reporting-hierarchy lock** (NEW 2026-06-21) — Staff `reports_to_id` can be set/changed ONLY by admin. Manager-created staff have `reports_to_id` stripped to null on create; manager updates preserve existing value. Frontend hides the "Reports To" Select for non-admin in Add Staff dialog.
- **Approval Log** (NEW 2026-06-21) — `/approvals` admin-only page + sidebar item. `GET /api/approval-log` returns unified audit feed (transactions approved/rejected, reimbursements l1/accountant/paid/rejected stages, leaves approved/rejected, payroll paid) with Date/Time · Type · Action · Summary · Amount · By · Remarks. Filters: type, action, date range. KPI cards (Total/Approved/Rejected/Total Amount). Print-ready.
- **Leave audit fields** (NEW 2026-06-21) — `decide_leave` now persists `decided_by` + `decided_at`. Approval Log surfaces approver name for leaves (was `—` before).
- **Extended role write-permissions** (NEW 2026-06-21):
  - `hr` → POST/PUT `/api/staff`, POST `/payroll/run`, PATCH `/payroll/{id}/pay`, PATCH `/leaves/{id}`
  - `senior_manager` → POST `/transactions/{id}/approve|reject`, POST `/transactions/bulk-approve`, POST/PUT `/batches`, PATCH `/batch-payments/{id}/receive`
  - `center_staff` → POST `/attendance`
- **Programs / Batches / Milestones module** (NEW 2026-06-21) — new `/programs` page + sidebar entry. Project tabs (JSDMS, BOCWW, PRI, …) populated from `/entities/project`. Per project: center filter + batch dropdown + 3 milestone cards (1st/2nd/3rd). Each milestone shows Amount · Expected Date · Status (Not configured / Pending / Received) · received_date. "Mark Received" auto-creates an approved `income` transaction with center_id+project_id mirrored from the batch. Backend collections: `batches`, `batch_payments`. Endpoints: GET/POST/PUT/DELETE `/api/batches`, GET/POST/PUT/DELETE `/api/batch-payments`, PATCH `/api/batch-payments/{id}/receive`. Cascade delete: removing a batch wipes its milestone payments. Duplicate `(batch_id, milestone)` blocked with 400; double-receive blocked with 400. Project/center FK existence validated on batch creation.
- **Partner-wise milestone splits** (NEW 2026-06-21) — `Batch.partner_ids: List[str]` (multi-select in Batch dialog). On `/receive`, milestone amount is split equally into N approved `income` transactions (one per partner), each tagged `source="milestone"` + `milestone="1st|2nd|3rd"` and inheriting `center_id` + `project_id` from the batch. Rounding tail goes to the last share so sum exactly equals total. If no partners are selected, a single unassigned income txn is created (back-compat).
- **Milestone Income Dashboard** (NEW 2026-06-21) — new `GET /api/dashboard/milestone-income` returns `{total, by_milestone, by_partner, by_project, count}` with `start/end/project_id/center_id` filters + user scope. Dashboard renders a "Milestone Income" section: 4 KPI cards (Total / 1st / 2nd / 3rd) + Partner-wise Split table (% share) + Project-wise table (% share). Hidden when no milestone txns yet.
- **Mobile Attendance PWA** (NEW 2026-06-24) — new mobile-first `/check-in` page (NOT behind ProtectedRoute) for staff self-check-in. Three-step UX: (1) capture geolocation via `navigator.geolocation`, (2) take selfie via `<input type="file" accept="image/*" capture="user">` → uploads to `/api/files/upload` (now open to any authenticated user), (3) select status (present/half/leave) → `POST /api/attendance/self`. Backend looks up staff via `user_id`, upserts today's attendance with `marked_via="self"`, `marked_at`, `latitude`, `longitude`, `accuracy`, `selfie_path`. Re-submits use `exclude_none` so minimal payloads don't wipe existing fields. Admin HRMS Attendance tab now shows Source / Location (Google Maps link) / Selfie (40×40 thumbnail) columns per row. PWA manifest at `/manifest.json` with `start_url=/check-in`, `display=standalone`, `theme_color=#0a3bc5`, 192/512 icons + apple-mobile-web-app-* meta tags → installable as a home-screen app on Android & iOS.
- **HR full HRMS rights** (NEW 2026-06-24) — `hr` role now has full access: DELETE `/staff`, reimbursement L1-approve override, accountant-approve, pay; previously also had staff CRUD, payroll run/pay, leaves decide, attendance.
- **Auto-provision Staff Login + Email Credentials** (NEW 2026-06-24) — Admin → HRMS → Add Staff dialog has a new "Create login & email credentials" checkbox. When ticked + email entered: backend (1) creates a `users` row with role `center_staff`, secure 12-char random password (1 upper + 1 lower + 1 digit + 1 symbol minimum), hashed via bcrypt; (2) links the new user_id to the staff record; (3) calls Resend to email the temporary password + check-in mobile URL via a branded HTML template (Mashara Skills colours, Open Portal / Mark Attendance CTAs, "change password on first login" warning). Idempotent if user with same email already exists. Email is non-fatal: when `RESEND_API_KEY` is empty, staff/user are still created and the response includes `email_status: { sent: false, reason: "resend_not_configured" }` so the UI can inform the admin clearly.
- **Email integration**: Resend SDK (`resend==2.32.2`), backend env vars `RESEND_API_KEY` (empty until user pastes their key), `SENDER_EMAIL=onboarding@resend.dev` (Resend test sender). Helper module `backend/email_utils.py` with `generate_password(length=12)` + async `send_credentials_email()` (uses `asyncio.to_thread` to keep FastAPI event loop free).
- **Resend API key configured** (2026-02-XX) — User pasted `RESEND_API_KEY` into `backend/.env`. Backend restarted. Live send test to `delivered@resend.dev` succeeded (returned message id). Staff-credential emails now actually deliver on Add Staff "Create login & email credentials".
- **Forgot Password OTP flow** (2026-02-XX) — 3-step `/forgot-password` page: email → 6-digit OTP via Resend (15-min validity, single-use, rate-limited 3/15min, no email enumeration) → new password. Login & Staff PWA (/check-in) both link to it with smart "Back to" return state. Backend endpoints: POST /api/auth/{forgot-password, verify-otp, reset-password}. TTL index on password_reset_otps.expires_at auto-purges.
- **Partner Cross-Approval** (2026-02-XX) — Associated partners (same project/center OR custom pairing in `partner_associations`) can approve each other's pending transactions. 1 valid approval → auto-approved. Self-approval blocked. New /partner-associations admin page for custom pairings. New POST /api/transactions/{tid}/partner-approve endpoint + eligibility helper.
- **Job-role-wise 1st Milestone Auto-Computation + TDS** (2026-02-XX) — Batches now carry `job_roles: [{category, job_role, candidates, hours}]`. Fixed hourly rates: Cat1=₹56.35, Cat2=₹52.50, Cat3=₹36.85. Auto-formula: `1st_total = Σ(candidates × rate × hours) + total_candidates × ₹1000 uniform`. New `GET /api/batches/{bid}/compute-1st-milestone`. Mark Received dialog has TDS dropdown (0%/2%/10%); TDS calculated on (gross − uniform), uniform is TDS-exempt. Gross income txns still recorded at full amount; separate expense txn (source='tds_deduction') records the TDS. Tested 13/13.
- **3-Milestone Split + Candidate Recovery** (2026-02-XX) — Spec extended: `role_total = Σ(c × rate × h)`. Then `1st = 30% × role + uniform`, `2nd = 40% × role × (passed/total) − recovery (30% × role × failed/total)`, `3rd = 30% × role × (placed/total)`. Batches gained `passed_candidates` + `placed_candidates` fields. `BatchPaymentIn.recovery_amount` for 2nd-milestone claw-back. New `GET /api/batches/{bid}/compute-milestones` returns all three. On Receive, recovery creates a separate `source='candidate_recovery'` expense txn alongside `tds_deduction`. UI shows live 3-milestone strip + breakdown card with all 3 sub-cards. Configure 2nd auto-fills gross + recovery amount. Verified end-to-end: 30 candidates / 26 passed / 4 failed / 20 placed → 1st ₹1,31,430, 2nd net ₹1,03,684 (gross ₹1,17,208 − recovery ₹13,524), 3rd ₹67,620. Tested 11/11 new + 13/13 iter-15 retained.
- **TDS Register (Form 26Q helper)** (2026-02-XX) — GET /api/reports/tds-register?fy=&quarter=&project_id= returns full TDS deductions list grouped by Indian-FY quarter. CSV export endpoint. New /tds-register page with FY/Quarter/Project filters + KPI cards + by-project table + detailed row view. Sidebar entry visible to admin/accountant/senior_manager/hr.
- **Bulk Select + Delete/Archive** (2026-02-XX) — Reusable `BulkDeleteDialog` component (>10 items require type-confirm 'DELETE N' / 'ARCHIVE N' phrase). Applied to Companies, Partners, Centers, Projects (hard-delete), Transactions (admin can delete approved too), Stock (delete parent txns), Partner Pairings (hard-delete), Users + HRMS Staff (SOFT archive: sets is_active=false + cascades to linked user; staff data preserved for reports). Admin only. Self-archive blocked.
- **2nd Milestone Assessment Fee + Recovery-Aware TDS** (2026-02-XX) — TDS taxable base now correctly subtracts recovery: `taxable = gross − uniform − recovery`. New manual fields `assessment_fee_per_candidate` + `assessment_fee_total` on 2nd milestone payment; on Receive, creates a separate `source='assessment_fee'` expense txn. Final 2nd milestone net = `gross − recovery − tds − assessment_fee`. Verified math: gross ₹1,17,208 − recovery ₹13,524 − TDS@2% on ₹1,03,684 (₹2,073.68) − assessment ₹13,000 = **net ₹88,610.32**. Tested 34/34 (iter-16 + iter-18 combined).
- **Partner Profit-Share % (Company + Partner split)** (2026-02-XX) — New per-batch `partner_share_percent` (0-100, default 0). On milestone receive: partner pool = gross × pct, split equally among `partner_ids`; company keeps `gross × (1 − pct)`. Company income recorded as separate txn with `partner_id=null`. E.g., 2 partners @ 25% on ₹1L → company ₹75k + each partner ₹12.5k (12.5% each). TDS/recovery/assessment fee remain single company expenses (not pro-rated). Live UI hint shows the per-partner % calculation. Active batch view has a dedicated "COMPANY" share card alongside per-partner cards. Tested 14/14 new + iter-12 stale tests updated to new spec — 72/72 total milestone tests pass.
- **"Other" Milestone Category** (2026-02-XX) — Added `"other"` to `MilestoneType` literal alongside 1st/2nd/3rd. Purely manual entry — no auto-fill formula. Admin enters amount + description, can update later via PUT, supports TDS deduction on Receive same as other milestones. Milestone-income aggregator includes new "other" bucket. UI shows it as 4th milestone card with label "Other (manual)". Invalid milestone strings still return 422.

## Backlog (P1)
- Excel (.xlsx) export — currently CSV only
- Multi-currency support
- User management screen for Admin (currently API-only)
- Edit/Delete transactions individually from CSV import errors view
- Audit log + per-transaction attachments

## Backlog (P2)
- Email-based password reset (UI)
- Recurring transactions / scheduled entries
- Per-project budget vs actual variance reports

## Next Tasks
- Wait for user feedback & iterate

## Code Review Fixes (2026-06-21)
- Frontend: Fixed array-index keys → use stable identity (`Transactions.jsx` item rows now use `it._k` cached id; `Dashboard.jsx` PieChart cells now use `entry.name`)
- Frontend: Removed unused `eslint-disable-next-line` directives in `Transactions.jsx` and `Entities.jsx`
- Frontend: Replaced `console.warn` in `AuthContext.logout` with silent best-effort catch
- Backend: Test files (`tests/test_finance_*.py`) now read `ADMIN_EMAIL`/`ADMIN_PASSWORD` from env (`FINANCE_TEST_ADMIN_EMAIL`/`FINANCE_TEST_ADMIN_PASSWORD`) with fallback to seeded test creds
- Backend: Relaxed `TransactionOut.amount` to `ge=0` so historical/edge data (e.g. 0-day payroll runs) serializes; `TransactionIn.amount` still validates `gt=0` for new entries
- Backend: `/api/payroll/{pid}/pay` now skips creating a zero-amount expense transaction when `net <= 0` (still marks payroll row as paid)
- Skipped as **false positives** (verified with our linter): `i18n.js` "Password" string, server.py `is not None` (idiomatic Python), `data/ct` undefined (re-raise above guarantees assignment), majority of React-hook-deps warnings (would cause infinite fetch loops without restructuring; existing code uses correct dependency arrays)
- Deferred (high risk / requires major refactor): splitting `Transactions.jsx`/`HRMS.jsx`/`Dashboard.jsx` into smaller components, wrapping every `load`/`loadAll` in `useCallback`
