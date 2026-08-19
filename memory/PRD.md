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

### Phase 37 · Phase 3 — Assessment + Placement + Attendance CSV (Done, Feb 2026)
- **User asked**: Ship Assessment stage (SDMS + agency + present/pass/fail chips + live certification %), Placement stage (employer + CTC + M1/M2/M3 retention chips + live placement %), and CSV export for the attendance grid.
- **Backend `/app/backend/server.py`** (~+280 LOC):
  - **Assessment**: `PATCH /api/batches/{bid}/assessment` (batch-level SDMS/agency/date/assessor/status); `POST /api/batches/{bid}/candidates/{cid}/assessment` (per-candidate absent/present/passed/failed + certified auto-set on passed); `POST /api/batches/{bid}/candidates/assessment/bulk` (UpdateOne `bulk_write`); `GET /api/batches/{bid}/assessment/summary` (returns present/absent/passed/failed/certified counters + `certification_pct`, `pass_pct`). Helper `_resync_batch_assessment_counters` keeps batch.passed_candidates / total_certified / actual_present / pass_count / fail_count / absent_count in sync.
  - **Placement**: `PATCH /api/batches/{bid}/candidates/{cid}/placement` (blocks `placed` status for non-certified with 400); `POST /api/batches/{bid}/candidates/placement/bulk` (silently skips non-certified); `GET /api/batches/{bid}/placement/summary` (total_enrolled, certified, placed, `placement_pct`, pending, per-month retention counts + %s, ctc min/avg/max). Helper `_resync_batch_placement_counters` keeps placed_candidates / num_placement in sync.
  - **Attendance CSV**: refactored `get_batch_attendance` to reuse `_build_attendance_grid` helper; new `GET /api/batches/{bid}/attendance/export.csv?from_date&to_date` streams a CSV — headers = Candidate ID + Name + Mobile + <date columns> + Present + Absent + Holiday + Present %.
  - RBAC: `ASSESS_ROLES`/`PLACE_ROLES` = (admin, manager, senior_manager, hr, center_manager); CSV export also allows accountant. Center-manager scoped to own centers throughout.
- **Frontend** (2 new files + 1 enhancement):
  - `/pages/bm/AssessmentStage.jsx` — batch metadata form with 6 batch-level fields + "Save Batch Info", 6-KPI summary strip with live certification %, 4-chip bulk-mark bar, per-candidate outcome chips (Absent / Present / Passed / Failed) with active-state ring highlight + Certified badge.
  - `/pages/bm/PlacementStage.jsx` — 6-KPI strip (Enrolled / Certified / Placed / **Placement %** / Pending / Avg CTC), 3-card Retention snapshot (M1/M2/M3 counts + %s), certified-candidates-only table with per-row Edit dialog (status + employer + location + designation + joining + CTC + 3 retention selects + remarks).
  - `/pages/bm/AttendanceStage.jsx` — added "Export CSV" button that streams via `fetch(url, {credentials:'include'})` and triggers a filename-sanitised download.
  - `BatchManagement.jsx` — Stages 5 + 6 tabs now enabled. Placeholder section removed. **All 7 stages of Batch Management are now functional.**
- **Verified iter-54**: 16/16 backend pytest + 100% Playwright frontend. Regression clean on /api/batches, /api/batch-targets, /api/mis/live/overview.
- **Post-test fixes**: (1) Assessment meta initialised with 6 empty-string keys to kill React uncontrolled-to-controlled warnings; (2) Attendance CSV filename sanitised (regex `/[^a-zA-Z0-9-_]/g → _`).

### Phase 37 · Phase 2 — Batch Management Stages 3, 4, 7 (Done, Feb 2026)

- **User asked**: Ship Enrollment (bulk CSV + capacity gate), Attendance Grid (date-range Mark-All-Present), and Auto-Closure + Extension approval.
- **Backend `/app/backend/server.py`** (~+450 LOC):
  - **Enrollment**: `_batch_capacity_state(bid)` helper; `GET /api/batches/{bid}/candidates` returns capacity + rows; `POST /api/batches/{bid}/candidates` single-add with Aadhaar dedupe + full-capacity 400; `POST /api/batches/{bid}/candidates/bulk-upload` (multipart CSV/XLSX) returns `{valid, errors, counts, capacity_state}` — validates name, dedupes Aadhaar (in-batch + in-file), truncates overflow into errors; `POST /api/batches/{bid}/candidates/bulk-commit` atomically re-checks capacity + `insert_many`; `DELETE /api/batches/{bid}/candidates/{cid}` soft-deletes.
  - **Attendance**: `_iter_dates` + `_validate_att_window`; `GET /api/batches/{bid}/attendance` returns candidates × dates matrix; `POST /api/batches/{bid}/attendance/mark` bulk-marks P/A/H with per-cell / column / all-batch modes via PyMongo `bulk_write(UpdateOne, ...)`; `GET /api/batches/{bid}/attendance/summary` overall + per-candidate %s.
  - **Auto-close + Extension**: `_auto_close_expired_batches` closes past-end batches, sets all four `*_locked=true` + appends system entry to `lifecycle_history`; `_batch_autoclose_scheduler` daily 01:15 IST cron; `POST /api/batches/auto-close/run` (admin-only manual trigger); `POST/GET /api/batch-extension-requests` (center_manager scoped); `PATCH .../{rid}/approve` admin-only (updates end_date, reopens if closed, clears locks, audit trail); `PATCH .../{rid}/reject` requires `rejection_reason`.
  - `BatchOut` now exposes `auto_closed_at`.
- **Frontend** (3 new files):
  - `/pages/bm/EnrollmentStage.jsx` — batch picker + capacity meter, CSV template download, upload-with-preview flow (valid rows table + inline error panel), manual-add dialog, enrolled candidates table with remove.
  - `/pages/bm/AttendanceStage.jsx` — batch + date-range picker (clamped to batch window), summary chips, sticky-header grid with clickable P/A/H cells, per-column bulk-mark icons, "Mark All Present" button (overwrite=false), per-candidate % column.
  - `/pages/bm/ClosureStage.jsx` — Auto-Closure description + "Run Auto-Close Now" (admin), Request Extension dialog (batch + new-end + reason), requests table with Approve/Reject (admin), reject dialog with mandatory reason, KPI strip, closed-batches details.
  - `BatchManagement.jsx` — tabs 3/4/7 now enabled and render the 3 new stage components.
- **Verified iter-53**: 25/25 backend pytest + 100% Playwright E2E across all 3 stages. Regression clean on /api/batches, /api/batch-targets, /api/mis/live/overview.
- **Post-test fixes**: (1) Request Extension button now stays visible but disabled with tooltip when no active batches with end_date; (2) `auto_closed_at` exposed in BatchOut so admins can see when the scheduler closed a batch.
- **Remaining Batch Management stages**: 5 (Assessment) + 6 (Placement) — placeholders in the current UI.

### Phase 37 · Phase 1 — Batch Management Module (Stages 1 & 2) (Done, Feb 2026)

- **User asked**: New dedicated "Batch Management" module = single centralised system for the batch lifecycle (Target Allocation → Batch Creation → Enrollment → Attendance → Assessment → Placement → Closure). Duplicate Add-Batch buttons removed from other modules. User approved (a) Phase 1 only, (d) admin-only for extension approvals in future, (f) grandfather legacy batches without target link.
- **Backend `/app/backend/server.py`** (~+250 LOC around line 10450):
  - New models `BatchTargetIn` / `BatchTargetOut` + `TARGET_ADMIN_ROLES` = (admin, manager, senior_manager). Fields: state/territory/company_id/center_id/project_id/target_year/fy/training_type/job_role_targets[]/total_target/remarks + auto-managed allocated/remaining.
  - Endpoints: `POST /api/batch-targets` (validates FKs + sum(job_role_targets)=total_target + total>0), `GET /api/batch-targets` (filters project_id/center_id/target_year/only_available; center_manager scoped to `assigned_center_ids` with anti-bypass), `GET /api/batch-targets/{tid}`, `PATCH /api/batch-targets/{tid}` (rejects shrinking total below already-allocated), `DELETE /api/batch-targets/{tid}` (admin only; rejects when allocated>0), `GET /api/batch-targets/{tid}/batches`.
  - Helpers `_consume_target(tid, amount)` — atomic `find_one_and_update({remaining:{$gte:amount}}, $inc)` guard; `_release_target(tid, amount)` for delete/detach.
  - `BatchIn.target_id: Optional[str]` added. `create_batch` now consumes target seats atomically (with rollback on insert failure) and enforces project/center coherence with the target. `delete_batch` releases the seats back.
  - Legacy batches (target_id=null) remain fully functional — no forced migration.
- **Frontend `/app/frontend/src/pages/BatchManagement.jsx`** (~640 LOC, new file):
  - Route `/batch-management` (App.js) + sidebar entry with Target icon + `batchMgmtAccess` role gate covering admin/manager/senior_manager/accountant/hr/center_manager.
  - i18n label `batch_management` (EN + HI).
  - 7-KPI header strip (Targets, Total Target, Allocated, Remaining, Utilization %, Total Batches, Active Batches).
  - Tabs 1–7: Targets + Batches enabled; Enrollment / Attendance / Assessment / Placement / Closure disabled with "Coming in next release" placeholders.
  - Stage 1 (Target Allocation): filters (search/project/year), CRUD table with progress bar per row and inline "Batch" quick-create button that prefills the Batch dialog.
  - Stage 2 (Batch Creation): target dropdown lists only `only_available` targets; project/center auto-fill and lock when the target has them; capacity input clamps to remaining with inline validation; Legacy vs Linked badge on batch rows.
  - Deprecated inline "New Batch" buttons in Programs (`btn-goto-batch-management`) and MIS ProjectSummaryTab Manual mode (`pjt-goto-batch-management`) — both redirect to `/batch-management`.
- **Verified iter-52**: 20/20 pytest + 100% Playwright. Includes atomic 3-parallel-consume race test (only one wins), delete releases seats, insufficient→400, RBAC.
- **Post-test fixes**: (1) Added `DialogDescription` for a11y on both dialogs; (2) role-gated Create Batch button (accountant/hr see "Read-only role" chip); (3) Center-manager list scoping now anti-bypass (previously a passed `center_id` could sidestep assigned-centers check).
- **Deferred to Phase 2 & 3**: Stages 3–7 (Enrollment / Attendance / Assessment / Placement / Closure), extension request workflow (admin-only approval per user), auto-closure on End Date, Batch Details page with 9 tabs, audit log.


- **User asked (Hinglish)**: "isme jo already created hai use dropdown me dikhaye jaise project center etc, iske alawa center manager jo dwara jo batch banaya ja raha hai usme ye sab option daliye aur baar samajhiye yadi ek baar batch ban gaya to o lock ho jayega uske baad attendance monitoring hoga, uske baad assessment status sirf upload hoga ye hone ke baad ye bhi lock matlab fir se edit nahi baad me placement status update kuch is trah se … Batch Status Auto-Update should support: Draft / Upcoming / Active / Training Completed / Assessment Pending / Assessment Completed / Certification Pending / Certified / Placement in Progress / Closed". User chose option (c) — enable lifecycle on BOTH Core ERP `db.batches` AND `mis_project_summary`, target Production.
- **Backend `/app/backend/server.py`**:
  - Added `BATCH_LIFECYCLE_STATES` (10-state ordered list) + `_lifecycle_locks(status)` helper that returns `{basic_locked, attendance_locked, assessment_locked, placement_locked}` derived from the current status index.
  - `BatchIn` model extended with ~24 optional MIS overlay fields (state/territory/target_year/training_type/total_target/sdms_batch_id/attendance_pct/total_dropout + assessment block + placement block + `lifecycle_status`). `BatchOut` exposes lock flags + `lifecycle_history`.
  - New `PATCH /api/batches/{bid}/lifecycle?to=<State>&remarks=...` — advances/rolls-back with role checks (non-admin can only move forward; center_manager confined to own centers; admin bypasses everything). Appends every transition to `lifecycle_history`. Keeps legacy `closed` bool in sync on Closed / non-Closed.
  - New `GET /api/batches/lifecycle-states` — returns the ordered list for UI dropdowns.
  - `PUT /api/batches/{bid}` — added lifecycle-lock enforcement (400 if a non-admin tries to edit a locked field). Center manager scope enforced.
  - MIS mirror: `PATCH /api/mis/projects/{pid}/lifecycle` (same semantics on `mis_project_summary`). MIS `POST /mis/projects` now allows `center_manager` (scope-checked against `db.centers`) and stamps `lifecycle_status` + locks + creation history entry. MIS `PATCH /mis/projects/{pid}` enforces the same per-phase locks. `_pjt_compute` overlays lock flags + normalises `lifecycle_status` on every read.
- **Frontend `ProjectSummaryTab.jsx`** (MIS Project Summary):
  - `SECTIONS` restructured with per-section `phase` + per-section `hint`. Fields tagged with `type: select-project | select-center | select-company | select-lifecycle | select` where relevant.
  - Loads Core ERP entities via `Promise.all([/entities/project, /entities/center, /entities/company])` on mount. Filters out entities with empty names before rendering `<SelectItem>` (Shadcn Select rejects empty values).
  - Center dropdown auto-fills State / Territory / Center Manager from the selected center's entity metadata.
  - Section headers show 🔒 **Locked** amber chip when the corresponding `*_locked` flag is true; inputs dimmed + `disabled`.
  - New **Lifecycle actions** bar in edit dialog — 10 buttons for direct state transitions; current state highlighted with its lifecycle tone. Backend enforces role-based validation.
  - Row Status column now shows the 10-state lifecycle chip (colored per `LIFECYCLE_TONES`). Filter dropdown offers all 10 lifecycle states.
  - `canWrite` extended to include `center_manager` (MIS Dashboard).
