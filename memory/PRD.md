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
