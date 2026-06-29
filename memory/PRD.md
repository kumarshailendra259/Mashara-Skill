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