- **Bug found & fixed same-session**: Shadcn `<Select.Item value="">` runtime error — fixed by (a) using `value={editing[f.k] || undefined}` on controlled Selects and (b) filtering out entity records with empty `name` before rendering options.
- **Verified**: E2E backend flow — create MIS batch (Draft) → advance to Active (basic_locked=true) → advance to Certification Pending (assessment_locked=true, placement_locked=false) → admin rollback to Draft (all locks cleared). Live browser: Add Batch dialog renders with all dropdowns + 10-state Batch Status selector + section-level lock hints.
- **Note for user**: Preview me implementation complete. Production par push karne ke liye "Deploy" button dabana hoga (finance.masharaskills.com).

### Phase 36A + 36B — MIS Single Source of Truth (Done, Feb 2026)
- **User asked**: MIS Dashboard should not create duplicate Projects/Centers/Batches/Candidates. It must fetch, calculate, and display data directly from the existing Core ERP modules — Single Source of Truth. User approved "Phase A (Backend rewiring) → Phase B (Frontend) → testing agent".
- **Backend `/app/backend/server.py` — new additive endpoints (all non-breaking; legacy /api/mis/* left intact)**:
  - Helper `_mis_live_batch_rows()` — joins `db.batches` with `db.projects`, `db.centers`, `db.companies`, and per-batch candidate counts (aggregation on `db.candidates` grouped by batch_id). Returns rows shaped like `mis_project_summary` (batch_id, project, center_name, state, total_target, total_enrolled, total_certified, num_placement, total_dropout, status + computed %s).
  - `GET /api/mis/live/overview` — Live KPIs from Core ERP: entities (projects/centers/companies/partners counts), batches (total/active/closed), training (target/enrolled/certified/placement/dropout with %s), bg (live from `bank_guarantees`), mobilization (today from mis_mobilization).
  - `GET /api/mis/live/project-summary` — batch-level rows with filters (project, center, state, status, search).
  - `GET /api/mis/live/project-summary/filter-options` — dropdown values.
  - `GET /api/mis/live/rollups` — by_project / by_center / by_state aggregates.
  - `GET /api/mis/live/reports/daily` — executive summary + rollups (Core ERP driven).
  - `GET /api/mis/live/reports/drilldown/{kpi}` — kpi ∈ {enrolled, certified, placement, dropout, active_batches, centers, projects}. Returns kind + count + rows.
- **Frontend**:
  - `MISDashboard.jsx` — dual overview fetch via `Promise.all([/mis/overview, /mis/live/overview])`. New **"Live · Core ERP"** KPI strip (green badge, 8 KPIs) rendered above the existing "MIS Overlay" strip (indigo badge). Live KPI cards drill down via `/api/mis/live/reports/drilldown/*`. Drill dialog handles new kinds `centers` and `projects`.
  - `ProjectSummaryTab.jsx` — new **Data Source** segmented toggle at top (`pjt-src-live` / `pjt-src-manual`). Defaults to Live. In Live mode: rows come from `/api/mis/live/project-summary`, Add/Edit/Delete/Bulk/Export buttons hidden (with explanatory copy "Add batches on Programs page — numbers auto-fetch from Batches / Candidates modules"). Switching to Manual keeps legacy behaviour on `/api/mis/projects`.
- **Verified iter-51**: 21/21 backend pytest pass (all 6 new endpoints + RBAC + legacy regression on `/api/mis/overview`, `/api/mis/projects`, `/api/mis/reports/daily`, `/api/batches`, `/api/candidates`). Frontend 100% E2E — both KPI strips visible, drill-downs open for Projects (100 records) & Active Batches (351 records), Data Source toggle works, Manual mode restores Add/Bulk/Export buttons. No regression on Overview / SIP Status / JSDMS / Mobilization / Reports / Alerts tabs.
- **Data observations (not bugs)**: Preview seed data has 3,467 certified > 2,559 total_target (Achievement % 135.48% — over-achievement) and 0 candidates linked to batches (Enrolled live = 0). This reflects the current seeded state, not a code defect.


## Implemented Features (Mar 2026)

### Phase 31 — Cycle-Based Partner Settlement Math (Done, Aug 2026)
- **User asked**: Explicit math rules — (a) `A_Contribution + B_Contribution = Total Expense` where each partner's contribution = investment + expense; (b) `Total Income − Total Expense = Profit/Loss`; (c) `Final Share = Contribution + (P/L × 0.5)` [equal 50-50 split]; (d) only ACTIVE cycle transactions (strictly AFTER last settlement date) count — once settled, older cycles are closed. Lifetime totals stay visible only via the "View Settled History" toggle.
- **Root cause of blocker**: Previous fork rewrote helper `_aggregate_partners_for_center` to return a 6-tuple (partners, total_expense, fair_share, n, total_income, profit_loss) but the caller at `settlement_view` (line 2891) was still unpacking a 4-tuple → `GET /api/dashboard/settlement` returned 500 for every user.
- **Backend `/app/backend/server.py`**:
  - Fixed tuple unpacking: `partners, total_contrib, fair_share, n, total_income, profit_loss = _aggregate_partners_for_center(rows, p_name)`.
  - Response envelope for each center now includes `total_income`, `profit_loss`, `profit_share_each` in addition to existing `total_contribution`, `fair_share_each`, `partner_count`.
  - Per-partner rows now expose `total_contribution`, `profit_share` (equal for all partners = `profit_loss / n`), `final_share` (= contribution + profit_share), plus legacy `net_contribution` for back-compat.
  - "All-settled stub" (no post-cutoff activity) now also carries the 5 zero-KPI fields so frontend renders consistently.
- **Frontend `/app/frontend/src/components/SettlementSection.jsx`**:
  - New 5-KPI strip per center: Total Income · Total Contribution (Expense) · Profit/Loss · Profit Share/Partner (50/50) · Fair Share/Partner. Colors flip red/green based on P/L sign.
  - Partner rows now show 4 new columns — Contribution, Profit Share (50%), Final Share, Adjustment.
  - Cycle-math explanation banner + `settled_till` badge with "Active cycle from next day".
  - Lifetime block (History toggle) enriched with its own 4-KPI strip.
- **Verified**: 12/12 pytest pass; testing_agent iter-50 validated live UI + math accuracy across 110 centers, zero bugs.

### Phase 35 — Login Provisioning + Self-Service Profile + Bank Verify (Done, Aug 2026)
- **User asked**: (1) staff add hone ke baad login ID + password generate hoke mail ho jaye, (2) staff khud bank details fill kare aur HR approve kare, (3) profile photo bhi laga sake.
- **Backend `/app/backend/server.py`**:
  - New **`POST /api/staff/{sid}/generate-login`** (admin/hr) — creates the linked user account (role: `center_staff`), generates a random 12-char password, emails credentials via Resend. Params: `send_email=true`, `force_reset=true` to rotate password on an existing user. Idempotent — second call without `force_reset` returns the existing user without a new password. Password is echoed back only when the email failed AND caller is admin.
  - New **`GET /api/me/staff-profile`** — returns the calling user's linked staff row for the self-service page.
  - New **`PUT /api/me/staff-profile`** — staff self-updates a whitelisted subset (`mobile, address, photo_url, bank_name, bank_account_no, ifsc, account_holder_name, upi_id`). Explicitly EXCLUDES role/salary/center. If ANY bank field changed → auto-sets `bank_verified=false` and pings all admin/hr users so they re-approve.
  - New **`POST /api/me/staff-profile/photo`** — multipart image upload to object storage; sets `photo_url` + `photo_key` on the staff row. Enforces 3MB + `image/*` guard.
  - `POST /api/staff/{sid}/verify-bank` (existing) — now also fires a `bank_verified` notification to the staff so they know HR approved.
- **Frontend**:
  - **New page `pages/MyProfile.jsx`** — self-service form with (a) photo tile + upload/change button, (b) Contact Details section, (c) Bank Details section with real-time "Pending HR Approval" amber badge vs "Verified" emerald badge. All submits use `<SubmitButton>` for double-click safety.
  - **Sidebar** — new "My Profile" entry (`staffOnly` — visible to center_staff / center_manager / hr / manager / senior_manager). English + Hindi translations added.
  - **HRMS Staff table** — new **KeyRound** button per row (`staff-genlogin-<id>`) that (a) creates the login + emails password if not yet linked, (b) rotates the password + re-emails if login already exists. Fallback: if email delivery fails, admin gets a browser prompt showing the plaintext password to share manually.
  - **HRMS Staff table** — new amber **ShieldAlert** icon when the staff has bank details but they're not verified (click to approve); replaced with a green **ShieldCheck** badge when verified.
- **Verified**: End-to-end script — generate-login on a fresh staff created the user + rotated password on second call with `force_reset=true`; idempotent second call returned the existing user without rotation. Live browser: 25 Generate-Login buttons render on Staff tab, `/me/profile` page renders with photo/contact/bank sections + hint copy "Fill in and submit — HR will approve".

### Phase 34 — Safe Receive Rollback + Cleanup Guards + Dashboard Consolidation (Done, Aug 2026)
- **User asked**: (1) disable Transactions submit + busy state, (2) idempotency guard on `create_transaction` via unique index, (3) `receive_batch_payment` must save txns BEFORE flipping to `received` and rollback on failure, (4) guard `cleanup-orphan-txns` so it never deletes valid milestone txns, (5) consolidate dashboard API calls.
- **Frontend `pages/Transactions.jsx`** — new-transaction "Save" button now uses `<SubmitButton>` (synchronous ref-latch prevents rapid double-click; spinner + "Saving…" label; auto-unlocks on completion). All other `api.post` calls are already duplicate-safe thanks to the Phase 32 axios `Idempotency-Key` interceptor.
- **Backend `/app/backend/server.py`**:
  - **Idempotency unique index** — `idempotency_keys.key` (unique) + TTL on `expires_at` were already registered in Phase 32; verified in production Mongo `index_information()`.
  - **`receive_batch_payment` — rollback safety**: `status: pending → _receiving` (intermediate lock) instead of jumping straight to `received`. All 4 possible txn inserts (income splits, recovery, assessment fee, TDS) plus the final status commit are wrapped in try/except that calls `_rollback()`. Rollback deletes every txn we managed to insert (tracked via `all_created_ids`) AND resets the payment back to `pending`. Only when the final commit succeeds does the status flip to `received`. Guarantee: `status="received"` ⇔ all txns persisted.
  - **`cleanup_orphan_milestone_txns` — hardened**: default now `dry_run=True`. Refuses to delete unless `confirm=true` AND `orphans ≤ max_delete` (default 100). Response returns `refused_reason` on guard-trip. Also gates the duplicate-cleanup phase behind the same `confirm=true`. This prevents mass-wipe of valid manual milestone txns that don't structurally match any batch.
  - **New `GET /api/dashboard/all`** — consolidated endpoint returning `{summary, milestone_income, fooding_income, settlement, errors}`. Sub-queries run in parallel via `asyncio.gather` with per-block error isolation (a slow settlement never blocks the summary tiles). Response shape matches the underlying endpoints so client-side reducers slot the payload in without remapping.
- **Frontend `pages/Dashboard.jsx`** — replaced 3 separate `api.get("/dashboard/{summary|milestone-income|fooding-income}")` calls with a single `api.get("/dashboard/all")`. Settlement is included via the same call when the toggle is on (`include_settlement_history=true` query param).
- **Verified**: 22/22 pytest pass (settlement + idempotency + pending-approvals suites); browser dev-tools request trace shows dashboard load fires ONE `/dashboard/all` instead of 3–4 separate calls; consolidated endpoint end-to-end response returns keys `[errors, summary, milestone_income, fooding_income, settlement]` with 129 settlement centers + milestone total ₹1.5Cr + fooding ₹36K matching the previous individual-endpoint responses.

### Phase 33 — Staff Bulk Ops + Attendance Chips (Done, Aug 2026)
- **User asked**: (a) missing Employee Codes wale staff ko codes assign karo, (b) bulk staff add karne ka option do, (c) attendance status pe color dikhao — Present = green, Absent = red, On Leave = blue. Later: add CSV export + template download.
- **Backend `/app/backend/server.py`**:
  - Extracted reusable `_next_employee_code()` helper (format `EMP-YYYY-NNNN`, year-scoped 4-digit sequence, safe under concurrent adds thanks to the existing unique index on `staff.employee_code`).
  - New `POST /api/staff/backfill-employee-codes?dry_run={bool}` (admin/hr) — scans staff with missing/blank codes, assigns fresh codes sequentially. `dry_run=true` reports count without writing.
  - New `POST /api/staff/import` (multipart CSV; admin/hr) — bulk-adds staff. Headers case-insensitive: `name` (required), `designation`, `email`, `mobile`, `salary`, `center_id`, `employee_code` (optional; auto-allocated when blank). Duplicate detection on employee_code + email. Returns `{created, skipped, errors[]}` with per-row reasons.
  - `GET /api/staff` now bulk-joins today's attendance status (IST-normalised date) → new `today_status` field on `StaffOut` (`"present"|"absent"|"half"|"leave"|null`). No extra API roundtrip for the HR UI.
- **Frontend `HRMS.jsx`**:
  - **"Backfill Codes"** button in Staff tab toolbar — dry-run first, prompts with count, then real fix. Uses hash icon.
  - **"Bulk Add (CSV)"** upload label with hidden file input — sends CSV multipart, toasts `created/skipped` count.
  - New **`StaffTodayChip`** component renders a color-coded pill with a status dot: present→emerald, absent→red, on-leave→blue, half-day→amber. Placed in a new "Today" column between Name and Designation.
- **Verified**: End-to-end script — backfill run assigned 164 codes in one shot; CSV import created 3 valid rows + correctly skipped 1 duplicate + surfaced the reason. Live browser test — Auto Provisioned = green PRESENT chip, Boss1_23de04 = red ABSENT, Boss1_49b718 = blue ON LEAVE (screenshot confirms). All 25 visible staff now have `EMP-2026-XXXX` codes.

### Phase 32 — Performance + Idempotency Guard (Done, Aug 2026)
- **User asked**: (a) Optimize the dashboard to fetch data in fewer/consolidated calls and add DB indexes to speed up reads; (b) implement a global submission guard: disable submit immediately + spinner, and make transaction-creation endpoints idempotent so duplicate submits don't create duplicate records. The screenshot showed Pending Approvals stuck on "LOADING…".
- **Backend `/app/backend/server.py`**:
  - **Pending Approvals fast-path**: `list_pending_approvals` pre-computes the caller's role + assigned_center_ids + linked staff_id + direct-report subordinate set ONCE, then evaluates step-eligibility in pure Python (no per-row DB roundtrip). All approval-type collections are now fetched **in parallel via `asyncio.gather`**. Response for admin now <400ms.
  - **DB indexes added** (Phase 32): `current_level` + `created_at` compound index on every approval-type collection (10 in total), `partner_settlements(center_id, date desc)`, `transactions(center_id, status, partner_id)` for settlement fetch, `staff(reports_to_id)`, plus TTL index on `idempotency_keys(expires_at)`.
  - **Idempotency helpers** — `_get_idempotency_key` FastAPI dependency + `_check_idempotency` / `_store_idempotency` helpers backed by a new `idempotency_keys` collection with 24h TTL. Wired into `POST /api/transactions`, `POST /api/quotations`, `POST /api/payments`, `POST /api/advance-requests`. Same `(user_id, Idempotency-Key)` on repeat returns the stored response → **no duplicate records**.
- **Frontend**:
  - `lib/api.js` — Axios interceptor now auto-attaches a fresh `Idempotency-Key` header (crypto.randomUUID) to every POST/PUT/PATCH so no code changes were needed at call-sites; the whole app is now duplicate-safe.
  - New reusable `<SubmitButton>` component (`components/SubmitButton.jsx`) with a `useRef` synchronous latch that beats React re-render lag, plus busy-state spinner (`Loader2`) and optional `loadingLabel`. Ready for adoption on high-traffic forms.
- **Verified**: 4 new pytest cases in `test_iter32_idempotency_perf.py` (same key → same txn, different keys → different txns, missing key → normal flow, pending approvals under 2s SLA). 32/34 regression pass (2 pre-existing MONGO_URL-env failures unrelated). Live browser test — Pending Approvals renders 219 items instantly with populated KPI strip; Idempotency-Key confirmed present on `POST /auth/login`.

### Phase 31C — Legacy DD-MM-YYYY Date Corruption Fix (Done, Aug 2026 — 🚨 CRITICAL DATA BUG)
- **User reported (production)**: BOCWW Ramgarh pe settlement 2026-08-13 par ki, phir bhi Current Cycle ₹2,46,060 dikha. Drill-down modal ne saaf dikhaya ki 16 txns ki `date` field DD-MM-YYYY format ("24-10-2025", "24-02-2026") mein stored thi. Because `$gt: "2026-08-13"` compares strings LEXICOGRAPHICALLY, `"24-10-2025"` > `"2026-08-13"` (since '2','4' > '2','0'), so ALL such rows leaked into the "active cycle" totals despite being months older than the cutoff.
- **Root cause**: `TransactionIn` model + CSV importer `POST /api/transactions/import` accepted any date string without format validation. Users bulk-importing older CSVs entered Indian-style DD-MM-YYYY dates.
- **Backend `/app/backend/server.py` — three-layer fix**:
  1. **Input validation** — new helper `_normalize_date(v)` accepts YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY, YYYY/MM/DD, or datetime; always returns strict YYYY-MM-DD. `TransactionIn.date` uses Pydantic `@field_validator("date", mode="before")` running this normaliser. CSV importer runs it too.
  2. **Defensive read-path in `settlement_view`** — instead of pushing the cutoff into a MongoDB `$gt` filter (broken for legacy DD-MM-YYYY rows), we now fetch ALL approved partner txns for the center and filter+group in Python using `_normalize_date(row.date)` before comparison. This means the leak is fixed **immediately** upon deploy, even if the DB still contains malformed date strings.
  3. **Same defensive normalisation applied to `settlement_contributing_txns`** — the drill-down modal now shows the normalised YYYY-MM-DD date instead of the raw stored value, and correctly excludes rows outside the current-cycle window.
- **Migration endpoint + UI button (permanent cleanup)**:
  - `POST /api/admin/normalize-txn-dates?dry_run={bool}` (admin) — scans `transactions` for any `date` not matching `^\d{4}-\d{2}-\d{2}$` regex, converts them in-place with `_date_normalized_at` audit stamp. Idempotent.
  - Admin-only "Fix Legacy Dates" button in Partner Settlement header (`normalize-dates-btn`) — one-click flow: dry-run count → confirm → real fix.
- **Verified**: End-to-end script — seed 3 pre-cutoff malformed txns (`24-02-2026`, `24-10-2025`, `26-10-2025`) + 1 legit post-cutoff (`2026-08-15`) with settlement dated `2026-08-13`. Response before defensive fix: current cycle expense = ₹34,000 ❌. Response AFTER defensive fix: current cycle expense = ₹1,000 ✓ (only the legit post-cutoff row). Lifetime remains ₹35,000 ✓. Drill-down normalises display dates to YYYY-MM-DD. 28/28 pytest green.



### Phase 30B — Attendance Spoofing Security Fix (Done, Aug 2026 — 🚨 CRITICAL)
- **User reported (production, ⚠️ security)**: Anand Kumar (center_staff, no admin credentials) ke 2026-08-11 ke HR list me row appear ho gaya jismein `Source: ADMIN`, `Punch IN: —`, `Punch OUT: 09:43`, no selfie, no location. User's concern: "Ye toh koi bhi hack kar sakta hai."
- **Root cause identified**: `POST /api/attendance` endpoint mein `require_role("admin", "manager", "center_manager", "hr", "center_staff")` — `center_staff` role INCLUDED tha. Aur `marked_via` field client-supplied thi (default fallback `"admin"`). Iska matlab ANY logged-in center_staff:
  1. Kisi bhi `staff_id` ke naam ka attendance row post kar sakta tha (apna ya kisi aur ka)
  2. Geofence + selfie bypass kar sakta tha (ye endpoint dono nahi check karta)
  3. `marked_via` client se koi bhi value bhej sakta tha — including "admin" — jo HR dashboard pe "Source: ADMIN" dikha deti thi.
- **Fix `/app/backend/server.py`**:
  - **POST /attendance**: Roles reduced to `admin, manager, center_manager, hr` — **center_staff removed**. center_staff ke liye ab sirf `/attendance/self` valid route hai (geofence + selfie enforced).
  - **Server-authoritative `marked_via`**: Ab hardcoded `doc["marked_via"] = "admin"` — client body ka value ignore. Koi bhi `marked_via="self"` bhej ke source spoof nahi kar sakta.
  - **Center-manager scoping**: Agar caller `center_manager` hai, `staff_id` ka `center_id` uske `assigned_center_ids` mein hona chahiye — warna 403. Pehle CM koi bhi staff ke liye create/edit kar sakta tha.
  - Same scoping added to `PATCH /attendance/{aid}` (retro-edit) — CM ab dusre centers ke staff rows edit nahi kar sakta.
  - Both endpoints ab `marked_by_name` / `edited_by_name` bhi audit stamp karte hain.
- **Regression pytest** `/app/backend/tests/test_attendance_security.py`:
  - `test_center_staff_cannot_spoof_admin_attendance`: center_staff → POST /attendance → 403 (both own + other user); admin → POST with `marked_via="self"` → 200, but stored `marked_via` is FORCED to `"admin"`.
  - `test_center_manager_scoped_to_own_center`: CM can mark own-center staff (200), other-center staff (403).
- **Verified**: 31/31 total regression pytest pass (security + timezone + bank + milestone suite).

### Phase 30 — Attendance Timezone + Next-Day Fresh Start (Done, Aug 2026)
- **User reported (production)**: Screenshot showed Anand Kumar's Home card as "Day Complete" with Check-In "Aug 10, 11:15 PM" and Check-Out "Aug 11, 09:43 AM" — one shift bridging two calendar days. User expected: agar staff previous day punch-out bhool jaye, next day fresh Check-In se start ho.
- **Root causes**:
  1. **UTC vs IST mismatch**: `self_check_in`, `self_check_out`, and `/attendance/today` used `datetime.now(timezone.utc).date()` for the `date` field. At 11:15 PM IST (Aug 10 17:45 UTC → UTC date "2026-08-10"), a check-in was stamped for date "2026-08-10". A follow-up check-out at 9:43 AM IST (Aug 11 04:13 UTC → UTC date "2026-08-11") queried the wrong day and stitched itself into a stale row, producing the confusing display.
  2. **No previous-day cleanup**: If a staff forgot to punch out, the previous day's row stayed with `check_in_at` set + `check_out_at` empty forever — surfacing on dashboards as "Present" and confusing the client-side "checkedIn / checkedOut" logic.
- **Backend fix `/app/backend/server.py`**:
  - New `BUSINESS_TZ = ZoneInfo("Asia/Kolkata")` and helper `_today_ist()` — used consistently across all 3 attendance endpoints (`/attendance/self`, `/attendance/checkout`, `/attendance/today`).
  - `self_check_in` now runs a preliminary `update_many` that flips ANY previous-day rows (staff_id + date < today_IST + check_in_at set + check_out_at empty) to `status="incomplete"` with an `auto_closed_at` timestamp. `check_out_at` stays empty (we don't fabricate a punch-out timestamp — only close the state).
  - `list_attendance` `effective_status` recognises `status="incomplete"` explicitly so HR dashboards render an "Incomplete" badge instead of misleading "Present" or "Absent".
- **Regression pytest** `/app/backend/tests/test_attendance_next_day_fresh.py`:
  - Seeds yesterday-IST row with check-in only (no check-out).
  - `/attendance/today` returns empty (fresh start) ✓
  - New check-in: yesterday's row auto-flipped to `incomplete` + `auto_closed_at` populated; `check_out_at` stays empty (no fake data) ✓
  - Today's row has check-in stamped at today's IST date ✓
  - Check-out succeeds and marks today as `present` ✓
  - Attendance list returns yesterday as `effective_status="incomplete"` and today as `"present"` ✓
- All 29 milestone/bank/attendance regression tests pass.

### Phase 29 — Bank / Cash Reconciliation (Done, Aug 2026)
- **User asked**: Ek menu banao "Bank/Cash Reconciliation" jo sirf admin + accountant ko dikhe. Payment/Advance/Reimbursement/Payroll disbursements pe accountant chuni hui account se paisa deduct ho, wallet me actual live balance dikhe, aur transaction log niche same page pe show ho — kis vendor/center ko kya diya, remarks ke saath.
- **Backend `/app/backend/server.py` (Phase 29 module)** — new collections + endpoints:
  - `bank_accounts`: `{id, name, type (bank|cash|upi_wallet), bank_name, account_no, ifsc, upi_id, opening_balance, current_balance, is_active, remarks, created_by, created_at}`
  - `bank_transactions` (append-only ledger): `{id, account_id, account_name, account_type, direction (credit|debit), amount, balance_after, source (payment|advance|reimbursement|payroll|deposit|adjustment|opening_balance), source_id, remarks, vendor_name, center_id, center_name, date, created_by, created_by_name, created_at}`
  - Helper `_post_bank_ledger(...)` — atomic conditional `find_one_and_update({id, is_active, current_balance>=amount}, {$inc: current_balance ±amount})` + ledger insert. Overdraft-safe (returns 400 if balance short); no negative balances possible.
  - `GET /bank-accounts` (admin, accountant) — list accounts.
  - `POST /bank-accounts` (admin) — create with opening_balance; seeds an "opening_balance" credit ledger row.
  - `PATCH /bank-accounts/{aid}` (admin) — edit metadata (never balance).
  - `DELETE /bank-accounts/{aid}` (admin) — only if 0 ledger entries (else prompts to deactivate).
  - `POST /bank-accounts/{aid}/deposit` (admin, accountant) — manual credit with remarks + optional source_label.
  - `POST /bank-accounts/{aid}/adjust` (admin) — signed delta correction (audit-logged as source="adjustment").
  - `GET /bank-transactions` (admin, accountant) — combined ledger with filters: `account_id`, `source`, `center_id`, `from`, `to`, `q` (search vendor/remarks/center). Returns `{rows, total_credit, total_debit, net}` + `X-Total-Count`.
  - New startup indexes: `bank_accounts(is_active desc, name)`, `bank_transactions(account_id, date desc)`, `(source, date desc)`, `(center_id, date desc)`.
- **Backend integration hooks** (Phase 29):
  - `POST /approvals/act` — new field `bank_account_id`. On the FINAL step of a `payment` request, backend calls `_post_bank_ledger(direction="debit", source="payment", source_id=payment_id)` and stamps `bank_account_id` + `bank_txn_id` on the auto-created `transactions` row. Skips debit when the payment is `funded_by_advance_id` (advance release already booked the outflow).
  - `POST /advance-requests/{aid}/release` — new field `bank_account_id`. Debits the chosen account by `paid_amount`; stamps IDs onto the linked transaction + advance_request row.
  - Helper `_require_bank_account_if_configured(bank_account_id)` — makes `bank_account_id` MANDATORY as soon as one active account exists; if zero configured, path stays backward-compatible (no debit, no error).
- **Frontend — new page** `/app/frontend/src/pages/BankReconciliation.jsx` (route `/bank-reconciliation`):
  - Two tabs: "Account Balances" (cards with type badge, current balance in num, Deposit + Edit buttons per account) and "Transactions Ledger" (filterable table with credit/debit/balance columns + KPI cards for Credits/Debits/Net).
  - Admin-only "New Account" dialog — supports Bank / Cash-in-Hand / UPI Wallet with type-conditional required fields (A/C+IFSC for bank; UPI ID for wallet).
  - Deposit dialog previews "Current → New" balance live.
- **Frontend — approval dialog** (`PendingApprovals.jsx`): For payment/reimbursement final approvals, a new "Bank / Cash Account" dropdown appears (required when accounts exist) — dropdown shows live balances so the accountant can pick a well-funded account.
- **Frontend — advance release dialog** (`Advances.jsx`): Same "Bank / Cash Account" dropdown wired into `submitRelease`, mandatory when accounts exist.
- **Sidebar**: New "Bank / Cash Reconciliation" entry (Wallet icon) via `adminAccountantOnly: true` flag in Layout.jsx nav config; route in App.js.
- **i18n**: `bank_reconciliation` label added to both English (`Bank / Cash Reconciliation`) and Hindi (`बैंक / कैश Reconciliation`).
- **Verified**: New pytest `test_bank_reconciliation.py` — CRUD create/list/deposit/adjust, overdraft prevention, viewer 403, delete-with-ledger blocked. 28/28 across all milestone-family + bank tests pass. Screenshot confirms page renders end-to-end (sidebar link visible for admin only; empty-state prompts to create first account).

### Phase 28H — Partner Batch Scope Bug Fix (Done, Aug 2026)
- **User reported (prod)**: Partner login (Niranjan Kumar) mein "Ramgarh_10 · BOCWW Ramgarh" batch pe upper KPI cards `Total Configured` / `Total Received` ₹42,97,104 dikhaya jab actual sum sirf ₹4,32,180 tha (1st ₹1,85,220 + 2nd ₹2,46,960). Admin/accountant login mein sahi ₹4,32,180 aa raha tha.
- **Root cause**: `list_batch_payments` (`GET /api/batch-payments`) aur `list_batches` (`GET /api/batches`) mein partner/center-scoped roles ke liye scoping logic `q["batch_id" or "center_id"] = {"$in": scoped_ids}` UNCONDITIONALLY set kar deta tha — chahe frontend ne specific `batch_id=X` bheja ho ya nahi. Isse specific batch ka query broadening ho ke ALL allowed batches mein change ho jata tha, aur frontend un sabhi payments ko current batch ki mein add karta tha.
- **Fix `/app/backend/server.py`**:
  - `list_batch_payments`: Ab `if batch_id:` branch mein sirf authorization check (`batch_id not in allowed → []`) hota hai, `q["batch_id"] = batch_id` filter untouched raheta hai. Broad `$in` filter sirf tab lagta hai jab koi specific batch nahi maanga gaya.
  - `list_batches`: Same pattern for center_manager/center_staff/partner — specific `center_id` filter respect hota hai; broadening sirf tab jab param blank.
- **Regression pytest** `/app/backend/tests/test_partner_batch_scope.py`: Seed partner + 2 batches (A: 2 payments, B: 3 payments) at same center. Verify `GET /batch-payments?batch_id=A` returns EXACTLY 2 rows (all `batch_id == A`); `?batch_id=B` returns 3; no-filter returns 5; out-of-scope batch returns `[]`. Also `GET /batches?center_id=X` filters correctly. 6/6 milestone-family tests pass.

### Phase 28G — Regenerate Missing Milestone Transactions (Done, Aug 2026)
- **User reported (prod)**: After orphan-cleanup + de-dup ran, received milestones stopped showing on the Milestone Income dashboard.
- **Root cause**: Earlier permissive Phase-1 backfill in cleanup wrongly re-attributed some legacy milestone txns to unrelated `batch_payments` that shared the same (milestone, amount). Then Phase-3 de-dup, which groups by `(batch_payment_id, source, partner_id, milestone)`, saw those wrongly-attributed txns as duplicates of the real txns and deleted the "extras" — effectively wiping legitimate income rows for their original batches.
- **Preview evidence**: 108 batch_payments in status=received but 97 of them had 0 corresponding milestone txns.
- **Fix — new admin endpoint** `POST /api/batches/regenerate-missing-milestone-txns?dry_run={bool}`:
  - Scans all batch_payments where `status="received"`.
  - Skips any that already have at least one milestone-family txn (idempotent).
  - For the rest, reconstructs milestone + candidate_recovery + assessment_fee + tds_deduction transactions using the SAME math as `receive_batch_payment` (gross → partner_pool via `partner_share_percent` split across `partner_ids`; company share; recovery, assessment fee, TDS from persisted `batch_payments` fields). Uses `received_date` as the txn date to preserve historical timing.
  - Each regenerated txn is tagged with `batch_id`, `batch_payment_id`, and a `_regenerated: true` marker for future audit.
  - Returns `{scanned, regenerated_payments, transactions_created, skipped, dry_run}`.
- **Frontend `Programs.jsx`**: New admin-only button "Regenerate Missing Txns" (`btn-regenerate-missing`) next to Cleanup — one-tap recovery with confirmation prompt + detailed toast counts.
- **Preview data recovery**: 93 payments regenerated → 172 new txns → Milestone Income ₹19,87,848 → ₹1,06,59,643 (correct). Idempotent re-run reports 0 regenerated, 108 skipped.
- **Regression pytest** `/app/backend/tests/test_regenerate_missing_milestone.py`: seeds a batch + received payment without any txns → dry-run reports 1, DB unchanged → real run creates 1 txn tagged with batch_id + batch_payment_id → re-run creates 0 (idempotent). All 5 milestone-family test files still pass (5/5).

### Phase 28F — Read-Path Performance Indexes (Done, Aug 2026)
- **User asked**: Frequently used fields (source, status, center_id, etc.) par indexes add karein taaki data reading tez ho jaaye.
- **Backend `/app/backend/server.py` startup**: Added a `_safe_idx(coll, keys, **kw)` helper (wraps every index create in try/except so a single failure never blocks startup) and built compound indexes on the hottest read paths:
  - **transactions** (10 new): `(source,status)`, `(center_id,date desc)`, `(project_id,date desc)`, `(partner_id,status)`, `(company_id,date desc)`, `(type,date desc)`, `(status,current_level)`, `(batch_id)`, `(batch_payment_id)`, `(created_by,created_at desc)`.
  - **attendance** (3 new): `(staff_id,date desc)`, `(center_id,date desc)`, `(date desc,status)`.
  - **staff** (3 new): `(center_id,is_active)`, `(user_id)`, `(employee_code)`.
  - **leaves / reimbursements / regularisations** (5 new): `(created_by,status)` + `(status,current_level)` on each.
  - **payroll** (2 new): `(staff_id,year desc,month desc)`, `(year desc,month desc,status)`.
  - **advance_requests** (5 new): `(created_by,status)`, `(center_id,status)`, `(status,current_level)`, `(status,required_till)`, `(advance_no)`.
  - **quotations / payments** (2 new): `(status,current_level)` on each.
  - **assets / transfers** (3 new): `(status,current_level)` on `asset_purchase_requests`, `asset_transfers`, `employee_transfers`.
  - **batch_payments / fooding_entries** (3 new): status-based dashboards.
  - **vendors** (1 new): `(center_ids)` for center-scoped listing.
- **Verified**: Backend restarted clean (no index-build failures). MongoDB `.explain()` confirms the winning plan uses the new indexes:
  - `source: "milestone", status: "approved"` → `source_1_status_1`
  - `center_id + date + type: "expense"` → `center_id_1_date_-1`
  - `status + current_level > 0` → `status_1_current_level_1`
- **Regression**: 25/25 pytest across `test_receive_idempotency`, `test_batch_cascade_cleanup`, `test_batch_rbac`, `test_partner_entity_visibility`, `test_finance_api` — all pass.

### Phase 28E — Idempotent Receive + Duplicate Cleanup (Done, Aug 2026)
- **User-reported (production)**: Milestone Income total still inflated after orphan cleanup — actual root cause was **duplicate transactions** created by rapid double-click on "Mark Received" (each click created a fresh set of milestone/recovery/TDS txns even though the batch_payment already had status="received").
- **Backend `/app/backend/server.py` — atomic receive lock**:
  - `receive_batch_payment` (`PATCH /api/batch-payments/{pid}/receive`) — first operation is now an **atomic** `find_one_and_update({id: pid, status: {$ne: "received"}}, $set: {status: "received", _receive_lock_by, _receive_lock_at})`. If MongoDB matches 0 documents, the payment was already received → 400 "Already received" (idempotent). Only the winning caller proceeds to create the milestone/recovery/assessment/TDS transactions.
  - `receive_fooding` (`PATCH /api/fooding-entries/{fid}/receive`) — same lock pattern. Fooding txns now also stamped with `batch_id` + `fooding_entry_id` for cascade delete.
- **Backend — unique index guardrail**: at startup we build `transactions` unique indexes:
  - `(batch_payment_id, source, partner_id, milestone)` — partial (only rows with `batch_payment_id: string`).
  - `(fooding_entry_id, source, partner_id)` — partial (only rows with `fooding_entry_id: string`).
  Both wrapped in try/except so legacy duplicates don't crash startup.
- **Backend — cleanup Phase 3 (De-dup)**: `POST /api/batches/cleanup-orphan-txns` now also groups milestone-family txns by `(batch_payment_id, source, partner_id, milestone)` and deletes all but the earliest in each duplicate group. Response payload gains `duplicates_deleted`.
- **Backend — strict backfill**: The permissive `(milestone, amount)`-only backfill removed. Only strict `(center_id, project_id, milestone, amount, status="received")` correlation is used now, preventing wrong-batch attribution during legacy cleanup.
- **Frontend — button disabling**:
  - `Programs.jsx` `confirmReceive` — new `recvBusy` state, dialog "Confirm Receive" button `disabled={recvBusy}`, opacity-60 + "Processing…" label until server responds.
  - `FoodingTab.jsx` `confirmReceive` — same `recvBusy` guard on the fooding "Confirm Receive" button.
- **Preview data recovery**: Cleanup with the enhanced de-dup phase deleted 75 duplicate txns → Milestone Income total ₹84,88,457 → ₹19,87,848 (correct after removing double-received duplicates).
- **Verified**: `test_receive_idempotency.py` — 5 concurrent PATCH calls with same payload → exactly 1×200 + 4×400 "Already received", exactly 1 income txn created, direct duplicate insert blocked by unique index. Plus regression: `test_batch_cascade_cleanup.py`, `test_batch_rbac.py`, `test_partner_entity_visibility.py` — all pass.

### Phase 28D — Milestone Income Orphan Cleanup + Cascade Delete (Done, Aug 2026)
- **User reported (prod + preview)**: Milestone Income dashboard was showing inflated totals — e.g., BOCWW Ramgarh ke ~₹47L me ~₹15L wo income entries thin jinke parent batches admin ne delete kar diye the. Turned out `receive_batch_payment` auto-generated income/recovery/assessment/TDS transactions bina `batch_id` / `batch_payment_id` linkage ke create karta tha, aur `DELETE /batches` sirf batch_payments delete karta tha — transactions orphan reh jaate the aur `/dashboard/milestone-income` (which reads `source="milestone"` transactions) unhe count karta rehta tha.
- **Backend `/app/backend/server.py`**:
  - `receive_batch_payment` — ab har auto-generated txn (4 sources: `milestone`, `candidate_recovery`, `assessment_fee`, `tds_deduction`) par `batch_id` + `batch_payment_id` stamp hote hain.
  - `DELETE /api/batches/{bid}` — ab cascade: `transactions.delete_many({batch_id: bid})` + `batch_payments.delete_many({batch_id: bid})` + batch. Returns `transactions_deleted` count.
  - `POST /api/batches/bulk-delete` — same cascade for bulk operations.
  - `DELETE /api/batch-payments/{pid}` — ab cascade `transactions.delete_many({batch_payment_id: pid})`.
  - **New endpoint** `POST /api/batches/cleanup-orphan-txns?dry_run={bool}` (admin-only) — legacy one-shot cleanup:
    - **Phase 1 Backfill**: For any milestone-family txn missing batch_id/batch_payment_id, correlates via `(center_id, project_id, milestone, amount, status="received")` against live `batch_payments` and stamps the IDs.
    - **Phase 2 Prune**: Deletes any milestone-family txn whose (tagged) batch_id or batch_payment_id no longer exists, AND unmatchable legacy rows.
    - Returns `{scanned, backfilled, orphans, deleted, dry_run}` — idempotent.
- **Frontend `Programs.jsx`**: New admin-only "Cleanup Orphan Txns" button (`btn-cleanup-orphans`) in the page header — one-tap fix for old data with confirmation prompt + toast summary.
- **Preview data recovery run**: scanned 231, backfilled 131 (linked to live batches), deleted 100 orphans → Milestone Income total moved from ₹1,00,59,059 (160 txns) to ₹84,88,457 (99 txns). Idempotent — re-run showed 0 orphans.
- **Regression pytest** `/app/backend/tests/test_batch_cascade_cleanup.py`:
  - Create batch → create payment → mark received → verify txn has `batch_id` + `batch_payment_id` ✓
  - Seed legacy-style orphan → dry-run detects it → real cleanup deletes it ✓
  - Delete batch → cascade removes the tagged milestone txn ✓
  - Full assertions pass. Non-regression on prior test_batch_rbac + test_partner_entity_visibility.

### Phase 28C — Batch Role Split (Done, Aug 2026)
- **User asked**: Center Manager ko SIRF batch CREATE ka adhikar; edit/update Accountant ke paas.
- **Backend `/app/backend/server.py`**:
  - `POST /api/batches` — allowed roles: `admin, manager, senior_manager, center_manager`. Center manager ke liye extra guard — `body.center_id` unke `assigned_center_ids` mein hona chahiye, warna 403.
  - `PUT /api/batches/{bid}` — added `accountant`. Full list: `admin, manager, senior_manager, accountant`.
  - `PATCH /api/batches/{bid}/close` — added `accountant`.
  - `GET /api/batches` — guard changed from `require_finance_visible` to explicit role list including `center_manager, center_staff` (already had scoping logic; now the guard admits them).
  - `DELETE /api/batches` — remains admin-only.
- **Frontend**:
  - `Programs.jsx` — split `canEditBatches` into three vars: `canCreateBatch` (admin/manager/sr-mgr/**center_manager**), `canEditBatch` (admin/manager/sr-mgr/**accountant**), `canDeleteBatch` (admin only). New Batch button visible per `canCreateBatch`; Edit + Close/Reopen per `canEditBatch`; Delete per `canDeleteBatch`.
  - `Layout.jsx` — `/programs` sidebar entry flag changed from `financeOnly` to new `programsAccess` that also admits `center_manager`.
  - `App.js` — `/programs` route: removed `requireFinance` (Programs page itself handles endpoint 403s via `.catch(() => setPayments([]))`).
- **Regression pytest** `/app/backend/tests/test_batch_rbac.py`:
  - CM creates batch at own center → 200 ✓
  - CM at other center → 403 ✓
  - CM update → 403 ✓
  - CM delete → 403 ✓
  - Accountant update → 200 ✓
  - Accountant create → 403 ✓
  - Accountant delete → 403 ✓
  - All 7 assertions pass. Non-regression on `test_partner_entity_visibility.py`.

### Phase 28B — Partner Entity Visibility Bugfix (Done, Aug 2026)
- **User reported (production)**: Partner user "Shyam Kumar" ke Companies page pe "NO DATA YET" show ho raha tha — Shyam ka related company visible nahi tha.
- **Root cause**: `_visible_entity_ids(user, "company"/"project")` sirf `center_ids` set hone par batches se company_id derive kar raha tha. Jab partner ke assigned batches me `center_id: null` set tha (early-stage batch — sirf partner + company/project tagged, center abhi tak assign nahi), toh company/project visible list ban hi nahi rahi thi.
- **Fix**: `/app/backend/server.py` `_visible_entity_ids` me partner ke liye ek naya fallback source add kiya: `batches.find({partner_ids: own_pid, target_field: {$ne: null}})` — center_id se independent. Ab partner ki jitni bhi batches me wo listed hai (chahe center_id set ho ya na ho), un sabki company + project uski visible list me appear hoti hain. Transactions ka existing fallback bhi maintained hai.
- **Regression pytest** `/app/backend/tests/test_partner_entity_visibility.py`: seeds a partner + batch with `center_id=null, company_id, project_id, partner_ids=[partner]`, logs in as partner, asserts GET `/entities/company` includes the seeded company AND GET `/entities/project` includes the project. Passes 1/1. Existing 21 tests in `test_finance_api.py` non-regression.

### Phase 28 — Payment Dashboard + Approval Double-Submit Prevention (Done, Aug 2026)
- **User asked**: (a) Approvals ka double-submit bug fix karo — same request cheez do baar dabne pe duplicate transaction ban jaati thi. (b) Ek naya Payment Dashboard chahiye jismein Daily/Weekly/Monthly expenses, Upcoming Payments, Center-wise & Project-wise breakdown, aur Income pie chart dikhe.
- **Double-Submit Fix**:
  - Backend `/api/approvals/act` — atomic optimistic lock via `find_one_and_update({id, current_level, status $nin ["paid","approved","rejected"]}, $set: {_processing_lock_by, _processing_lock_at})`. Concurrent duplicate returns **409** "This request is already being processed or was just actioned." Lock is cleared (`$unset`) on every terminal update path (approve/reject/send_back).
  - Frontend `PendingApprovals.jsx` — new `confirmBusy` state; confirm button `disabled={confirmBusy}` + opacity-60 + loading spinner; guarded rapid-clicks all collapse to a SINGLE POST.
  - **Verified iter-49**: 4 parallel threads → exactly 1×200 success, 3× rejected (400/409). Frontend rapid-click of 6 = exactly 1 POST.
- **Payment Dashboard**:
  - Backend `GET /api/dashboard/payment-summary` (finance-only via `require_finance_visible`). Filters: `center_id`, `partner_id`, `project_id`, `start`, `end`. Returns `kpis` (daily/weekly/monthly/upcoming), `daily_series` (last 30 days), `weekly_series` (last 12 ISO weeks), `monthly_series` (last 12 months), `center_wise` (top-10), `project_wise` (top-10), `income_breakdown` (top-8 categories), `meta.filter_applied`. Auto-scopes for partner/center_manager/center_staff.
  - Frontend `/app/frontend/src/pages/PaymentDashboard.jsx` — new page at route `/payment-dashboard`. Recharts-based: KPI grid, Daily Line chart, Weekly & Monthly Bar charts, Center-wise & Project-wise horizontal bars, Income pie chart with category legend + percentages. Filter row with Center/Partner/Project selects + date pickers + Reset button + Refresh button.
  - Sidebar entry `Payment Dashboard` (PieChart icon, `financeOnly: true`) visible only to admin/senior_manager/hr/accountant/partner. Route wrapped in `ProtectedRoute requireFinance`.
  - **Route-guard tightening**: `ProtectedRoute.jsx` — the `OPS_DASHBOARD_ROLES` bypass now only applies to path `/` (RoleHome). Any other `requireFinance` route redirects center_manager to `/`, preventing them from opening blank finance shells.
  - **Verified iter-49**: 4/4 backend pytest pass + full Playwright E2E — all KPIs, filters, refresh, sidebar RBAC verified. Admin sees page, center_manager redirected to `/`.
- **Test IDs added**: `payment-dashboard-page`, `pd-kpi-{daily,weekly,monthly,upcoming}`, `pd-chart-{daily,weekly,monthly,center,project,income}`, `pd-filter-{center,partner,project,start,end,reset}`, `pd-refresh-btn`, `pd-income-row-<i>`.


- **User asked**: Description of Item/Service full dikhaye (chhota nahi), bold rakhe, vendor ka naam bhi dikhe with good color.
- **Frontend**:
  - Removed `line-clamp-2` from row description — full text now wraps with `whitespace-pre-wrap` and `break-words`.
  - Description restyled as an indigo card: `border-l-4 border-indigo-400`, `bg-indigo-50`, `font-bold text-indigo-900 text-[14px]`, `pl-3 py-2` with relaxed leading.
  - New `🏷 Vendor: <name>` amber chip (data-testid `row-vendor-<id>`) renders whenever `summary.vendor_name` is populated. Advance rows show `Payee:` prefix.
  - Action dialog header block mirrors the same layout (vendor chip + full indigo description block).
- **Verified**: testing_agent iter-48 — **100% frontend E2E pass**. Payments tab 4 vendor chips, Advances tab 42 payee chips. All iter-47 regression elements intact (48 requester, 4 center, 74 purpose, 101 amount rows + FINAL STEP badges + 10 filter tabs).
- **Code review notes** (deferred): Consider extracting shared `<RequestSummaryHeader/>` component to avoid duplication between row + dialog; PendingApprovals.jsx is ~596 lines (approaching split threshold).

### Phase 27H — Pending Approvals Row Enhancement (Done, Jul 2026)
- **User asked**: Requester ka naam + center name dikhaye, aur purpose/amount/description bold + prominent ho for quick approver scanning.
- **Backend `/approvals/pending`** now emits per item: `requester_id`, `requester_name` (falls back to employee_name for advance_request), `center_id_of_request`, `center_name_of_request`, and new `summary.purpose` (from purpose field / reason / 'QRN <qrn>' shorthand for payment/quotation).
- **Frontend row redesign**: type strip + FINAL STEP green badge, 👤 requester name line, 🏢 cyan center chip, bold 15px purpose, muted description, emerald bold 15px amount, ⏱ raised date + 📅 required date. Action dialog header mirrors the same structure.
- New data-testids: `row-requester-<id>`, `row-center-<id>`, `row-purpose-<id>`, `row-desc-<id>`, `row-amount-<id>`.
- **Verified**: testing_agent iter-47 — **6/6 backend pytest + full Playwright E2E** with 100% success rate. Screenshot verification confirmed: 129 rows rendered, 48 requester chips, 4 center chips, 74 purpose rows, 101 amount rows, 98 FINAL STEP badges.

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

### Staff App — Profile & Holidays Tabs (Done, Feb 2026)
- **User asked**: Staff App me Profile section aur Holidays / Weekly Off ka option add karo.
- **Backend `/app/backend/server.py`**: `/me/summary` response me new `weekly_off_days: string[]` field added (reads `hr_policy.weekly_off_days`, defaults to `["sunday"]`). Non-staff fallback also returns default.
- **Frontend `/app/frontend/src/pages/CheckIn.jsx`**:
  - `SIDEBAR_ITEMS` me `holidays` (Calendar icon) + `profile` (UserCog icon) entries added; mobile drawer inherits via `sidebarEntries`.
  - New `HolidaysTab` — Weekly Off badge grid (Mon–Sun with green "✓ Off" for configured days) + Upcoming holidays list + Past holidays block.
  - New `ProfileTab` — self-service edit for photo/mobile/address/bank details (embedded inside Staff App shell). Uses `/me/staff-profile` GET/PUT + `/me/staff-profile/photo` POST.
  - Quick action "Holidays" now navigates to Holidays tab instead of just toggling.


   LoginHistory.jsx           # Audit page

### Reimbursement Attachments + HR Templates (Done, Feb 2026)

### Staff App Attendance — Faster + Friendlier Denied-Location UX (Done, Feb 2026)
- **User asked**: Manisha ke phone pe "User denied Geolocation" a raha tha, attendance mark nahi ho pa raha. Flow ko simpler + fast banao.
- **Frontend `/app/frontend/src/pages/CheckIn.jsx`** (`AttendanceTab`):
  - **Auto-request location on mount** so staff never sees a manual "Get Location" tap for the happy path.
  - New **"Location blocked" panel** with step-by-step recovery instructions in Hinglish for Chrome/Edge, Safari (iOS), Android app + a big "Retry Now" button (distinguishes `err.code===1` PERMISSION_DENIED from generic errors).
  - Reverse-geocode is now truly fire-and-forget — Check-In button unblocks as soon as coordinates arrive, without waiting for the Nominatim address lookup.
  - **Client-side image compression** for selfies (canvas → JPEG 78% at max width 900px). Shrinks 5-10MB phone photos to ~150-300KB → 20-40× faster upload on 2G/3G.
  - Cleaner three-block layout (Location → Selfie → Status → Check In) with colour-coded state cards (green when captured, red when blocked, grey when pending). Removed "Step 1 of 3" clutter and merged Status pills out of a wrapping card into a compact 3-column pill grid.
  - `geolocation` options now use `maximumAge: 30000` so a fresh cached fix (30 s) can serve immediately, cutting first-tap wait time when the OS already has a fix.
- **Verified**: Playwright tests both flows — denied-permission panel shows Retry + full instructions, granted-permission flow captures Ranchi coords → resolves address → enables the Check In button.


- **User asked**: (a) Reimbursement rows me attached documents dikhne chahiye (list + detail modal), (b) Reimbursement submenu me HR ke liye ek admin section jahan manual claim-format templates upload/edit/delete kar sakein.
- **Backend `/app/backend/server.py`**:

### Candidate Data Management (BOCWW / JSDMS) (Done, Feb 2026)
- **User asked**: Project-wise Candidate Data Management module — BOCWW (27 fields incl. labour registration meta) + JSDMS (11 fields) with per-project forms, filters, bulk Excel upload/download with row-level validation, duplicate detection, soft-delete.
- **Access**: admin, hr, manager, center_manager, partner. Enforced via `require_role(*CANDIDATE_ROLES)` on every endpoint and via `candidateAccess` flag on the sidebar entry.
- **Backend `/app/backend/server.py`** — new `db.candidates` collection + endpoints:
  - `POST /api/candidates` — create with required-field + duplicate check
  - `GET /api/candidates` — list with filters (project, batch, district, course, search, date_from/to, include_deleted, pagination)
  - `GET /api/candidates/filter-options?project=` — distinct batch/district/course values for dropdowns
  - `GET /api/candidates/sample-excel?project=BOCWW|JSDMS` — download strict-format template with one seeded sample row
  - `POST /api/candidates/bulk-upload?project=…` — strict-header Excel upload; returns `{uploaded, failed, duplicate, total_rows, errors[]}`
  - `GET /api/candidates/export?…filters…` — filtered Excel export
  - `GET /api/candidates/{id}`, `PATCH /api/candidates/{id}`, `DELETE /api/candidates/{id}` (soft), `PATCH /api/candidates/{id}/restore`
- **Duplicate detection**: **per project** on `aadhaar` (both) and `candidate_id` (BOCWW only). Also blocks intra-file duplicates during bulk upload.
- **Normalisation**: strips whitespace, normalises Aadhaar/mobile to digits-only, canonicalises Gender to M/F/T and Physically Handicapped to Yes/No before insert.
- **Excel headers strict** (case-sensitive, exact match to spec). Missing headers → HTTP 400 with the list of missing columns.
- **Frontend `/app/frontend/src/pages/Candidates.jsx`** (new page, route `/candidates`, sidebar entry "Candidate Data"):
  - Big project switcher (BOCWW / JSDMS) → forms + table columns reconfigure automatically
  - Filter bar: Batch / District / Course dropdowns (populated from `filter-options` endpoint), search box, date range, include-archived toggle
  - Action bar: Sample Format · Export Excel · Bulk Upload · Add Candidate
  - Data table with View / Edit / Delete / Restore per-row actions and archived-row styling
  - Add/Edit modal: BOCWW form separates the Batch/Course meta block from the candidate detail block; JSDMS form is one clean grid. Fields respect required, digits-only, max-length, select-with-options.
  - Bulk-upload modal: shows sample-download button, file input, and post-upload summary with `Rows / Uploaded / Duplicate / Failed` counters plus a row-level error list.
- **Verified**: curl-tested create + duplicate 409 + list-with-filter; bulk upload of 3 JSDMS rows returned `uploaded:2, duplicate:1` as expected; UI screenshots confirm both project layouts, form, and table render correctly. All existing modules untouched (Attendance, Reimbursements, Payroll etc.).

### Candidate Data — Critical Duplicate Bug Fix + FY Field (Done, Feb 2026)
- **Bug reported**: Same Aadhaar `356299759079` for "SAHIDA BIBI" was uploaded 3 times with different Candidate IDs — duplicate check should have blocked the extras but didn't.
- **Root cause**: Bulk-upload in-file duplicate check used a composite key `(project, aadhaar, candidate_id)` — because Candidate IDs differed, the same-Aadhaar rows produced different tuples and slipped past the in-file guard, then all landed in the DB via a single `insert_many`.
- **Fix `/app/backend/server.py`**:
  - Split the in-file dup guard into three independent sets: `seen_aadhaar`, `seen_cid`, `seen_lrn`. First key match = block subsequent rows with a clear reason.
  - Extended `_find_duplicate` to also check `labour_reg_no` (the BOCWW Registration Number) for BOCWW; any of `aadhaar` / `candidate_id` / `labour_reg_no` matching a live record blocks the insert with a specific reason.
  - Bulk-upload error messages now name the exact conflicting field ("same Aadhaar", "same Candidate ID", "same BOCWW Registration No.").
- **FY (Financial Year) added everywhere as requested**:
  - Backend: `fy` is the first column in both `BOCWW_COLUMNS` and `JSDMS_COLUMNS`; sample Excel seeded with `"2024-25"`.
  - Backend: `/candidates` and `/candidates/export` accept a `fy=` query param; `/candidates/filter-options` returns distinct `fys[]`; free-text search now also matches `fy` and `labour_reg_no`.
  - Frontend `/app/frontend/src/pages/Candidates.jsx`: FY filter dropdown placed first in the filter bar (before Batch); FY column shown as the first column in the results table; search placeholder updated; export/list URLs include the FY param.
- **Verified**: Test upload of 3 rows with same Aadhaar `356299759079` and different Candidate IDs → response `uploaded:1, duplicate:2` with reasons like "Duplicate within upload — same Aadhaar (356299759079) already in row above". Second test with different Aadhaars but same `labour_reg_no=LR-777` → `uploaded:1, duplicate:1` with reason "same BOCWW Registration No.". Fix confirmed working end-to-end.


- **Dependencies**: added `openpyxl==3.1.5` to `requirements.txt`.


  - New `reimbursement_templates` collection + endpoints:
    - `POST /api/reimbursement-templates?name=…&category=…&description=…` (file upload, HR/admin only, max 10MB)
    - `GET /api/reimbursement-templates?active_only=true` (all authenticated users; non-HR sees only active)
    - `PATCH /api/reimbursement-templates/{tid}` (HR/admin — rename, toggle `is_active`, edit category/description)
    - `DELETE /api/reimbursement-templates/{tid}` (HR/admin)
  - Uploaded template also registered in shared `db.files` so `/api/files/view?path=…` streams it just like every other attachment.
- **Frontend `/app/frontend/src/pages/HRMS.jsx`** (Reimbursements tab):
  - New "HR · Claim Form Templates" panel above the reimbursement table: HR/Admin sees Upload + Archive/Delete controls; other roles see only Download links.
  - Paperclip chip in every row now clickable → opens **View Attachments modal** with inline image preview (`<img>`) or PDF iframe (`<iframe>`) plus Download links.

### Candidate Data — Full-Row Excel View + Labour Aadhaar Cap of 2 (Done, Feb 2026)
- **User asked**: All 27 BOCWW / 11 JSDMS fields should be visible in the table (right-scroll to see rest). Also: Candidate Aadhaar must NEVER repeat, but Registered Labour Aadhaar CAN repeat — max 2 candidates per single labour, 3rd is blocked.
- **Frontend `/app/frontend/src/pages/Candidates.jsx`**:
  - Table now iterates over the active project's field spec and renders **every column** with `whitespace-nowrap`. Overflow-x-auto wrapper enables horizontal scroll. Header shows "← scroll right for more →" hint.
  - **Actions column pinned sticky-left** so View/Edit/Delete always remains visible while user scrolls right through 27 BOCWW columns.
  - Cell styling adapts by field type: digit fields (Aadhaar, mobile, registration numbers) render in monospace, Name renders bold, `multi`-line fields (Full Address) get truncated with title-tooltip.
- **Backend `/app/backend/server.py`**:
  - `_find_duplicate` now enforces `registered_labour_aadhaar` cap of 2 (BOCWW only): counts existing live records with the same labour aadhaar; if `count >= 2`, returns `duplicate=True, on="registered_labour_aadhaar_limit_2"`.
  - Bulk upload maintains a per-file `seen_laa_count` counter plus a cached DB count per labour aadhaar (`db_laa_count_cache`); projected total (`db_count + in_file_count`) is checked before accepting each row.
  - Duplicate error messages refined for humans on both manual POST and bulk upload paths (e.g. "Labour Aadhaar (999988887777) already has 2 candidates — 3rd not allowed").
- **Verified**:
  - Uploaded 3 rows all with `registered_labour_aadhaar=999988887777`, different Candidate Aadhaars/IDs → response `uploaded:2, duplicate:1` with reason mentioning the "3rd not allowed" limit.
  - Manual POST attempting to create a 3rd candidate for the same labour → HTTP 409 with clean error text.
  - Screenshot confirms all 27 BOCWW columns render and Actions column stays sticky while scrolling.


- **Frontend `/app/frontend/src/pages/CheckIn.jsx`** (Staff App → Claims tab):
  - Loads active templates via `/reimbursement-templates?active_only=true` and shows a "Claim Form Templates" download card above the New Claim form.
  - Each claim in "My Claims" now has a clickable "View N attachments" button that opens an attachments preview modal (image inline / PDF iframe / download link).
- **Google Maps replacement (Geofences)**: DONE (Option B — key-free). `MapPicker.jsx` swapped OpenStreetMap tiles for **CartoDB Voyager** (`basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png`) which gives Google-Maps-style roads/buildings/labels without any API key or billing. Default blue Leaflet pin replaced with an inline SVG red teardrop pin (Google Maps look, tip-anchored). Radius preview circle repainted turquoise (`#14b8a6`, 22% fillOpacity, 2px stroke). Verified visually — 1 marker + 1 circle render, drag/click/zoom/pan preserved. Real Google Maps (Option A) can still be added later when the user provides `GOOGLE_MAPS_API_KEY`.



### Candidate Data — Cleanup, Relation Guard, Delete Restriction, Center Scoping (Done, Feb 2026)
- **User asked**: (1) archive existing rows with duplicate Candidate Aadhaar keeping 1; (2) block Relation = "wife" / "husband"; (3) delete allowed only for Admin + HR; (4) partner / center_manager should only see data for their center + add a Center ID option.
- **Backend `/app/backend/server.py`**:
  - New `_validate_relation()` helper — case-insensitive block of relation values in `BLOCKED_RELATIONS = {"wife", "husband"}` on both `POST /candidates` and `PATCH /candidates/{id}` and every bulk-upload row.
  - New `_candidate_scope_filter(user)` — returns Mongo scope query based on role:
    - `admin / hr / manager / senior_manager`: `{}` (see everything)
    - `center_manager / center_staff`: `center_id ∈ assigned_center_ids`
    - `partner`: `center_id ∈ _associated_center_ids`
    - anyone else: sees nothing.
  - `_user_scoped_center_ids(user)` — used to enforce that a scoped role can only add/edit/bulk-upload rows within their own centers.
  - `GET /candidates`, `GET /candidates/filter-options`, `GET /candidates/export` all apply the scope filter now.
  - `DELETE /candidates/{id}` and `PATCH /candidates/{id}/restore` reduced to `require_role("admin", "hr")`.
  - New `Center ID` column added at the beginning of both `BOCWW_COLUMNS` and `JSDMS_COLUMNS` (optional field so imports pre-Center-scoping still work; scoped roles get a 400 if they omit it).
  - New `POST /candidates/cleanup-duplicates?project=&dry_run=true|false` (admin/hr) — groups live candidates by (project, aadhaar), keeps the earliest one and soft-deletes the rest. Returns a preview report + archived count.
- **Frontend `/app/frontend/src/pages/Candidates.jsx`**:
  - Fetches `/entities/center` once and shows a **Center dropdown** in the filter bar and in the Add/Edit form (via new `FieldRenderer` type `center`).
  - Table cell for `center_id` now renders human-readable center name via a `Map<id → name>` lookup.
  - Client-side blocks Relation = "wife" / "husband" before submit; also blocks empty Center for center-scoped roles.
  - Delete / Restore action icons now only render when `canDelete = ["admin", "hr"].includes(user.role)`.
  - New amber **Cleanup Duplicates** button (admin only) — does dry-run first, shows count in confirm dialog, then archives on OK.
- **Verified**:
  - Manual POST with `relation_with_labour="Husband"` → HTTP 400 with clean message. Same for `"wife"`.
  - `cleanup-duplicates` endpoint returns `{"duplicate_groups": N, "archived": M}` correctly on an empty DB (0/0) and on seeded duplicates.
  - Screenshot confirms Center dropdown in form + filter bar and Cleanup Duplicates button appear.
- **Prod cleanup instructions**: After deploy, admin can click "Cleanup Duplicates" on the Candidate Data page → dry-run shows count → confirm → archives extras (soft delete; recoverable via Include-archived toggle).


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

### Bank Guarantee Tracking + Dashboard Expiry Alert (Done, Feb 2026)
- **User asked**: new Bank Guarantee tracking module with the fields from screenshot (LoI No, Work Order No, In Favour Of, Applicant, Issued By, BG Number, Amount, Attachment <2MB, Date of Issuance, Valid Till, BG Claim Expiry Date) + Center + Location; plus a Dashboard popup that starts 30 days before BG expiry in red bold and stays until a new BG is updated.
- **Backend `/app/backend/server.py`**:
  - New `db.bank_guarantees` collection + endpoints:
    - `POST /bank-guarantees` — multipart upload (attachment mandatory <2MB); stores file in `finance-tracker/bank-guarantees/{id}.{ext}` and registers in shared `db.files`.
    - `GET /bank-guarantees` — list with search + center filter + include_renewed toggle.
    - `GET /bank-guarantees/expiring-soon?days=30` — returns `{expiring:[…], expired:[…]}`; used by dashboard alert.
    - `PATCH /bank-guarantees/{id}` — edit any updatable field.
    - `PATCH /bank-guarantees/{id}/renew` — flips `is_renewed=true`, silences the alert.
    - `DELETE /bank-guarantees/{id}` — soft delete (admin/hr only).
  - Access roles: `BG_ROLES` for read (admin/hr/manager/senior_manager/accountant/center_manager/partner); `BG_WRITE_ROLES` for create/update/renew.
- **Frontend `/app/frontend/src/pages/BankGuarantees.jsx`** (new page, route `/bank-guarantees`, sidebar entry "Bank Guarantees"):
  - Filter bar (search, center, show-renewed toggle) + Add form modal implementing every field from the screenshot + Center dropdown + Location + Remarks + <2MB validation.
  - Table row status chip: green **Active**, red bold **EXPIRED**, red bold `Nd left` when within 30 days, grey **Renewed**.
  - Row actions: View / Edit / **Mark Renewed** (green shield icon, only when expiring/expired) / Delete (admin+hr only). Renewed rows hide edit.
  - Viewer modal shows every field + attachment download link.
- **Dashboard alert `BGExpiryAlert`** (exported from same page and used in `Dashboard.jsx`):
  - Pulses at the top of Dashboard whenever any live BG's claim expiry is within 30 days or already expired.
  - Big red-bordered banner with `AlertTriangle` icon, bold heading "BANK GUARANTEE EXPIRY ALERT", one row per BG (up to 6 shown), CTA link to `/bank-guarantees`, and hint "Alert stays until each BG is marked as renewed."
  - Auto-hides when the API returns zero expiring + zero expired (all renewed or none exist).
- **Verified**: POST with 15-day-out expiry → showed in `/expiring-soon`; Dashboard screenshot confirms the red banner with the BG row + green CTA; sidebar shows "Bank Guarantees" entry visible for admin.


- DO NOT refactor `server.py` `compute_milestones` / `receive_batch_payment` — extremely delicate math
- DO NOT modify React hook `[]` mount patterns flagged by lint as "missing deps" — they're intentional
- ALL 3rd-party integrations go via `integration_playbook_expert_v2`
- Resend domain `masharaskills.com` is fully verified; daily quota limits apply on free tier
- Production env vars sync via `.env` files during deployment


### Bank Guarantee — Renewal Chain + Email Alerts (Done, Feb 2026)
- **Renewal Chain**: `POST /bank-guarantees?renews_bg_id=…` validates the reference, inserts the new BG, then atomically flips the old row to `is_renewed=true, renewed_by_bg_id, renewed_by_bg_number, renewed_at, renewed_by_user`. New BG stores `renews_bg_id` + `renews_bg_number` for a bidirectional link. `GET /bank-guarantees/{id}/chain` returns the full ordered chain. Frontend Add form has a green "Renews BG (optional)" dropdown (only when there are renewable BGs); Viewer modal shows numbered audit trail with Current/Renewed tags.
- **Email Alerts**: `email_utils.send_bg_expiry_alert()` renders a red-bold HTML with a BG table + CTA. `_bg_dispatch_alerts()` triggers on `days_to_expiry ∈ {30,15,7,0}` or past-due; dedupes via `bg_alert_log` markers (idempotent per today+bg+day). Recipients: active admin+hr users, with test/seed domains auto-filtered so Resend doesn't reject the whole batch. Endpoint `POST /bank-guarantees/run-alerts?force=true` (admin-only) + red "Send Alerts Now" button in the BG page header. Background `_bg_alert_scheduler()` ticks every 6 hours after startup.
- **Verified**: BG-A → BG-B(renews_bg_id=BG-A) → BG-A auto-marked renewed with backlink; chain returned both. `run-alerts?force=true` for a Day-30 BG returned Resend id `6ea41f45-…` and delivered to `masharaenterprises@gmail.com`.
- **WhatsApp alerts**: NOT YET IMPLEMENTED — requires Twilio / Meta Cloud API credentials. Follow-up ask sent to user.


### Bank Guarantee — Center-Scoped Alerts (Done + Verified, Feb 2026)
- **GET `/bank-guarantees/expiring-soon`**: role-scoped. admin/hr/manager/senior_manager/accountant see every BG; partner sees only BGs at centers linked via `batches.partner_ids` (`_centers_for_partner`); center_manager/center_staff see only their `assigned_center_ids`. Others → empty.
- **`_bg_dispatch_alerts()`**: builds a per-recipient `{email → [bgs]}` map. Every active admin + accountant receives every triggered BG (global). Center-linked partners / center_managers / center_staff receive only the BGs of the centers they're mapped to (via `assigned_center_ids` or `batches.partner_ids`). Removed the earlier legacy admin/hr-only early-bail so center-scoped recipients still get emailed when no global admin/hr has a valid email.
- **CenterManagerDashboard.jsx**: now also renders `<BGExpiryAlert />` at the top so CMs see the same red pulsing banner (scoped to their centers).
- **Verified via seeded fixtures**: 5 BGs across 2 centers + 1 without center. admin & accountant listed all 5; center_manager A saw only 2 (Center-A BGs); center_manager B saw only 2 (Center-B BGs including expired one); partner linked to Center-A via batch saw only its 2 BGs. `run-alerts?force=true` fanned out 33 individually-scoped emails: `test_bg_cm_a` got 2, `test_bg_cm_b` got 2, `test_bg_partner_a` got 2, real accountants got all 5. Test seed rows cleaned up post-verification.

### Bank Guarantee — Bulk Upload (Done + Verified, Feb 2026)
- **`GET /bank-guarantees/sample-excel`**: downloads the 10-column template with a styled header + one example row. Columns: BG Number, Bank Name, Branch Name, BG Amount, Issue Date, Expiry Date, Beneficiary Name, Project / Scheme Name, District, Remarks / Description.
- **`POST /bank-guarantees/bulk-preview`**: validates the uploaded `.xlsx` / `.xls` WITHOUT persisting. Returns `{total_rows, valid, failed, valid_rows[], errors[]}` with row-wise reasons. Accepts multiple date formats (`YYYY-MM-DD`, `DD/MM/YYYY`, `DD-MM-YYYY`, `DD.MM.YYYY`, `YYYY/MM/DD`) and numeric amounts with ₹/Rs./commas stripped.
- **`POST /bank-guarantees/bulk-upload`**: re-runs the same validator and INSERTs valid rows in one `insert_many`. Returns `{uploaded, failed, inserted[], errors[]}`.
- **Validation rules**: mandatory fields (BG Number, Bank Name, BG Amount, Issue Date, Expiry Date, Beneficiary Name); expiry must be after issue; amount must be > 0; BG Number duplicate check both inside the file and against live DB.
- **Frontend `BankGuarantees.jsx`**: new "Bulk Upload" button in the header opens a 3-step dialog — (1) Download Sample Excel, (2) Choose file + Preview, (3) Preview shows a red skipped-rows table (with row + reason) and a green ready-to-insert table (formatted BG number, bank, amount ₹, dates, beneficiary, district). Confirm button reads "Upload N BGs".
- **Verified end-to-end**: uploaded 7-row test file → preview showed 2 valid + 5 failed with correct row-wise reasons (missing Bank Name, missing BG Amount, expiry-before-issue, in-file duplicate, invalid date); Confirm inserted the 2 valid BGs (visible in the tracking table with correct status chips); a second attempt of the same file returned all rows as failures because BG numbers now exist in DB.

### Bank Guarantee — Bulk Upload Full-Field Support (Done + Verified, Feb 2026)
- **Extended to 14 columns** matching every field on the manual Add BG form (per user request):
  FY, Letter of Intent (LoI) No, Work Order No, In Favour Of, Applicant, Issued By, Bank Guarantee Number, Amount, Date of Issuance, Valid Till, BG Claim Expiry Date, Center, Location, Remarks.
- **New `fy` field** added to schema (optional free-text; wired into POST create, PATCH allowed list, GET list search, View modal, Add form). Bulk upload accepts it as first column.
- **Center resolution**: Bulk upload's "Center" column takes the center's **name** and resolves it to `center_id` via a case-insensitive lookup of `centers` collection. Unknown names → row-level error "Center not found: '…' (check spelling)".
- **Mandatory fields tightened**: Issued By, BG Number, Amount, Date of Issuance, Valid Till, BG Claim Expiry Date (6 required). FY / LoI / WO / In Favour Of / Applicant / Center / Location / Remarks remain optional.
- **Extra validation**: Valid Till must also be after Date of Issuance (in addition to expiry-after-issuance).
- **Sample Excel**: template now ships with user's example row (BG 1353NDLG00068126, ICICI Bank, Birsa Palojori, ₹1,74,636 etc.) so users can see the exact format at a glance.
- **Preview table**: shows every one of the 14 columns (horizontally scrollable) with ₹ formatted amount + green tick on resolved Center name — users can verify every field before Confirm.
- **Verified E2E**: uploaded user's exact example — all 14 fields persisted correctly (`fy=Birsa 25-26`, `letter_of_intent_no=LOI001722/26/02/2026`, `work_order_no=W002476/02/03/2026`, `applicant=Valeur Fabtex Pvt Ltd`, `center_id` resolved from name "Birsa Palojori", etc.). BG View modal displays all fields. Row-level errors work for unknown center + missing amount + expiry-before-issue + duplicate BG number.

## Jharkhand Skills MIS Dashboard — Phase 1 (Foundation + SIP Status) — Done + Verified, Feb 2026

### Scope Locked
Full 12-section MIS module split into 5 phases to protect existing Finance/HR/Attendance/BG:
- **Phase 1 (this session)**: Foundation — new isolated collections, routes, sidebar entry, tabbed MIS Dashboard page, and complete SIP / Center Status module with Excel bulk-upload + preview + export + BG expiry alert.
- Phase 2: Project Wise Summary (38-col, batch-level, auto-calcs, Excel)
- Phase 3: JSDMS Project Summary (20 cols + FY-wise targets)
- Phase 4: Daily Mobilization Report (multi-location, GPS, photo)
- Phase 5: Reports, drill-down analytics, Daily PDF export

### RBAC Mapping (uses existing roles per user)
- admin → Super Admin (full R/W)
- senior_manager → State Head (R/W)
- manager → Project Manager (R/W)
- hr / accountant → R/W
- center_manager / partner → Read-only
- staff / center_staff → Read + create own mobilization (Phase 4)

### Backend (`/app/backend/server.py` — new section at bottom)
- Collections + indexes (created on startup via `_ensure_mis_indexes`):
  `mis_sip_centers`, `mis_project_summary`, `mis_jsdms`, `mis_mobilization`
- Endpoints:
  - `GET  /api/mis/overview` — consolidated KPI counters (SIP totals, batch totals, placement %, today's mobilization etc.)
  - `POST/GET/PATCH/DELETE /api/mis/sip-centers[/{id}]` — full CRUD with duplicate-Center-ID guard (409)
  - `GET  /api/mis/sip-centers/sample-excel` — template download
  - `POST /api/mis/sip-centers/bulk-preview` — dry-run validation with row-wise errors
  - `POST /api/mis/sip-centers/bulk-upload` — batch insert with duplicate detection (in-file + DB)
  - `GET  /api/mis/sip-centers/export` — full Excel export matching template columns
- SIP schema (14 fields): serial_no, center_name, center_id_code, state, accreditation_date, status, last_inspection_date, center_rating, work_order_value, bg_submitted_amount, bg_validity_date, branch_start_date, job_role_on_caaf, job_role_to_be_added

### Frontend
- `/app/frontend/src/pages/mis/MISDashboard.jsx` — tabbed shell with 12 KPI cards + overview chart-bars (certification/placement/dropout %) + 6 tabs
- `/app/frontend/src/pages/mis/SIPStatusTab.jsx` — full CRUD table with:
  - Search + Status filter, Export / Bulk Upload / Add
  - Status chip color coding (accredited=green, pending=amber, expired=red)
  - BG validity urgency chip: red bold for <0d, amber bold for ≤30d, plain otherwise
  - 3-step Bulk Upload dialog matching BG bulk upload pattern (template → file → color-coded preview → Confirm N Centers)
  - Add/Edit modal with all 14 fields, View modal shows every field
- Sidebar entry "MIS Dashboard" (BarChart3 icon, i18n key `mis_dashboard`), route `/mis`
- Placeholder cards for Project Summary / JSDMS / Mobilization / Reports tabs — clearly labeled "Phase 2/3/4/5"

### Verified E2E
- Overview endpoint returns zero-safe aggregates when other collections are empty
- Manual create → 201; duplicate Center ID → 409
- Sample Excel download → 5.4 KB xlsx
- Real SIP Status sheet imported from the user's reference workbook (`Daily report Jharkhand skills Own.xlsx`) → preview showed 2 valid + 3 blank-row errors; confirm inserted 2 centers; Overview then showed `total_centers=2, accredited=2`
- Frontend screenshot confirms sidebar entry, 12 KPI cards, SIP tab table with 2 rows, status chips, action buttons — existing modules untouched

### Reference Workbook Columns Captured (for Phase 2-4)
- **Project Wise Summary** (38 cols): S.NO., State, Territory, Name Of Company, Center Name, Center Manager, Projects, Target year, Training Type, Total Target, Remaining Target, Total Target FY wise, Remaining Target FY Wise, Batch ID, Job Role, Total Enrolled, Start Date, End Date, Status, SDMS Batch ID, Attendance Percentage, Total Drop Out, Assessment Date, Billing Status, Total Certified, Status(2), Assessment Agency, Assessor Name, Assessor Contact Number, Total Actual Present Candidates, Pass, Fail, Absent, NO OF PLACEMENT, Offer Letter, Placement Status 1st/2nd/3rd Month
- **JSDMS PROJECT** (20 cols): Sl.No., BG Status, Centre Name, Job Role, Target Received Work Order, Target Achieved 21-22/22-23/23-24, No. of Batches, Total Hour, Training Duration in Months, Training Per Hour, Center Status, Job Role Status, If Not approved then Reason, Total Enrolled, No of Certified Trainer at center, No. Of Trainers TOT Aligned, No. Of TOT Renew Aligned, No. Of Trainers Required at Center
- **Mobilization Report** (up to 21 cols): BRANCH NAME, DATE, Project Name, MOBILIZATION AREA NAME 1-5 with DISTANCE/Total for each, Total Mobilisation, TOTAL DISTANCE, MOBILIZER NAME/EMP.ID/CONTACT, REMARKS

## MIS · Phase 2 — Project Wise Summary (Done + Verified, Feb 2026)

### Backend (`server.py`, appended to MIS section)
- Collection: `mis_project_summary` (batch-level rows)
- 38 fields matching reference Excel (Bharno / Satgawan / Kairo / future projects)
- Endpoints:
  - `POST/GET/PATCH/DELETE /api/mis/projects[/{id}]` — full CRUD with duplicate Batch ID guard (409)
  - `GET /api/mis/projects/filter-options` — distinct projects/centers/territories/target_years for filter dropdowns
  - `GET /api/mis/projects/rollups` — by_project + by_center + by_territory aggregates for dashboard charts
  - `GET /api/mis/projects/sample-excel` — 38-column template with real example row
  - `POST /api/mis/projects/bulk-preview` — dry-run validation with row-wise errors
  - `POST /api/mis/projects/bulk-upload` — insert valid rows with in-file + DB dupe detection
  - `GET /api/mis/projects/export` — full Excel export (38 base + 5 auto-calc columns)
- Header alias handling for messy real-world Excel: `"Remaining Targate"`→`remaining_target`, `"NO OF PLACEMMENNT"`→`num_placement`, multi-line placement headers etc.
- **Auto-calculated fields** (computed on read, never persisted):
  - `certification_pct` = certified / enrolled × 100
  - `placement_pct`    = placement / certified × 100
  - `assessment_pct`   = actual_present / enrolled × 100
  - `pass_pct`         = pass_count / actual_present × 100
  - `dropout_pct`      = dropout / enrolled × 100
  - `achievement_pct`  = certified / total_target × 100
  - `remaining_target_calc` = max(0, target - enrolled)

### Frontend (`/app/frontend/src/pages/mis/ProjectSummaryTab.jsx`)
- 6-KPI summary strip (batches, target, enrolled, certified, placement, certification %)
- 5-filter bar: search, project, center, FY, status + Export/Bulk Upload/Add
- **Batch table** with 16 columns including all auto-calc %s (color-coded: green ≥60%, amber >0, muted otherwise; drop % red >15% / amber >5% / green ≤5%)
- **Add/Edit form** grouped into 4 sections: Basic Info / Batch Info / Assessment / Placement + live auto-calc preview panel at bottom (shows Certif %, Place %, Ach %, Drop %, Remaining Target while typing)
- **View modal** with 3 highlight KPIs at top + all 38 fields grouped by section
- **Bulk Upload dialog** — 3-step (template → file → preview with red errors + green ready-to-insert)
- Status chips color-coded (active/running/ongoing=green, closed=grey, completed=blue)

### Verified E2E with reference workbook
- Imported real "Project wise summary Bharno Gum" sheet → 79 rows → 26 valid batches inserted + 53 blank rows correctly skipped
- Auto-calc math verified against known row: `BATCH/19424/08/2024` → target=440, enrolled=30, certified=29 → cert%=96.67, ach%=6.59, place%=100 ✅
- Overview updates: total_batches=26, total_enrolled=780, total_certified=355, placement_pct=38.33%, certification_pct=45.51%
- Rollups aggregate: by_project "Birsa" — 26 batches, 2280 target, 780 enrolled, 355 certified
- Frontend screenshot confirms color-coded % table, filters, KPI strip, bulk-upload flow — existing modules untouched

## MIS · Phase 3 — JSDMS Project Tracker (Done + Verified, Feb 2026)

### Backend
- Collection: `mis_jsdms`
- 21 stored fields (20 from Excel + `achieved_24_25` for the current FY)
- Endpoints (all under `/api/mis/jsdms/*`): CRUD, filter-options, sample-excel, bulk-preview, bulk-upload, export
- **Auto-calc fields** (computed on read):
  - `total_achieved`         = achieved_21_22 + achieved_22_23 + achieved_23_24 + achieved_24_25
  - `remaining_target`       = max(0, target_received - total_achieved)
  - `achievement_pct`        = total_achieved / target_received × 100
  - `trainer_gap`            = max(0, trainers_required - (tot_aligned + tot_renew_aligned))
  - `trainer_readiness_pct`  = (tot_aligned + tot_renew_aligned) / trainers_required × 100
  - `enrolled_vs_target_pct` = total_enrolled / target_received × 100

### Frontend (`/app/frontend/src/pages/mis/JSDMSTab.jsx`)
- 6-KPI summary (rows, target received, total achieved, enrolled, achievement %, trainer gap — gap turns red when > 0)
- 4-filter bar: search, Centre, Job Role, BG Status
- **17-column table** with color-coded auto-calcs (achievement % green ≥60%, amber otherwise; trainer gap red when positive)
- **Add/Edit form** grouped into Basic / FY-wise / Training Delivery / Trainer Roster + live preview panel (Total Achieved, Remaining, Achievement %, Trainer Gap, Trainer Readiness %) that recomputes as user types
- **View modal** highlights 5 auto-calc KPIs on top
- **Bulk Upload** — 3-step dialog with template download + colour-coded preview
- BG Status chip colours: Submitted=blue, Approved=green, Pending=amber, Rejected/Expired=red

### Verified E2E
- Manual create with target=800, FY splits 120/180/220/60, req=4, aligned=2, renew=1, certified=3 → total_achieved=580, remaining=220, ach%=72.5, trainer_gap=1, readiness%=75 ✅
- Template download + bulk upload of own template roundtrip works
- Frontend screenshot confirms KPI strip + table + BG chips render with real auto-calc values

## MIS · Phase 4 — Daily Mobilization Report (Done + Verified, Feb 2026)

### Backend
- Collection: `mis_mobilization`; one document per (branch, mobilizer, date) with embedded `locations[]` (max 5)
- Location schema: `{area_name, distance_km, mobilisation, lat, lng, photo_data_url (base64), notes}`
- **Auto-calc at write time**: `total_mobilisation = sum(loc.mobilisation)`, `total_distance_km = sum(loc.distance_km)`
- Endpoints (all `/api/mis/mobilization/*`): CRUD, `filter-options`, `rollups`, `export`
- `rollups` returns: today · month_to_date · avg_per_day · by_mobilizer (30d, top 100) · by_branch · by_project · daily_trend (last 30d)
- RBAC: staff / center_staff can create + edit only their own reports (`submitted_by` guard); admin/hr/manager/senior_manager/accountant/center_manager have full read; admin/hr can delete

### Frontend (`/app/frontend/src/pages/mis/MobilizationTab.jsx`)
- 6-KPI strip: Today Mob, Today Distance, Today Reports, MTD Mob, Avg/Day Mob, Avg/Day KM
- 4-filter bar (Branch, Project, From, To) + Export + New Daily Report
- **3 rollup mini-tables** side by side: Top Mobilizers (30d), Branch-wise (30d), Project-wise (30d)
- Reports table (date, branch, project, mobilizer, emp id, locations count, total mob, distance, submitted by)
- **New Report dialog**:
  - Header fields (Branch, Project, Date, Mobilizer Name/Emp ID/Contact)
  - Dynamic Locations section — Add up to 5 locations; each row has:
    - Area Name, Distance (km), Mobilisation count
    - **GPS button** — uses browser `navigator.geolocation.getCurrentPosition`, shows captured lat/lng inline
    - **Photo Upload** — client-side canvas downscale to ~400 KB base64, thumbnail preview + remove button
    - Notes
  - Live totals panel at bottom (Total Mobilisation + Total Distance updating as user types)
- View dialog shows metadata + location cards with photo thumbnails + clickable Google Maps link on GPS coords
- Excel export flattens all 5 possible location slots into columns

### Verified E2E
- Manual POST with 3 locations (5.5+12.3+8.7 km, 20+35+18 mob) → auto totals: `total_mobilisation=73`, `total_distance_km=26.5` ✅
- Rollups: today/MTD `{mob:73, km:26.5, reports:1}`; avg-per-day `{mob:3.84, km:1.39}` (correctly divided by days-in-month elapsed); by_mobilizer / by_branch / by_project all show single Kaushal Kumar entry; daily_trend has 1 row
- Overview KPI updates: `today_total=73, today_distance_km=26.5` ✅
- Frontend screenshot confirms 6-KPI strip, 3 rollup cards, table row, and lists integration with existing overview

## MIS · Phase 6 — Alerts & Exceptions Panel (Done + Verified, Feb 2026)

### Backend
- **New endpoint**: `GET /api/mis/alerts` — returns 8 alert categories in a single round trip:
  1. `bg_expiring`   (amber) — `mis_sip_centers.bg_validity_date` between today and +30d
  2. `bg_expired`    (red)   — `mis_sip_centers.bg_validity_date < today`
  3. `accreditation_pending` (amber) — SIP centers where status ≠ "accredited"
  4. `assessment_pending` (amber) — project batches with `enrolled > 0` and `certified == 0/null`
  5. `low_attendance` (red)   — batches with `0 < attendance_pct < 70`
  6. `placement_pending` (amber) — `certified > 0` and `placement == 0/null`
  7. `batches_ending` (blue)  — active batches with `end_date` in next 15 days
  8. `trainer_gap`   (red)   — JSDMS rows where `trainers_required > (tot_aligned + tot_renew_aligned)`
- Each category returns `{key, label, severity, count, target_tab, top[max 5 preview records]}`.

### Frontend (`/app/frontend/src/pages/mis/AlertsPanel.jsx`)
- Rendered at the top of the **Overview tab** so exceptions are the very first thing the user sees on login.
- Header shows a running total ("9 open exceptions" in red, or "All clear · no open exceptions" in green when zero).
- **8 color-coded cards** in a responsive 1/2/4-column grid — severity drives the left border + subtle background tint (red/amber/blue/green). Each card shows: icon, category label, big count, and the first offender's identifier (Center / Batch / Centre name).
- Cards with zero count are dimmed and non-clickable.
- Clicking any card opens a **drill-down dialog** showing the top 5 items in a table shaped per-category:
  - BG Expiring → Center · Center ID · State · Expiry
  - Low Attendance → Batch ID · Center · Job Role · Attendance % (color-coded)
  - Placement Pending → Batch ID · Center · Job Role · Certified count
  - Batches Ending → Batch ID · Center · Job Role · Ends On
  - Trainer Gap → Centre · Job Role · Required · Gap (highlighted red)
  - etc.
- Dialog has **"Jump to <TAB>"** button that switches the parent MIS tab (`onJumpToTab` prop wired into MISDashboard's `setTab`) so users can inspect / edit the offending records with one click.
- Refresh button re-hits the endpoint on demand.

### Verified E2E
- Seeded fixtures across SIP / Project / JSDMS collections to trigger every category → alerts endpoint returned all 8 counts correctly (BG Expiring=1, BG Expired=1, Accreditation Pending=1, Assessment Pending=2, Low Attendance=1, Placement Pending=1, Batches Ending=1, Trainer Gap=1).
- Frontend screenshots confirm the panel renders on Overview with all 8 cards color-coded, and clicking "Low Attendance" opens a drill-down showing the offending batch with red 55% attendance.
- No impact on existing Finance / HR / Attendance / BG / Candidate modules.

## MIS · Phase 5 + KPI Drill-down + Weekly Digest (Done + Verified, Feb 2026)

### Backend
- **`GET /api/mis/reports/daily`** — one aggregated call returning executive summary (16 KPIs), by_project / by_center / by_district arrays for charts, monthly_mob_trend (last 30 days), and open_alerts list
- **`GET /api/mis/reports/drilldown/{kpi}`** — filtered batch list for KPI card click-through (`enrolled` / `certified` / `placement` / `dropout` / `active_batches` / `centers`, all with limit)
- **Weekly digest**:
  - `_mis_build_weekly_digest()` — assembles alerts + 7-day mobilization totals + top 10 upcoming BG expiries
  - `_mis_dispatch_weekly_digest(force)` — sends via Resend to admin + senior_manager + hr users, filters out demo emails, idempotent per ISO week (`mis_digest_log` marker)
  - `_mis_digest_scheduler()` — background task that fires on Mondays every 4 hours, safe to re-run
  - Manual trigger endpoint: `POST /api/mis/digest/run?force=true`
- **`send_mis_weekly_digest()`** email helper in `email_utils.py` — HTML template with alerts table, week-mobilization strip, upcoming BG table, and "Open MIS Dashboard →" CTA

### Frontend
- **`/app/frontend/src/pages/mis/ReportsTab.jsx`** — full printable Daily Report:
  - Header with Refresh + **Print / Save PDF** button (uses browser print dialog with print-only CSS so users can Save-as-PDF)
  - 16-card Executive Summary
  - **4 Recharts**:
    1. Target vs Achievement · By Project (grouped bar: Target/Certified/Placement)
    2. District-wise Performance (horizontal bar: Enrolled + Certified)
    3. Center-wise Enrollment (Top 10, vertical bar)
    4. Monthly Mobilization Trend (dual-axis line: Mobilisation + Distance)
  - Project-wise Performance table (batches, target, enrolled, certified, placement, certif %, ach %)
  - Center-wise Performance table (top 10)
  - Exceptions & Alerts summary strip (auto-populates from `/mis/alerts`)
  - Print-only CSS blocks: sidebar/action bar hidden; report area full-width
- **KPI Drill-down on Overview**:
  - `KPI` component in MISDashboard turned into an optional `<button>` when `drilldown` prop set; adds hover shadow + `cursor: pointer`
  - Clickable KPIs: Total Centers, Active Batches, Total Enrolled, Certified, Placement
  - Click → fetches `/mis/reports/drilldown/{key}` → opens a shadcn Dialog with a full batch/center table (Batch ID, Center, Project, Job Role, Enrolled, Certified, Placement, Certif %, Status)

### Verified E2E
- Seeded 6 batches across 3 projects (Birsa / Satgawan / Kairo) + 3 districts (Gumla / Koderma / Lohardaga) + 10 daily mobilization reports over last 10 days
- `/mis/reports/daily` returned: 3 projects, 6 batches, 1940 enrolled, 1600 certified (82.47%), 1255 placement (78.44%), 100 dropout, 75.12% achievement
- KPI drill: clicking "Total Enrolled (1940)" opened dialog showing all 6 batches with correct Certif % (80%, 86.84%, 82.86%, 85.29%, 81.48%, 75%)
- Reports tab screenshots confirm all 4 charts render with real data + tooltips work (hover on Aug-18 shows Distance=15, Mobilisation=38)
- Digest `POST /api/mis/digest/run?force=true` returned `sent:2` to real admin/HR users, filtered out `@x.io` / `@example.com` demo addresses
- Scheduler task boots on app startup, safely idempotent per ISO week via `mis_digest_log`
