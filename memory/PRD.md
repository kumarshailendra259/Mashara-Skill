# Mashara Finance HRMS & Operations ERP — Product Requirements Document

## Original Problem Statement
Web application for company-wise, partner-wise, center-wise, project-wise tracking of investments, profit/loss, expenses & income — extended to a full HRMS/ERP with multi-role RBAC, approval workflows, attendance, payroll, stock and Play Store mobile app.

## Production Deployment
- Production URL: https://finance.masharaskills.com
- Preview is separate dev env; user clicks "Deploy" to push code from preview to prod.

## [2026-06 · Milestone auto-fetch from Batch Management]
User ask: "Milestone me automatic data Batch management se Fetch kare, kuchh bhi manually dalna na pade."
Decisions: role-total from the batch's Work Order/Course; passed/placed from Batch Management (Assessment/Placement stages); those numbers LOCKED read-only on Finance page; Company + Partner Share % + Partners stay editable on Finance (Company defaults from the batch).
Implemented:
- `/app/frontend/src/pages/Programs.jsx`: new `effectiveJobRoles(batch)` + `normCat()` derive the milestone basis from WO fields (`num_candidates × final_rate × job_role_hours`, category I/II/III→1/2/3); `rateForRow` now prefers a row's `custom_rate` (the WO `final_rate`). `activeBatchBreakdown`, the auto-calc table, and `openNewPayment` auto-fill all use `activeRoles`. Edit Batch dialog slimmed to read-only auto-fetched info (job role, candidates, hours, rate, role total, 1st/2nd/3rd, passed, placed) + editable Company/Partner Share %/Partners only. `saveBatch` now merges the 3 editable fields onto the full existing batch (prevents the old destructive full-replace that wiped WO/job_roles/passed/placed).
- `/app/backend/server.py`: `_compute_batch_milestones` prefers `custom_rate>0`; new `_batch_effective_job_roles(batch)`; `GET /batches/{bid}/compute-milestones` and `/compute-1st-milestone` auto-derive from WO. `update_batch` now fetches `existing` first and validates `work_order_id` ONLY when it changes (fixes rejecting edits on batches with a stale WO ref).
- Verified: compute-milestones curl → role_total ₹2,479.40 @ ₹61.985 WO rate, 1st ₹5,743.82; frontend auto-calc card + slim dialog screenshots correct; slim PUT preserves all WO fields while updating partner share.
- FIX [2026-06 · prod report Pakur_01 showed 367 not 30]: milestone candidate basis was using `num_candidates` (the Work Order's course-level allocation, spans the whole WO) instead of the batch's own count. Now uses `total_beneficiaries` (batch capacity) → `enrolled` → `num_candidates` fallback, in both `effectiveJobRoles` (Programs.jsx) and `_batch_effective_job_roles` (server.py). Hours & rate unchanged (course hours + WO final_rate). Verified in preview (test batch total_beneficiaries=3 vs num_candidates=5 → milestone used 3). NEEDS DEPLOY to reach production.


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


### Phase 100 — District Master + Auto 30-Candidate Batch Sheets (Candidate Export) (Done, Jun 2026)
- **User asked**: `/candidates` Export Excel ko multi-sheet banao — har District ke liye ek `<District>_All_Candidate` master sheet + automatically 30-30 candidates ke batch sheets (`<District>_01`, `_02`…). Sequential allocation (1-30→_01, 31-60→_02…), CEILING(total/30) batches. New columns: `S.No` (sheet-local 1..30), `Original S.No` (district master seq), `Batch Name` (generated), `Batch ID` (existing DB value, preserved). Filters respect; specific district → only uske sheets; specific batch (DB id/name ya generated name) → sirf wo ek sheet; no candidates → 404 (koi empty sheet nahi). DB batch assignment export se kabhi change na ho.
- **Implemented (backend only, `server.py`)**: Rewrote candidate export into one reusable builder `_build_candidate_workbook(docs, headers, widths, district_filter, batch_filter)` + per-sheet writer `_write_candidate_sheet()` + adaptive metadata header `_meta_cells_for()` + helpers `_district_meta`, `_safe_sheet_token`, `_unique_sheet_title` (31-char + illegal-char safe + dedupe), `_cand_doc_batch_id`. District grouping (alphabetical, stable created_at order), 30-size allocation (export-only, never writes DB). Batch selection priority: existing DB batch id/name → single sheet; else generated `District_NN` → single sheet; else 404. New `BOCWW_EXPORT_HEADERS`/`_WIDTHS` (21 cols A..U) + `JSDMS_EXPORT_HEADERS`/`_WIDTHS` (14 cols). Reference formatting per sheet: Arial Narrow, borders, wrap, widths, row heights, freeze A4, autofilter, sheet NOT protected (editable metadata), Aadhaar/Mobile/Labour-Reg/Batch-ID forced text (`@`). Union/ALL view unchanged (batch filtered in Python).
- **Frontend**: no change — `Candidates.jsx exportExcel` already posts project + district + batch + all filters.
- **Verified via openpyxl** (seeded Gumla 87 / Garhwa 45 / Ranchi 30): ALL/ALL → 3 districts × (master + 30-batch sheets) alphabetical; Gumla 87 → master(87)+_01(30)+_02(30)+_03(27); specific district → only its sheets; generated `Gumla_02` → single sheet (sheet S.No 1-30, Original S.No 31-60, Batch Name Gumla_02); DB batch `BATCH-DBX` → single sheet (5 rows); empty → 404; DB Batch ID preserved on master (BATCH-DBX), text formats intact, freeze/autofilter/not-protected on every sheet. Seed helper updated `/app/backend/tests/seed_candidates_test.py`; test data cleaned.
- NOTE: Adding the 4 new columns means BOCWW is no longer the EXACT 18-col reference layout of Phase 99 — now 21 cols with an adaptive (but reference-styled) metadata header, per this phase's explicit requirement.

### Phase 102 — Candidate ↔ Center Auto-Mapping (Phase 1 of Project→Center→Batch→Candidate) (Done, Jun 2026)
- **User asked** (big relational feature, phased): Candidate ko enter kiye gaye Center ID (code e.g. CTR-M28M) se Center Management master se auto-map karo; actual center reference save karo; Center Name + ID dikhao; sirf selected project (scheme) ke centers dropdown me dikhe; invalid/mismatch par clear error + save block; existing data auto-backfill; unmapped records ka view. (Batch auto-linking = Phase 2, keyed on **FY year + center_id** per user.)
- **User choices**: Batch Management = existing financial module (Phase 2 me link hoga); center match by `center_code`; har center par **scheme tag (BOCWW/JSDMS multi-select)** add karke project-filter; phased delivery.
- **Phase 1 implemented (this session)**:
  - **Backend `server.py`**: `_resolve_center_ref()` (center UUID ya center_code/entity_uid dono accept) + `_apply_center_mapping()` (validate + set `center_ref_id`/`center_name`/`center_code`; invalid → 400, scheme-mismatch → 400). Wired into `create_candidate`, `update_candidate`, `candidate_bulk_upload` (per-row, with `center_mapped`/`center_errors` in summary; scoping ab resolved ref par). `EntityIn` + `CenterCreateIn`/`CenterPatchIn` + `_center_out` me `schemes: List[str]`. `filter-options` ab scheme-filtered `centers` [{id,name,center_code}] deta hai (untagged legacy centers sab me dikhte hain). `list_candidates` ko `center_id` (ref-or-code match) + `unmapped` filter params mile. Naya `POST /candidates/backfill-center-mapping` (admin) existing candidates ko backfill karta hai.
  - **Frontend**: `Candidates.jsx` — center column "Name · CODE" + red **UNMAPPED** badge; Center dropdown (filter + add/edit form) ab scheme-filtered `options.centers`; "Show only Unmapped Centers" toggle; bulk-result me Center Mapped/Center Errors. `CenterManagement.jsx` — form me **Candidate Schemes (BOCWW/JSDMS)** multi-select toggle buttons, create/patch ke saath persist.
  - **Verified** (seeded 2 centers + candidates): valid code → auto-map (ref/name/code set); invalid code → 400; BOCWW→JSDMS-center → scheme-mismatch 400; filter-options sirf BOCWW-tagged + untagged centers; backfill 3→mapped 2/unmapped 1; unmapped view + center filter by UUID + name/code display — sab sahi; UI screenshot confirm. Test data cleaned.
- **Phase 2 (pending, next)**: Candidate ↔ financial Batch auto-linking (match by project + center + **FY year** + batch id), Batch Management me candidate counts/IDs/names, batch-create pe existing matching candidates attach, naya candidate pe existing batch me add, bulk-upload batch summary, clickable batch id. (points 2-batch,3,4,5,6,7,10-batch)

### Phase 103 — Candidate ↔ Batch Auto-Linking (Phase 2) (Done, Jun 2026)
- **User asked**: Candidate ko financial Batch se auto-link (match by center + FY year + batch id); Batch Management me total/active candidates + IDs/names; batch-create pe matching candidates attach; naye candidate pe existing batch me add; clickable batch id → Batch Management details.
- **Implemented (backend `server.py`)**: Candidate par naya `batch_ref_id` (financial batch UUID) — roster text `batch_id`/`batch` preserve. Helpers: `_resolve_batch_ref()` (match db.batches by `center_id==center_ref_id` + name/sdms_batch_id == batch text; FY year digits tiebreaker), `_apply_batch_mapping()` (best-effort, non-blocking), `_batch_candidate_filter()` (batch_id OR batch_ref_id), `_attach_candidates_to_batch()` (batch create/edit pe matching roster candidates ko link). Wired into create_candidate, update_candidate (re-link on center/batch/fy change), bulk-upload (`batch_mapped` counter), create_batch + update_batch (auto-attach). `enrolled` count (list_batches aggregation), `_batch_capacity_state`, `/batches/{bid}/candidates` sab ab batch_ref_id ko bhi count/include karte hain. Backfill endpoint ab batch linking bhi karta hai (`batch_mapped` in response).
- **Frontend**: `Candidates.jsx` — Batch ID cell clickable (`Pakur_09 ↗`) jab linked, warna amber **Unlinked** badge; click → `/batch-management?batch=<ref>`. `BatchManagement.jsx` — `?batch=<id>` deep-link us batch ka Edit/detail dialog auto-open karta hai.
- **Verified** (seeded project+center+batch): candidate create (batch exists) → auto-linked + batch candidates endpoint me dikha (enrolled 1); candidate create (batch nahi) → batch_ref None, phir batch create → auto-attached (list_batches enrolled 1); clickable batch id UI + deep-link dialog open — screenshot confirm. Test data cleaned.
- **NOTE**: Batch match project-level pe scheme(BOCWW/JSDMS) vs Project-entity mismatch ki wajah se **center + batch-id + FY** par hota hai (project string match skip — safe). Batch linking non-blocking hai (center mapping blocking hai).

### Phase 101 — Generated Batch Dropdown + Batch Summary Sheet (Done, Jun 2026)
- **User asked**: (1) Batch filter dropdown me generated batch names (Gumla_01, Gumla_02…) bhi dikhayein taaki user seedhe select kar sake. (2) Export workbook me ek extra "Batch Summary" sheet — district/batch-wise totals + male/female/category breakup.
- **Implemented**:
  - **Backend `server.py`**: `candidate_filter_options` ab `db_batches`, `generated_batches` aur merged `batches` return karta hai (`_candidate_generated_batch_names()` helper — district-wise CEILING(count/30) allocation names). `list_candidates` ab generated batch name ko resolve karta hai: agar koi DB batch match nahi karta to `District_NN` parse karke us district ki candidates (created_at ASC — export jaisa order) ko 30-size window me slice karke return karta hai (table = Excel se match). `_build_candidate_workbook` ab `_write_batch_summary_sheet()` ko pehli sheet ("Batch Summary") ke roop me likhta hai — District | Batch Name | Total | Male | Female | Trans | Other | per-category columns (dynamic), district subtotals + grand total, header fill + freeze + autofilter. `_norm_gender_bucket()` helper.
  - **Frontend `Candidates.jsx`**: Batch dropdown ab 2 labeled groups me — "Existing Batches" (db) + "Auto 30-Candidate Batches" (generated). `filter-options` se `db_batches`/`generated_batches` store.
- **Verified** (seeded Gumla 87/Garhwa 45/Ranchi 30): filter-options generated = [Garhwa_01,02, Gumla_01-03, Ranchi_01]; list `?batch=Gumla_02` → 30 rows (Cand 31-60); Batch Summary sheet totals Garhwa 45=23M/22F, Gumla 87=44M/43F, Grand 162=82M/80F, Cat ST breakup; single-batch export bhi summary + batch sheet; sheet order Batch Summary first; UI dropdown grouped options render confirmed via screenshot. Test data cleaned.



- **User asked**: `/candidates` ka "Export Excel" ko uploaded reference `BOCWW VALID DATA.xlsx` ke EXACT template jaisa banao — merged metadata header (rows 1-2, editable), candidate headers row 3, data row 4+, S.No auto, Aadhaar/Mobile/Labour Reg No text (no scientific notation), borders/widths/freeze/autofilter, sheet unprotected. JSDMS ko bhi wahi editable metadata header + existing fields. Filters (fy, center, batch, district, course, search, date range) respect ho. Existing add/edit/delete/bulk-upload/filters na toote.
- **Implemented (backend only, `server.py`)**: New builder `_build_candidate_template()` (openpyxl) + `BOCWW_EXPORT_HEADERS`/`_WIDTHS` (exact 18 cols A..R from reference), `JSDMS_EXPORT_HEADERS`/`_WIDTHS`, `_bocww_meta_cells()` (exact merges A1:C1/D1:H1/I1/K1:L1/M1:O1/P1:R1 + row2), `_jsdms_meta_cells()`, `_cand_export_meta()` (metadata values from filtered docs; filter district/batch win). `GET /api/candidates/export` now branches: BOCWW → exact template, JSDMS → template over lean roster, union/ALL → unchanged simple table. Added missing `center_id` query param + filter. Metadata cells plain text/editable; sheet NOT protected; Aadhaar/registered-labour-Aadhaar/labour-reg-no/mobile forced to text (`@`); freeze A4; autofilter A3:last.
- **Frontend**: no change needed — `Candidates.jsx exportExcel` already posts project + all filters (including center_id) to the endpoint.
- **Verified via openpyxl**: merges/headers/widths/row-heights/freeze/autofilter match reference exactly; sheet.protection=False; S.No auto 1,2,3; text fields keep leading chars (no sci-notation); district/batch metadata driven by filters; empty + filtered exports build without error (opens clean in Excel). Seed helper `/app/backend/tests/seed_candidates_test.py`; test data cleaned.


- **User asked (Hinglish, emergency P0)**: (1) One-screen Approve+Pay — Accounts ke FINAL "Approve" par ussi approval screen me payment confirmation khule → "Approve & Record Payment" (alag Process Payment step khatam). (2) "Paid By" dropdown — authorised Accounts users ki mandatory list, txn/audit me user id+name+time save. (3) Explicit Partner dropdown — center ke active mapped partners, 1 ho to auto-select, partner ID save (pehle auto-derive hota tha). (4) Partial payment — employee-level PAID/PENDING + batch "Partially Paid" + Retry Payment.
- **User choices**: One-screen sirf jab final approver khud Accounts/Admin ho (warna normal approve → Accounts baad me HRMS se pay kare); Paid By + Bank dono MANDATORY; v1 me PENDING/PAID kaafi (no FAILED); Partner auto-select + mandatory.
- **Backend (`server.py`)**: `PayrollBatchPayIn` + `paid_by_user_id`/`paid_by_name`/`partner_id`/`staff_ids`. `POST /api/payroll-batches/{id}/pay` rewritten — accepts `pending_payment` OR `partially_paid` (retry); pays only unpaid∩staff_ids rows; validates Paid By (authorised roster) + Bank mandatory; explicit partner_id (fallback auto-derive); creates ONE expense txn for the subset with paid_by stamped; marks target rows `pay_status=paid`; batch → `paid` if all paid else `partially_paid`; appends `transaction_ids[]` + audit. `_payroll_batch_out` adds per-row `pay_status` + `paid_count`/`pending_count`/`paid_amount`/`pending_amount`. `_derive_pending_at` handles `partially_paid`.
- **Frontend**: `PendingApprovals.jsx` — when an admin/accountant is the FINAL approver of a payroll batch, the Approve dialog shows a payment block (employee checklist + Partner auto-select + Paid By + Bank + Mode + Date + UTR) and the button becomes "Approve & Record Payment" (calls `/approvals/act` approve then `/payroll-batches/{id}/pay`). `HRMS.jsx PayrollBatchDialog` — pay sub-dialog upgraded with Partner (auto-select, mandatory) + Paid By (mandatory) + Bank (mandatory) + partial employee checklist; list + dialog show "Retry Payment" for `partially_paid`; staff table has a Pay Status column; `partially_paid` status tone chip added.
- **Verified**: backend curl (partial 5000 → partially_paid, retry 3000 → paid, explicit partner_id + paid_by+time on txn, guards: missing paid_by/bank → 400, double-pay → 400) + testing agent iteration_82 (100% of critical frontend flows: one-screen approve+pay single click, mandatory validation toasts, HRMS partial → Partially Paid with per-row PAID/PENDING, Retry → PAID). Test data (ZZPAYTEST-*) + bank balance cleaned/restored. Seed helper: `/app/backend/tests/seed_payroll_test.py`.
- **Follow-up (same session)**: Payment/Reimbursement/Advance final-approval attribution block (`PendingApprovals.jsx`) — Center already auto-selects from the request; Partner dropdown now lists ONLY the selected center's active mapped partners (via `/centers/{cid}/mapped-partners`), auto-selects when exactly one, is disabled until a center is chosen, and refetches when the center is changed (removed the old all-partners list). Verified via screenshot: center auto-selected, partner dropdown shows only the center's mapped partner, auto-selected.


### Phase 88 — Central Course / Job Role Master (single source of truth) (Done, Jun 2026)
- **User asked (18-point spec, Hinglish)**: "CREATE ONCE → SELECT ANYWHERE → AUTO-MAP EVERYWHERE". Central Course/Job Role Master; WO Course Details me manual entry hataao — searchable dropdown se select karo, baaki fields (Sector/SubSector/QP/Cat/NSQF/Hours/Cost/Board/Day/Days/Benefit) auto-map ho; non-admin ke liye mapped fields read-only, sirf admin override kare; backend course_master_id store + enforce kare; duplicate (name+QP) rok; historical snapshot preserve; migration + baaki modules baad me. Must NOT break existing modules or center isolation.
- **User choices**: (1) existing `db.job_role_master` collection EXTEND karo (no dup table); (2) override = Super Admin + Company Admin; (3) migration Phase D me (auto-link name+QP + admin mapping screen); (4) Phase A+B+C pehle, phir D+E; (5) menu under Organization Management.
- **Delivered Phase A+B+C**:
  - **Backend (`server.py`)**: `JobRoleMasterIn` extended to full course dimensions (name, qp_code, sector, sub_sector, category, nsqf_level, qp_hours, training_hours, default_hours[legacy sync], cost_per_hour, boarding_per_day, default_days, benefit, description, effective_from/to, active). Endpoints: GET `/api/job-role-master` (filters active_only/q/sector/category/with_usage), GET `/api/job-role-master/{id}/usage` ({work_orders,batches,candidates}), POST (409 duplicate on name OR qp_code), PATCH (updated_by/at + dup guard + hours sync), DELETE (soft-deactivate). `WorkOrderCourseIn.course_master_id`; `_resolve_course_masters(courses,is_admin)` — non-admins ke liye master values overwrite descriptive+rate fields (beneficiaries client-side), admins override allowed; wired into create/update WO; `_compute_work_order` row output me course_master_id included.
  - **Frontend**: new `pages/CourseMaster.jsx` (route `/course-master`, Organization Management sidebar item `course_master` gated `batchMgmtAccess`) — table + search + Sector/Category/Status filters + usage col + Add/Edit/Activate-Deactivate. Shared `components/course/CourseMasterFormDialog.jsx` (all fields) + `components/course/CourseCombobox.jsx` (cmdk Popover searchable by name/qp/sector/subsector). `WorkOrderFormModal.jsx` course rows → combobox + auto-map + read-only-for-non-admin ("Mapped from Course Master" lock) + "+ Add New Course" (admin) auto-selects newly created master. `BatchManagement.jsx` pickJobRole sets category from master. i18n `course_master` EN+HI. Suppressed benign ResizeObserver dev overlay in `index.js`.
- **Verified**: testing agent iteration_72 — backend 12/12 pytest (CRUD, 409 dup name+qp on POST+PATCH, hours sync, soft-delete, filters, usage 404, WO course_master_id store, value 300*41*20=246000/PBG 7380, admin override kept, NON-admin manager enforcement overwrites tampered fields from master while keeping beneficiaries, WO without master still works). Frontend 100%: /course-master CRUD + filters + toggle; WO modal combobox search + inline Add New Course auto-select + auto-populate + lock indicator + WO create (270000/PBG 8100). Test data cleaned.
- **Pending (Phase D+E, next)**: existing-data migration (auto-create masters from distinct WO/Batch courses by name+QP + Admin mapping screen for ambiguous), historical snapshot/versioning on master update, extend master reference into Candidate Enrollment / Placement / Reports / Exports. Field-lock currently on WO; batch already master-driven.

### Phase 88b — Migration + Snapshot + Rate Config Admin (Done, Jun 2026)
- **User asked**: (D) purane WO/Batch courses se master auto-create + name/QP link + ambiguous mapping screen; snapshot/versioning; (E) candidate/exports me course master reference; Rate Config Admin Page (long-pending P0). Choices: Rate Config under Batch Management; migration as a Course Master tab (dry-run preview + apply); version field + course_master_version stamp; backfill existing candidates.
- **Backend (`server.py`)**: Rate Config already had `db.rate_config` + GET/PATCH — added POST `/api/work-order/rate-config` (add slab, FY-range overlap 400 guard) + DELETE (204, blocks last slab), admin-only. Master `version` field (=1 on create, `$inc` on PATCH); `_resolve_course_masters` stamps `course_master_version` on WO rows (cleared when link removed); `WorkOrderCourseIn.course_master_version`. Migration: `_collect_course_signatures` (scans WOs+batches for unlinked courses), `_match_masters` (name/QP), `_link_signature_everywhere`, GET `/api/course-master/migration/preview` (auto_link/create_new/ambiguous buckets), POST `/api/course-master/migration/apply` (creates + links, admin mappings for ambiguous), POST `/api/course-master/backfill-candidates`. `_candidate_course_stamp` stamps job_role_master_id/qp/sector/sub_sector/nsqf/course_hours/course_master_category onto candidates at enroll (add + bulk-commit) + backfill; union `/api/candidates/export` gains QP/Sector/Sub Sector/NSQF/Course Hours cols (BOCWW/JSDMS govt formats untouched).
- **Frontend**: new `pages/RateConfig.jsx` (route `/rate-config`, Batch Management sidebar `rate_config` adminOnly) — slab table + add/edit/delete + LWE note. `CourseMaster.jsx` now Tabs: Courses + `components/course/CourseMigrationTab.jsx` (Scan&Preview summary cards + auto-link/create-new lists + ambiguous mapping selects + Apply + Backfill). i18n `rate_config` EN+HI.
- **Verified**: testing agent iteration_73 — backend 15/15 pytest (rate config CRUD+overlap+403; versioning: old WO keeps v1 snapshot after master bumped to v2, new WO gets v2; migration preview/apply/backfill + 403; candidate stamping; union export cols added, govt exports unchanged) + frontend 100% (rate-config renders 2 slabs + add dialog + overlap toast; migration tab summary cards + buttons; sidebar placement). Test data cleaned, rate-config restored to defaults. Two trivial nits fixed post-test (dead ternary, stale version clear).
- **Remaining backlog**: Placement-specific reports course cols; candidate LIST UI columns (API already returns fields); modularise server.py.

### Phase 89 — Mandatory Unique Entity ID & Relationship Linking (Done, Jun 2026)
- **User asked**: Har Center/Partner/Project/Company ka system-generated permanent Unique ID; Centers list me Unique ID column; Center create/edit pe Partner→Project→Company mandatory (DB+API); cascading dropdowns; reverse visibility; orphan prevention; deletion integrity; search by ID; audit trail; admin mapping interface. Center data isolation na toote.
- **Choices**: Partner=`PART-XXXXXX`, Project=`PROJ-XXXXXX` (Company=`UXU7SO`, Center=`UXU7SO-A7K2` reused); existing unmapped centers → "Mapping Required" (not blocked), new/edit pe mandatory; cascading graph = existing center mappings se derive; Phase 2 (codes everywhere in batch/candidate/finance/reports) deferred.
- **Backend (`server.py`)**: `entity_uid` field on all 4 entities + `_new_prefixed_code` + `_backfill_entity_uids` (startup, PART/PROJ backfill + unique indexes). `_enforce_center_mapping` (400 if partner/project/company missing or invalid), `_record_mapping_audit` (append-only `entity_mapping_audit`), `_entity_dependency_count` (deletion integrity → 409). create/update/delete_entity wired; `entity_uid` immutable on PUT. `list_entities` enriches centers (partner/project/company name+uid + mapping_complete) + `q` search. New: GET `/entity-mapping-options` (cascading), `/entities/{etype}/{eid}/relationships` (reverse), `/entity-mappings` (admin table + unmapped_only + q), `/entity-mappings/audit`.
- **Frontend**: `Entities.jsx` — Unique ID column (all types) + order Unique ID|Name|Partner|Project|Company|Manager|Email|LWE|Login Mail|Description|Actions; amber "Mapping Required" badges; search box; center form mandatory Company*/Partner*/Project* with cascading (Project disabled till Partner) + validation toast. New `pages/EntityMappings.jsx` (route `/entity-mappings`, Organization Management sidebar `entity_mappings` adminOnly) — summary cards + search + unmapped toggle + Center→Partner→Project→Company table. i18n EN+HI.
- **Verified**: testing agent iteration_74 — backend 19/19 pytest (uid regex+immutable, mandatory 400s, delete 409, cascading, reverse, admin mapping, audit, search) + frontend 100% (centers columns+badges+search+mandatory cascading form; /entity-mappings cards+table). Center isolation intact. Test data cleaned.
- **Deferred (Phase 2)**: Unique codes surfaced across batch/candidate/attendance/finance/invoice/settlement/reports/exports; reassign-mapping directly from the mapping page; explicit staff dependency in deletion check.

### Phase 89b — Multi-Partner Center Mapping (Done, Jun 2026)
- **User asked**: Ek center 2+ partners se map ho sake. Choices: har row = complete Partner+Project+Company triple; `mappings[]` array on center; first=primary synced to legacy fields; min 1 complete + har row complete; existing single-mapping auto-migrate; sab views update.
- **Backend**: `_normalize_center_mappings` (accepts `mappings[]` or legacy singles; validates ≥1 complete + existence + dedupe; syncs primary→legacy `partner_id/project_id/company_id`; explicit `mappings:[]` → 400) + `_center_mapping_list`. create/update_entity wired. `list_entities` returns `mappings_resolved[]` + `mapping_count`. `entity_mappings` admin table expands ONE ROW PER MAPPING (mapping_index/total). Cascading `$unwind` row-scoped; reverse visibility + deletion-integrity match `mappings.partner_id` via `$or` legacy. Startup migration legacy→mappings[].
- **Frontend `Entities.jsx`**: center form single dropdowns → repeatable "Partner → Project → Company Mapping" editor (Add Partner Mapping / per-row remove, Project/Company disabled till Partner); save validates ≥1 complete + no partial rows. List columns show primary + "+N more".
- **Verified**: testing agent iteration_75 — backend 16/16 after fix (multi-create, dedupe, 400s, edit add/remove, migration, per-mapping admin rows, reverse, cascading, deletion 409, empty-mappings PUT→400) + frontend 100% (multi-row editor create/edit/remove; +N more badge). Regression green. Test data cleaned.


### Phase 83 — Attendance next-day carry-over bug FIXED (Jun 2026)
- **Bug**: Forgot-to-checkout on day N showed "You're checked in" on day N+1. Root cause: `/api/me/summary` (staff dashboard) used `datetime.now(timezone.utc).date()` (UTC) → between 00:00–05:30 IST the UTC date was still yesterday, so it returned yesterday's open row; and stale-close only ran on check-in, never on page load.
- **Fix (`server.py`)**: new `_auto_close_stale_attendance(staff)` helper — closes ALL open rows with `date < today_ist` (checked-in, no checkout, not regularised/admin/leave/half) as `status="auto_closed"`, `check_out_at` = shift end (or HR `day_end_time`, else 18:00 IST) via `_shift_end_iso_for`, `check_out_via="auto"`, `auto_close_note`. Wired into `/me/summary`, `/attendance/today`, `/attendance/checkout`, `/attendance/my`, and replaces the inline stale-close in `/attendance/self`. `/me/summary` now uses `_today_ist()` (not UTC). Multiple consecutive missed days each auto-close independently. Existing check-in/checkout unchanged; center isolation untouched.
- **Payroll/display safety**: `auto_closed` mapped to `incomplete` in payroll effective-status, monthly calendar, `/attendance/my` effective_status, and `/me/summary` month_stats — so pay math and history are unaffected; history retains actual check-in + auto checkout + status + note.
- **Verified (curl+DB+UI)**: stale prior-day row → `/me/summary today=null`, `/attendance/today attendance=null`, row becomes `auto_closed` w/ day-end checkout+note; multiple stale days (10/11/12) all auto_closed independently; fresh check-in creates today's row (CHECKED_IN); frontend `/check-in` dashboard shows **CHECK IN** (no dangling "You're checked in"). Test data cleaned.


- **User asked**: Admin-configurable per-role menu/submenu access with 7 permission levels (View/Create/Edit/Delete/Approve/Export/Print), enforced at backend/API level (not just hidden in UI), audit log, dynamic sidebar, direct-URL guard, custom-role creation. Must NOT break existing modules; center-data isolation stays separate & always-on.
- **User choices**: existing system roles default FULL access (no lockout); new custom roles default ALL-OFF; admin always full; Phase 1 backend enforcement = menu-level VIEW (unauthorized API/URL → 403); Phase 2 = granular create/edit/delete/approve/export/print API enforcement (pending); new-role UI included.
- **Backend (`server.py` ~L195)**: `MENU_REGISTRY` (59 stable menu ids, tree via parent), `SYSTEM_ROLES` (8), collections `roles` / `role_menu_permissions` / `permission_audit`. Helpers `_role_perm_map` (admin=all-true; system role default all-ON; custom default all-OFF; stored rows override), `check_menu_permission`, `require_menu` dependency, and `@app.middleware rbac_view_enforcement` (maps API path prefixes → menu id, enforces VIEW, admin bypass, /api/auth + /api/rbac exempt, unmapped pass-through). Endpoints: `/api/rbac/menus`, `/api/rbac/roles` (GET/POST/PATCH/DELETE), `/api/rbac/permissions/{role}` (GET/PUT — PUT admin→400), `/api/rbac/permissions/{role}/reset`, `/api/rbac/audit`, `/api/auth/me/permissions`. Audit records actor + old→new per action.
- **Frontend**: `context/PermissionContext.jsx` (loads /me/permissions → `can(menuId,action)`, fail-open), wrapped in `App.js`. New admin page `pages/MenuAccessControl.jsx` (role selector, create/rename/delete role, full menu tree × 7 checkboxes, Select/Clear/Expand/Collapse/Reset/Save+confirm, Audit Log tab; admin role read-only). Route `/menu-access-control` (ProtectedRoute `requireAdmin`). Sidebar: "Roles & Permissions" link under Organization Management (adminOnly); top-level groups gated by `can(GROUP_MENU[key],'view')`. i18n `roles_permissions` EN+HI.
- **Verified**: testing agent iteration_69 — backend 19/19 pytest, frontend 100%. Confirmed: admin cannot be restricted (400), custom role defaults OFF, save+audit old→new, reset restores, non-admin 403 on /api/rbac/*, VIEW enforcement 403 + sidebar hide when a menu view is turned OFF, no-lockout defaults, center isolation unchanged/independent. Ephemeral test users cleaned; 0 permission rows remain (all roles at default full access — clean state).
- **Pending (Phase 3)**: submenu-level sidebar gating; per-page button-level gating wiring (`can()` helper ready); extend action prefix map to any remaining niche endpoints. Optional: admin user-delete endpoint (currently 405).

### Phase 82b — RBAC Phase 2: Granular Action Enforcement (Done, Jun 2026)
- **User asked**: Har module endpoint pe create/edit/delete/approve/export/print permission enforce karna (Phase 1 me sirf VIEW tha).
- **Backend (`server.py`)**: extended `rbac_view_enforcement` middleware — derives action from HTTP method + path keywords (`_action_for_request`: /approve|/reject→approve, /export|.csv|/download|/xlsx→export, /pdf|/print→print, else GET→view/POST→create/PUT|PATCH→edit/DELETE→delete) and enforces it via `check_menu_permission`. VIEW still enforced only on the Phase-1 small prefix set (shared module GET reads stay unaffected); non-view actions enforced across a comprehensive `_ACTION_PREFIX_MENU` (subscription, entities/companies/projects/centers/users, batches/targets/work-orders, transactions/invoices/payments/bank/reimbursements/advances/payroll/salary, vendors/quotations/purchase, candidates, staff/attendance/leaves/holidays/shifts/geofences/assets/offer-letters, approvals/chains/log, partners/associations/settlement). Admin bypass; unmapped → pass-through; system roles default all-ON (no breakage); custom roles default OFF.
- **Verified (curl)**: manager restricted → POST /api/leaves (create OFF) → **403**, GET /api/leaves (view) → **200**, reset → POST → 422 (allowed); finance approve OFF → POST /transactions/{id}/approve → 403; hr.employees export OFF → GET /staff/export.csv → 403, GET /staff → 200; batch.creation delete OFF → DELETE /batches/{id} → 403. Existing `require_role` gates still apply on top (double-layer). All roles reset to default (0 permission rows), test audit cleared.
- **Note**: submenu-level API enforcement works where endpoints are distinct; income/expense/investment share `/api/transactions` (→ finance) and companies/centers/projects/partners share `/api/entities` (→ org), so those enforce at the parent-menu granularity by design.



### Phase 81 — Batch Management · Work Order Master (Source of Truth) (Done, Jun 2026)
- **User asked**: Make Work Orders the central source of truth for Work Order Value/PBG in Batch Management. Confirmed: new Work Order master (WO Number, Issue/Expiry, LOI, PBG% dropdown 3/5/10/Manual, GST=No, Course Details line items → auto-compute value = Σ Total Fee, override allowed) linked to Project+Centre+FY; View Work Order from Target Allocation; WO Value column in Target Allocation; centre-wise value; dashboard financial cards; Work Order Financial Summary table; filters; only ACTIVE WOs counted (no double-count). No change to existing Batch/Target logic/RBAC.
- **Backend (`server.py`)**: new `db.work_orders` collection. `WorkOrderIn/Out` + `WorkOrderCourseIn`; `_compute_work_order` (backend-authoritative: classroom = hours×cost/hr×benef, boarding = board/day×days×benef, value = Σ total_fee or override, pbg_amount = value×pbg%/100); `_wo_effective_status` (active/expired[expiry<today]/cancelled/completed); `_enrich_work_order`. Endpoints: POST/GET/PATCH/DELETE `/api/work-orders` (create/edit: admin+manager+senior_manager; delete: admin; read: +accountant/hr/center_manager, centre-scoped for center_manager) and `GET /api/batch-management/financials` (cards: total_wo_value/total_pbg/allocated_value/avg; summary_rows grouped by project+centre+fy with target rollups; grand_total). `list_batch_targets` now enriches each row with `work_order_value` (Σ active WOs matching project+centre+fy) + `center_wo_value` (Σ active WOs for centre).
- **Frontend**: new `components/batch/WorkOrderFormModal.jsx` (course editor + live totals + PBG dropdown + override), `WorkOrderViewModal.jsx` (single detail + multi-WO "Work Orders for this Centre" list + Print/PDF via new window + Edit/Delete), `WorkOrderFinancials.jsx` (4 dashboard cards + filters + summary table + grand total). `BatchManagement.jsx` wired: financials load, WO modals, Target Allocation table gained "Work Order Value" column (`bm-tgt-wo-value-*`) + eye "View Work Order" action (`bm-tgt-view-wo-*`) + "+ Work Order" toolbar button.
- **Verified**: testing agent iteration_68 — backend 16/16 pytest (`test_phase81_work_orders.py`): auto-compute (₹6,87,150 / PBG ₹20,614.50), override precedence, expired/cancelled excluded from totals, status filter surfaces inactive, financials grand-total consistency, target enrichment, RBAC (partner 403, admin-only delete). Frontend 100%: cards render dynamic ₹, summary + grand total, filters, form modal, view modal (detail/print/edit/delete), target WO Value column + view action, existing KPI strip + Batch/Target flows intact. Dummy test WOs cleaned from DB (0 remaining → client starts fresh).
- **Note**: center_manager centre-scoping code path present (verified by review) but not exercised E2E. GST intentionally excluded per user.

### Phase 81b — Batch ↔ Work Order Link (Done, Jun 2026)
- **User asked**: Batch create form me existing Work Order ka dropdown (WO No — Centre — FY) daalo taaki har batch apni WO se linked rahe.
- **Backend**: `BatchIn.work_order_id` (optional) + validation (400 if WO doesn't exist) on create & update; `BatchOut.work_order_no` enriched in `list_batches` via batch-load map (no N+1).
- **Frontend (`BatchManagement.jsx`)**: "Linked Work Order" Select (`bm-batch-inp-wo`) in the batch form's Work Order Allocation section — options are active/all WOs filtered by the batch's project+centre, labelled `WO No — Centre — FY (status)`; new "Work Order" column in the Batch Creation table showing the linked WO number. `woList` loaded once + refreshed on WO save.
- **Verified**: curl — batch created with `work_order_id` persists, GET /batches returns `work_order_no`, bad id → 400, cleanup done. Frontend screenshot — dropdown + column render, no crash.



### Phase 80 — Global Premium SaaS/HRMS UI Redesign (Done, Jun 2026)
- **User asked**: App-wide modern premium Finance+HRMS SaaS redesign (SalaryBox-clean + Mashara analytics). UI/UX ONLY — no logic/API/DB/RBAC/calculation changes. Inter font; professional blue primary; green income/profit, red expense, indigo investment, amber pending; thin borders; 4-8px radius; subtle shadows; spacious; soft-blue active sidebar; enterprise header; modern KPI cards/tables/forms/buttons; responsive.
- **Approach (low-risk, high-cascade)**: The whole app is styled via global CSS tokens + shared classes (`swiss-card`, `overline`, `num`, `value-*`) + shadcn tokens + shared `Layout`/`KpiCard`. Updating those cascades the new look across every module without touching page logic. Design blueprint captured in `/app/design_guidelines.json` (design_agent).
- **Changes**:
  - `public/index.html` — load Inter 400/500/600/700 + JetBrains Mono.
  - `src/index.css` — Inter global (dropped Chivo/IBM Plex); tokens: `--warning` #f59e0b (amber), added `--investment` #4f46e5 + `--brand-soft` #ebf2ff + soft tints; `--radius` 0.375rem; shadcn `--primary`/`--accent`/`--ring` refreshed; `.swiss-card` 8px radius + subtle shadow + hover; `.overline` 600; `.badge-*` status helpers; custom thin scrollbar. Print styles preserved.
  - `components/KpiCard.jsx` — backward-compatible optional `icon` (lucide) in a soft-colored badge + `tone` + `sub`.
  - `pages/Dashboard.jsx` — KPI cards now carry icons (Wallet/TrendingUp/TrendingDown/LineChart), filter Selects/Inputs softened to rounded-md, chart tooltips restyled (8px radius, subtle shadow).
  - `components/Layout.jsx` — sidebar group + submenu ACTIVE state → soft-blue (`bg brand-soft` + blue text, rounded, no left-border), brand-blue app logo; NEW header **Pending Requests amber pill** (`data-testid=pending-requests-pill` → /pending-approvals); header buttons softened to rounded-md. All RBAC/collapse/mobile logic untouched.
- **Verified**: testing agent iteration_67 (frontend regression, 100%): admin dashboard (4 KPI cards + icons, filters, charts), sidebar nav across /transactions /hrms /reports /subscription /partner-settlement /users /center-management (all non-blank), header controls (pending pill/notif/lang/user/logout), transactions table + New Transaction dialog, partner RBAC intact (no admin routes, /companies-admin 403), mobile 390px bottom-nav + drawer + stacked KPIs. Only pre-existing minor console warnings (Reports key prop, mobile drawer a11y) — not redesign regressions.


### Phase 79 — Partner Settlement Interactive Dashboard + Sidebar Relocation (Done, Jun 2026)
- **User asked (navigation)**: Remove Partner Settlement from the Dashboard; add sidebar group Partnership → Partner Settlement opening the SAME settlement system (no logic/API/calculation change).
- **User asked (redesign)**: Turn the long Partner Settlement list into an interactive dashboard — KPI Summary → Filters → Charts → Center Overview (expandable cards) → Partner-wise → per-center Detail → Settled History. Keep 100% of existing settlement logic/actions. Partner role must see the menu (center/company-scoped data only), no admin surfaces.
- **Frontend**:
  - `pages/Dashboard.jsx` — removed `SettlementSection` (Dashboard now clean; widgets only).
  - `components/Layout.jsx` — `grp_partnerships` gained item `partner_settlement` (icon Handshake) gated by new `settlementAccess` flag (admin/company_admin/partner/manager/senior_manager/accountant/hr). i18n `partner_settlement` EN+HI.
  - `App.js` — new route `/partner-settlement` (requireFinance).
  - `pages/PartnerSettlement.jsx` — thin page rendering the new dashboard.
  - NEW `components/SettlementDashboard.jsx` — reuses the EXACT same endpoints (`/dashboard/settlement`, `/dashboard/settlement/history`, `/dashboard/settlement/txns`, POST `/dashboard/settlement/record`, DELETE `/dashboard/settlement/record/{id}`, `/admin/normalize-txn-dates`). Features: 8 KPI cards (Total Income / Contribution-Expense / Overall P&L / Partner Profit Share / Fair Share per Partner / To Receive / To Pay / Settled Amount — all dynamic); filters (Company [best-effort via /entities], Center, Partner, Cycle Active|Lifetime, Status All|Pending|Settled, Date Range, Clear); 5 recharts (Income vs Expense, P&L by Center, Partner Contribution, Share Distribution pie, Settlement Status pie) that respond to filters and are capped Top-10 centers / Top-8 partners for readability; Center Overview compact cards (income/expense/P&L/fair share/to receive/to pay + status badge) expandable to the original detailed partner table with Settle Dues + View Contributing Txns; Partner-wise aggregate table with per-center dues breakdown + Settle Dues; Settled History dialog; Fix Legacy Dates (admin); green=positive/receivable, red=negative/payable. Failure now shows a toast.
- **Verified**: testing agent iteration_66 (frontend, 100%): admin (132 centers, KPIs populated, all filters/charts/expand/settle-dialog/txn-drill/history work) + partner (kumarshailendra259@gmail.com → 2 centers only, strict isolation, KPIs Total Income ₹5,000 / Fair Share ₹32,500 / To Receive ₹550 / To Pay ₹550, no admin sidebar leak) + Dashboard confirmed clean (no settlement-section). Backend untouched.
- **Backlog note**: `SettlementDashboard.jsx` is ~950 lines — candidate to split into KPIs/Charts/CenterCard/dialogs later.


### Phase 78 — Partner Settlement History Visibility Fix + Assign Centers UI (Done, Jun 2026)
- **Bug (regression from Phase 77 strict isolation)**: Partners lost access to the Settlement dashboard/history because their associations (`_associated_center_ids`) were never enriched in the settlement endpoints, so `_scoped_center_ids` fell through to `[]` (fail-closed) and hid all centers + the history section.
- **Fix (`server.py`)**: added `await _enrich_user_with_associations(user)` to `settlement_view` (~3507), `record_settlement` (~3863), `settlement_history` (~3919), `delete_settlement_record` (~3949), `settlement_contributing_txns` (~3982). Now partners resolve to their mapped centers and see strictly-scoped settlement data + history.
- **UI (`Users.jsx`)**: 'Assign Centers' label now shows a live `(N selected)` counter + helper hint 'User will only see data of the centers checked below'; each center checkbox carries `data-testid=assign-center-<id>` and highlights when selected.
- **Verified**: backend curl (partner kumarshailendra259@gmail.com → scope 2 centers, /dashboard/settlement 200 scoped, /dashboard/settlement/history 200 empty) + testing agent iteration_65 (100% frontend: partner sees exactly 2 centers Birsa Kairo + Palojori Deoghar, View Settled History renders per-center empty-state, no leak of other centers; Assign Centers live counter 0→1→2→1 works). Note: DB currently has 0 partner_settlement records so history empty-state is expected.
- **Non-blocking follow-ups flagged**: SettlementSection.toggleHistory swallows per-center fetch errors (mask real 500 as empty); Users.jsx flat 213-center checkbox list could use search + Select-All/Clear.


### Phase 72 — Company Centers + Center-wise Access + Multi-Company Users (Done, Jun 2026)
- **User asked (20-point spec, Hinglish)**: Multiple Centers per Company with auto-generated unique Center Codes; Company→Center relationship; per-Center access enable/disable (Super Admin selects individual centers); multi-company users (many-to-many) who log in ONCE and switch companies after login; per-company roles (e.g. company_admin in Company A, manager in Company B); backend-enforced security (no bypass via payload/URL tampering).
- **User choices**: 1a full rollout; 2b extend existing `db.centers`; 3 company code random short `UXU7SO` + center code `UXU7SO-A7K2`; 4b always show company selector after login; 5b manual multi-company assignment via UI.
- **Backend `/app/backend/server.py`**:
  - Random code generators `_rand_code` / `_new_company_code` (6-char, no ambiguous chars) / `_new_center_code(company_code)` → `{CODE}-XXXX`.
  - Startup migration `_migrate_multicompany()` (idempotent): reformatted 73 legacy `COMP-NNNNN` codes → short random (mirrored onto users.company_code); assigned `center_code` + `access_status=enabled` + `center_status=active` to 212 centers; backfilled `user_companies` (baseline single-company membership) + `user_centers` from users.assigned_center_ids. Indexes on user_companies(user_id,company_id unique), user_centers(user_id,center_id unique), centers.center_code (partial unique).
  - New collections: `user_companies {user_id, company_id, role, status}`, `user_centers {user_id, company_id, center_id, status}`. Center access stored on the center doc (`access_status`, `access_type`, `center_status`, `center_code`).
  - New endpoints (all on `sub_api`, prefix /api): `GET/POST /centers`, `PATCH /centers/{cid}`, `POST /centers/set-access` (bulk enable subset → rest disabled), `GET/PUT /users/{uid}/memberships`, `GET /auth/my-companies`, `POST /auth/switch-company`.
  - `create_entity`: companies now get short random codes; centers auto-get center_code + access defaults.
  - `POST /auth/switch-company`: validates membership (403 if not a member), sets active context on the user doc — `company_id`, `role` (from membership, never elevates to super_admin), `assigned_center_ids` (only access-ENABLED + active centers). All existing center-scoped endpoints inherit the new active company automatically. Super Admin stays global (switch only records `active_company_id` UI context).
  - `my_scope` now returns `active_company_id` + `active_company`.
  - Authz: `_can_manage_company` — Super Admin any; Company Admin only own company. Company Admin membership edits limited to own company slice + cannot assign super_admin.
- **Frontend**:
  - `AuthContext` — adds `companies`, `isSuperCompanies`, `switchCompany`, `loadCompanies` (hydrated from `/auth/my-companies`).
  - `ProtectedRoute` — multi-company gate: non-super users are routed to `/select-company` after login until a company is chosen (sessionStorage `companyChosen`). Super Admin skips.
  - New `pages/CompanySelect.jsx` (`/select-company`) — post-login company picker showing per-company role. `components/CompanySwitcher.jsx` — header dropdown for 2+ company users (hidden for Super Admin). `pages/CenterManagement.jsx` (`/center-management`, admin/company_admin) — company selector, KPI tiles, centers table (code/name/access/status/actions), Add Center dialog (no manual code), per-center access toggle, bulk "Manage Access" panel with Select All/Clear All/Save. `components/MembershipsDialog.jsx` — in Users page (building icon per row) to assign a user to multiple companies with per-company role + center checkboxes.
  - Sidebar: new "Center Management" item under Organisation group (admin/company_admin). i18n keys `center_management` EN+HI.
- **Verified E2E (testing agent iteration_60 — 100% backend 9/9 + full frontend)**: Super Admin center CRUD + auto codes (e.g. `3YJW4A-LACZ`); single + bulk access toggle; hr multi-company login → Company Selector → switch changes role (company_admin↔manager) + center scope; membership dialog add/remove/save; security — 403 on non-member switch + cross-company center create; fail-closed (assigned_center_ids=[] + needs_mapping when all centers disabled). Only a minor pre-existing Radix aria-describedby a11y warning.
- **NOTE**: Existing single-company operational users now also pass through the one-time company selector on each fresh login (per user choice 4b).

### Phase 97 — Duplication Audit + DUP-004 & DUP-002 Consolidation (Jun 2026)
- Full read-only architecture/duplication audit delivered (13 duplicate groups, 4 conflicting-logic areas, matrix + commonization plan). No code changed during audit.
- **DUP-004 (attendance effective-status)**: 4 inline copies (attendance list ~6827, salary daily ~9416, dashboard `_effective_status` ~11193) → single canonical `_attendance_effective_status(row)` (module-level ~941). All callers delegate. Behaviour-preserving (verified: 08-10 auto_closed→present, present_days=1.0 unchanged). Root cause class of Phase 94 bug removed.
- **DUP-002 (conflicting center-access fns)**: `_user_scoped_center_ids` now a thin behaviour-preserving wrapper over canonical `_scoped_center_ids` (removes duplicated role branching; head roles still unrestricted for the create-guard, exact prior outputs kept). A stricter hr/manager unification left as an explicit future decision.
- Remaining audit backlog (awaiting approval): DUP-001 center-access service, DUP-003 role registry, DUP-005 partner-mapping stores, DUP-006 late calc, DUP-007 working-days, DUP-008 frontend canEdit divergence, DUP-009 currency formatter (16 files), DUP-010..013 UI/util.


### Phase 96 — Center↔Partner↔Staff Mapping UI (Phase 2 of 4, Done Jun 2026)
- **Backend (`server.py`, extends existing `center.mappings[]` + staff `assigned_center_ids[]`; no new ID system)**:
  - `GET/POST/PATCH/DELETE /centers/{cid}/mapped-partners` — partner mappings with `active` + `cross_approval` flags (default ON) + role. Dedupe (no duplicate partner per center).
  - `GET/POST/DELETE /centers/{cid}/mapped-staff` — staff mapped via `assigned_center_ids` (primary `center_id` protected from unmapping).
  - `GET /partners/{pid}/mapped-centers` and `GET /staff/{sid}/mapped-centers` — reverse "Assigned Centers" views.
  - Fixed `_record_mapping_audit._norm` None-safe sort (was raising TypeError on new entries).
  - These flags are the SAME source of truth Phase 1 cross-approval reads (`_center_cross_approvers`), so toggling Cross Approval here directly controls who can cross-approve.
- **Frontend**: new `MappingManagerDialog.jsx` (reusable). Center rows → "Mappings" (Network icon) opens Partners/Staff tabs with +Add (searchable picker), Cross-Approval Switch, active toggle, remove. Partner rows → "Assigned Centers" (+Add Center, remove). Staff Profile → "Center & Role Mapping" tab → "Manage Centers" (admin/manager/hr). Hooked into `Entities.jsx` + `StaffProfile.jsx`.
- **Verified**: center↔partner add/patch(cross_approval)/delete, center↔staff add/list/delete, partner + staff reverse — all curl 200 + reflected. Dialogs render (screenshots). Self-tested (curl + screenshots), not full testing_agent.
- **PENDING**: Phase 3 attendance Late chip, Phase 4 center-security regression sweep.


### Phase 95 — Partner Cross-Approval Fix + "Pending at ___" Label (Phase 1 of 4, Done Jun 2026)
- **Context**: Big multi-part request (cross-approval fix, Pending-at label, Center↔Partner↔Staff mapping UI, center security sweep, attendance Late chip). User approved build order: P1 cross-approval+label → P2 mapping UI → P3 attendance Late → P4 security sweep. Data model confirmed: extend `center.mappings[]` entries with `active`+`cross_approval` flags (default ON); staff `assigned_center_ids[]` for multi-center.
- **Root cause of cross-approval bug**: `_centers_for_partner()` derived a partner's centres only from batches / legacy `centers.partner_id` / txn-history — it IGNORED the new `centers.mappings[].partner_id`. So a partner mapped to a centre only via the mapping UI (no txn/batch history) had an empty centre set → co-partner's txn was neither in scope nor cross-approvable.
- **Fix (`server.py`, Phase 1)**:
  - `_centers_for_partner` now also reads `centers.mappings[].partner_id` (honours per-entry `active`).
  - New helpers `_center_cross_approvers(center_id)` (active + cross_approval partners at a centre) and `_attach_pending_at(docs)` (batched, 3 queries).
  - `_can_partner_approve` — gate now uses computed `assigned_center_ids ∪ _associated_center_ids`; PRIMARY eligibility rule = approver is an active cross-approval partner mapped to the txn's centre (source of truth = `center.mappings`). Creator still blocked from self-approval.
  - `TransactionOut.pending_at` (computed) + `list_transactions` attaches it. Frontend `Transactions.jsx` shows "Pending at <name/Admin>" under the status pill and in the details-drawer history.
- **Verified (API + screenshot)**: seeded 2 partners + 1 centre (both mapped, cross_approval ON) + partner users. Shailendra creates pending txn → Rajiv SEES it (pending_at="Rajiv") and APPROVES (approval_via=partner_cross); Shailendra CANNOT self-approve ("cannot approve a transaction you created"); Rajiv mapping set inactive → txn no longer visible + approve blocked. Seed data cleaned up after.
- **PENDING (P2-P4)**: Mapping UI on Center/Partner/Staff detail pages (with active+cross_approval toggles, +Add Partner/Staff/Center), attendance Late chip (shift-based), full center-security regression sweep.


### Phase 94 — Attendance "Incomplete" Bug Fix (both punches → Present, Done Jun 2026)
- **Bug (user)**: Jab morning check-in AND evening check-out dono record the (incl. auto-closed 5:30 PM checkout), row phir bhi "INCOMPLETE" dikhta tha aur salary me absent count hota tha.
- **Root cause**: raw `status` "auto_closed"/"incomplete" ko display + payroll logic check-out hone par bhi incomplete/absent maanta tha.
- **Fix (`server.py`) — rule: check_in_at AND check_out_at dono ho → PRESENT** (auto-closed checkout bhi present; lateness alag se shift-rule deduction se handle hota hai):
  - Salary daily view (`staff_salary_summary` ~9146), attendance list `effective_status` (~6558), staff dashboard `_effective_status` (~10916), aur payroll count `_compute_payroll_for_staff` (~8598) — sab me both-punch → present.
- **Verified**: staff 3a9f089b Aug-2026 → present_days 0→1, salary page par koi INCOMPLETE label nahi (API + screenshot).


### Phase 93 — Transactions Page Enterprise UI/UX Redesign (Done, Jun 2026)
- **User ask**: Redesign Finance & Accounting → Transactions into a premium enterprise ERP look (reference image), UI-ONLY — no backend/business/RBAC/API changes. 100% existing functionality retained.
- **Frontend (`Transactions.jsx` full rewrite, all existing handlers preserved verbatim: load/approve/reject/partner-approve/bulk-approve/bulk-delete/save/remove/export/import)**:
  - Header: breadcrumb (Finance & Accounting → Transactions) + title + subtitle; Print/Export CSV/Import CSV + New Transaction as a dropdown (Expense/Income/Investment — only existing types).
  - 5 interactive KPI cards (Total Transactions, Total Expense ₹, Pending, Approved, Rejected) computed from REAL loaded data; clicking a card filters the table (status client-side; expense→type filter).
  - Smart filter toolbar: search (client), Status, Type, Advanced Filters right-drawer (company/partner/center/project + date range), active filter chips + Clear All.
  - Redesigned table: checkbox, Date (sortable), Transaction (type badge + description + attachment/items indicators), Organization, Amount (prominent/colored), Allocation (partner/center/project), Status pills (green/amber/red/neutral), Actions. Sticky header, row hover, row-click opens right Details Drawer.
  - Transaction Details Drawer (Sheet): TRX id, title/amount/status, tabs Overview/Attachments/History (timeline from created_at + paid_by + status), bottom actions gated by existing RBAC (Approve/Reject/Partner-Approve/Edit/Delete).
  - Bulk contextual toolbar (admin): N selected + Approve/Export/Delete.
  - View options Table/Compact/Grouped (presentation only; Grouped = group-by-status). Client pagination (rows-per-page 10/25/50/100, page numbers, prev/next, "Showing X–Y of N").
- **Verified (iteration_78)**: 100% frontend, all 15 flows pass, 0 bugs/regressions. NOTE: no backend/API/RBAC changes. Follow-up idea: server-side pagination for very large tenants (client currently loads full list).


### Phase 92 — Security Audit Fixes (SEC-001..004) + Full-Page Staff Profile (Done, Jun 2026)
- **Security fixes (all verified, iteration_77 — 19/19, 0 critical)**:
  - **SEC-001 [CRITICAL]**: public `POST /api/auth/register` now hardcodes `safe_role = "viewer"` (previously only blocked admin/super_admin/company_admin, letting anyone self-grant senior_manager = org-wide access). Privileged roles ONLY via admin `POST /auth/users`.
  - **SEC-002 [HIGH]**: `GET /api/payments/{pid}/voucher/download` now gated to `VOUCHER_ROLES` (or creator) + `_assert_center_access`.
  - **SEC-003 [HIGH]**: `_assert_center_access` added to write/action twins — invoices `PATCH`/`POST /advance`/`GET /audit`, `PATCH /work-orders/{wid}`, `PATCH /batch-targets/{tid}` + `GET /{tid}/batches`, bank-guarantees `PATCH`/`POST /status`/`PATCH /renew`. Body center_id (WO/target) also validated in-scope.
  - **SEC-004 [MEDIUM]**: candidate `PATCH` fail-open replaced with fail-closed `_assert_center_access`, moved to run BEFORE project/body validation (ordering bug found+fixed by testing agent).
- **Full-Page Staff Profile (`/hrms/staff/:sid/profile`, new `StaffProfile.jsx`)**:
  - Backend `GET /api/staff/{sid}/profile` — center-scoped, salary-stripped for non-salary roles, enriches center_name/reports_to_name/user_role. `/payroll` gained `staff_id` filter.
  - Header (photo/initials, name, Employee ID, Center, Role, Status) + left section nav: Basic Information, HR Information, Center & Role Mapping, Attendance (month nav + P/A/H/L summary), Leave, Payroll (salary-roles only), Documents (admin/hr/manager/accountant only), Performance + Activity Timeline ("Coming soon" empty states).
  - HRMS "View Profile" (IdCard) button now navigates to the page (dialog removed).
  - **Verified**: admin sees Payroll+Documents+PAN/Aadhaar & salary; center_manager sees NO Payroll/Documents tabs, NO PAN/Aadhaar, salary absent from API (screenshots).


### Phase 91 — HRMS Staff: Salary Visibility Control + Universal Profile Card (Done, Jun 2026)
- **User ask**: Salary sirf admin/hr/accountant/partner (+ manager/senior_manager per follow-up) ko dikhe; center_manager ko NAHI. Aur ek fixed set of employee master details (Emp ID, Name, Photo, Gender, DOB, Mobile, Email, Joining Date, Employment Status, Employment Type, Designation, Department, Reporting Manager) SAB roles ko dikhe.
- **Backend (`server.py`)**:
  - `SALARY_VISIBLE_ROLES = {admin, hr, accountant, partner, manager, senior_manager}`. `list_staff` strips `monthly_salary`/`per_day_rate` from the JSON for other roles (server-side, not UI-only); `staff_export_csv` blanks those columns too.
  - `StaffIn` gained `department` + `employment_type` ("full_time"|"part_time"|"contract"). `list_staff` also enriches `reports_to_name`.
- **Frontend (`HRMS.jsx`)**:
  - `canViewSalary` gate hides Salary + Per-Day columns for center_manager/viewer/etc. Add/Edit Staff form gained Department (text) + Employment Type (select).
  - New `StaffProfileDialog` — "View Profile" (IdCard) button on EVERY row, all roles → read-only card (photo, status auto-derived Active/Inactive/Resigned/Terminated, designation, department, employment type, gender, DOB, joining date, mobile, email, reporting manager). No salary/bank.
- **Verified**: center_manager `/api/staff` omits salary keys + UI shows no Salary/Per-Day columns + profile card renders (screenshot); admin still gets salary (curl). test account `cmtest_salary@x.com`.


### Phase 90 — Center Data Isolation Security Audit Fixes (Done, Jun 2026)
- **User Golden Rule (reaffirmed)**: ANY role's user linked to a center sees ONLY that center's data; if linked to multiple centers, sees all of those. Enforced server-side, never trusting frontend center_id.
- **New shared guards (`server.py` ~line 1050)**:
  - `_assert_center_access(user, center_id)` — enrich user → `_scoped_center_ids(user)`; `None` = global pass; else `center_id` must be in allowed set else `403`. Fail-closed for docs with null center_id (scoped users blocked).
  - `_apply_invoice_scope(query, user)` — injects `{center_id: {$in: allowed}}` into invoice queries; rejects explicit out-of-scope `center_id` filter with 403.
- **SEC-001 [HIGH] Invoices** — `GET /api/invoices`, `/api/invoices/export.csv`, `/api/invoices/dashboard`, `GET /api/invoices/{iid}` now center-scoped.
- **SEC-002 [HIGH] IDOR detail APIs** — `GET /api/candidates/{cid}`, `/api/payments/{pid}`, `/api/quotations/{qid}` now assert center access on fetched doc.
- **SEC-003 [MEDIUM] Secondary** — `GET /api/batch-targets/{tid}`, `/api/work-orders/{wid}` (replaced partial center_manager-only guard), `/api/bank-guarantees/{bid}/chain` now assert center access.
- **Verified (testing agent iteration_76)**: 14/14 passed, 0 critical. Cross-center GET-by-id + list-with-out-of-scope-center_id → 403 for scoped user; admin (global) → 200 everywhere; no regressions. (Invoice-by-id 200-branch not exercised — invoices collection empty in this env.)


### Phase 77 — CRITICAL: Strict Center-wise Data Isolation (Done, Jun 2026)
- **Bug (user)**: A finance-visible but center-scoped user (role accountant/hr mapped to ONE center) saw OTHER centers' data on the Partner Settlement dashboard (BOCWW Garhwa/Gumla/Jamtara/Pakur etc.).
- **Root cause**: `settlement_view` (and siblings) scoped only by `assigned_partner_id` (partner role). A non-partner center-scoped finance role fell into the `else` branch → ALL centers. Several dashboard/report endpoints also had a `center_id` **override** bypass and/or discarded the user (`Depends(_)`) with no scope.
- **Fix (`server.py`, enforced at query/API level — never trusts frontend center_id)**:
  - `settlement_view`, `settlement_contributing_txns` (`/dashboard/settlement/txns`), `settlement_history`, `record_settlement`, `delete_settlement_record` → all now use `_scoped_center_ids(user)`; unmapped `center_id` ⇒ 403; no-param ⇒ only mapped centers.
  - `dashboard_summary` → a supplied `center_id` may only narrow within scope (403 if unmapped), removed the override.
  - `payment_dashboard_summary` → rewritten to scope EVERY role via `_scoped_center_ids` (base + upcoming_filter), removed the `center_id` override bypass.
  - New helper `_scope_staff_query(user, staff_q, center_id)`; applied to `/reports/attendance`, `/reports/consolidated`, and `/reports/payroll` (staff-ids in scope) — these previously discarded the user and returned all centers.
  - Rule: effective access = ROLE permission ∩ user's mapped centers. Head-level (`admin`/`senior_manager`) = `_scoped_center_ids` None ⇒ unrestricted (regression-safe).
- **Verified**: curl + testing agent iteration_64 (regression test file `/app/backend/tests/test_center_scope_isolation.py`, 17/17 pass, 1 data-skip): scoped accountant sees exactly 1 settlement center vs admin 132; unmapped `center_id` ⇒ 403 across settlement / txns / history / summary / payment-summary / attendance / consolidated; admin can pass any center_id without 403; frontend dashboard shows only the mapped center.
- **Follow-up (NOT yet scoped)**: `/api/mis/*` (SIP-centers live overview) is a **separate SIP dataset** with its own center codes — flagged for a dedicated isolation pass (do carefully to avoid MIS regression). Also broadly re-audit any future module against `_scoped_center_ids`.

### Phase 76 — Trial Expiry Reminders (WhatsApp + SMS + Email) (Done, Jun 2026)
- **User (Hindi)**: Trial ke aakhri 3 din me WhatsApp/email reminder bhejein.
- **Backend `server.py`**: `_trial_dispatch_reminders(force)` + `_trial_reminder_scheduler` (registered at startup, ticks every 6h). Finds `company_trials` with `ends_at` within the next 3 days (days_left 3/2/1), computes days_left, resolves **decision-maker** recipients only (admin/company_admin/owner/accountant/manager/senior_manager/partner/reporting_authority + the trial starter — not every staff member), and sends: Email (Resend, chunked ≤50 recipients per call), WhatsApp + SMS (Twilio). Idempotent per `{date}:{company}:{days_left}` via `trial_reminder_log` (max one ping/day/milestone). Manual Super-Admin trigger: `POST /api/subscription/trials/dispatch-reminders?force=true`.
- **Backend `email_utils.py`**: `send_trial_expiry_reminder(to_emails, company_name, days_left, ends_at, portal_url)` — amber-styled email with a Subscribe CTA.
- **Verified (real sends via curl)**: trial ending in 2 days → identified; email delivered to 37 decision-makers (chunked, Resend `to`-50-limit fixed); WhatsApp+SMS sent via Twilio; second run skipped (idempotency marker written). No frontend change (background job).

### Phase 75 — 10-Day Free Trial + Payment-gated Module Locking (Done, Jun 2026)
- **User (Hindi)**: Jab tak payment na ho saare modules LOCK; ek 10-day free trial jo saare modules unlock kare; trial khatam → lock; payment/trial kisi bhi role/person kar sakta hai.
- **Backend `subscription_service.py`**: `TRIAL_DAYS=10`; `db.company_trials` (one trial per company); `get_active_trial` / `get_trial` / `start_trial`. `compute_entitled_modules` ab active trial hone par saare active catalog modules ko `status:"trial"` ke saath unlock kar deta hai. (Default: no entitlement + no trial → sab locked; existing lock UI `scope.blocked_modules` se drive hota hai.)
- **Backend `server.py`**: `_trial_status(user)` (eligible/active/used + days_left); `trial` field added to `/api/auth/me/scope` and `/api/subscription/me`; new `POST /api/subscription/start-trial` (`get_current_user`, company-scoped, 400 no-company, 409 already-used). Order create `/subscription/orders` already `get_current_user` → any role can pay.
- **Frontend**: `AuthContext.startTrial()`; new `TrialBanner.jsx` (eligible → Start Free Trial + Buy Now; active → days-left + Subscribe Now; expired+locked → Pay to Unlock) rendered atop Layout main content. Existing lock icons + Module Locked page unchanged (auto-unlock during trial).
- **Verified**: backend curl (before 8 locked → start-trial → 0 locked/active/10 days → forced expiry re-locks → 409 on re-start) + testing agent iteration_63 100% backend+frontend (eligible banner → Start → active banner + locks vanish + locked pages render real content; Subscribe Now → /subscription as company_admin; super admin no banner/no locks).

### Phase 74 — Pending Approvals: Requester Details on every card (Done, Jun 2026)
- **Bug (user, Hindi)**: Approval cards showed only reason/date/step but NOT who raised the request. Root cause: `GET /api/approvals/pending` only returned `requester_name` (often null for regularisations) and the frontend card had no dedicated requester block.
- **Backend `server.py` (`list_pending_approvals`)**: after building the list, batch-enriches EVERY item (all approval types) with a `requester` object `{name, employee_code, department, designation}` resolved from `db.staff` (by `staff_id`, else by `user_id == created_by`) with fallback to `db.users`. `requester_name`/`requester_id` preserved (backward compatible). Note: `staff` has no `department` field in the current schema → department resolves to null → UI shows N/A.
- **Frontend `PendingApprovals.jsx`**: replaced the inline requester line with a 'Requester Details' box (`data-testid=requester-details-<request_id>`) showing Requester Name, Employee ID, Department, Designation with `N/A` fallback; kept the center chip; matched existing card styling; imported `User as UserIcon`.
- **Verified**: backend curl (219 items all carry `requester`; 185 have employee_code; regularisation 4d4e2aeb → TEST_L1Mgr_e0e668 / EMP-2026-0182 / Manager / dept N/A). Testing agent iteration_62 — 100% backend + frontend: details render across all types + multiple cards, N/A fallback safe, Reject regression worked (219→218 via /approvals/act), Approve/Send Back dialogs intact, mobile 390px wraps cleanly, no console errors.

### Phase 73 — Center Reports (per-center Investment/Income/Expense/P&L) (Done, Jun 2026)
- **User asked (Hindi)**: Har center ka investment/expense/P&L summary Center Management page par dikhaayein.
- **Backend `server.py`**: new `GET /api/centers/reports?company_id=&include_pending=&start=&end=` (on `sub_api`, gated admin/company_admin, `_can_manage_company`). Aggregates `db.transactions` by `center_id` (types investment/income/expense; status=approved by default, `!= rejected` when include_pending). Returns `{company_id, totals:{investment,income,expense,profit}, centers:[{center_code,name,access_status,investment,income,expense,profit}]}` — every center included (even zero-activity); profit = income − expense. Company Admin auto-scoped to own company; 400 if company_id missing (super admin); 403 cross-company.
- **Frontend `CenterManagement.jsx`**: new "Financial Summary" section below the centers table — 4 company total cards (Investment/Income/Expense/Profit, loss in red) + per-center P&L table (INR-formatted, red/green profit) + "Include pending entries" toggle that refetches and switches the header label.
- **Verified**: backend curl (correct totals, 400/403 guards, include_pending); testing agent iteration_61 frontend 100% — section renders, totals match (Expense ₹6,000 / Profit -₹6,000 in red), per-center row correct, toggle refetches; Add Center + Manage Access regression clean.

### Phase 72.1 — Save Memberships 500 fix (Done, Jun 2026)
- **Bug**: `PUT /api/users/{uid}/memberships` threw 500 `DuplicateKeyError E11000` on `user_centers (user_id, center_id)` — the endpoint inserted one row per center with no de-dup or company-center validation, so a repeated/cross-company center id crashed the request (root cause reproduced via curl).
- **Fix (`server.py user_memberships_set`)**: all reads/validation happen before any write; duplicate company rows collapse (last wins); center ids are de-duped within a company AND globally per user; each center is validated against the company it is claimed under (unknown / cross-company ids are silently dropped); write runs inside a MongoDB transaction when supported, with a safe pre-validated sequential fallback for standalone mongod (deployment is standalone — no replica set).
- **Verified via curl**: multiple companies, same-role & different-role, per-company selected centers, duplicate centers (was the crash), cross-company centers, invalid ids, empty/clear, and GET-after-PUT persistence — all HTTP 200, saved data reopens correctly, no tracebacks.


### Phase 71 — Grant Free Access: Multi-Module Entitlement Bug Fix (Done, Feb 2026)
- **User reported**: Super Admin ne "Grant Free Access" se Finance/MIS/Accounting modules enable karne ki koshish ki lekin sirf `hr` module active hua.
- **Root cause**: `subscription_service._extend_or_create_entitlement` ka idempotency check sirf `source_order_id` pe scoped tha. Ek order kai modules grant karta hai (base `hr` + selected features); pehle module ke insert ke baad, loop mein aane wale saare aage ke modules ko same `source_order_id` match mila aur wo `return existing` se short-circuit ho gaye — DB mein sirf pehla module actually create hua.
- **Fix**: Idempotency check ab `(source_order_id, module)` composite key pe scoped hai — file: `/app/backend/subscription_service.py`.
- **Impact**: `apply_bundle_entitlements` ko use karne wale saare code paths (paid Razorpay subscriptions + free grants + top-ups) ab har requested module ke liye separate entitlement rows create karte hain.
- **Verification**: curl POST `/api/companies-admin/grant-free-access` ne 9 unique modules return kiye (`approvals, attendance, bank_guarantee, finance, hr, mis, notifications, payroll, reports`), DB mein saare 9 rows confirmed. UI screenshot ne "Select All" button + 8/8 pre-checked features + purple selected-state confirm kiya.
- **Frontend already fixed pehle**: `CompaniesAdmin.jsx` mein features default se pre-selected + "Select All" button (backup for manual reselect).


### Phase 70 — Super Admin / Company Admin RBAC & Tenant Isolation (Done, Feb 2026)
- **User asked**: Rename "Admin" role to "Super Admin"; introduce new "Company Admin" role restricted to its own company_id. 18-point spec covering registration hardening, license enforcement, cross-company isolation, hierarchical role management, super-admin cross-tenant dashboard, and backwards compatibility.
- **Design decision (minimally invasive)**: Rather than rewriting 100+ backend `require_role("admin")` calls and 30+ frontend `role === "admin"` checks, we keep `admin` as the internal canonical role string and present it as **"Super Admin"** everywhere in the UI. `super_admin` is accepted as an input alias (normalized to `admin` before storage). `company_admin` is a brand-new distinct role.
- **Backend `/app/backend/server.py`**:
  - `ROLE_LITERAL` now includes `super_admin` (input alias) + `company_admin` (new). Startup migration: any legacy `"super_admin"` row is normalized back to `"admin"` so DB stays canonical.
  - `require_role(*roles)` — transparently aliases `"admin"` ↔ `"super_admin"`, so every legacy call still works and callers can pass either.
  - `SUPER_ADMIN_ROLES = {"admin","super_admin"}`, `COMPANY_ADMIN_ROLES = {"company_admin"}` + helpers `is_super_admin()`, `is_company_admin()`.
  - `FINANCE_VISIBLE_ROLES` gains `super_admin` + `company_admin` so tenant-scoped admins keep finance visibility.
  - `POST /auth/register` — privileged roles (`admin`, `super_admin`, `company_admin`) can NEVER be self-signed-up. Silently downgraded to `viewer`. Meets security rule §8.
  - `POST /auth/users` (admin+company_admin gated):
    - Company Admin's `company_id` is ALWAYS derived from the session and OVERRIDES whatever the client sent (rule §1, §7).
    - Only Super Admin can create another Super Admin or a Company Admin (rule §5, §6).
    - License role check (`hrms_staff`/`role_user_staff`) still enforced when supplied; not required for privileged roles.
    - `super_admin` role input normalized to internal `admin` before insert.
  - `PATCH /auth/users/{uid}`:
    - Company Admin can ONLY edit users of their own `company_id` (rule §4 — cross-company edits blocked by 403).
    - Company Admin cannot promote to Super Admin / Company Admin, and cannot edit a Super Admin (rule §5).
    - `super_admin` role input normalized to `admin`.
  - `GET /auth/users`:
    - Super Admin sees all rows, optionally filtered via `?company_id=&role=` query params.
    - Company Admin sees ONLY rows where `company_id == their company_id` (backend-enforced, not just UI hiding). Rule §3, §4.
    - Attaches `company_code` per row (via `db.companies` lookup) so the UI table can show it.
  - `GET /companies-admin/list` — hard-locked to `require_role("admin")` (Super Admin only). Company Admin gets 403.
  - `_scoped_center_ids(user)` — new branch for `company_admin`: returns the list of centers belonging to their `company_id` (populated via lazy enrichment).
  - `_enrich_user_with_associations(user)` — new branch for `company_admin`: computes `user._associated_center_ids = [ids of every center whose company_id == user.company_id]`. Runs on-demand in the auth scope endpoint.
  - `GET /auth/me/scope`:
    - Skips the "No Centers Assigned" banner for `company_admin` (scoped by company, not by center).
    - Enriches company_admin lazily on the way through so their center list resolves.
- **Frontend**:
  - `/app/frontend/src/pages/Register.jsx` — role dropdown NO LONGER offers `Admin` / `Super Admin` / `Company Admin`. Only offers Manager, Senior Manager, Center Manager, Center Staff, Partner, Accountant, HR, Viewer. Backend also fail-closed.
  - `/app/frontend/src/pages/Users.jsx`:
    - New `ROLE_LABELS` map: `admin → "Super Admin"`, `super_admin → "Super Admin"` (tolerance), `company_admin → "Company Admin"`, and pretty-print for every other role.
    - Role dropdown now filters `admin` and `company_admin` out when the caller isn't a Super Admin.
    - Super Admin gets an extra `Company` column showing `company_code` (COMP-NNNNN) per row.
    - Both Super Admin and Company Admin (`isAdmin`) can access the create-user form; only Super Admin (`isSuperAdmin`) sees privileged-role options.
  - `/app/frontend/src/components/Layout.jsx`:
    - New `isAnyAdmin` (admin OR company_admin) + `isSuperAdmin` (admin only) helpers. Every `adminOnly` sidebar item, plus `hrOrAdmin`, `accountingOnly`, `hrLineOnly`, `candidateAccess`, `bgAccess`, `misAccess`, `adminAccountantOnly`, `invoiceAccess`, `batchMgmtAccess`, now also grant Company Admin access.
    - `superAdminOnly` flag introduced. `/companies-admin` is `superAdminOnly` — Company Admin never sees it (rule §14 fulfilled from the CA side).
    - `/subscription` remains `adminOnly` (both admin tiers can buy licenses for their tenant).
- **Verified end-to-end (curl + browser)**:
  - Super Admin login → role `admin` returned; UI renders badge **"Super Admin"** on every row and Users page.
  - Public register with `role: "super_admin"` → user created as `viewer` (privilege escalation blocked).
  - Super Admin creates a Company Admin for COMP-10001 → stored role `company_admin`, `company_id: 6447...`.
  - Company Admin login → role `company_admin`, `needs_mapping: False` (no yellow banner), sidebar hides `/companies-admin`.
  - Company Admin `GET /auth/users` → 762 users returned, ALL scoped to COMP-10001. No cross-tenant leak.
  - Company Admin `POST /auth/users {company_id: OTHER_CID, role: manager}` → user actually persisted with CA's own `company_id`, NOT the payload's OTHER_CID. Rule §7 upheld.
  - Company Admin `POST /auth/users {role: super_admin}` → HTTP 403 "Only Super Admin can create Super Admin or Company Admin".
  - Company Admin `GET /companies-admin/list` → HTTP 403.
  - Legacy `admin` in DB → renders as **"Super Admin"** in UI table + user badges. Login/auth intact. No existing users broken.
- **Acceptance criteria (all 10)**:
  1. Super Admin logs in → can access all companies ✅ 
  2. Company Admin logs in → sees only own company data ✅ 
  3. Cross-company access attempt → HTTP 403 ✅ 
  4. Payload-tampered `company_id` → OVERRIDDEN by backend ✅ 
  5. Company Admin creates Manager → auto company_id ✅ 
  6. Company Admin tries other-company user → forced to own ✅ 
  7. Company Admin tries super_admin role → 403 ✅ 
  8. Super Admin creates Company B Admin → CA locked to Company B ✅ 
  9. Existing admin renders as Super Admin ✅ 
  10. No regressions on existing users / auth / navigation ✅



### Phase 69 — Company Codes + Role-based Licenses + Multi-tenant Foundation (Done, Feb 2026)
- **User asked (18-point spec)**: Every company must have unique `Company Code` (COMP-NNNNN). Replace single Staff Limit with role-wise licenses (HRMS Staff + Role/User Staff). Purchases must be permanently linked to `company_id` + `company_code`. License enforcement: block user creation when the role's ceiling is reached (exact copy: "HRMS Staff license limit reached. You have used X of Y available licenses. Please purchase additional licenses."). Deactivation must free the license. "Buy Additional Licenses" flow. Super Admin cross-company view. Super Admin editable pricing.
- **User's 3 clarifications**: Super admin edits pricing themselves (I seeded defaults + editor). Full multi-tenancy scope (foundational). Super Admin cross-company view at `/companies-admin`.
- **Backend `/app/backend/subscription_service.py`**:
  - New `LICENSE_ROLES = ["hrms_staff", "role_user_staff"]` + `DEFAULT_LICENSE_PRICING` seeded at ₹99/staff/month (HRMS) and ₹49/staff/month (Role/User). Editable by super admin.
  - `seed_catalog()` also seeds `db.subscription_license_pricing`.
  - `get_pricing_catalog()` now returns `{license_pricing, plans, features, addons, gst_rate_pct}`.
  - `compute_quote()` re-written to accept `{hrms_staff_qty, role_user_staff_qty, feature_codes, addon_codes, staff_count_for_bgv, duration_months, coupon_code}` — server-authoritative, GST 18% on post-discount taxable.
  - `apply_bundle_entitlements()` now ALSO credits `db.company_licenses` for both roles atomically on payment capture. Idempotent via `source_order_id`.
- **Backend `/app/backend/server.py`**:
  - `_next_company_code()` — atomic `db.counters` sequence (COMP-10001, COMP-10002…). `_backfill_company_codes()` runs at startup and back-fills every existing company (73 backfilled in preview DB). Unique partial-filter index on `companies.company_code`.
  - `_backfill_user_company_ids()` — best-effort resolves `user.company_id` from their first `assigned_center → center.company_id`, falls back to first company. Prevents license checks from crashing for legacy users.
  - `POST /entities/company` — auto-assigns `company_code` on creation. Never accepts client-supplied codes.
  - `POST /subscription/quote` + `POST /subscription/orders` — accept role qtys instead of plan_code. Order docs now persist `company_code`, `company_name`, `hrms_staff_qty`, `role_user_staff_qty`, `gst_invoice`, `gstin`, `is_topup`, full `line_items[]`. Company ID always derived from the authenticated user (security rule §16).
  - `POST /subscription/verify` — on capture, calls `apply_bundle_entitlements` to increment `company_licenses.purchased_qty` for both roles + activate modules.
  - `GET /subscription/licenses` — returns `{company, licenses[{role, name, price_paise, purchased_qty, used_qty, available_qty}]}`. Refreshes `used_qty` on every call by counting active users with matching `license_role`.
  - `_check_license_available(company_id, role)` — raises HTTP 402 with **exact business message** ("HRMS Staff license limit reached. You have used X of Y available licenses. Please purchase additional licenses.") when the ceiling is hit.
  - New `POST /auth/users` — admin creates user + enforces license via `_check_license_available`; `company_id` derived from admin's session. Legacy `POST /auth/register` (public self-register) kept intact for first-admin bootstrap.
  - `PATCH /auth/users/{uid}` — enforces license on re-activation OR license_role change, then calls `_refresh_license_usage(company_id)` so deactivation frees the license immediately.
  - Admin pricing endpoints (super-admin only): `GET/PATCH /subscription/admin/license-pricing`, `PATCH /subscription/admin/features`, `PATCH /subscription/admin/addons`.
  - `POST/GET/DELETE /subscription/admin/coupons` — coupon CRUD (unchanged).
  - `GET /companies-admin/list` — full cross-company table for super admin with `q`+`status` filters. Returns per-row: company_name/code, active modules, HRMS/Role used-vs-bought, subscription_status ("active"/"expired"), expiry_date, latest_payment_id + amount + captured_at.
  - New Pydantic models: `UserOut`+`RegisterIn`+`UserUpdateIn` gained `company_id`, `company_code`, `license_role`, `is_active`. `AdminCreateUserIn` for `POST /auth/users`.
- **Data model additions (Mongo)**:
  - `counters` — atomic sequence for `company_code_seq`.
  - `companies` — unique `company_code` (COMP-NNNNN) partial-filter index.
  - `users` — new fields `company_id`, `license_role` ("hrms_staff" | "role_user_staff"), `is_active`.
  - `company_licenses` — `{company_id, role, purchased_qty, used_qty, last_order_id, updated_at}` with unique compound index on `(company_id, role)`.
  - `subscription_license_pricing` — `{role, name, description, price_paise, sort, is_active}` editable by super admin.
- **Frontend `/app/frontend/src/pages/SubscriptionBilling.jsx`** (major rewrite while keeping the SalaryBox design):
  - **License Usage banner** at top: company name + `Company Code: COMP-10001`, KPI tiles (Total Licenses / Used / Available), progress bars per role (green ≤ 70%, amber 70-89%, red ≥ 90%). Each role row has a "Buy More" button that pre-fills the cart for that role only and shows an amber "Additional license purchase mode" banner (features/addons cleared, isTopup=true).
  - **Staff & User Licenses card** — replaces the old dropdown. Two stepper cards side-by-side:
    - HRMS Staff (blue) — [-] qty [+], `₹99 / staff / month` displayed
    - Role/User Staff (emerald) — [-] qty [+], `₹49 / staff / month`
  - **Order Summary** now shows Company + Company Code at the top. Line-items enumerate: `LICENSE HRMS Staff × 20 × 1mo ₹1,980`, `LICENSE Role/User Staff × 5 × 1mo ₹245`, plus features/addons.
  - Coupon + GST invoice + Continue to Pay preserved. Sticky on desktop (`lg:sticky lg:top-4`).
  - "Edit Pricing" button (admin only) opens a `PricingEditorDialog` where super admin can edit all license/feature/addon prices in one shot (batch PATCH). Live pricing reload after save.
  - "Payment History" tab — new columns: Order ID / Company Code / HRMS / Role/User / Features / Total / GST Invoice (with GSTIN) / Status / Date.
- **Frontend `/app/frontend/src/pages/CompaniesAdmin.jsx`** (NEW):
  - Route: `/companies-admin` (admin only).
  - Header: "Super Admin" chip → "Companies" heading.
  - 5 KPI tiles: Companies count / Active Subs / HRMS licenses used-of-bought (sys-wide) / Role/User licenses used-of-bought / Recent Revenue.
  - Search input (name / code / payment id) + status Select (All / Active / Expired), Refresh + CSV export.
  - Table: Company · Code (COMP-NNNNN) · Modules · HRMS Used/Bought · Role/User Used/Bought · Status · Expiry · Latest Payment (id + amount + date).
- **Frontend `/app/frontend/src/components/Layout.jsx`** — sidebar `grp_subscription` gains a second item **Companies (Super Admin)** with a Building icon (admin-only). i18n keys added for `companies_admin` in EN + HI.
- **Verified E2E**:
  - `GET /subscription/licenses` (admin session) → `{company: {name: "Valeur Fabtex Pvt Ltd", company_code: "COMP-10001"}, licenses: [{role:"hrms_staff", purchased:0, used:0}, {role:"role_user_staff", purchased:0, used:0}]}`.
  - `POST /auth/users {license_role:"hrms_staff"}` with 0 purchased licenses → **HTTP 402** with exact message `"HRMS Staff license limit reached. You have used 0 of 0 available licenses. Please purchase additional licenses."` (user-verbatim string).
  - After granting HRMS=2 licenses: 2 users created (HTTP 200, both stamped with `company_code: COMP-10001`), 3rd → HTTP 402 `"used 2 of 2"`. Deactivate user 1 → `used_qty` auto-drops to 1 → 3rd user creation now succeeds. Regression-clean.
  - `GET /companies-admin/list` → 73 companies rendered with sequential COMP-10001…COMP-10073 codes.
  - Live cart quote: `20 HRMS × ₹99 × 1mo + 5 Role/User × ₹49 × 1mo + Payroll ₹699 = ₹2,924 subtotal + ₹526.32 GST = ₹3,450.32 grand total`. Company Code COMP-10001 rendered in summary.
- **Preserved (not touched)**: Coupons, GST, Features, Addons, Duration, existing Razorpay flow, existing HRMS modules, existing navigation & auth.
- **Deferred (Phase 70+)**: Full row-level `company_id` scoping across every existing HRMS/payroll/attendance/transaction row (already effectively scoped via center/role). Login-with-Company-Code (frontend supports plain email login today; adding a Company-Code login field is a small future add-on).



### Phase 68 — SalaryBox-style Cart, Coupons & Standalone Sidebar (Done, Feb 2026)
- **User asked (Hinglish)**: "buyer ko payment show karte rahe as per select staff and feature and add ones aur subscription aur billing ko alag menu banaye approval & workflow se nikal kar" — SalaryBox-style dynamic cart with staff-tier plan + features + addons + coupons + GST + live-updating price. And move Subscription & Billing out of the Approvals group into its own standalone sidebar menu.
- **Backend `/app/backend/subscription_service.py`** (major rewrite):
  1. **`DEFAULT_PLANS`** — 8 staff-limit tiers (5→Unlimited): Starter ₹499, Basic ₹899, Growth ₹1,499, Team ₹2,999, Business ₹4,999, Enterprise ₹8,999, Scale ₹19,999, Unlimited ₹49,999 /month. Base plan grants `hr` module.
  2. **`DEFAULT_FEATURES`** — 8 stackable feature toggles with updated rates: Payroll ₹699, Attendance Pro ₹499, Approvals ₹299, Bank Guarantee ₹399, SMS/WA ₹249, MIS ₹599, Finance ₹799, Advanced Reports ₹399 /month.
  3. **`DEFAULT_ADDONS`** — 6 optional extras: Background Verification ₹199/staff (one-time), GST Filing ₹999, Priority Support ₹1,499, Custom Domain ₹399, Data Vault ₹499, API Access ₹1,999 /month.
  4. **`seed_catalog()`** — extended to bootstrap `subscription_plans`, `subscription_features`, `subscription_addons` collections idempotently.
  5. **`get_pricing_catalog()`** — single call returns `{plans, features, addons, gst_rate_pct: 18}`.
  6. **`validate_coupon(db, code, subtotal)`** — validates against `db.coupons` (case-insensitive), respects `expires_at`, `max_uses`, `min_subtotal_paise`; supports percentage OR flat-rupee discounts.
  7. **`compute_quote()`** — server-authoritative computation. Accepts `{plan_code, feature_codes, addon_codes, staff_count_for_bgv, duration_months, coupon_code}`, returns full breakdown: `line_items[]`, `subtotal_paise`, `discount_paise`, `coupon_status`, `gst_paise`, `grand_total_paise`. GST 18% applied on `(subtotal − discount)`. Client-supplied amounts NEVER trusted.
  8. **`apply_bundle_entitlements()`** — after payment capture, activates base-plan modules (`hr`) + every feature in the bundle. Addons are recorded on the order doc for ops but don't gate modules.
- **Backend `/app/backend/server.py`** — new endpoints on `sub_api`:
  - `GET /subscription/pricing` — returns full pricing catalog.
  - `POST /subscription/quote` — live quote used by the cart on every state change.
  - `POST /subscription/orders` (replaces old per-module version) — accepts `{plan_code, feature_codes, addon_codes, staff_count_for_bgv, duration_months, coupon_code, gst_invoice, gstin}`. Server re-computes the quote and creates Razorpay order for the recomputed amount (defends against client tampering). Persists the full `line_items[]` + `gst_invoice` + `gstin` on the order doc.
  - `POST /subscription/verify` (updated) — on signature-valid capture, activates every module in the bundle via `apply_bundle_entitlements`, bumps `coupons.used_count` if applicable.
  - `GET /subscription/me` (updated) — returns `entitled_modules`, `active_entitlements[]`, `current_bundle` (latest captured order), `is_admin`.
  - **Admin coupon CRUD**: `POST /subscription/admin/coupons` (create), `GET /subscription/admin/coupons` (list), `DELETE /subscription/admin/coupons/{id}` (soft-disable). Supports percentage OR flat, min-subtotal, max-uses, expires_at. Duplicate codes → 409.
  - `db.coupons` gets a unique index on `code`.
- **Frontend `/app/frontend/src/pages/SubscriptionBilling.jsx`** (complete rewrite): SalaryBox-inspired 2-column layout.
  - **Header**: "Choose Your Plan" (or "Upgrade Plan" if there's a current bundle) + refresh button + blue "You are on {plan}, valid till {date}" banner when a bundle exists.
  - **Tabs**: Build Plan · Coupons · Orders & Audit.
  - **Build Plan tab (buyer's cart)**:
    - **Staff Limit card** — dropdown of all 8 tiers with pricing inline.
    - **Features card** — 8 toggleable feature buttons (blue ring + check when selected), price + description per card. "N feature(s) added" counter + "Clear" button.
    - **Add-ons card** — 6 toggleable addon buttons (emerald ring + check when selected). BGV shows an inline staff-count input (per-staff pricing).
    - **Duration card** — +/− stepper (1-24 months).
    - **Right sticky Order Summary** — full receipt:
      - Line items (plan / feature / addon chips with names + qty + prices, scrollable if long)
      - **Apply Coupon input + Apply button** → shows "LAUNCH50 applied" chip + remove-X when applied
      - Subtotal, Coupon Discount (emerald, if applied), GST (18%), **Grand Total** (2xl bold)
      - "+ Payment handling charges may apply" footnote
      - **GST Invoice Yes/No** radios (Yes → GSTIN input appears)
      - **Continue to Pay** button (opens Razorpay Checkout)
    - Live quote debounced 200ms — every checkbox/dropdown/coupon change re-hits `POST /subscription/quote`.
  - **Coupons tab (admin only)** — table of coupons (code, discount, uses, expires, status, deactivate action). "New Coupon" dialog with Code/Description/Discount-type (%/flat)/Min-subtotal/Max-uses/Expires-on.
  - **Orders & Audit tab (admin only)** — recent orders (order id, plan, features CSV, total, GST invoice chip with GSTIN, status) + audit trail.
- **Frontend `/app/frontend/src/components/Layout.jsx`** — new `grp_subscription` group with only one item ("Subscription & Billing", CreditCard icon, admin-only), placed as the **2nd group right after Dashboard**. Removed from the Approvals & Workflow group.
- **Frontend `/app/frontend/src/lib/i18n.js`** — new EN/HI key `grp_subscription`.
- **Verified end-to-end**:
  - Backend curl: `GET /subscription/pricing` → 8 plans + 8 features + 6 addons + `gst_rate_pct: 18`.
  - Backend curl: `POST /subscription/quote {plan_20 + payroll + attendance + priority}` → subtotal ₹4,196 + GST ₹755.28 = grand total **₹4,951.28**. Line items exposed for UI rendering.
  - Backend curl: `POST /subscription/admin/coupons {code:LAUNCH50, discount_pct:50, max_uses:100}` → coupon created. Quote with `LAUNCH50` on plan_20 + payroll → subtotal ₹2,198 − ₹1,099 discount + ₹197.82 GST = ₹1,296.82.
  - Browser (admin login): Sidebar shows **Subscription** as its own standalone group at position 2. Route `/subscription` renders the SalaryBox-style cart. Toggling Attendance Pro + Payroll + Priority Support updates the right cart to ₹4,951.28 live. Applying LAUNCH50 shows "LAUNCH50 applied" chip and grand total drops to ₹1,296.82. GST invoice Yes reveals GSTIN input. Continue to Pay button enabled for admin.
- **Data model additions (Mongo)**:
  - `subscription_plans` — `{code, name, staff_limit, price_paise, sort, is_active}`
  - `subscription_features` — `{code, name, description, price_paise, is_active}`
  - `subscription_addons` — `{code, name, description, price_paise, unit ("monthly"|"per_staff"), is_recurring, is_active}`
  - `coupons` — `{code (unique), description, discount_pct?, discount_paise?, min_subtotal_paise?, max_uses?, used_count, expires_at?, is_active, created_by}`
  - `orders` — now stores `plan_code, feature_codes[], addon_codes[], staff_limit, subtotal_paise, discount_paise, gst_paise, coupon_code, coupon_applied, gst_invoice, gstin, line_items[]` in addition to Razorpay ids.



### Phase 67 — Emergent Object Storage Integration (Verified + Hardened, Feb 2026)
- **User asked**: Add File & Media Storage integration.
- **Discovery**: Existing app already had a working Emergent Object Storage integration in `/app/backend/server.py` (helper `_put_object` / `_get_object` around lines 1213-1241), driving every file upload path — `/api/files/upload`, staff KYC docs, profile photos, offer letter templates + generated letters, reimbursement receipts + templates, salary slip templates + generated slips, attendance selfies. But it hardcoded the endpoint host and lazy-initialised.
- **Integration playbook (verified)**:
  1. Endpoint: `${INTEGRATION_PROXY_URL}/objstore/api/v1/storage` (falls back to `https://integrations.emergentagent.com`). `INTEGRATION_PROXY_URL` is already provisioned in the pod env.
  2. Auth: `POST /init` with `{"emergent_key": EMERGENT_LLM_KEY}` → returns `storage_key` (cache module-level, refresh on 403).
  3. Upload: `PUT /objects/{path}` with `X-Storage-Key` + `Content-Type` + raw bytes. Path scheme: `{APP_STORAGE_PREFIX}/uploads/{user_id}/{uuid}.{ext}`.
  4. Download: `GET /objects/{path}` with `X-Storage-Key`.
  5. No presigned URLs, no delete API — soft-delete via `db.files.is_deleted` and the private streaming endpoint stays behind auth.
- **Changes applied to `/app/backend/server.py`**:
  1. `STORAGE_BASE` now reads `os.environ.get("INTEGRATION_PROXY_URL")` first (per playbook), with hardcoded fallback for safety.
  2. `_init_storage()` records `_storage_last_error` on failure so the health endpoint surfaces the actual reason.
  3. New `@app.on_event("startup") _init_object_storage` — calls `_init_storage()` eagerly at boot so misconfiguration is loud (`Object storage initialised (https://integrations.emergentagent.com, prefix=finance-tracker)` in `backend.err.log`); a failure logs a warning but does NOT crash the app (per playbook: retry on first upload).
  4. New endpoint `GET /api/files/health` (admin-only) → returns `{storage_base, prefix, initialised, last_error}` for ops visibility. Mounted on the `sub_api` router because the primary `api` router was already `include_router`-ed earlier in the file.
- **Verified end-to-end**:
  - Startup log: `INFO server - Object storage initialised (https://integrations.emergentagent.com, prefix=finance-tracker)`.
  - `GET /api/files/health` (admin) → `{"storage_base":"https://integrations.emergentagent.com","prefix":"finance-tracker","initialised":true,"last_error":null}`; HR → `403 Forbidden`.
  - `curl` round-trip: uploaded `hello.txt` via `POST /api/files/upload` (with CSRF token), downloaded back via `GET /api/files/view?path=...` — content matched byte-for-byte.
  - Browser round-trip (admin session cookie): uploaded a blob via `fetch` with the axios-interceptor style CSRF cookie header, then downloaded via `/api/files/view` — HTTP 200, exact content returned.
- **Security preserved**: Phase 63 hardening (per-object BOLA auth, no `?auth=<jwt>` query fallback, CSRF on POST) is intact. Non-privileged roles still only see files whose parent record they can see via `_scoped_center_ids`.
- **No new keys required from user** — the integration uses the existing `EMERGENT_LLM_KEY`. `INTEGRATION_PROXY_URL` is auto-provisioned by the platform.



### Phase 66 — Razorpay SaaS Subscription & Module Access Control (Done, Feb 2026)
- **User asked (Hinglish)**: SaaS-style subscription banao — har module (HR, Payroll, Attendance, Finance, Approvals, Bank Guarantee, Notifications, MIS) alag-alag purchase ho, Razorpay se live payment le sake, aur bina purchase kiye locked module use na kar paye. UI mein 🔒 lock icons + full page block dono chahiye.
- **Razorpay secrets in `/app/backend/.env`**: `RAZORPAY_KEY_ID=rzp_test_TXTWJ7xENptxlZ`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET=MASHARAENTERPRISES`.
- **Backend `/app/backend/subscription_service.py`** (new):
  1. `DEFAULT_CATALOG` — 8 modules with INR prices in paise (Notifications ₹149, Approvals ₹199, Attendance/BG ₹299, HR ₹399, Finance/MIS ₹499, Payroll ₹699 per month).
  2. `seed_catalog(db)` — idempotent bootstrap into `db.subscription_catalog`.
  3. `compute_entitled_modules(db, user)` — returns active entitlements for the user's `company_id` (falls back to `user.id`). Admins get implicit access to all modules ("admin" status).
  4. `_extend_or_create_entitlement()` — idempotent: same `source_order_id` → no-op; existing active entitlement gets extended from current expiry, else activates fresh from now. Strips `_id` before returning (fixes ObjectId serialisation).
  5. `verify_payment_signature(order_id, payment_id, signature)` — HMAC-SHA256 with Key Secret over `{order_id}|{payment_id}`.
  6. `verify_webhook_signature(raw_body, signature)` — HMAC-SHA256 over raw body with Webhook Secret. Fails closed on empty or mismatched.
  7. `audit(db, event, actor, target, extra)` — writes to `db.subscription_audit` for compliance.
- **Backend `/app/backend/server.py`** (new sub-router `sub_api = APIRouter(prefix="/api")`, mounted AFTER route definitions because the primary `api` router was already `include_router`-ed on line 20460):
  - `GET /subscription/catalog` — public (auth-only) list of paid modules + prices + `key_id`.
  - `GET /subscription/me` — per-user module status (`active`/`not_subscribed`/`admin`).
  - `POST /subscription/orders` — creates a Razorpay Order (`amount = price × months`, currency INR, receipt with company prefix); persists to `db.orders`.
  - `POST /subscription/verify` — server-side signature check, marks order captured, extends/creates entitlement, writes audit.
  - `POST /api/webhooks/razorpay` — CSRF-exempt public webhook; validates `X-Razorpay-Signature`, deduplicates via `db.razorpay_events`; handles `payment.captured` + `payment.failed`.
  - `GET/POST /subscription/admin/*` — admin-only list of entitlements/orders, manual **Grant** (for trials/compensation), **Revoke**, and **Audit** endpoints.
  - `GET /auth/me/scope` — now returns `entitled_modules` + `blocked_modules` for the SPA.
  - `require_module_entitlement(module)` — reusable FastAPI dependency that raises `HTTP 403 {error:"module_not_subscribed", module, redirect:"/subscription", message:"Not Authorised For This Service…"}` for un-entitled companies. Admins bypass.
  - Orders indices: **partialFilterExpression** (`$type: "string"`) on `razorpay_order_id` and `razorpay_payment_id` — prevents the duplicate-null-key bug that a plain `unique=True, sparse=True` produced.
- **Frontend `/app/frontend/src/pages/SubscriptionBilling.jsx`** (new): Enterprise-styled Manage Your Modules dashboard.
  - Header with company_id chip + Refresh.
  - **3 KPI tiles** — Active Modules · Locked Modules · Monthly Commitment (₹ sum of active prices).
  - **Modules grid** — one card per module: name, description, ₹price/month, status pill (Active / Locked / Admin Access), renewal date + days-left, primary CTA ("Unlock Module" or "Extend Access"). Non-admins see disabled buttons + "Admin only".
  - **Duration dialog** — 1-24 month picker, live total pill; "Proceed to Payment" dynamically loads `checkout.razorpay.com/v1/checkout.js`, creates the order server-side, opens Razorpay's Checkout modal with correct order_id/key_id + prefilled user info. On success → verify → refresh auth scope so blocked_modules updates instantly. On dismiss → toast. On failure → toast.
  - **Admin-only "Audit & Orders" tab** — recent orders table (status chips: captured/failed/created) + audit trail (event chip, actor, target, timestamp).
  - Amber banner for non-admins when locked modules exist ("Ask an admin to complete a one-click purchase").
- **Frontend `/app/frontend/src/components/Layout.jsx`** — module-locked sidebar + full-page block.
  - Every relevant sidebar item now carries a `module: "hr" | "payroll" | ... ` prop. `SidebarBody` renders a small `🔒 Lock` icon (amber-500) next to any nav-link whose module is in `scope.blocked_modules`. Title tooltip: "Module locked — Subscribe to unlock".
  - Route → module resolver (`moduleForPath`) runs on every render. If the current path matches a locked module, `<main>` renders a full "Not Authorised For This Service" block card (amber ring, Lock icon, "Open Subscription & Billing" CTA + "Back to Dashboard"), preventing children from ever mounting.
  - New sidebar entry in **Approvals & Workflow** group: **Subscription & Billing** (CreditCard icon, admin-only).
- **Frontend `/app/frontend/src/context/AuthContext.jsx`** — `login()` now hydrates scope right after login so `blocked_modules` is populated on the very first render (no more flash-of-unlocked content).
- **i18n** — `subscription` key added in EN + HI (`Subscription & Billing` / `सब्सक्रिप्शन एवं बिलिंग`).
- **Verified end-to-end (curl + browser)**:
  - HR (`hr@finance.app`) fresh company: `entitled=[]`, `blocked=[finance,hr,payroll,attendance,approvals,bank_guarantee,notifications,mis]`. `/hrms` renders "Not Authorised" block, sidebar shows 🔒 on HRMS/Employee Transfers/HR Settings/Payment History.
  - Admin grants HR module to HR's company → HR `entitled=["hr"]`, `blocked` drops HR. `/hrms` unlocks. Sidebar lock disappears.
  - After granting all 8 modules → Subscription page shows "8 Active · 0 Locked · ₹3,042 Monthly Commitment", every card labelled ACTIVE with renewal date `03 Oct 2026 (30d left)`.
  - Admin revoke: `entitled=[]` again, `blocked` full list restored.
  - Razorpay Order creation (`POST /subscription/orders`) — live Razorpay call succeeded (order_id `order_TXUFUyoJCZiic4`, amount 119700 paise for `hr × 3` months).
  - Razorpay signature verification helper — HMAC-SHA256 produces stable output; test webhook body `{"event":"payment.captured"}` signed with `MASHARAENTERPRISES` matches expected hex.
- **Files added**:
  - Backend: `/app/backend/subscription_service.py`
  - Frontend: `/app/frontend/src/pages/SubscriptionBilling.jsx`
- **What USER still needs to do (outside code)**:
  1. **Register production Razorpay webhook**: Razorpay Dashboard → Settings → Webhooks → Add → `{PUBLIC_APP_URL}/api/webhooks/razorpay` (currently `https://invest-analytics-24.preview.emergentagent.com/api/webhooks/razorpay`) → set secret to `MASHARAENTERPRISES` → subscribe to `payment.captured` + `payment.failed`.
  2. When moving to LIVE mode: regenerate Live Key + Secret in Razorpay Dashboard and paste into `/app/backend/.env` as `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET`.
  3. Production redeploy (preview→prod) via the "Deploy" button.



### Phase 65 — Strict Role + Center-based Data Access Control (Done, Feb 2026) — PREVIEW ONLY, awaiting user approval before prod deploy
- **User asked**: Every non-head-level user must only see data related to their mapped Center(s). Applies to Payroll, Attendance, HRMS, Staff, Finance, Expenses, Approvals, Reports, Dashboard. Backend-level enforcement mandatory (no reliance on frontend). IDOR-safe — URL/API-ID tampering must not bypass. Head-level = **admin + senior_manager**. Users without mapping → **fail-closed** + admin-forced warning banner. `center_id=null` records → head-level only.
- **Centralised policy layer (`server.py`)**:
  1. **`_txn_scope_for_user(user)` rewritten** — the org-wide gate for transactions. Head-level = `{admin, senior_manager}`. All other roles (hr, accountant, manager, center_manager, center_staff, ops, trainer, mobilizer, project_manager, ...) → strictly `{center_id: {$in: assigned_center_ids}}`. Empty mapping → `{_never_: True}` (fail-closed sentinel).
  2. **`_scoped_center_ids(user)`** helper — returns `None` for head-level, `[]` for empty-mapping scoped users, `[ids…]` otherwise. Single source of truth used across the codebase.
  3. **`_center_scope_query(user, field="center_id")`** — returns a Mongo filter dict any endpoint can `q.update(...)` with. Handles the null-center-id policy (head-level sees it, scoped users don't).
  4. **`_ENTITY_FULL_ACCESS_ROLES`** narrowed from `{admin, manager, senior_manager, hr, accountant}` → `{admin, senior_manager}`. `_visible_entity_ids()` now scopes hr/accountant/manager/ops/trainer/... via `assigned_center_ids`.
- **Applied to endpoints (Phase 65 tag)**:
  - `GET /payroll-batches` — server-side center scope + IDOR-safe `center_id` param.
  - `GET /payroll-batches/{id}` — 403 for non-mapped centers + null-center batches.
  - `GET /payroll` (list) — resolves user's staff via center_id → `staff_id: {$in: ...}` filter.
  - `GET /staff` — replaces the old center_manager-only filter with a universal `_center_scope_query`.
  - `GET /attendance` — staff_id → center_id lookup; self-view preserved.
  - `GET /leaves` — same pattern as attendance.
  - `GET /entities/{etype}` — via `_visible_entity_ids` (used for center/partner/vendor dropdowns).
  - **Transactions, dashboards, and any endpoint using `_txn_scope_for_user`** — inherit the new policy automatically (single point of change).
- **New endpoint**: `GET /api/auth/me/scope` returns `{role, is_head_level, assigned_center_ids, assigned_centers, needs_mapping}` for the SPA to drive dropdowns + banners.
- **Frontend**:
  1. `AuthContext` now hydrates `scope` on every `refresh()` and exposes it to consumers via `useAuth().scope`.
  2. `Layout.jsx` shows a **prominent amber "No Centers Assigned" banner** at the top of every page when `scope.needs_mapping === true` — bilingual message with role tag + explicit call to action ("contact Admin → User Management").
- **Verified end-to-end (curl + screenshot)**:
  - Admin → `is_head_level: true`, 219 centers, 2 payroll batches (unrestricted).
  - HR with **no mapping** → `is_head_level: false, needs_mapping: true`, 0 staff, 0 batches (fail-closed). Warning banner visible on HRMS page with matching Hinglish copy.
  - HR **mapped to 1 center** → sees exactly **3 staff** (that center's roster), 0 batches (no batch exists for that center). "Total Employees" KPI reflects 3. Banner hidden.
  - IDOR: HR tries `GET /payroll-batches/{admin-only-batch-id}` → **HTTP 403** "Not authorised to view this payroll batch".
- **Preview-only rollout**: user asked to test in preview first + deploy production manually via the deploy button. Backend + frontend changes are on preview; no automatic prod push.
- **Follow-ups for a future phase (still TODO)**: apply the same `_center_scope_query` pattern to `/reimbursements`, `/regularisations`, `/advance_requests`, `/quotations`, `/assets`, MIS dashboard aggregations, and export/report endpoints. These currently rely on `created_by` scoping (works but isn't as strict as center-based). Framework is in place — a targeted follow-up sweep can wire the helper into each list endpoint in ~30 lines total.


### Phase 64 — Center-wise Payroll Batches + Fully Dynamic Approval-Workflow Integration (Done, Feb 2026)
- **User asked**: (1) Payroll should follow the configured Approval Workflow — status + "Pending At" must be fully driven by the chain, not hardcoded strings. (2) Add Center selection before running payroll — "All Centers" or a specific center. (3) One batch per (center, month, year) — no duplicates. (4) Batch detail must show Center Name, Total Employees, Payroll Status, Pending At, Created By, Created Date & Time, Final Approval Date & Time. (5) Filters: Payroll Month, Center, Status, Pending At. (6) Do NOT disturb existing modules — extend, don't rewrite.
- **Backend `server.py`**:
  1. New helper **`_derive_pending_at(batch)`** — computes `pending_at_label`, `pending_at_role`, `pending_at_names`, `is_terminal` for EVERY status:
     - `draft`/`reopened` → "Draft — awaiting finalisation" (hr)
     - `pending_approval` → "Pending at {step_label}: {approver names}" (role from resolved approver)
     - `pending_payment` → "Pending at Accounts (Final Payment)" (accountant)
     - `paid` → "Paid" (terminal)
     - `rejected` → "Rejected" (terminal)
  2. **`PayrollFinaliseIn`** gained an optional `center_id` field. `None`/`"all"` splits draft rows by `staff.center_id` and creates ONE batch per unique center (staff without a center → "Unassigned" batch). Specific ID → single batch for that center.
  3. **`POST /payroll/run`** accepts `center_id` query param — filters staff to that center before generating drafts.
  4. **`POST /payroll/finalise`** — completely reworked:
     - Duplicate guard now on `(center_id, month, year, active_status)` — allows one batch per center per month.
     - Groups draft rows by center_id, creates one batch per group.
     - Returns `{batches: [...], skipped_duplicates: [...]}` — HR sees exactly which centers already had a batch.
     - Every batch stores `center_id`, `center_name`, `created_by_name`, `by_role` in audit_log entries.
  5. **`GET /payroll-batches`** — added filters: `center_id` (accepts specific ID, `"all"`, `"unassigned"`), `pending_at_role` (server-side filter). Every returned batch is enriched with `pending_at_label`, `pending_at_role`, `pending_with`, `center_name` (backfilled for legacy batches).
  6. **`GET /payroll-batches/{id}`** — enriches every response with the same dynamic fields + `is_terminal`.
  7. **Approval action** (`/api/approvals/act` for `request_type=payroll`) — the `approved` audit_log entry now carries `by_role`, `level`, and `step_label` so the Approval Timeline UI shows exactly which chain step was actioned.
- **Frontend `HRMS.jsx`**:
  1. New state `pCenterId` — Center dropdown right below the Month/Year picker in the Payroll tab. Options: "All Centers (per-center batches)" + every active center. Clear button for quick reset.
  2. `runPayroll` passes `center_id` query param when set.
  3. `finalisePayroll` sends `center_id` in body, handles the new multi-batch response with a summary toast (`Finalised N batches · X staff · ₹YY,YYY`).
  4. New **`PayrollBatchesSection`** component — replaces the old single-batch card. Shows a filterable table (Center / Status / Pending At filters + Clear all) with columns: Month, Center, Staff, Net Payable, Status, **Pending At** (label + role tag), Created (by + date), Approved (date), Action.
  5. **`PayrollBatchDialog`** upgraded:
     - New **meta strip** at top: Center, Month/Year, Created By (name + timestamp), Final Approval (timestamp or "Not yet approved").
     - **"Pending At" banner** shown whenever status is non-terminal — value read from `batch.pending_at_label` (fully workflow-driven).
     - **"Approval Timeline"** section (formerly "Audit Trail") — richer rendering: colored action chip (approved=emerald, rejected=red, paid=blue, finalised=purple, reopened=orange), by_name + by_role, step_label + level, transition arrow, remarks in italic quotes.
- **Verified end-to-end via curl (11/11 assertions)**:
  - Run for specific center — only that center's staff processed (3/3).
  - Finalise for specific center → 1 batch with `center_name` = "TEST_iter28_C_5f3eac", `pending_at_label` = "Pending at Accounts (Final Payment)", 2 audit_log entries.
  - Duplicate finalise → 0 new batches, 1 skipped (returns `existing_batch_id`).
  - `center_id` filter → returns exactly that center's batch.
  - `pending_at_role=accountant` filter → 2 pending-payment batches surfaced.
  - "All Centers" mode split 247 staff into **34 batches** (one per unique center, unassigned staff into a single "Unassigned" batch).
- **Verified on frontend**: Payroll tab shows Center dropdown (213 options), Payroll Batches table with filters, batch dialog with meta strip, "PENDING AT: Pending at Accounts (Final Payment)" banner, Approval Timeline showing FINALISED → AUTO_APPROVED events with role + step labels.
- **Backwards compatible**: Existing org-wide batches (center_id=null created before Phase 60) still render — labeled "Unassigned", untouched otherwise.


### Phase 63 — Security Hardening: CORS Allowlist, CSRF Double-Submit, File BOLA, Webhook Fail-Closed (Done, Feb 2026)
- **User asked**: Run Security Audit on deployed app + fix all 4 findings (2 HIGH + 1 MEDIUM + 1 LOW).
- **SEC-001 [HIGH] — CORS allowlist (`server.py:20050`)**:
  1. Replaced `allow_origin_regex=".*"` with `allow_origins=[…]` sourced from `CORS_ORIGINS` env (comma-separated).
  2. Default allowlist: `https://finance.masharaskills.com`, `https://invest-analytics-24.preview.emergentagent.com`, `http://localhost:3000`.
  3. Preview infra still rewrites ACAO to `*` at the ingress — but browsers refuse to send credentials with wildcard, so cross-site data theft is blocked regardless. On self-hosted production our allowlist takes full effect.
- **SEC-002 [HIGH] — CSRF (double-submit cookie)**:
  1. `set_auth_cookie` now sets TWO cookies: `access_token` (httpOnly, `SameSite=lax`) AND `csrf_token` (non-httpOnly, readable by JS, `SameSite=lax`).
  2. `SameSite=none` → `SameSite=lax` on the access cookie stops the browser from sending it on cross-site POST/PUT/PATCH/DELETE.
  3. New app-level `csrf_middleware` intercepts every state-changing request; if the caller uses cookie-auth, `X-CSRF-Token` header MUST match the `csrf_token` cookie or 403 is returned. Bearer-token API clients are unaffected.
  4. Exempt paths: `/api/auth/login`, `/api/auth/register`, `/api/auth/forgot-password`, `/api/auth/reset-password*`, `/api/webhooks/*`, `/api/health`.
  5. Frontend `/app/frontend/src/lib/api.js` interceptor reads `csrf_token` via `document.cookie` and auto-attaches `X-CSRF-Token` on every POST/PUT/PATCH/DELETE. Zero manual changes needed across screens.
  6. `logout()` now clears both cookies.
- **SEC-003 [MEDIUM] — File BOLA + token-in-URL (`GET /api/files/view`)**:
  1. Removed the `?auth=<jwt>` query fallback so JWTs never leak into access logs / referrers.
  2. Added per-object authorization:
     - Privileged roles (admin, hr, accountant, manager, senior_manager) — full visibility (matches their existing data access).
     - Uploader — can always view their own uploads.
     - Others — must be linked to the record that references the path (staff_documents, reimbursements, leaves, advance_requests, quotations, payments, regularisations, asset_purchase_requests, employee_transfers). Staff also see their own personal staff_documents.
     - Otherwise → **403**.
- **SEC-004 [LOW] — Twilio webhook fail-open (`POST /api/webhooks/twilio/status`)**:
  1. Removed the broad `except Exception` that silently accepted callbacks after validator errors.
  2. Any validation error OR invalid signature → **403** (strict fail-closed).
- **Verified via curl** (all 12 assertions passed):
  - CSRF: no header → 403; wrong header → 403; correct header → 200; GET without CSRF → 200; exempt login POST → 200.
  - Twilio webhook: no signature → 403.
  - File view: no auth → 401; `?auth=<jwt>` query → 401 (query fallback removed).
  - Frontend smoke: CSRF cookie readable by JS (`document.cookie` starts with `csrf_token=…`); Notifications page state-change POST succeeded via the axios interceptor.
- **Preview limitation acknowledged**: Emergent preview ingress rewrites cookies to `SameSite=None; Partitioned` (Chrome CHIPS). Partitioning already isolates cookies per top-level site so the SameSite=None behavior in preview is safe. On self-hosted production the app-level `SameSite=lax` header takes effect.


### Phase 62 — BG Alerts on WhatsApp/SMS + Production Sender Swap UI (Done, Feb 2026)
- **User asked (Hinglish)**: 1) BG Alert flow ko Twilio se bhi wire karo (email ke saath-saath WhatsApp/SMS jaaye) 2) Production WhatsApp Business Sender ko sandbox se easily swap kar sakein.
- **Backend `_bg_dispatch_alerts` (`server.py`)**:
  1. User queries (global admins/accountants + center-scoped users) ab `mobile` + `name` bhi project karti hain.
  2. Email dispatch ke baad naya "Twilio fan-out" block: har unique user (jo already resolved hai email ke liye) ka mobile lekar `twilio_service.send_message` call karta hai — pehle WhatsApp, then SMS fallback. Compact body: "🏦 Bank Guarantee Alert\nBG XXX in N days (YYYY-MM-DD)\n… (+K more)\n{portal}/bank-guarantees". SMS body normalized (no emoji, `|` join) aur 300 chars cap.
  3. Har send `db.notification_logs` mein `event_type="bg_expiry"` + `event_id="{today}:{user_id}[:sms]"` ke saath log hota hai — full audit trail + idempotency.
  4. Return payload ab `twilio_results[]` + `twilio_sent_count` bhi carry karta hai.
- **Backend `twilio_service.py`**:
  1. Runtime override state — `_RUNTIME_SMS_FROM`, `_RUNTIME_WHATSAPP_FROM` module vars.
  2. `get_sms_from()` / `get_whatsapp_from()` accessors — DB override first, env fallback.
  3. `load_runtime_overrides(db)` — hydrates from `db.notification_settings` (singleton doc `id=twilio`). Called on startup + after every admin update.
  4. `save_runtime_overrides(db, sms_from, whatsapp_from)` — upserts DB doc, reloads state, returns effective senders.
- **New endpoint**: `PATCH /api/notifications/config` (admin only) — validates that `whatsapp_from` starts with `whatsapp:+` and `sms_from` starts with `+`. Empty string clears the override (revert to env default).
- **Updated endpoint**: `GET /api/notifications/config` now also returns `sms_from_env`, `whatsapp_from_env`, `sms_override_active`, `whatsapp_override_active` so the UI can render the swap panel and show which side (DB/env) is currently effective.
- **Frontend `Notifications.jsx`**:
  1. Twilio Configuration card ab "Edit Senders" button + inline collapsible editor dikhata hai.
  2. Editor: SMS From (E.164) + WhatsApp From (`whatsapp:+E164`) inputs, env-default placeholders, "Leave empty to use env default" hint, prominent guide with direct link to Twilio Console → WhatsApp Senders + Meta business verification workflow explanation.
  3. Status chips inline — "DB Override" pill agar admin ne production sender set kiya ho.
- **Verified end-to-end**:
  - `POST /api/bank-guarantees/run-alerts?force=true` on a synthetic BG expiring in 7 days:
    - 29 email results all `sent:true`
    - `twilio_results: [{user_id: Admin, mobile: 9876543210, whatsapp_ok: true, whatsapp_sid: SMb8625..., sms_ok: true, sms_sid: SMb05cf...}]`
    - `twilio_sent_count: 1`
  - `PATCH /api/notifications/config {whatsapp_from: "whatsapp:+918888888888"}` → override active, `GET` returns `whatsapp_from: whatsapp:+918888888888, whatsapp_override_active: true, whatsapp_from_env: whatsapp:+14155238886`.
  - Validation: `PATCH {whatsapp_from: "+919999999999"}` → 400 "must be in form whatsapp:+<E164>".
  - Clearing: `PATCH {whatsapp_from: ""}` → reverts to sandbox env default.
  - Screenshot confirms Edit Senders panel opens with the Twilio Console guidance link.
- **What USER still needs to do (Twilio-side, outside code)**: Register a production WABA sender at [Twilio Console → Senders → WhatsApp Senders](https://console.twilio.com/us1/develop/sms/senders/whatsapp-senders) (Meta Business verification required). Once approved, paste the new `whatsapp:+91XXXXXXXXXX` into the Edit Senders UI — zero-downtime swap.


### Phase 61 — Twilio SMS + WhatsApp Integration (Done, Feb 2026)
- **User asked (Hinglish)**: Twilio account hai — integrate karo. Backlog P1 tha (Bank Guarantee expiry WhatsApp alerts). User ne credentials share kiye: Account SID `ACb910c...`, Auth Token, SMS from `+19208069066`, WhatsApp sandbox `whatsapp:+14155238886`.
- **Backend**:
  1. `pip install twilio==9.11.0` + `aiohttp-retry==2.9.1`; added to `requirements.txt`.
  2. New env vars in `/app/backend/.env`: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM`, `TWILIO_WHATSAPP_FROM`.
  3. New module `/app/backend/twilio_service.py`:
     - Lazy singleton `Client`; `is_configured()` guard so app never crashes when creds are missing.
     - `normalise_phone(raw)` — best-effort E.164 normaliser (handles `9876543210`, `+91 98765-43210`, `(920) 806-9066` etc.).
     - `send_message(db, channel, to, body, event_type, sent_by, ...)` — async wrapper around Twilio's sync SDK via `run_in_threadpool`; supports free-form SMS/WhatsApp AND approved Content Templates (`content_sid` + `content_variables`); every attempt is persisted to `db.notification_logs` (queued/failed) with `MessageSid`, sender, channel, event tag, body — full audit trail.
     - Sets `status_callback` to `${PUBLIC_APP_URL}/api/webhooks/twilio/status` for delivery updates.
  4. Endpoints in `server.py` (before `app.include_router(api)`):
     - `POST /api/notifications/send` — admin/hr/accountant → single message.
     - `POST /api/notifications/send-bulk` — admin/hr → batch send.
     - `GET  /api/notifications/logs` — admin/hr/accountant → audit trail, filter by channel/event_type.
     - `GET  /api/notifications/config` — admin only → reports configured state + sender IDs (no secrets leaked).
     - `POST /api/webhooks/twilio/status` — PUBLIC → validates `X-Twilio-Signature` via `RequestValidator`, updates the matching `notification_logs` row by `MessageSid` with status/error_code.
- **Frontend**:
  1. New page `/app/frontend/src/pages/Notifications.jsx`:
     - Twilio Configuration panel — admin-only card showing status, SMS/WhatsApp senders, webhook base + WhatsApp Sandbox `join <code>` instruction.
     - Compose panel — channel select (SMS / WhatsApp), recipient input (auto E.164), event tag, message textarea with char counter, Send button.
     - Filter tabs (All / SMS / WhatsApp) + log rows showing channel, status chip (with icon), event tag chip, recipient, body, MessageSid (truncated), sender, timestamp, error_code + error_message when applicable.
  2. Route `/notifications` added to `App.js` (admin/hr accessible via RBAC).
  3. Sidebar entry `SMS & WhatsApp` under **Approvals & Workflow** group (`adminOnly`), icon `MessageSquare`, i18n keys added in `/app/frontend/src/lib/i18n.js` (English + Hindi).
- **Verified (real Twilio calls, not mocked)**:
  - `GET /api/notifications/config` → `{configured: true, sms_from: +19208069066, whatsapp_from: whatsapp:+14155238886, public_base: ...}`.
  - `POST /api/notifications/send` `{channel:sms, recipient:9999999999, body:...}` → `HTTP 200 {ok:true, message_sid:SMe8103465f730601a34f3eda3f9ab36f5, status:queued}`. Log row persisted with full audit fields.
  - Invalid phone `"bad"` → `HTTP 400 {ok:false, error:invalid_phone}` — no Twilio call made, no cost.
  - Frontend screenshot: page renders configured Twilio panel, compose card, and the queued SMS log row correctly.
- **Sandbox note**: Currently on Twilio WhatsApp Sandbox — real-world recipients must send `join <sandbox-code>` to `+14155238886` before they can receive WhatsApp messages. For production WhatsApp, register a dedicated WABA sender in Twilio Console and swap `TWILIO_WHATSAPP_FROM`.
- **Integration into existing BG expiry scheduler is available as a hook**: `_bg_dispatch_alerts` still sends emails via `send_bg_expiry_alert`; a follow-up will add a `twilio_service.send_message` call in the same loop for users who have a `mobile` on their user profile. Manual sends already work end-to-end.


### Phase 60 — HR Approver Dashboard: Payroll Approvals Queue & "Pending Approval at [Name]" Mapping (Done, Feb 2026)
- **User asked (Hinglish)**: `/pending-approvals` par ek dedicated visual card/queue ho "Payroll Approvals" ke liye, aur HR ke Payroll Management page par jo batches `pending_approval` state me hain unke saamne "Pending Approval at [Approver Name]" dynamically show ho — taaki HR ko exactly pata rahe kis approver ke paas payroll batch ruka hai aur wahin se nudge kar sake.
- **Backend `/app/backend/server.py`**:
  1. `_resolve_pending_approvers()` L5506 — added `pending_approval` to the status whitelist so payroll batch chain resolution actually returns approvers (earlier it silently returned `[]` for payroll because batch status is `pending_approval`, not `pending`/`in_progress`).
  2. `_payroll_batch_out()` — enriches the batch response with `pending_with`, `current_step_label`, `current_level`, `total_steps` whenever `status == "pending_approval"`.
  3. `list_payroll_batches` (GET `/api/payroll-batches`) — same enrichment applied per-row so the HRMS Payroll dashboard can display "Pending Approval at [Name]" without a second fetch.
  4. `list_pending_approvals` (GET `/api/approvals/pending`) — payroll rows now carry a human summary: `purpose = "Payroll Batch · MM/YYYY"`, `description = "N staff · Net payable ₹X"`, `amount = net_payable`, `requester_name` falls back to `finalised_by_name` when `created_by_name` is missing.
- **Frontend `/app/frontend/src/pages/PendingApprovals.jsx`**:
  1. Added `payroll` to `TYPE_META` (Users icon, purple accent).
  2. Added `Payrolls` tab in the filter tab-bar with count badge.
  3. Added a prominent **Payroll Approvals** card just below the KPI strip — shows batch count, total net payable, "Review Payroll Queue" button and inline previews of up to 3 pending batches with one-click Approve.
  4. `openDetail` routes payroll rows to `/hrms?tab=payroll`.
- **Frontend `/app/frontend/src/pages/HRMS.jsx`**:
  1. `PayrollBatchStatusCard` — when status is `pending_approval`, renders a "Pending Approval at ..." row showing `batch.pending_with[*].name` (comma-separated) plus `Step X of Y`.
  2. `PayrollBatchDialog` — added the same amber "Pending Approval at" banner near the top when a batch is `pending_approval`.
- **Frontend `/app/frontend/src/pages/ApprovalWorkflows.jsx`**:
  - Added `{ v: "payroll", label: "Payroll Approval" }` to the TYPES list so admins can configure the Payroll chain from the same UI as other approval types.
- **Verified**:
  - Curl: `/api/payroll-batches` returns `pending_with: [{id, email, name, role}]` when status is `pending_approval`; falls back to `None` for other statuses.
  - Curl: HR `/api/approvals/pending` returns the payroll batch with purpose/description/amount populated.
  - Screenshot (HR login, `/pending-approvals`): dedicated purple "Payroll Approvals" card visible with net payable and Review Payroll Queue CTA. Payrolls tab shows count `1`.
  - Screenshot (HR login, `/hrms` → Payroll → Jul 2026): batch card shows `PENDING APPROVAL AT HR Test (Step 1 of 1)`.
- **RBAC note**: The enrichment respects the existing role scoping — non-approvers only see the batch status, they don't gain any new permission from seeing the approver's name.


### Phase 59 — Payroll Segregation of Duties: HR Cannot Pay (Done, Feb 2026)
- **User asked (Hinglish, URGENT)**: HR must not be able to mark payroll Paid directly. Complete workflow: HR prepare/finalise → HR Approver review → Approved → Accounts pays → Paid. Enforcement must be at API level, not just UI hiding.
- **Bulk of workflow already existed** (Phase 55): batch model, approval chain integration, accountant-only `POST /payroll-batches/{id}/pay`, audit log, notifications, admin reopen. Only per-row PATCH endpoint was still allowing HR.
- **Backend fix `/app/backend/server.py:9545`**: `PATCH /api/payroll/{pid}/pay` role list changed from `("admin", "accountant", "hr")` → `("admin", "accountant")`. Docstring added declaring the SoD rule. Admin retains this legacy path as emergency fallback; Accountant uses it for one-off approved rows; HR ALWAYS gets 403.
- **Frontend fix `/app/frontend/src/pages/HRMS.jsx` (PayrollTableRow actions)**: HR users no longer see a **Pay** button. They now see either:
  - `Awaiting Accounts` indigo chip if the row is inside an active batch (already submitted for approval)
  - `Submit via Finalise` slate chip if the row is still Draft (with tooltip: "click Finalise Payroll at the top to submit this row for approval")
  - `Resolve Issues` red button when the row has attendance/salary issues
  - `View Payroll` outline button when Paid
- **Verified via curl**: HR PATCH `/payroll/{pid}/pay` → 403 Forbidden. Accountant → 200. Admin fallback → 200.
- **Existing workflow preserved**: HR still finalises via `Finalise Payroll` header button → `POST /payroll/finalise` → batch enters approval chain → accountant sees it in `/payroll-batches?status=pending_payment` → `POST /payroll-batches/{id}/pay` creates transaction + marks batch Paid.
- **RBAC roles in play** (all pre-existing):
  - `hr` — payroll.view / create / edit / resolve_issues / submit-for-approval (via finalise)
  - `manager`/`senior_manager` — approval via `/approvals/act` type=payroll
  - `accountant` — payroll.view_approved / process_payment / view_payment_history
  - `admin` — full override + reopen paid rows
- **Audit log intact** — every state transition on `payroll_batches` still appends `{action, at, by, by_name, old_status, new_status, remarks}`.

### Phase 58 — Payable Days Formula: Include Weekly Off + Holidays (Done, Feb 2026)
- **User's revised policy (Hinglish)**: Payable Days = Present + Half×0.5 + Paid Leave + **Weekly Off** + **Holidays**. Working Days = Total Calendar Days − Weekly Off − Holidays (unchanged).
- **For July 2026 (screenshot example)**: Present=26, WO=4, H=1 → Working Days = 31 − 4 − 1 = 26, Payable Days = 26 + 0 + 0 + 4 + 1 = 31. Previously Phase 45 explicitly excluded WO from payable, so an all-present employee got only 27 payable days instead of 31.
- **Fix `/app/backend/server.py:_compute_payroll_for_staff` L7186**: added `weekly_off_count` to the payable_days sum. Formula now: `payable_days = present_days + (half_days × 0.5) + paid_leave_days + weekly_off_count + holiday_count`. Zero-attendance override (Phase 47) still forces payable_days=0 when the employee never worked.
- **Verified via curl on staff `bb0b247d…` Jul 2026**: attendance summary payable_days=5 (1 present + 4 weekly-off + 0 holidays) — recalc endpoint agrees. Working_days remains 27 (31 − 4 − 0). No UI code changed — existing labels/cards keep working as-is because backend keys are unchanged.
- **Historical rows**: existing paid payroll rows retain their old payable_days snapshot (audit-preserved). New Run Payroll or Recalc will pick up the new formula. Recommend admin runs `/payroll/{pid}/recalc` on any draft row that needs updating before finalising.

### Phase 57 — Payroll Month/Year Data-Refetch Fix (Done, Feb 2026)
- **User reported (production, Hinglish)**: Screenshots showed IDENTICAL data for Jul 2024 and Aug 2025 (79 employees, 1 processed, 23 issues, same ₹19K gross, same 3 rows). Changing the period picker was NOT refetching payroll data — all months showed the same numbers.
- **Root cause `/app/frontend/src/pages/HRMS.jsx` L336-346**: `loadPayroll` was calling `GET /api/payroll` without ever passing `month`/`year` params. Backend `list_payroll` supports these query params but was defaulting to a global result (`query={}`) when neither was sent, returning the whole payroll history sorted by year/month desc — so the UI always showed the *most-recent* payroll rows regardless of what the picker said.
- **Fix**:
  - Added `month: pMonth, year: pYear` to the `loadPayroll` params.
  - Added `pMonth, pYear` to the `useCallback` dependency array — `loadPayroll` now re-runs on period change.
  - `setPayroll([])` + `setPayrollTotal(0)` before the fetch — prevents stale rows from lingering during in-flight requests.
  - Period picker `onChange` now also resets `payrollPage=0` and clears `expandedPayrollId` for a clean transition.
- **Verified live (preview)**:
  - Default Aug 2026 → Total 236 · rows 0 (hide-zero on)
  - Switch to Jul 2026 → Total 252 · Attendance Issues 25 · Gross ₹1.9K · Net ₹1.6K · 1 row visible with ISSUE badge + 26 Unmarked chip + batch card auto-swaps to "07/2026 REOPENED"
  - Data genuinely changes per month; no stale values.
- **Backend untouched** — `list_payroll` already supported `month`/`year` and staff eligibility (joining/exit clipping) since Phase 45. All Active Employee / joining-date / exit-date rules from the spec (points 2–7) are already enforced inside `_compute_payroll_for_staff`. This fix simply wires the UI to hit the right query.

### Phase 56 — HRMS Payroll UI/UX Redesign (Done, Feb 2026)
- **User asked (Hinglish)**: Complete redesign of HRMS Payroll page into a clean, modern, enterprise finance dashboard — 20-point spec covering header, KPI cards, progress bar, exception panel, filter bar, table redesign, expandable rows, meaningful statuses, 3-dot menu, responsive design. Strict rule: NO backend/logic changes, all functionality preserved.
- **Frontend `/app/frontend/src/pages/HRMS.jsx`** — full Payroll tab replacement (L1873–2040 → new layout), zero backend touched:
  - **New Header**: bold H2 period picker (single dropdown showing "Aug 2026 ▼" instead of 2 separate month/year inputs — fixes user's "Jul selected but Aug data" bug). 4x3 month grid + 5-year picker inside a DropdownMenu. Primary "Run Payroll" (blue) + "Finalise Payroll" (protected purple ring) + Export dropdown (consolidates 4 CSV buttons into one menu).
  - **KPI Strip**: 6 compact SummaryTile cards (Total Employees / Processed / Pending / Attendance Issues / Gross Payroll / Net Payable) with color-coded rings. Gross + Net use compact ₹ formatting (₹8.42L, ₹1.24Cr).
  - **Payroll Processing bar**: `Payroll Processing 66% Complete · 52 of 79 employees` + red exception panel `N employees need attention` when issues detected.
  - **QuickFilterChips**: All / Issues / Pending / Ready to Pay / Paid — each with count badge, applied client-side via `_applyPayrollFilters`.
  - **New Filter Bar**: search + status dropdown + quick chips + hide-zero toggle + row count + pagination — all in one clean row.
  - **New Table**: 8 columns (chevron / Employee / Attendance / Gross / Deductions / Net Pay / Status / Actions). Sticky header. No repeated period column. AttendanceCell shows `20 / 24 days` + `✓ Complete` or `⚠ N Unmarked`. Deductions rendered as `− ₹677` (red). Net Pay visually strongest.
  - **PayrollStatusPill**: derived from `_payrollStage(p)` — Paid / Ready to Pay / Issue / Pending Review / Draft. Colored rounded pills.
  - **Row Actions**: single primary "View Payroll" (paid), "Resolve Issues" (issue), or "Pay" (draft) + 3-dot menu with Salary Breakdown, Print Payslip, Recalculate, Generate/Download/Release Slip, Edit Payroll (or admin Reopen+Edit / Delete). Prevents accidental payment when issues unresolved.
  - **Expandable Row**: chevron on left opens inline drawer with 2-col grid — Salary Breakdown (Basic/HRA/DA/Bonus/PF/ESI/TDS/Advance Recovery/Net) + Attendance Summary (Present/Working/Half/PL/LOP/Late/Unmarked/Payable). Uses `expandedPayrollId` state, no route change.
  - **Handlers reused**: runPayroll, finalisePayroll, downloadBankCsv, downloadHRReport, openEditPayroll, payPayroll, recalcPayroll, printPayslip, generateSlip, downloadSlip, releaseSlip, reopenAndEditPayroll, deletePayrollRow — all existing handlers preserved 1:1.
- **New state**: `payrollQuickFilter` (all/issues/pending/ready/paid) + `expandedPayrollId`. New imports: DropdownMenu + MoreVertical + ChevronDown + ChevronRight + AlertCircle + CheckCircle2 icons.
- **Design tokens**: white cards on slate-50 bg, blue-600 primary, emerald-600 success, red-600 error, amber warning, minimal purple, 8-12px radius, 1px slate-200 borders, uppercase 10px overline labels, num class for right-aligned currency, sticky slate-50 header.
- **Verified live**: Aug 2026 view + Jul 2026 view + period picker dropdown + expandable rows + quick chip filters all render correctly. All 25 existing testids kept (payroll-search, payroll-status-filter, run-payroll, finalise-payroll, bank-csv-btn, rep-*-btn, hide-zero-toggle, pay-payroll-*, edit-payroll-*, edit-paid-*, delete-payroll-*, view-detail-*, recalc-payroll-*, payslip-pdf-*, slip-*).

### Phase 55.2 — Partner Cross-Approval: Center Name Missing (Done, Feb 2026)
- **User reported (production, Hindi)**: "Partner Cross Approval me Center ka naam show nahi kar raha hai partner ko use laaye" — /pending-approvals page pe partner cross-approve transactions ke row me center chip missing tha.
- **Root cause**: `GET /api/approvals/pending` ke `partner_cross` branch me `center_id_of_request`, `center_name_of_request`, `requester_id`, `requester_name` populate nahi ho rahe the — frontend `PendingApprovals.jsx:313-317` par `item.center_name_of_request` chip pehle se ready thi lekin data khaali tha.
- **Backend fix `/app/backend/server.py:6452-6497`**: `list_pending_approvals` ke partner_cross branch me batch-fetch add kiya — `db.centers.find({id: {$in: unique_center_ids}})` + `db.users.find({id: {$in: unique_creator_ids}})` — dono N+1 se bachne ke liye. Response payload me center_id_of_request, center_name_of_request, requester_id, requester_name aur summary.center_id/center_name ab populate hote hain.
- **Frontend unchanged** — cyan-chip renderer already existed.
- **Preview verification**: preview DB me koi partner_cross-eligible transaction nahi tha, but code path curl-tested ok (partner login → /approvals/pending returns 200). Production redeploy ke baad chip dikhne lagega.

### Phase 55.1 — Admin Edit/Delete on Paid Payroll Rows (Done, Feb 2026)
- **User asked (production, Hindi)**: "admin ko paid ko edit, delete dab karne ka option dijiye" — Paid payroll rows par direct edit + delete admin ke liye chahiye.
- **Backend `/app/backend/server.py`**:
  - New `DELETE /api/payroll/{pid}` (admin only). Reverses the row's linked transaction slice (creates offsetting income txn), cancels the linked staff_payments row, updates batch counters (payroll_ids/staff_count/gross/deductions/net_payable/amount) if row belongs to a batch, and writes a compliance snapshot to `db.payroll_deletions` before removing the row. Idempotent: refuses if already reversed.
- **Frontend `/app/frontend/src/pages/HRMS.jsx`**:
  - Payroll row actions (Paid rows) now include for admin only:
    - **Orange Edit pencil** (`data-testid=edit-paid-{id}`) → calls `reopenAndEditPayroll` which prompts confirm (explains ₹X reversal), hits `PATCH /payroll/{pid}/reopen`, refreshes the list, then opens the edit dialog on the fresh Draft row.
    - **Red Delete trash** (`data-testid=delete-payroll-{id}`) → calls `deletePayrollRow` which prompts with row-specific reversal warning if Paid.
- **Verified via curl + UI**: 25 Paid rows in preview all render both buttons. HR delete → 403. Admin delete → 200 + row gone + snapshot in `payroll_deletions`.

### Phase 55 — Payroll → Approval → Accounts Payment → Transaction Workflow (Done, Feb 2026)
- **User asked (Hindi/Hinglish, URGENT)**: Complete strict payroll workflow — HR calculate → HR Finalise → Approval → Accounts Payment → Transaction Entry → Paid. HR CANNOT pay directly through batch. Month-wise batch grouping (1 batch = 1 approval = 1 payment = 1 transaction) but with per-staff visibility. Accountant-only payment. Admin can Reopen any batch (even Paid) to reverse transaction and unlock rows.
- **User's confirmed choices**: existing `approval_chains` system (1a), month-wise batch (2a), accountant role only (3a), keep legacy Pay All as fallback (4b), same-step Run+Finalise (5a). Plus: admin can reopen Paid payrolls back to unpaid so HR can re-edit.
- **Backend `/app/backend/server.py`**:
  - `ApprovalType` Literal extended with `"payroll"` + `APPROVAL_TYPE_COLL` maps to `payroll_batches`. Startup collection list includes `payroll_batches`.
  - `approvals/act` endpoint: new **payroll** branch on approve → sets batch status = `pending_payment` + notifies all accountants. Reject branch: unlocks payroll rows so HR can re-edit.
  - **5 new endpoints** (`~L9625`):
    1. `POST /payroll/finalise` (admin/hr) — locks all Draft rows for month/year into a `payroll_batches` doc, attaches approval chain (or auto-approves if no chain), sets rows `locked=true, batch_id=X`.
    2. `GET /payroll-batches?status&month&year` (admin/hr/accountant/senior_manager/manager) — list.
    3. `GET /payroll-batches/{id}` — full detail with inlined staff rows (name, emp_code, masked bank a/c, IFSC).
    4. `POST /payroll-batches/{id}/pay` (admin/accountant) — creates `transactions` row (source=payroll_batch, type=expense) + `staff_payments` per employee (transaction_type=salary) + posts bank ledger debit + marks batch/rows paid. Idempotent: refuses second pay + refuses non-positive net (business rule: negative nets mean advance recovery > gross — reopen and fix).
    5. `POST /payroll-batches/{id}/reopen` (admin) — reverses transaction (creates offsetting income txn + credits bank ledger), cancels staff_payments, unlocks rows back to Draft. Works on any status.
    6. `PATCH /payroll/{pid}/reopen` (admin) — individual row reopen (legacy Pay All path).
  - Audit log on batch: every state transition appends `{action, at, by, by_name, old_status, new_status, remarks}`.
- **Frontend `/app/frontend/src/pages/HRMS.jsx`**:
  - New state: `batches`, `openBatchId`, `loadBatches` + `finalisePayroll` fn. Batches auto-refresh on month/year change.
  - **Finalise Payroll button** (purple, `data-testid=finalise-payroll`) next to Run Payroll — visible to admin/hr when no active batch exists for the month.
  - **PayrollBatchStatusCard** — appears below toolbar when a batch exists. Shows staff count, net, finalised-by name, colored status chip (`data-testid=batch-status-chip`), Open Batch button.
  - **PayrollBatchDialog** — full drawer with: (a) 4-cell totals strip (staff / gross / deductions / net), (b) staff-wise breakdown table (emp code, name, bank a/c masked, gross/deduct/net), (c) audit trail with per-step chips, (d) role-scoped footer buttons: Process Payment (admin/accountant, when pending_payment), Reopen Admin (orange, admin only).
  - **PaymentSub-dialog** — accountant enters method (NEFT/RTGS/IMPS/Cheque/UPI/Cash/Other) + date + optional bank account + UTR + remarks.
- **Business rules enforced**:
  - HR cannot pay a batch (403). HR can only finalise + trigger workflow.
  - Accountant cannot finalise (403), cannot reopen (403), can only pay approved batches.
  - Admin can do everything including reopen a Paid batch (reverses transaction).
  - Same batch cannot be paid twice (400 "already paid").
  - Batch with non-positive net cannot be paid (400 with actionable message).
  - Duplicate active batch for same month/year rejected (409).
- **Testing agent iter-59**: 20/20 backend pytest PASS + frontend flows verified for admin/HR/accountant. Discovered CRITICAL bug (`TransactionOut.amount ge=0` broke `/transactions` when a paid batch had negative net) — fixed by refusing non-positive net payments upfront. Auto-approve audit entry now includes `by_name`. Admin `canReopen` list widened to include `processing` state.
- **Preview only** — production redeploy required to push changes to `finance.masharaskills.com`.

### Phase 54 — HRMS Attendance Report Fix (All-Dates + Regularised Status) (Done, Feb 2026)
- **User reported (Hinglish, URGENT, production)**: (1) approved regularisation rows dikha rahe hain "INCOMPLETE" instead of PRESENT, (2) selected month me har date show nahi ho rahi (e.g., 07-01 ke baad seedhe 07-08 aa raha hai), (3) missing dates ka status calculate hi nahi ho raha.
- **Root cause**: (a) auto-closure sweep in POST `/api/attendance/self` (line ~4855) was flipping any prior row with `check_in_at != null AND check_out_at empty` to status='incomplete', which included regularised rows. (b) `GET /api/payroll/staff/{sid}/summary` returned raw `att_rows` from Mongo — only dates with an existing record made it into the response, so missing dates disappeared.
- **Backend `/app/backend/server.py`**:
  - **self_check_in auto-closure filter** (L~4855) tightened — now excludes rows where `regularised=True OR status IN (leave, half) OR marked_via IN (regularised, admin)`. Prevents future corruption.
  - **staff_salary_summary** — completely reworked `attendance_rows` output. Now emits ONE row per calendar day in the month via a merge of `db.attendance` + approved `db.leaves` (paid/unpaid) + `db.holidays` + HR-policy weekly_off_days. Priority: real attendance row (with regularised override to 'present') > approved leave > holiday > week_off > future/upcoming > absent. Synthetic rows carry `synthetic:true`, `is_week_off`, `holiday_name`, and `is_regularised` flags.
  - **Regularised effective-status override** — if `regularised=True OR marked_via='regularised'`, status is forced to 'present' (or 'half' if raw='half'), never 'incomplete'.
  - **Startup Phase54 repair migration** — one-shot pipeline `update_many` on `db.attendance` that fixes any legacy row where `(regularised=True OR marked_via='regularised') AND status='incomplete'` — falls back to `attendance_status` field when valid, else 'present'. Runs on every boot idempotently (only logs when modified_count>0).
- **Frontend `/app/frontend/src/pages/StaffSalaryDetail.jsx`**:
  - Attendance rows table now uses new `AttStatusBadge` component that supports all statuses: present/half/absent/leave/incomplete/week_off/holiday/upcoming with distinct color chips.
  - Regularised rows render a small purple **R** chip next to the PRESENT badge (with title + aria-label for a11y).
  - Synthetic (auto-generated) rows show `opacity-70`, no Edit button, marked_via shows 'policy'/'holiday'/'leave' where applicable; only real rows are editable.
  - Header caption shows "N marked · M auto-generated" for transparency.
- **Testing agent iter-58**: 8/8 pytest PASS. Verified 31 rows for Jul/Aug 2026, 28 for Feb 2026, 31 for Dec 2030 (future). Regularised staff `43be2dc5-fff3-4de7-8762-5207f597b44f` on 2026-04-15 → status='present', is_regularised=true, marked_via='regularised' (was 'incomplete' before). Aug 2026 UI: 19 red (absent), 5 gray (week_off), 1 pink (holiday Aug 15), 1 green (present), 5 gray-50 (upcoming future). All required testids present.
- **Preview only** — production redeploy required to push changes to `finance.masharaskills.com`.

### Phase 53 — Staff Edit Preserves Employee Code + Accountant View (Done, Feb 2026)
- **User reported (Hinglish, production)**: (1) "staff edit karne par employee id change ho ja raha hai — aisa nahi hona chahiye", (2) "accountant aur HR ko staff ka pura details jaise bank documents etc puri tarike se dikhe".
- **Root cause (bug 1)**: `PUT /api/staff/{sid}` did `update = body.model_dump()` which included `employee_code: None` when the frontend edit form didn't send it (edit dialog has no employee_code input). Mongo `$set` then wiped the code to null — next backfill run would re-issue a *different* EMP-YYYY-NNNN. Same latent risk for `user_id`.
- **Backend `/app/backend/server.py`**:
  - `update_staff` (line ~4300) now `update.pop("employee_code", None)` + `update.pop("user_id", None)` — these are immutable-from-edit. Employee code changes go through `/staff/backfill-employee-codes`; login (user_id) changes go through `/staff/{sid}/generate-login`.
  - `GET /api/staff/{sid}/documents` role list extended: `admin/hr/manager` → `admin/hr/manager/accountant` — accountant can now see uploaded documents.
- **Frontend `/app/frontend/src/pages/HRMS.jsx`**:
  - New `canViewStaffFull` gate (admin/hr/manager/accountant) + `viewStaffId` state.
  - Staff row now shows an **Eye "View Details"** button (data-testid `staff-view-{id}`) visible to accountant + all editors. Edit pencil (`staff-edit-{id}`) remains gated to `canManageStaff` (admin/manager/hr).
  - Actions <td> + Actions <th> gate widened to `canManageStaff || canViewStaffFull` so the column renders for accountant too. Individual row buttons (offer letter Mail, verify-bank) still gated to `canManageStaff` so accountant sees only Salary, View, and (if privileged) the write buttons.
  - New `StaffFullDetailsDialog` component (bottom of file) — Read-only 5-section drawer: Identity (emp code, name, designation, joining/exit, status), Contact (email/mobile/DOB/gender/PAN/Aadhaar last4/address/emergency contact), Salary & Center, Bank Details (with Verified/Pending chips), and Documents list (fetches via `/staff/{sid}/documents`, opens each via `/api/files/view` in a new tab). Uses `data-testid` on every field (`view-empcode`, `view-holder`, `view-accno`, `view-ifsc`, `view-docs-list`, `view-doc-{id}`).
  - Ancillary: added `DialogDescription` import + `Eye` icon import.
- **Test credentials added**: `acc@finance.app / Acc@12345` (role: accountant) — persisted in `/app/memory/test_credentials.md`.
- **Verified end-to-end**:
  - Backend curl: PUT /api/staff/{sid} with body missing employee_code → response returns `employee_code: EMP-2026-0178` (preserved) and `designation: TEST_DESIG` (updated) ✅
  - Live browser as `acc@finance.app`: /hrms → Staff tab → 25 view buttons render, 0 edit buttons (correct RBAC) → clicking View opens the dialog showing Identity, Contact, Salary & Center, Bank Details, Documents sections ✅

### Phase 52 — Staff App Attendance Redesign (Home Check-In + Monthly Calendar) (Done, Feb 2026)
- **User asked (URGENT, Hindi/Hinglish)**: Redesign Staff App per reference screenshots — (1) home page pe direct CHECK IN button (Home → GPS → Selfie → Marked), (2) out-of-office pe "You are X meters away from office · Please move closer · Refresh Location" screen, (3) home button state 'Checked In – HH:MM' → 'CHECK OUT' after check-in, (4) Attendance menu me monthly calendar (Attendance For [Month] dropdown + Present/Absent/Half/Paid Leave/Week Off summary + Sun-Sat grid with LATE labels + today highlighted + click date detail). Do NOT redirect from Home to Attendance. Preserve HRMS/Admin flows.
- **Backend `/app/backend/server.py`**:
  - `POST /api/attendance/self` now returns **structured 400 detail** on geofence violation: `{code:"outside_geofence", distance_m, radius_m, site_name, message}` — frontend parses this to render the "Xm away" recovery screen.
  - Persists `office_distance_m` (haversine to nearest fence) + `is_late` (computed from staff shift `start_time + grace_minutes` in Asia/Kolkata) on the attendance row so the calendar detail modal can show them.
  - New endpoint `GET /api/attendance/my-monthly?month&year` — aggregator that merges `db.attendance` + approved `db.leaves` (paid vs unpaid via leave_type.paid) + `db.holidays` + HR-policy `weekly_off_days`. Returns `{days: {ISO: {status, is_late, is_today, is_future, check_in_at, check_out_at, latitude, longitude, address, office_distance_m, holiday_name}}, summary: {present, absent, half, paid_leave, week_off}, month, year, weekly_off_days, total_days}`. Status priority: attendance row > approved leave > holiday > week_off > future > absent.
- **Frontend `/app/frontend/src/pages/CheckIn.jsx`**:
  - **HomeTab** — CHECK IN button (`data-testid=quick-check-in`) now calls `openCheckIn()` instead of `setTab("attendance")` — attendance is marked inline, home page never leaves view. After success, state swaps to `quick-check-out` ("Checked In – HH:MM · CHECK OUT") or `quick-check-done` on second punch.
  - **New `CheckInFlowSheet` component** — fullscreen fixed overlay driving Location → Selfie → Submit. Uses `navigator.geolocation` + `navigator.mediaDevices.getUserMedia({video: {facingMode}})` for live camera preview. Auto-captures selfie via canvas.toBlob, uploads via `/api/files/upload`, then posts to `/api/attendance/self` (check-in) or `/api/attendance/checkout` (check-out). Parses structured 400 → transitions to `checkin-step-out-of-range` with "You are X meters away from {site_name}" + Refresh Location button.
  - **AttendanceTab — full rewrite** as a monthly calendar. Header `att-today-banner` (Absent/Checked In pill + Check In launcher), `att-month-toolbar` with prev/next arrows + month label, `att-summary-strip` (5 tinted tiles), Sun-Sat weekday header, 7-col `att-calendar-grid` with per-day tiles: green (present), red (absent), amber (half), purple (paid leave), gray (week off), pink (holiday), light-gray (future). Today gets a red ring. `LATE` badge on late-attendance days. Click any date → `att-date-detail` modal with status, check-in/out times, working hours, office distance, address, Google Maps link, holiday name.
  - Regularisation subflow preserved inside AttendanceTab (Regularise button + list + track approval).
- **Test credentials added**: `autostaff_1782322458@example.com / Staff@12345` (center_staff, linked to "Auto Provisioned" staff row) — persisted in `/app/memory/test_credentials.md`.
- **Testing agent iter-57**: 11/11 backend pytest PASS + all frontend testids render correctly (calendar grid, summary strip, month navigation, date detail modal, out-of-range UI, home inline check-in). Only cosmetic: added `DialogDescription` on att-date-detail dialog to silence a11y warning.
- **HRMS/Admin unchanged**: `POST /api/attendance/mark` (bulk HR-side), `PATCH /api/attendance/{aid}` (HR retro-edit), `GET /api/attendance` (admin list), `GET /api/reports/attendance` (CSV IST fix from Phase 46) — all untouched.

### Phase 51 — GET /api/staff Regression Fix (Done, Feb 2026)
- **Testing agent iter-56 flagged CRITICAL**: `GET /api/staff` returned 500 because `StaffOut.designation: str` failed pydantic validation on legacy rows with `designation=None`. This silently broke the Staff Financial History employee search (showed empty results).
- **Fix `/app/backend/server.py`**: `StaffIn.designation` changed from `str` to `Optional[str] = None` (StaffOut inherits from StaffIn). Matches other optional fields; no schema change required in DB.
- **Verified curl**: `GET /api/staff?limit=5` → 200 (admin), 200 (hr@finance.app); `GET /api/staff?q=Auto` → 1 hit. SFH employee search functional again.

### Phase 50 — Hide Zero-Attendance Rows from Payroll Table (Done, Feb 2026)
- **User asked**: "Zero attendance wale staff show nahi hona chahiye payroll me" — hide staff who have zero attendance from the Payroll list so HR only sees rows that need real action.
- **Frontend `/app/frontend/src/pages/HRMS.jsx`**:
  - New `hideZero` state (default `true`) + toggle checkbox "Hide zero-attendance" in the Run Payroll toolbar (right-aligned via `ml-auto`).
  - Payroll table body wrapped in IIFE that filters `payroll` when `hideZero=true`:
    - Filter predicate: `hasAny = present + paid_leave + half_days > 0`. Row kept if `hasAny || status !== "draft"` — this preserves the audit rule: **paid/approved rows are always visible** even at zero attendance (historical safety).
    - Empty-state message updated: when `hideZero=true` and rows are hidden, shows "N zero-attendance rows hidden — toggle Show zero-attendance to view them." instead of the plain "No payroll yet".
- **Live verified as HR user**:
  - Default view (hide=ON): 1 row visible (Auto Provisioned paid) — 24 zero-attendance drafts hidden ✅
  - Toggle OFF: 24 zero-attendance draft rows appear with red "Zero attendance" badge for audit ✅
  - Zero-attendance paid rows would remain visible either way (preserved audit trail).



### Phase 49 — HRD (HR Role) Payroll Toolbar + Pay Access + Duplicate-Month Confirmation (Done, Feb 2026)
- **User reported**: HR user "HRD(Human Resorces Department)" logged in par Payroll tab pe **Run Payroll toolbar aur Pay button nahi dikh rahe** — jabki admin (Mashara Enterprises) ke paas full toolbar hai. User wants HR = admin functionality for payroll.
- **Root cause**: `HRMS.jsx` had two frontend role gates that only accepted `admin` or `accountant`:
  - Line 1815: `{(isAdmin || isAccountant) && (…Run Payroll toolbar…)}` → HR excluded from Month/Year picker + Run Payroll + Bank CSV / Attendance CSV / Payroll CSV / Consolidated CSV.
  - Line 1895: `{p.status !== "paid" && (isAdmin || isAccountant) && (…Pay button…)}` → HR excluded from the Pay action per row.
  - Backend already granted HR both endpoints (Phase 42/46) — only the UI blocked them.
- **Fix `/app/frontend/src/pages/HRMS.jsx`**:
  - Both role gates now read `(isAdmin || isAccountant || user?.role === "hr")` — HR sees the exact same toolbar and Pay buttons as admin/accountant.
  - `runPayroll()` now **pre-checks** for existing payroll rows on the selected month via `GET /api/payroll?month&year&limit=1` and shows a browser confirm: "Payroll for M/Y already exists. Draft rows will be recalculated; Approved/Paid rows remain locked. Continue?" — prevents accidental overwrites per user's spec item 7.
  - Success toast now reports 4 counters — `Created X, Updated Y, Skipped locked L, Ineligible N` — so HR sees exactly how many staff were affected including joining/exit-based skips.
- **Month-wise view + Salary History**: Already delivered in Phase 48 (`/hrms/financial-history`) — HR can pick any employee and filter by From/To Date, Month, Payment Type, Status, and see the full monthly summary + transactions.
- **Verified live as `hr@finance.app`**:
  - Payroll tab → Run Payroll toolbar visible with Month=8, Year=2026, Run Payroll button + all 4 CSV downloads ✅
  - 24 Pay buttons rendered next to draft rows ✅
  - Zero-attendance rows still correctly show ₹0/₹0/₹0 (Phase 47 preserved) ✅
  - Consolidated CSV / Bank CSV downloads returned HTTP 200 for HR (verified via curl in Phase 46) ✅



### Phase 48 — Staff Wise Financial History / Employee Payment History Module (Done, Feb 2026)
- **User asked**: Naya HRMS module — HR/Admin kisi bhi employee ko select karke aaj tak ki poori financial ledger dekhe (salary, reimbursement, advance, bonus, incentive, overtime, other payments) with month-wise summary, filters, CSV export, and Add-Payment for manual entries. Duplicate prevention critical: existing payroll/reimbursement/advance data ko re-count nahi karna.
- **Backend `/app/backend/server.py`** (~+230 LOC before router registration):
  - **New collection**: `staff_payments` — stores manual payments only (bonus/incentive/overtime/arrear/loan_payment/final_settlement/other_payment/recovery). Auto-cancels via soft-delete (status=cancelled + cancelled_by/at) so audit trail is preserved.
  - `POST /api/staff-payments` (admin/hr/accountant) — validates type + amount, stamps created_by + IST timestamp.
  - `GET /api/staff-payments?staff_id=...` — list per employee.
  - `DELETE /api/staff-payments/{pid}` — soft cancel (status=cancelled).
  - `GET /api/staff/{sid}/financial-history?date_from&date_to&payment_type&status` — **read-only aggregator** that pulls from four sources in parallel and returns `{staff, summary, monthly[], transactions[]}`:
    - Salary from `db.payroll` (source_module="payroll", one txn per month, uses paid_at or month/year for date)
    - Reimbursement from `db.reimbursements` (source_module="reimbursement", matches via staff_id/user_id/created_by)
    - Advance from `db.advance_requests` (source_module="advance", released/adjusting/settled mapped to "paid" status)
    - Manual from `db.staff_payments` (source_module="custom")
  - **Duplicate prevention**: each txn's stable `id` is `{source_module}:{source_id}` — the aggregator never inserts anything, so the same salary/reimbursement/advance appears exactly once no matter how many times the API is called.
  - **Only Paid counted** in totals — `is_paid()` matches status ∈ {paid, released, adjusting, settled}. Pending/Draft/Rejected/Cancelled excluded from `grand_total` and monthly rollups but still visible in the transactions list.
  - Startup index bootstrap: `staff_payments(staff_id, payment_date desc)` + `staff_payments(payment_type)`.
- **Frontend `/app/frontend/src/pages/StaffFinancialHistory.jsx`** (~+380 LOC, new page):
  - Employee search box with server-side `?q=` (debounced 250ms) — supports both active and historical employees.
  - Filter bar: Date From / Date To / Payment Type (11 types) / Status + preset buttons (This Month · Last Month · FY 2026-27 · Till Date · Reset).
  - Employee header card with name + emp code + designation + joining date + Active/Exited badge, plus **Add Payment** button (HR/Admin/Accountant only) and Export CSV button.
  - **8 KPI cards** in colour-tinted grid: Total Salary · Reimbursements · Advances · Bonus+Incentive · Overtime+Arrear · Other · Deductions · **Grand Total Paid** (highlighted brand blue).
  - Two tabs: **Transactions** (full table with 10 columns · sticky header · payment-type coloured badges · Paid vs Draft status chips) and **Monthly Summary** (7-column month-wise aggregation).
  - **Add Payment dialog** with 8 manual payment types + payment date/mode/reference/description/remarks. Saves as `status="paid"` by default.
  - CSV export generates client-side using the currently filtered transactions.
- **Routing + Sidebar**: `App.js` gets `/hrms/financial-history` route. `Layout.jsx` adds the menu item **"Employee Payment History"** (Wallet icon) inside the Employee/HR Management group with `hrOrAdminOrAccountant` role gate. i18n keys `financial_history` added in English + Hindi.
- **Verified end-to-end**:
  - curl: `POST /api/staff-payments` created a ₹5,000 bonus row for Auto Provisioned (NEFT12345) → `GET /api/staff/{sid}/financial-history` returned staff object + summary (total_salary ₹0, total_bonus ₹5,000, grand_total ₹5,000, transaction_count 15, paid_count 1) + monthly[] with 3 months + transactions[] merging all 4 sources.
  - Live browser: `/hrms/financial-history` opened, "Auto" search returned "Auto Provisioned", click loaded header + 8 KPI cards (correct ₹5,000 grand total, ₹0 for the 14 draft salaries), Transactions tab shows the bonus row with green "paid" chip alongside 14 draft salary rows, Monthly Summary tab shows 2026-08 correctly rolling up ₹5,000.



### Phase 47 — Zero-Attendance Priority Rule + Joining/Exit Filter Verified (Done, Feb 2026)
- **User reported (production screenshot)**: HRMS Payroll dikha raha tha 0/24 attendance staff ko ₹533, ₹933, ₹587, ₹800, ₹1,000 salary — kyunki Phase 45 formula `payable_days = present + half*0.5 + paid_leave + holidays` mein **holidays being counted** even when the employee had zero real work. User's rule 9: "Zero Attendance Rule Has Highest Priority — Gross=0, Deduction=0, Net=0".
- **Backend `_compute_payroll_for_staff`** — added **Zero-Attendance Override** immediately after payable_days is computed:
  ```python
  valid_att_days = present_days + half_days + paid_leave_days
  if valid_att_days <= 0:
      payable_days = 0
  ```
  Now `basic = per_day × 0 = ₹0` regardless of configured monthly salary or holidays in the window. Someone who never showed up doesn't get holiday pay either.
- **Joining/Exit date eligibility** — audit confirmed `_compute_payroll_for_staff` already implements the full spec via `_parse(joining_date)` + `_parse(exit_date)`:
  - `joining > month_end_d` → skip (Case C)
  - `exit_dt < month_start_d` → skip (Case E)
  - `eff_start = max(joining, month_start_d)` (Case B)
  - `eff_end = min(exit_dt, month_end_d)` (Case D)
  - `payroll_run` returns `skipped_not_employed` counter.
- **7-case acceptance test PASSED (seeded 5 test staff, ran May/June/July 2026 payroll)**:
  - Test_JoinedBeforeMay (Jan 1, no exit) → Included in May+Jun+Jul ✅
  - Test_JoinedDuringJun (Jun 15) → Excluded May, Included Jun window=Jun-15→Jun-30, Included Jul full ✅
  - Test_JoinedAfterJul (Jul 5) → Excluded May+Jun, Included Jul window=Jul-05→Jul-31 ✅
  - Test_LeftJun15 (exit Jun 15) → Included May+Jun (window Jun-01→Jun-15), Excluded Jul ✅
  - Test_LeftMay31 (exit May 31) → Included May (window May-01→May-31), Excluded Jun+Jul ✅
  - Zero-attendance override → all 5 test staff got basic ₹0 as expected.
- **Live browser verified**: Payroll tab shows all zero-attendance rows with Gross ₹0, Deduct —, Net ₹0, red "Zero attendance" badge + Draft status. Data-integrity preserved: `payroll_run` re-runs update-in-place (no duplicates), Approved/Paid rows locked (skipped_locked counter), historical values untouched.



### Phase 46 — Attendance CSV Timezone Fix + HR Permission Audit (Done, Feb 2026)
- **User reported**: Portal pe 09:17 attendance mark hua, Excel me 03:47 download ho raha hai (5.5h difference = IST vs UTC). Also asked to give HR admin-level HRMS access including Run Payroll.
- **Backend `/app/backend/server.py`** — `_fmt(ts)` in `/api/reports/attendance`:
  - Was: `datetime.fromisoformat(ts).strftime("%H:%M")` — printed raw UTC hours.
  - Now: parses ISO, ensures `tzinfo=UTC` if naive, then `astimezone(BUSINESS_TZ)` before formatting — CSV time column now matches the exact clock time HR sees in the UI.
- **HR HRMS access — no code changes required**. Audit showed HR is already in the role gate for every HRMS endpoint the user cares about: `POST /api/payroll/run` ✅, `PATCH /api/payroll/{pid}/pay` ✅, `POST /api/payroll/{pid}/recalc` ✅ (Phase 43), `GET /api/payroll/bank-csv` ✅, `GET /api/reports/attendance` ✅, plus staff CRUD, attendance mark/edit, leaves approve, reimbursement l1/accountant/pay/reject, holidays, shifts, geofences, templates delete (Phase 42), bulk archive (Phase 42). Only intentionally-locked areas remain admin: user management, delete transactions, delete entities/batches/vendors.
- **Verified end-to-end**:
  - Inserted a test attendance row: `check_in_at=2026-07-15T03:47:00+00:00` (UTC) → CSV export now prints `Punch In: 09:17, Punch Out: 18:00, Hours: 8.72, Marked Via: SELF` — matches the portal exactly.
  - Logged in as `hr@finance.app / Hr@12345` and hit every write endpoint: `POST /api/payroll/run` → 200, `POST /api/payroll/{pid}/recalc` → 200, `GET /api/payroll/bank-csv` → 200, `GET /api/reports/attendance` → 200.



### Phase 45 — Payroll Formula Correction: Per Day Rate + Payable Days (Done, Feb 2026)
- **User asked (with production screenshot showing bug)**: Shatakshi Parashar (CTC ₹14,000, joined mid-month) was showing **₹15,866.67 Gross > CTC** because Per Day = 14000/15 (working_days) = ₹933 (too high) then × 17 payable days. Explicit corrected formula given:
  - **Payable Salary = (Monthly Salary ÷ Total Days in the Month) × Payable Days**
  - **Payable Days = Present + Holidays + Paid Leave** (Weekly Off no longer counted in payable per new policy)
- **Backend `/app/backend/server.py`** — `_compute_payroll_for_staff` now:
  - `per_day = monthly_salary / last_day` (calendar days of the month — 30/31/28/29) instead of `working_days`
  - `payable_days = present_days + (half_days × 0.5) + paid_leave_days + holiday_count` — Weekly Off intentionally excluded (kept as an information stat only)
  - Removed the dead earlier assignment that included `weekly_off_count` in payable
  - `basic = per_day × payable_days` — automatically caps mid-month joiners at their proportional share and never exceeds CTC
- **Frontend `StaffSalaryDetail.jsx`** — Salary Calculation Breakdown updated:
  - Row label changed to "÷ Total Days in Month" (was "÷ Payroll Working Days")
  - Weekly Off line removed from the "+" additions with an italic note explaining it is shown separately and no longer counted per company policy
- **Verified against user's example**: CTC ₹14,000, Present 14, Holiday 1, Paid Leave 0 → Per Day = 14000/31 = ₹451.61, Payable Days = 15, **Basic = ₹6,774.19** (matches expected math, previously ₹15,866.67).
- **Verified live**: Auto Provisioned Aug 2026 (CTC ₹15,000, 0 present, 5 weekly off, 1 holiday) → Per Day = ₹483.87, Payable Days = 1 (only holiday), **Basic ₹483.87** (previously showed ₹3,600 which incorrectly included weekly-off days).



### Phase 44 — Salary Detail: Attendance-Aware UI + Recalculate + Warning + Breakdown (Done, Feb 2026)
- **User asked**: Salary Detail page pe full salary show ho raha hai kyunki attendance rows kum hain (16/31). Show every unmarked day as unpaid, add warning, add recalculate, add clear breakdown.
- **Root cause on this specific page**: Backend `/api/payroll/staff/{sid}/summary` returned only `present/half/absent/leave/working_days/days_marked` — no concept of "unmarked absent" — and the frontend just displayed whatever gross the (pre-Phase-43) stale payroll doc had cached, so Shatakshi's July 2026 draft still read ₹15,866.67 even after the payroll_run fix.
- **Backend `/app/backend/server.py`** — `staff_salary_summary` now calls the same `_compute_payroll_for_staff` used by payroll_run and returns a **rich attendance breakdown** merged into `current.attendance`:
  - `total_calendar_days`, `payroll_working_days`, `present_days`, `half_days`, `paid_leave_days`, `unpaid_leave_days`, `absent_days`, `unmarked_absent_days`, `weekly_off_days`, `holiday_days`, `payable_days`, `unpaid_days`, `per_day_rate`, `attendance_deduction_display`, `employment_window`
  - Legacy fields (`present/half/absent/leave/working_days/days_marked`) are preserved so no other consumer breaks.
- **Frontend `StaffSalaryDetail.jsx`**:
  - **Warning banner** (amber, dashed border) — appears when `unmarked_absent_days > 0` and payroll is not paid. Explains the impact and offers an inline Recalculate button.
  - **Recalculate button** — always visible on Draft/Approved rows (except Paid). Calls `POST /api/payroll/{pid}/recalc`, toasts, and reloads the summary.
  - **Attendance Summary card** — now shows 10 stats (Present · Half Day · Paid Leave · Unpaid Leave/LOP · Absent · Not Marked · Weekly Off · Holidays · Working Days · Payable Days) instead of the old 6.
  - **Salary Calculation Breakdown** collapsible `<details>` — reveals the exact formula: `Monthly CTC ÷ Working Days = Per Day Rate`, then `Present + Half×0.5 + Paid Leave + Weekly Off + Holidays = Payable Days`, then `Per Day × Payable Days = Basic Earnings`. Right column lists every deduction line item with its amount, then Total Deductions and Final Net Pay.
- **Verified end-to-end**:
  - curl `/summary` for July 2026 Auto Provisioned (₹15,000 CTC): rich attendance returns `present=0, unmarked=25, weekly_off=5, holidays=1, payable=6, per_day=₹555.56` (was previously invisible in UI).
  - Live browser: opened Auto Provisioned's Aug 2026 detail → yellow warning banner, expanded 10-stat attendance card, ₹0 stale salary. Clicked **Recalculate** → toast "Payroll recalculated with latest attendance + leaves" → salary refreshed to **₹3,600 DRAFT** = 6 payable days × ₹600 per-day rate, Basic Pay updated in Earnings card, Gross Payable now ₹3,600 (not the full ₹15,000 CTC).



### Phase 43 — Payroll: Attendance-Aware Calculation Fix (Done, Feb 2026)
- **User asked**: Fix critical payroll bug where staff with 0/26 attendance were still getting full salary. Attendance, approved paid leave, and unpaid leave should drive salary calculation. Added Recalculate action for Draft payrolls.
- **Root cause**: `payroll_run` calculated `paid_days = total_days − absent_days − unpaid_leave_days`. When a staff had **zero attendance rows** for the month, both `absent_days` and `unpaid_leave_days` were 0, so `paid_days` fell back to the full calendar window — awarding full monthly salary regardless of attendance.
- **Backend `/app/backend/server.py`** — refactored payroll math into `_compute_payroll_for_staff(s, month, year, paid_off_dates, weekly_off_weekdays)`:
  - Loads approved leaves overlapping the month + resolves each leave_type's `paid` flag to classify as paid_leave / unpaid_leave.
  - Walks EVERY day in the effective employment window and classifies as: `weekly_off` / `holiday` / attendance-row status (`present`/`half`/`absent`/`unpaid_leave`/`leave`) / approved-leave status / **`unmarked_absent`** (working day with NO attendance row and NO approved leave — the critical bug fix).
  - Computes `present_days`, `half_days`, `paid_leave_days`, `unpaid_leave_days`, `absent_days`, `unmarked_absent_days`, `payable_days`, `unpaid_days`.
  - `per_day = monthly_salary / working_days` (per user spec: "Applicable Monthly Salary ÷ Payroll Working Days").
  - `basic = per_day × payable_days` (this replaces the old `monthly × paid_days/total_days` formula and correctly returns ₹0 for zero attendance).
  - `attendance_deduction_display = per_day × unpaid_days` (for the detail drawer).
  - `payroll_run` now returns `{created, updated, skipped_locked, ...}` and **updates draft rows in-place** on re-run instead of skipping them (data-integrity rule 14 from spec).
- **New endpoint `POST /api/payroll/{pid}/recalc`** — role `admin`/`hr`/`accountant`. Refreshes a single payroll row against the latest attendance + approved leaves. Blocks recalculation on Approved/Paid rows (locked). Full audit via `edited_by` / `edited_at` stamps.
- **Frontend `HRMS.jsx`**:
  - New **Recalculate** button (TrendingUp icon) on every Draft payroll row.
  - New **"Zero attendance"** red badge appears beside staff name when a Draft row has 0 present + 0 paid leaves.
  - Days cell now shows secondary line with `PL {n}`, `LOP {n}` (amber), `Unmk {n}` (red) for at-a-glance leave/absence breakdown.
  - Run Payroll toast updated to show "Created N, Updated M, Skipped locked L".
- **Verified end-to-end**:
  - curl: Run Sept-2026 payroll → 236 rows created → staff with 0 attendance now show `payable_days=4 (Sundays only), unpaid_days=26, basic=₹9,230.77` (previously ₹60,000).
  - curl: Recalculate a Draft row → `net=₹2,307.69` reflects current attendance + advance deductions.
  - Live browser: 12/2099 Draft rows all show ₹0 gross / ₹0 deduct / ₹0 net (correct for zero attendance). 24 recalculate buttons visible. Existing Edit/Pay/View/Slip buttons unchanged.



### Phase 42 — HR Full Access + HRMS Command Centre Redesign (Done, Feb 2026)
- **User asked**: HR ko HRMS ka full control access dena aur HRMS menu ka look interactive + sundar + easy-to-understand banana.
- **Backend `/app/backend/server.py`** — 4 admin-only endpoints extended with HR:
  - `DELETE /api/offer-letter-templates/{tid}` → `require_role("admin", "hr")`
  - `DELETE /api/salary-slip-templates/{tid}` → `require_role("admin", "hr")`
  - `DELETE /api/leave-types/{lt_id}` → `require_role("admin", "hr")`
  - `POST /api/staff/bulk-archive` → `require_role("admin", "hr")`
  - All other HRMS endpoints (staff CRUD, attendance mark/edit, leaves approve, reimbursement templates/l1/accountant/pay/reject, payroll run/edit/generate-slip/release-slip/pay, holidays, shifts, geofences, staff documents, verify/unverify bank, offer letter send, generate-login) already included HR — audited and confirmed.
- **Frontend `/app/frontend/src/pages/HRMS.jsx`** (~+90 LOC, replaced header + tab bar):
  - **Hero header** with soft gradient (slate → white → indigo/50), new title "HR Command Centre" + Hinglish subtitle "Ek jagah pe pura staff lifecycle — onboarding, attendance, leaves, reimbursements, payroll. Har action ek click door."
  - **5 KPI cards** side-by-side (grid-cols-5 on desktop, 2 on mobile) — Total Staff / Attendance Rows / Leave Requests / Reimbursements / Payroll Rows, each with its own icon (Users, CalendarCheck, CalendarDays, Receipt, Wallet) and toned background (indigo/emerald/amber/blue/slate).
  - **Rich tab bar** — flex row of 5 tabs, each with icon + label + tiny descriptor sub-line ("Claims + approvals", "Roster + master data", "Daily punch + regs.", "Requests + balances", "Monthly salary run"). Active state gets a matching tinted background per tab (blue for Reimbursements, indigo Staff, emerald Attendance, amber Leaves, slate Payroll). Border-based active indicator instead of the earlier flat underline.
  - All existing tab content (Reimbursements templates, Staff roster with 25-column table, Attendance date picker + status cards, Leaves inbox, Payroll rows) untouched — zero functional regression.
- **Test credentials**: Added `hr@finance.app / Hr@12345` (role: hr) to `/app/memory/test_credentials.md`.
- **Verified live**: HR user logged in → /hrms rendered with hero + 5 KPI cards (240/24/67/0/2646) + interactive tabs → clicking Attendance switched active tone to emerald + loaded staff punch cards. No console errors. No RBAC 403s on any HRMS action.



### Phase 41 — Finance (Milestones) ↔ Invoice Tracking Integration (Done, Feb 2026)
- **User asked**: Integrate Finance (Milestones) module with Invoice Tracking so milestone updates automatically flow into invoice stages. Chose (a) auto-link approach + (1) simple stage advance with remarks only.
- **Backend `/app/backend/server.py`** (~+170 LOC):
  - Helper `_ensure_invoice_for_bp(bp, user)` — checks `bp.invoice_id`; if absent, auto-creates a linked invoice with `invoice_no = "MS-{batch_code}-{milestone}"` (collision-safe via unique index + `-N` suffix), `invoice_type = "Milestone"`, `milestone_type = bp.milestone`, all master IDs derived from the parent batch, `amount_payable = bp.amount`, stage 1 stamped at `bp.created_at`, and back-links `bp.invoice_id` on the batch_payment row. Writes audit entry.
  - `GET /api/batch-payments/{pid}/bill-status` — returns `{linked, invoice_id, invoice_no, current_stage, current_stage_id, current_stage_label, current_stage_timestamp}` for the Milestones UI badge.
  - `POST /api/batch-payments/{pid}/advance-bill-status` (body: `{to_stage, remarks?}`) — role-gated (admin/accountant/senior_manager/manager/hr). Ensures invoice exists, enforces strict `to_stage == current + 1` sequence via the same invoice-advance rules. On stage 5, sources `disbursed_amount` from `bp.net_amount` (if received) or `bp.amount`, and re-computes deductions from persisted TDS + recovery + assessment_fee fields.
  - `_sync_invoice_on_receive(bp, user)` — best-effort helper called after `receive_batch_payment` successfully commits. Auto-advances the linked invoice through any missing stages up to 5 in one shot, stamping the receive timestamp on each and setting disbursement details from the persisted BP amounts. Wrapped in try/except so a sync failure never fails the receive.
  - Wired the hook: `receive_batch_payment` now calls `_sync_invoice_on_receive(res, user)` right before returning success. All existing rollback behaviour preserved.
  - Startup indexes: added `invoices.batch_payment_id` for reverse lookup.
- **Frontend `Programs.jsx`** (~+90 LOC):
  - `billStatuses` state — `{payment_id: {linked, current_stage, current_stage_label, current_stage_id, invoice_no}}`. `useEffect` fetches all bill statuses in parallel via `Promise.all` whenever the payments list changes.
  - `MilestoneCard` extended with new **"Bill Status"** section (below expected/received dates, above action buttons). Renders a colour-toned stage chip (slate/blue/indigo/amber/emerald per stage) with the linked invoice_no as a subtitle, plus an inline "Update" button (hidden once the invoice reaches Stage 5).
  - New "Update Bill Status" dialog — displays Current Stage → Advance To (next stage label), remarks textarea, and a Stage-5 warning that clarifies the disbursed amount will be sourced from the milestone (with a hint to use "Mark Received" instead to also update the finance ledger).
  - `submitBillStatus` — posts `to_stage = current + 1` + optional remarks, refreshes the specific milestone's status inline.
- **Existing modules protected**: Zero changes to receive_batch_payment's math, txn creation, rollback logic, or return shape. The invoice sync is strictly additive and wrapped in try/except. `batch_payments` schema gains one optional field (`invoice_id`) — reads unaffected.
- **Verified end-to-end**: Backend curl — fetched a live batch_payment → checked bill-status (returns `linked: false`) → advanced to stage 2 (invoice `MS-TEST_batch_07ea90-2nd` auto-created, `linked: true, current_stage: 2`) → skip attempt (400 "Expected 3, got 4"). Live browser — /programs → project with milestones → each MilestoneCard shows "Bill Status: Not started" + "Update" button → dialog opens with correct Current Stage / Advance To wording + remarks input.



### Phase 40 — Invoice & Payment Tracking Module (Done, Feb 2026)
- **User asked**: Central Invoice-to-Payment tracker under Finance & Accounting with 5 consolidated business stages (Generated on Portal → Bill Submitted to Department → Final Approved on Portal → Payment File is in Process → Disbursed). Track date+time on every stage, "Stayed at this stage" duration, days pending + aging buckets, configurable aging thresholds, invoice list with 17 fields + advanced filters + CSV export, detail page with vertical timeline + financial summary + audit history, KPI cards, integration with existing masters (companies, centers, projects, batches) — no duplicates.
- **Backend `/app/backend/server.py`** (~+540 LOC before router registration):
  - Collections: `invoices` (with embedded `stages` dict — 5 keys: generated/submitted/approved/processing/disbursed, each `{timestamp, remarks, completed_by_id, completed_by_name, completed}`), `invoice_audit`, `finance_settings` (singleton `{id: "aging", normal_max_days, attention_max_days}` — defaults 7 and 15).
  - Helpers: `_now_ist_iso()`, `_parse_iso_dt`, `_fmt_duration`, `_get_aging_config`, `_aging_bucket`, `_compute_current_stage`, `_compute_stage_durations` (per-stage from-prev + stayed timings), `_days_pending`, `_hydrate_invoice` (denormalises company/center/project/batch names + adds computed fields), `_write_invoice_audit`.
  - Endpoints: `GET /api/invoices/stages`, `GET/PATCH /api/finance-settings/aging` (patch admin/accountant only), `GET /api/invoices` (advanced filters — q, status by stage_id, company_id, center_id, project_id, batch_id, invoice_type, milestone_type, from_date, to_date, aging + pagination + sort), `GET /api/invoices/dashboard` (KPI totals + per-stage counts+values + outstanding sum), `POST /api/invoices` (auto-stamps stage 1), `GET /api/invoices/{id}` (returns hydrated invoice + `timeline` array), `PATCH /api/invoices/{id}`, `POST /api/invoices/{id}/advance` (**strict sequence** — to_stage must equal current+1, stage 5 requires disbursed_amount + captures UTR/bank/remarks), `GET /api/invoices/{id}/audit`, `DELETE /api/invoices/{id}` (admin), `GET /api/invoices/export.csv`.
  - RBAC: `INVOICE_WRITE_ROLES = admin/accountant/hr/senior_manager/manager`, `INVOICE_READ_ROLES` + partner + center_manager + reporting_authority.
  - Startup index bootstrap: unique index on `invoice_no`, compound `(tsp_company_id, created_at desc)`, `(center_id, ...)`, `(project_id, ...)`, `batch_id`, and `invoice_audit(invoice_id, timestamp desc)`. `finance_settings` seeded via `$setOnInsert`.
- **Frontend**:
  - `/pages/Invoices.jsx` — 7-KPI dashboard strip (Total / Generated / Submitted / Approved / Processing / Disbursed / Outstanding) — each clickable to filter list by that stage; advanced filter row (search + 10 filters + reset); sortable+paginated table with 16 columns (Invoice No, Generated, TSP, District, Centre, Project, Batch, Candidates, Amount, Net, Stage badge, Stage Since, Days Pending + aging chip, Disbursed, Outstanding, Action arrow); Create dialog with all fields; Aging Settings dialog (admin only); CSV export.
  - `/pages/InvoiceDetail.jsx` — Vertical timeline with 5 stages showing status chip (Completed/Pending), date + time, "From previous stage" + "Stayed at this stage" durations, remarks, attribution, and a special emerald-tinted disbursement details block for stage 5 with Disbursed Amount + UTR + Bank + Remarks. Financial Summary sidebar (Amount → Adjustment → Gross → Deduction → Net → Disbursed → **Outstanding** highlighted red). Invoice Info sidebar with clickable batch/center/project links to existing pages. Audit History section with per-entry action + stage + user + timestamp. Advance dialog validates required disbursed_amount on stage 5.
  - `App.js` — `/invoices` + `/invoices/:id` routes.
  - `Layout.jsx` — new nav item "Invoice & Payment Tracking" (FileText icon) placed inside the Finance & Accounting group with `invoiceAccess` role gate.
  - `i18n.js` — `invoices` label in English + Hindi.
- **Existing modules protected**: Zero changes to companies/centers/projects/batches/candidates/HRMS/Attendance/Approvals/etc. Invoice module reads master data via existing `/api/entities/*` and `/api/batches` endpoints. No duplicate records ever created.
- **Verified end-to-end**: Backend curl smoke test — create invoice → advance 1→2→3→4 → attempt skip to 5 without disbursed_amount (400) → disburse with UTR (stage 5 stamped, outstanding recomputed to ₹0). Live browser test — Finance & Accounting group auto-expands, /invoices lists the seed invoice with all KPIs populated, detail page renders the full 5-stage vertical timeline with green completed markers, disbursement block visible, financial summary correct, audit trail shows 5 entries.



### Phase 39 — Sidebar Reorganization: Grouped, Collapsible Nav + Breadcrumbs (Done, Feb 2026)
- **User asked**: Reorganize existing sidebar into 9 grouped, expandable/collapsible parent menus in exact order — Dashboard → Organization Management → Batch Management → Finance & Accounting → Approvals & Workflow → Candidate/Student Management → Employee/HR Management → Procurement & Vendors → Partnerships. Preserve every existing page, route, permission, and data connection. Add breadcrumbs, auto-expand parent when child is active, no duplicates.
- **Frontend `/app/frontend/src/components/Layout.jsx`**:
  - Flat `navItems` array replaced with a `navGroups` array of 9 parent groups. Each group has `key` (i18n), `icon`, and `items[]`. Every item preserves its **exact prior role-gate flag** (adminOnly, financeOnly, hrOrAdmin, misAccess, batchMgmtAccess, dashboardRoles, nonPartner, etc.) — RBAC filter logic is unchanged, just relocated into a helper `canSee(it)`.
  - `visibleGroups` memo filters items via `canSee` and drops any group whose items array becomes empty. If a user only has one submenu in a group, the group + that single submenu still render (per spec).
  - New `expanded` state + `toggleGroup(key)` handler. `useEffect` on `location.pathname` auto-expands the group containing the active route (and defaults `grp_dashboard` open on first load).
  - SidebarBody now renders each group as a header button (uppercase 11px label, icon, chevron, aggregated badge when collapsed) followed by indented submenu items with the existing NavLink active-state styling.
  - Header breadcrumb `[data-testid="breadcrumb"]` shows `{Group} » {Page}` using `ChevronsRight` separator, replacing the old "Dashboard · role" text.
  - Renamed sidebar labels only where the user's spec demanded: `Quotations` submenu now displays as "Payment Request" (label-only via new i18n key `payment_request` → route `/quotations` unchanged), `Partner Pairings` displays as "Partner Ratings" (label-only via new i18n key `partner_ratings` → route `/partner-associations` unchanged). Underlying page titles and routes untouched.
  - Bank Guarantees (unlisted in user spec but existing) placed under Finance & Accounting group to keep it accessible.
  - Mobile drawer (Sheet) uses the same grouped SidebarBody — mobile UX preserved.
- **i18n `/app/frontend/src/lib/i18n.js`**: 11 new keys added in both English + Hindi (`grp_dashboard`, `grp_organization`, `grp_batch`, `grp_finance`, `grp_approvals`, `grp_candidates`, `grp_hr`, `grp_procurement`, `grp_partnerships`, `payment_request`, `partner_ratings`).
- **Not touched**: `App.js` routes, every page file, backend, DB, and every role-permission check. Zero risk of route breakage.
- **Verified**: Admin login → all 9 groups render in exact order. Click `/transactions` → Finance & Accounting group auto-expands, Transactions row highlighted, breadcrumb "FINANCE & ACCOUNTING » Transactions" shows in header. Collapsed groups display aggregated pending badges (127 · 219 · 2625). Lint clean.



### Phase 38 · Session 1 — Work Order Allocation Rate Engine + Job Role Master (Done, Feb 2026)
- **User asked**: 28-section spec — Work Order allocation with FY Year + Category (I/II/III) + District (LWE 10% multiplier) → Per Hour Rate (auto) → Total Work Order Value (auto). Job Role master with default hours + inline "+ Add New". Backend-authoritative rate calc (frontend rate ignored). Centralised rate config for future FY changes. User approved (a) Session 1 (single-batch rate engine), (d) LWE flag empty — admin toggles per district, (g) legacy batches show "Incomplete WO" badge.
- **Backend `/app/backend/server.py`** (~+230 LOC):
  - **Rate engine (single source of truth)**: `DEFAULT_RATE_SLABS` seeded on startup into `db.rate_config` (2 slabs — <2026-27: I=49/II=42/III=35.10; ≥2026-27: I=56.35/II=52.50/III=36.85). `LWE_MULTIPLIER=1.10`. Helper `_compute_wo_rate(fy, category, is_lwe)` returns `{base_rate, final_rate, slab_id, ...}`. `_parse_fy_year("2026-27") → 2026`.
  - Endpoints: `GET /api/work-order/rate-config` (auth), `PATCH /api/work-order/rate-config/{slab_id}` (admin), `POST /api/work-order/calculate` (preview — accepts `is_lwe` or `district_id`).
  - **Job Role Master** `db.job_role_master` (name, default_hours, nsqf_level, category_hint, active). CRUD endpoints with case-insensitive dedupe. Soft-delete via `active=false`.
  - **District LWE flag**: `PATCH /api/districts/{cid}/lwe` (admin/manager/senior_manager) toggles `is_lwe` on `db.centers`. Returns minimal projection so no sensitive center fields leak.
  - **BatchIn** extended with `fy_year, category, job_role_master_id, job_role_hours, num_candidates, is_lwe, base_rate, final_rate, work_order_value`. `create_batch` + `update_batch` call `_compute_wo_rate` authoritatively — any frontend-sent rate is overwritten with the server value.
- **Frontend `BatchManagement.jsx`**:
  - New Work Order Allocation section in the Create Batch dialog: FY Year (5-option dropdown), Category (I/II/III), Job Role dropdown from master + `+` quick-add button, Job Role Hours (auto-fills from default_hours on role pick), No. of Candidate, **Per Hour Rate** (read-only, ₹X.XX with base + slab subtitle), **Total Work Order Value** (read-only, ₹large, with formula subtitle + LWE +10% chip).
  - Live recalc via debounced (250ms) `POST /api/work-order/calculate` on every FY/Category/Center/Candidates/Hours change.
  - "Add Job Role" dialog: name + default_hours + NSQF level → immediate dropdown insertion + auto-select on close.
  - Row indicator: batches missing `fy_year` or `category` show an "Incomplete WO" amber badge next to Legacy/Linked chip.
- **Verified iter-55**: 27/27 backend pytest (including full 12-cell rate matrix to 3-decimal precision + bogus-rate-override test) + 100% Playwright frontend flow.
- **Post-test polish**: `/api/districts/{cid}/lwe` now returns minimal projection.

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

---

## Phase 84 (Jun 2026) — Batch Management Data Synchronization Fix

**Problem:** Target Allocation "Allocated" showed 0 for most targets; bulk-created & legacy batches never counted; batch "Enrolled" column always showed 0 (read wrong field `passed_candidates`).

**Root cause:** `batch_targets.allocated/remaining` were drift-prone denormalized counters updated only by create/delete (with target_id). Bulk create never consumed; edits never re-synced; legacy (target_id=None) batches never counted. Frontend Enrolled read `b.passed_candidates`.

**Fix (backend-authoritative, derived from actual DB records):**
- New helpers: `_target_allocated_single`, `_target_alloc_map`, `_recompute_target_counters`, `_recompute_targets_for_batch`, `_norm_fy/_batch_fy/_target_fy` (server.py ~line 13475).
- Allocation rule (user-confirmed): a batch counts toward a target if `target_id` matches, OR (no target_id AND Project+Centre+FY match).
- `list_batch_targets`, `get_batch_target`, `batch_management_financials` now DERIVE allocated/remaining live (always correct after refresh/login). `update_batch_target` shrink-guard & `delete_batch_target` guard use live values.
- `create_batch` / `update_batch` / `delete_batch` enforce target limit against live remaining + call `_recompute_targets_for_batch`.
- `batches_bulk_commit` now resolves each row to a matching target (Project+Centre+FY), enforces limit across rows (fit rows created, overflow → `failed[]`), sets `target_id`, persists counters.
- `/batches` list now returns live `enrolled` count (aggregation on `db.candidates`); `BatchOut.enrolled` added. Frontend Enrolled column fixed to `b.enrolled`.
- New `POST /api/batch-management/reconcile-allocations` (admin/manager) — non-destructive recompute of all target counters.
- New `PATCH /api/batches/{bid}/candidates/{cid}` — admin/manager/HR/center_manager can edit enrolled candidate details (Aadhaar uniqueness re-enforced). Frontend EnrollmentStage got per-row Edit (pencil) button + reused dialog.

**Tested (curl, real preview data + smoke screenshot):** A create→alloc↑ ✓ | B bulk (2 fit @100, 3rd overflow→failed, alloc=100/rem=200) ✓ | C enroll→enrolled=1 in list ✓ | D refresh persists (live) ✓ | E duplicate aadhaar→409 ✓ | F exceed capacity→400 ✓ | candidate edit ✓. Frontend BM page renders, KPI cards live.

## Phase 84.1 (Jun 2026) — Legacy Batch WO Linking + Per-row Edit/Delete

**User ask (Hinglish):** Legacy batches ko update karne ka button; "Incomplete WO" jabki WO create ho chuka; side me edit option.

**Backend:** New `POST /api/batches/reconcile-work-orders` (admin/manager/senior_manager/center_manager). Auto-links every batch with NO work_order_id to the uniquely-matching ACTIVE Work Order (Project+Centre, +FY if batch has one). Back-fills batch fy_year from WO, and category when WO has a single distinct course category, then recomputes rate/WO value. Non-destructive (only fills missing fields). Center managers scoped to own centers. Returns {linked, ambiguous, no_match, total_unlinked}. Verified: created matching WO → reconcile linked 3 batches, category='I' & final_rate computed.

**Frontend (BatchManagement.jsx):**
- `saveBatch` now branches create (POST) vs edit (PUT `/batches/{id}`); edit mode relaxes the Target-required rule (legacy batches keep no target).
- New per-row **Edit (pencil)** + **Delete (trash)** buttons in a new Actions column (testids `bm-batch-edit-{id}`, `bm-batch-del-{id}`).
- New **"Fix Legacy WO"** header button (`bm-batch-reconcile-wo-btn`) → calls reconcile endpoint, toasts summary, reloads.
- "Incomplete WO" badge now keys off `!b.work_order_id` (matches user mental model) instead of `!fy_year||!category`.
- Dialog title/save label become "Edit Batch"/"Save Changes" in edit mode.

## Phase 85 (Jun 2026) — Batch Management Dashboard Redesign (Premium SaaS)

**Scope:** UI/UX only — no DB/API/business-logic changes (per user). Reference mockup provided.

**New component:** `/app/frontend/src/components/batch/BatchDashboard.jsx` (self-contained, all data via props). Renders:
- Header: title + subtitle "Complete Batch Lifecycle" + lifecycle breadcrumb + "Quick Actions" dropdown (Work Order / Allocate Target / Create Batch / Add Candidate / Record Placement).
- 6 KPI cards (Total Target, Allocated, Remaining, Utilization, Active Centres, Active Batches) — derived from `targets` scoped by the global filter bar (project/center/fy/q), so they respond to filters and always reflect real targets (not WO-dependent). Clickable → jump to stage.
- 4 financial KPI cards from `/batch-management/financials` cards (INR).
- Global filter bar (search + Project/Centre/FY/WO Status + Clear All + Export CSV) wired to `woFilters` (drives financials fetch).
- 4-col analytics (recharts): Target Utilization donut, Centre-wise WO Value horizontal bar (click bar → filter centre), Batch Lifecycle 8-tile widget, Pending Actions (clickable → stage).
- Attention Required alerts (unallocated targets → Allocate).
- Work Order Financial Summary table: sticky header, sortable columns, pagination (8/pg), utilization pill coloring (red/amber/green), status badges (Not Started/At Risk/In Progress/On Track/Completed), View → right-side slide-over drawer (Sheet) 'Work Order Details' + quick actions, More menu.
- Target Allocation (By Centre) table with progress bars + status (Critical/Attention/In Progress/On Track).

**BatchManagement.jsx changes:** replaced old header+KPI strip+`<WorkOrderFinancials>` with `<BatchDashboard/>`; converted the 7 Tabs into a bottom lifecycle stepper (STEPPER const + stepDone/stepSub) that swaps the detail content below (existing TabsContent stage components kept intact). Backend: added `wo_number` to financials summary groups.

**Design:** followed `/app/design_guidelines.json` (navy #1E3A8A primary, rounded-xl cards, soft shadows, slate palette, 6 KPI accent tints, status/utilization color maps).

**Tested:** testing_agent iteration_70 — all sections render, filters reactive, Quick Actions, stepper switches detail, empty states clean (preview DB has 0 active WOs), regression on Stage-2 batch table (353 edit/delete rows) intact. No console/page errors (only non-blocking recharts responsive warnings). Verified at 1440x900 + 1366x768.

## Phase 86 (Jun 2026) — Bank Guarantee ↔ Work Order / Batch Management Integration

**Goal:** Eliminate duplicate data entry — BG inherits everything from the Work Order (source of truth). WO-first flow, auto status, audit trail, coverage.

**Backend (server.py):**
- `GET /api/bank-guarantees/wo-context/{work_order_id}` — WO snapshot (FY/Project/Centre/LOI/WO No./WO Value/PBG) + existing BG coverage (received/balance/coverage%) + live Batch linkage (target/allocated/remaining/total+active batches/candidates). Single source of truth `_bg_wo_context`.
- `POST /api/bank-guarantees` refactored to JSON body: requires work_order_id, snapshots WO fields, validates claim_expiry>=valid_till and PBG shortfall (BG<PBG needs authorized override; BG>=PBG free), status=draft + status_history seed.
- `GET /api/bank-guarantees` enriches effective_status + days_remaining; filters project_id/center_id/fy/status(effective)/bank/search.
- `GET /api/bank-guarantees/summary` — 8 status counts + financial (total_pbg_required/total_bg_amount/active/expired/pending/outstanding).
- `PATCH /api/bank-guarantees/{id}` — extended editable fields + claim/shortfall re-validation.
- `POST /api/bank-guarantees/{id}/status` — workflow transitions (draft→submitted→under_verification→active→released/cancelled) with legal-transition guard, privileged-role guard for active/released/cancelled, auto submission/verification/activation stamping, and status_history audit append.
- Helpers `_bg_effective_status` (auto Active/Expiring Soon/Expired from valid_till, 30-day window — authoritative), `_bg_days_remaining`, `_bg_enrich`. Roles: BG_WRITE_ROLES (admin/hr/manager/senior_manager/accountant); BG_OVERRIDE_ROLES (admin/accountant/manager/senior_manager) for shortfall override + manual active/expired.

**Frontend (BankGuarantees.jsx full rewrite; BGExpiryAlert preserved):**
- Dashboard: 7 KPI cards + 5 financial cards (live /summary), quick-filter chips + filter bar (search/project/centre/fy/bank), status-badge table with days-remaining coloring, actions dropdown (View/Edit/Change Status/Renew/Delete-in-More).
- Sectioned Add/Edit/Renew dialog: Work Order Link (searchable combobox) → Auto-Linked Information (read-only, from wo-context, amount auto-fills to PBG + shortfall warning with override note) → BG Details → Additional (location/remarks/attachments via /files/upload). Save Draft / Submit.
- Status dialog (transition + stage fields + remarks). View Sheet drawer: BG fields + Work Order Summary + Batch linkage + Attachments + Audit Trail. Renew creates a new BG referencing old.

**Business rules (user-confirmed):** WO link mandatory; BG<PBG → shortfall warning + authorized override only (BG>PBG allowed freely); auto-expiry authoritative, manual Active/Expired only for authorized roles.

**Tested:** backend curl (shortfall 400, exact-PBG draft, claim<valid_till 400, full workflow, illegal transition 400, summary) + testing_agent iteration_71 (all frontend flows pass after a 1-line fix: projects endpoint `/mis/projects` + Promise.allSettled). No console errors. A demo WO 'WO-BG-SEED-01' (value 10L, PBG 30k) seeded in preview.

## Phase 87 (Jun 2026) — Batch Create: Job Role dropdown driven by linked Work Order

**User ask:** Batch banate waqt Work Order select karne par Job Role dropdown us WO ke courses se aaye (manual na karna pade), aur job role choose karte hi related info auto-fill ho.

**Backend:** Added scalar `job_role` field to BatchIn (persists selected role name from WO course).

**Frontend (BatchManagement.jsx):**
- New `selectedWO`/`woCourses` (from linked WO's `courses[]`), `pickWOCourse(idx)` handler, and an effect that on WO-link inherits WO FY and (single course) auto-fills role/category/hours/candidates.
- Job Role field now WO-course-driven when a WO is linked (options = WO courses, label "Job Role · from Work Order"); selecting one fills Category, Job Role Hours, No. of Candidates → Per Hour Rate + Total WO Value auto-compute. Falls back to the job-role-master dropdown (+ add) when no WO is linked. WO change resets `wo_course_index`.

**Verified (screenshot):** Linking WO-BG-SEED-01 → dropdown shows "Seed · Cat I · 200h"; select → Category I, Hours 200, Candidates 30, FY 2026-27, Rate ₹56.35, Total ₹3,38,100. No console errors.

## Phase 88 (Jun 2026) — Regularise Attendance: capture In/Out time

**User ask:** Attendance regularise karte samay date ke saath time bhi mention ho.

**Backend (server.py):** RegularisationIn now has optional `in_time`/`out_time` (HH:MM, IST). On approval (approvals/act, request_type=regularisation) the attendance row's `check_in_at` = `{date}T{in_time}:00+05:30` and `check_out_at` = `{date}T{out_time}:00+05:30` (check_out_via='regularised') instead of the approval `now`. Falls back to `now` if in_time absent.

**Frontend (CheckIn.jsx):** Regularise modal now has "In Time" + "Out Time" time inputs (shown for Present/Half; hidden for Leave). In Time required for non-leave; Out Time must be after In Time. Sent in the POST payload.

**Verified:** curl e2e — submit with in_time 10:00/out_time 18:30 → approve → attendance 2026-09-09 check_in_at 10:00+05:30, check_out_at 18:30+05:30, status present. Modal fields render + interactive (screenshot).

## Phase 92 (Jun 2026) — Financial Year (FY) System — Phase 1 (core)

**User ask:** Payment/finance ke sabhi modules me Financial Year filter — centralized, backend-level filtering (na sirf UI), p
uraane records ka backfill, FY range only FY 2023-24 → FY 2029-30, default current FY. Delivered as Phase 1 (core pages) with Phase 2 for the rest.

**User choices:** (1) GLOBAL header FY selector near company switcher + inline on each finance page; (2) include "All Financial Years" option; (3) DEFAULT = All FY (show everything; filter only when a specific FY chosen — non-breaking); (4) FY from each record's transaction date (Indian FY Apr–Mar); (5) options All + FY 2023-24..2029-30; current FY = 2026-27.

**Backend (server.py, ~line 3610 block):** Centralized FY helpers — `_fy_options`, `_finyr_bounds` (inclusive end 03-31; renamed to avoid collision with the PRE-EXISTING MIS `_fy_bounds` at ~16408 which has exclusive end), `_fy_clamp(start,end,fy)` (intersects, never widens → security-safe), `_fy_for_date`, `_current_fy_value`. New endpoints: `GET /api/financial-years` (options+current), `POST /api/admin/backfill-financial-year?dry_run=` (idempotent, stamps `financial_year` on all txns from date — non-destructive). `fy` param added + clamped on: list_transactions, dashboard_summary, dashboard_all (pass-through), milestone_income_summary, fooding_income_summary, payment_dashboard_summary, settlement_view, settlement_history. create/update_transaction now stamp `financial_year`. TransactionOut exposes `financial_year`.

**Frontend:** `lib/fy.js` (config — bump FY_MAX_START_YEAR to add FY 2030-31), `context/FYContext.jsx` (useFY, persists to localStorage 'mashara_fy'), `lib/api.js` interceptor auto-appends `fy` to finance GETs (setApiFy/getApiFy), `components/FYSwitcher.jsx` (header + inline). Wired into App.js (FYProvider) + Layout header. Core pages fy-aware (refetch on change) + inline selector: Transactions, PaymentDashboard, Dashboard, Reports, PartnerSettlement (SettlementDashboard). Transactions CSV export now has a `financial_year` column.

**Migration:** Backfill run on preview DB — 1142/1142 txns stamped.

**Verified (testing_agent iter79, 100%):** backend 8/8 (options+current, txn/summary/payment FY filtering, create stamps FY 2025-26 for 2025-08-15, FY does NOT bypass center isolation, cross-center still 403), frontend FY flows (header + inline selectors, live row-count change All→FY2025-26→FY2023-24→All, persistence).

**Phase 2 (pending):** Extend FY selector/filter + fy stamping to Invoices/InvoiceDetail, Advances, TdsRegister, BankGuarantees, BankReconciliation, Vendor/Staff payments, MIS, and FY-aware exports on those pages.

## Phase 93 (Jun 2026) — Financial Year (FY) System — Phase 2 (remaining payment modules)

**Scope:** Extended the Phase-1 FY system to Advances, Invoices, TDS Register, Bank Guarantees.

**Backend (server.py):** Added `_finyr_dt_range(fy)` (datetime-field FY range, [start, next-start)). `POST /api/admin/backfill-financial-year` now also stamps advance_requests (from `date`) and invoices (from stages.generated.timestamp) — returns advances_updated/invoices_updated. `list_advance_requests` gets `fy` param (filters advance `date`); advance create stamps `financial_year`. `list_invoices` + `invoice_dashboard` + `export_invoices_csv` + `_build_invoice_query` accept `fy` (filter stages.generated.timestamp, intersect with from/to); invoice create stamps `financial_year`; CSV export gained a "Financial Year" column. `bg_summary` accepts `fy`; BG list already had `fy`.

**SECURITY FIX (critical, found by testing_agent iter80):** `GET /api/bank-guarantees` and `GET /api/bank-guarantees/summary` had NO center-scope isolation — scoped users could see other centers' BGs. Fixed both to enforce `_scoped_center_ids(user)` (out-of-scope center_id → 403). Verified: admin sees all; accountant scoped to 9cf18e69 now sees 0 of the 4d7fc745 BGs; cross-center request → 403. (BG expiring-soon, chain, patch already guarded.)

**Frontend:** Advances.jsx + Invoices.jsx — `useFY`, refetch on global FY change, inline FYSwitcher, invoice CSV export sends fy. TdsRegister.jsx — its own FY dropdown now uses the app-wide 7-FY list and follows the global header FY selector. BankGuarantees.jsx — its `filters.fy` now syncs to the global header FY selector; summary call passes fy.

**Migration:** backfill re-run on preview DB — advances 160, invoices 5 stamped.

**Verified:** backend curl (advances fy=2026-27=160/fy=2023-24=0; invoices dashboard ALL=5/fy=2026-27=5; BG summary FY filter; BG isolation fix) + testing_agent iter80 (frontend FY flows 100% across all 4 pages: global→inline propagation, TDS/BG sync-to-global, invoice CSV FY column, center-scope preserved with fy).

**FY feature — remaining/backlog:** MIS payment views, Bank Reconciliation, vendor-payment reports, and FY-aware exports on Advances/TDS if desired; a shared Python FY module mirroring frontend fy.js (currently helpers live inline in server.py).

## Phase 94 (Jun 2026) — HRMS: Simplified Attendance→Payroll Workflow

**Goal:** Replace confusing payroll statuses (Draft/Awaiting Accounts/Issue/Resolve) with a clean 5-status flow. NO change to payroll/salary calculation formulas or existing data.

**New status flow (UI relabel only; backend statuses unchanged):**
🟡 HR Review → 🔵 HR Finalized → 🟠 Approval Pending → 🟣 Ready for Payment → 🟢 Paid. Attendance problems show as ACTION ALERTS ("N Unmarked Days"), never as a status.

**Backend (server.py):**
- NEW attendance-lock mechanism (collection `attendance_locks`, keyed by center_id+month+year, non-destructive). Helpers `_attendance_lock_doc`/`_is_attendance_locked`/`_assert_attendance_editable`. Guards added to `POST /attendance` and `PATCH /attendance/{aid}` → return **HTTP 423** when the staff's center+month is finalized.
- `GET /api/payroll/attendance-lock?month&year[&center_id]` — which centers are locked.
- `POST /api/payroll/finalize-attendance` (admin/hr) — ONE action: runs payroll (fresh draft rows) → **blocks (400, code=attendance_issues + blockers list)** if any employee has unmarked days → locks attendance for the center(s) → finalises into batch + approval workflow. Returns locked_centers.
- `POST /api/attendance/unlock` (admin/hr) — unlocks attendance; reopens the NON-paid payroll batch back to HR Review (rows→draft); paid batches flagged `paid_batch_blocked` (must be reversed via admin batch-reopen).
- payroll_run / payroll_finalise / _compute_payroll_for_staff and all calculations **UNCHANGED**; legacy endpoints still mounted.

**Frontend (HRMS.jsx):** Rewrote `_payrollStage` (5 statuses) + `_hasAttendanceIssue`, `_countPayroll`, `QuickFilterChips` (5 chips = dashboard counters), `PayrollStatusPill` (colour-coded), `AttendanceCell` (unmarked alert), `PayrollTableRow` primary actions (role-based: HR→Review Attendance, Approver→View/Approve, Accountant/Admin→Process Payment). Toolbar: replaced Run+Finalise with a secondary **Refresh** (populate review list) + hero **Finalize Attendance** (confirm dialog) + **Reopen Attendance** (when locked). Blue "Attendance Finalized & Locked" banner. lockInfo state + loadLockStatus/finalizeAttendance/reopenAttendance.

**Verified (testing_agent iter81, backend 11/11):** lock status, finalize role-gate (accountant 403), finalize blocks on unmarked (400), 423 enforcement on POST+PATCH attendance, unlock clears lock + edit succeeds, unlock role gate, legacy endpoints regression. Frontend: 5-status chips + Finalize button + no old labels + issue-as-alert confirmed. Row-level pills/banner code-reviewed (test month had 0 rows). Main agent curl-verified lock 423→unlock→200 + finalize blocking.

**Optional polish (not done):** swap native confirm()/prompt() for styled Shadcn AlertDialog.

## Phase 95 (Jun 2026) — HRMS: Auto-convert Unmarked → Absent (LOP) at Finalization

**Business rule change:** "Finalize Attendance" no longer BLOCKS on unmarked working days. Instead it auto-converts them to Absent (LOP), recalculates, sets unmarked to 0, keeps an audit trail, and proceeds.

**Backend (server.py):**
- NEW helper `_auto_lop_unmarked_for_staff(s, month, year, paid_off_dates, weekly_off_weekdays, now, actor)` — finds genuine Unmarked working days (NOT weekly-off, NOT holiday, NOT approved leave, within joining/exit window, no existing attendance row) and inserts attendance rows with `status="absent", marked_via="auto_lop", auto_lop=True` + audit fields. Idempotent.
- Rewrote `POST /api/payroll/finalize-attendance`: run payroll → auto-LOP convert for all scoped staff → RE-run payroll (unmarked→0, LOP deductions applied) → lock attendance (lock doc stores auto_lop_days/employees/note) → finalise into batch(es) → each batch audit_log gets an `auto_lop_conversion` entry. Response includes `auto_lop: {converted_days, affected_employees, note}`. NO longer returns 400 attendance_issues.
- Payroll calculations, weekly-off/holiday/leave/joining/exit handling all UNCHANGED (reuses `_paid_off_dates_in` + same date classification as `_compute_payroll_for_staff`).

**Frontend (HRMS.jsx):** `finalizeAttendance` confirm text now mentions auto-LOP; removed the unmarked-blocker alert branch; success shows an extra toast "Auto-converted N unmarked day(s) → Absent (LOP) for M employee(s)".

**Verified (curl, real scenario + cleanup):** center 10751714 / May-2026, 3 staff, 0 attendance → finalize converted 78 unmarked days (26 working days × 3, weekly-offs correctly excluded) to auto_lop Absent rows, net ₹0 (correct LOP), batch created (pending_payment → Ready for Payment), lock set with auto_lop_note, unmarked=0. Test data cleaned up afterwards. Workflow: Attendance → HR Review/Edit → Unmarked auto→Absent → Finalized → Approval → Payment → Paid.

## Phase 96 (Jun 2026) — FY System Phase 3 (Bank Reconciliation + Vendor spend)

**Backend (server.py):**
- `GET /api/bank-transactions` — added `fy` param; clamps from/to via `_fy_clamp` on the `date` field (statement date window).
- `GET /api/reports/top-vendors` — added `fy` param; filters payment `created_at` via `_finyr_dt_range`; FY takes precedence over `days` when both given.

**Frontend:**
- BankReconciliation.jsx — `useFY`, refetch on FY change, inline FYSwitcher in header. (Global header FY selector also applies via interceptor.)

**MIS — intentionally NOT FY-scoped:** `/mis/overview`, `/mis/live/*`, projects/centers/candidates/mobilization are OPERATIONAL/master data (center & candidate counts, BG expiry, enrolment %), not payment/transaction records with a transaction-date FY dimension. Applying FY there would be meaningless. Vendor MASTER (`/vendors`) is likewise master data (no date) — only vendor SPEND (top-vendors, from payments) is FY-relevant and now FY-aware.

**Verified (curl):** bank-transactions ALL=1 / FY2025-26=0 / FY2026-27=1 (row dated 2026-08-10); top-vendors FY2025-26=0 vs FY2026-27=6 (payments sit in 2026-27). Frontend compiles clean.

## Phase 97 (Jun 2026) — HRMS: "Process Payment" shortcut on batch row (BOCWW Garhwa report)

**Report (deployed app):** BOCWW Garhwa batch showed "Accounts Pending Payment" after the accountant APPROVED; no transaction created, no partner/account shown.

**Diagnosis (NOT a bug):** Approval and disbursement are two separate accountant actions. The approval chain moving the batch to `pending_payment` ("Accounts Pending Payment" / "Pending at Accounts (Final Payment)") is correct. The TRANSACTION (type=expense, source=payroll_batch) plus partner_id (derived from center), bank_account_id, UTR and payment_date are created only when the accountant runs **Process Payment / Mark as Paid** (`POST /api/payroll-batches/{id}/pay`). User confirmed the accountant had only approved, not disbursed.

**Fix/UX (user chose option d):** Added a direct **"Process Payment"** button on each batch row in `PayrollBatchesSection` (visible to admin/accountant when status=pending_payment, data-testid `pb-pay-<id>`) that opens the batch dialog and auto-jumps to the pay form (new `autoPay` prop on `PayrollBatchDialog` + `autoPayBatchId` state in HRMS). Pay form already captures method, payment date, Bank Account (debit), UTR, remarks. No backend change — pay endpoint unchanged.

**Verified (curl, preview + cleanup):** finalize→pending_payment (net ₹8,658) → pay with UTR/bank → batch `paid`, transaction created (source=payroll_batch, UTR captured, status approved). partner_id/bank_account_id populate when the center has a partner mapping + a bank account is selected (empty in the preview test center only). Test data fully cleaned. Frontend compiles clean.

## Phase 98 (Jun 2026) — EMERGENCY FIX: "Bank account not found or inactive" on payroll payment

**Root cause:** `pay_payroll_batch` (POST /api/payroll-batches/{id}/pay, ~L12280) looked up the debit account with `{"id": bank_account_id, "active": True}`, but the `bank_accounts` collection uses field **`is_active`** (there is no `active` field). So EVERY selected account failed → "Bank account not found or inactive", blocking all payroll payments. The list endpoint + vendor-payment validation already correctly use `is_active`.

**Fix (1 line):** changed the query to `{"id": bank_account_id, "is_active": True}`. No schema/data change, no parallel system.

**Verified (curl, preview + cleanup):** paid a batch with the exact account "Mashara Utkarsh Current A/C- 1140" (id 0575cb60, is_active:true) → HTTP 200, batch status=paid, transaction created (source=payroll_batch, bank_account_id + UTR stored, status approved). Error gone.

**Already working (confirmed, no change needed):** pay modal captures method/date/bank-account/UTR/remarks; pay creates the linked transaction, marks each employee paid, stamps partner (auto-derived from center) + bank account + UTR, writes audit_log; batch→paid; duplicate-pay blocked (requires status=pending_payment); transaction appears in Transactions.

**Still NOT built (larger spec items for a follow-up, needs scope confirmation):** merge final-approval + payment into ONE "Approve & Record Payment" action on the approvals screen; explicit mandatory Partner dropdown + "Paid By" dropdown in the pay modal; employee-level partial PAID/FAILED/PENDING with "Partially Paid" batch status + Retry Payment.

## Phase 99 (Jun 2026) — Candidate "Re-map Centers & Batches" one-click backfill button

**Request (Hindi):** "unmapped ko mapped kijiye" — production candidates showing UNMAPPED center (e.g. CTR-M28M) + UNLINKED batch (e.g. Pakur_09) chips.

**Root cause:** Backfill endpoint `POST /api/candidates/backfill-center-mapping` existed but had NO UI trigger. Existing roster candidates stored center code / batch name as text; their `center_ref_id`/`batch_ref_id` were never resolved → Unmapped/Unlinked.

**Fix (frontend only):** Added "Re-map Centers & Batches" button to Candidates page top toolbar (`Candidates.jsx`, data-testid `btn-remap-mappings`, roles admin/manager/senior_manager). Confirms, calls backfill endpoint with current `project`, toasts result (`X/Y centers mapped, Z batches linked, N still unmapped`), then reloads list + options. No backend change.

**User context:** Centers DO exist in Center Management (so center mapping will resolve); financial batches (Pakur_09 etc.) NOT yet created in Batch Management — those stay UNLINKED until created. Clicking the button again after creating batches will link them.

**Verified (curl, preview admin):** POST backfill → HTTP 200, {total:97, mapped:5, unmapped:92, batch_mapped:0} (preview test data). Button renders in toolbar (screenshot confirmed).

## Phase 100 (Jun 2026) — Payroll approve salary breakdown + reimbursement template download fix

**Issue 1 — Employee-wise salary breakdown on payroll approval (FIXED):**
Previously per-employee salary detail loaded ONLY for Accounts/Admin (isPayrollPay one-screen approve+pay). Senior Manager / HR / Manager approvers saw only "N staff · Net payable ₹X". 
Fix (`PendingApprovals.jsx`): `openAct` now fetches `/payroll-batches/{id}` for ANY payroll approve/view (not just accounts). Added a read-only Salary Breakdown table (data-testid `payroll-salary-breakdown`) in the act dialog showing per-employee Name, Emp Code, Gross, Deductions, Net + net total — visible to every approver. Backend `_payroll_batch_out` already returns gross/deductions/net per row (confirmed via curl, 204-row batch).

**Issue 2 — "Not authorised to view this file" on reimbursement template download (FIXED):**
Root cause: `GET /api/files/view` (server.py ~L1852) had no carrier for template files. Reimbursement/salary-slip/offer-letter templates are blank non-sensitive forms whose LIST endpoints are open to all authenticated users, but the file-stream auth blocked non-privileged roles (center_manager/center_staff/partner) → 403.
Fix (server.py): before the final 403, allow any authenticated user to stream a file whose `file_path` exists in `reimbursement_templates`, `salary_slip_templates`, or `offer_letter_templates`. 
Verified (curl): admin uploaded reimbursement template → center_manager (`cmtest_salary@x.com`) GET /files/view → HTTP 200 (was 403). Test template cleaned up.

## Phase 101 (Jun 2026) — Partner Batch Management menu + MIS/TDS cross-company data leak fix

**Issue 1 — Partner cannot see Batch Management menu (FIXED):**
`Layout.jsx` `canSee()` — `batchMgmtAccess` role list was missing `partner`. Added `partner`. Backend `/api/batches` already scopes partners to their mapped centers. Verified: partner login now shows BATCH MANAGEMENT group in sidebar.

**Issue 2 — MIS Dashboard showed ALL companies' data to a partner (SECURITY, FIXED):**
`/api/mis/live/*` endpoints counted everything globally (`count_documents({})`, `_mis_live_batch_rows()` over all batches) with NO center scope → a partner saw every company's projects/centers/batches/enrolled/certified.
Fix (server.py): added `_resolve_mis_scope(user)` (enrich + `_scoped_center_ids`), refactored overview/rollups into `_compute_mis_overview(scoped)` / `_compute_mis_rollups(scoped)`, added `scoped` param to `_mis_live_batch_rows()`. Scoped every endpoint: overview, project-summary, filter-options, rollups, reports/daily, drilldown. Head-level (admin/senior_manager) = unrestricted (scoped=None); scoped roles restricted to mapped center_ids; no centers → zeros/empty.
Verified (curl): admin overview centers=213/batches=353/enrolled=97; partner centers=2/batches=0/enrolled=0. project-summary admin 353 vs partner 0. rollups by_center admin 58 vs partner 0. drilldown centers admin 100 vs partner 2.

**Issue 3 — TDS Register showed cross-company TDS (SECURITY, FIXED):**
`/api/reports/tds-register` queried all `source=tds_deduction` transactions with no scope. Fix: enrich user + apply `_center_scope_query(user, field="center_id")`; `_never_` → empty register. Head-level unrestricted. (No TDS txns in preview, so both admin/partner returned 0 — logic mirrors established center-scope pattern.)

## Phase 102 (Jun 2026) — Pending Approvals premium SaaS redesign

**Request:** Redesign /pending-approvals into a modern premium enterprise dashboard (design reference provided), preserving ALL approval logic + RBAC.

**Delivered (frontend only — `PendingApprovals.jsx`):**
- Premium gradient header (navy→indigo→blue) with illustration; refreshed scrollable tab bar with active-pill + count badges; 4 pastel KPI cards (Total Awaiting / Total Amount / Oldest days / Updated) with icon tiles; refreshed purple payroll highlight card.
- Toolbar: live search (requester/purpose/vendor), Filter popover (Priority/Center/Amount range/Date range) with active-filter badge + Clear, List⇄Grid view toggle persisted in localStorage (`pa_view`).
- Request cards (rounded-xl, soft shadow, hover) with bulk-select checkbox, type/PARTNER-CROSS/FINAL-STEP chips, age-derived Priority chip (0-2d Low · 3-6d Medium · 7d+ High — NO DB field), requester box, vendor/payee chip, description, amount + dates, View/Approve/Reject/Send-Back.
- Bulk selection + bulk Approve/Reject with confirmation dialog, shared remarks (min 3 chars). SAFE rule: bulk approve SKIPS payment/reimbursement/advance/payroll FINAL-STEP items (needsAttribution) with a warning; reject allowed on all. Selection clears on tab change.
- Client-side pagination (10/page), loading skeletons, Inbox-Zero empty state.
- **PRESERVED unchanged:** single approve/reject/send-back dialog, payment attribution (Paid By/Center/Partner/Bank), payee details, attachments, chain history, payroll Approve+Pay one-screen flow, salary breakdown. All backend endpoints untouched (/approvals/pending, /approvals/act, partner-approve/reject, payroll-batches).

**Design:** blueprint in /app/design_guidelines.json (by design_agent).
**Tested:** testing_agent iteration_83.json — 13/13 frontend scenarios PASS (100%), no bugs. Individual approve + bulk approve/reject verified persisting to backend; skip-rule, filters, search, view-toggle, pagination, empty-state all pass.

## Phase 103 (Jun 2026) — Full-width layout fix + premium navy sidebar (global)

**Root cause of half-width:** The app shell (`Layout.jsx`) was already full-width (sidebar w-60 + `flex-1` main). The narrow/centered look came from the PAGE: `PendingApprovals.jsx` used `max-w-7xl mx-auto`, centering content to ~1280px on wide screens. Fixed by switching the page container to `w-full` (left-aligned, uses full workspace). KPI grid is `lg:grid-cols-4` → 4 cards per row at 1366/1440/1920.

**Premium sidebar (shared across ALL modules — `Layout.jsx` + `index.css`):**
- New enterprise-navy palette as CSS vars: --sb-bg #0B1F3A, --sb-bg2 #102B4E, --sb-active #155EEF→--sb-active2 #2563EB (active gradient), --sb-text #F8FAFC, --sb-text2 #CBD5E1, --sb-icon #C7D7F2, --sb-hover #193B63, --sb-divider #294563, --sb-badge #F59E0B. Workspace --bg → #F5F8FC.
- Helper classes `.sb-group/.sb-group-active/.sb-link/.sb-link-active` (gradient + left accent bar via ::before + shadow) + `.sb-chevron` rotate animation.
- Brand header: gradient logo tile (Landmark icon) + "Mashara Finance / FINANCE CONSOLE". Group buttons highlight when a child route is active; active link = blue gradient pill + light-blue left accent + white text/icon; hover = --sb-hover; badges amber (#F59E0B). Chevron rotates on expand. Mobile Sheet drawer reuses same SidebarBody (navy) with light close-X.
- **Preserved:** every menu item, group, route, RBAC gate, badge logic, auto-expand-on-route — ONLY className/colors changed, zero logic change.

**Pending Approvals header:** added breadcrumb "Approvals & Workflow → Pending Approvals" inside the gradient header (data-testid pa-breadcrumb).

**Verified (screenshots):** 1920×1080 + 1440×900 — page full-width, sidebar navy with correct active states on /pending-approvals and /transactions; no module broken; compile clean (1 benign warning). Approval interactions unchanged from Phase 102 (tested 100% in iteration_83).

## Phase 104 (Jun 2026) — Pending Approvals request card: 3-section layout (per reference)

User wanted each request card split into 3 side-by-side sections (ref image). Rebuilt `RequestCard` in `PendingApprovals.jsx`:
- **Section 1 — Requester details** (lg:col-span-4, right divider): type + PARTNER-CROSS/FINAL-STEP badges, requester name (user icon), Employee ID / Department / Designation (stacked), center chip.
- **Section 2 — Payment details** (lg:col-span-5, right divider): purpose, Payee/Vendor chip, big green amount ₹, description, date + raised date.
- **Section 3 — Approval details** (lg:col-span-3): Priority chip (age-derived) + kebab (⋮ → opens details) top-right, View/Approve/Reject (+Send Back) buttons bottom-right.
- Grid view keeps a stacked compact variant of the same 3 blocks. All button/select/priority data-testids preserved (btn-approve/btn-reject/btn-detail/btn-sendback/select-/priority-) + new sec-requester/sec-payment/sec-approval/kebab- testids.
- Fixed `oldestDays()` to clamp at 0 (was showing "-1" for future-dated test records).
Logic unchanged (handlers identical) → no re-test needed; verified via screenshot at 1920×1080 (3 sections render on all cards).

## Phase 105 (Jun 2026) — Payment approval: project name now populated (was "Project: —")

**Issue:** Approving a Payment Request created an expense transaction with `project_id: None` (hardcoded) → Transactions list Allocation showed "Project: —". Payment & quotation records don't store a project; it must be derived from the center.

**Fix (backend only, server.py):**
1. `_derive_context_for_center()` now also resolves `project_id` = most-common `project_id` among the center's batches (fallback: most-common project across existing approved txns at that center). Previously always returned None.
2. Payment final-approval block (request_type=="payment"): computes `eff_project_id` (from `rec.project_id` else derived context) and stamps it on the new transaction instead of `None`.
3. New idempotent startup migration `_backfill_txn_project_ids()` — fills `project_id` on existing `quotation_payment`/`payment` transactions missing it, deriving per-center from batches. Auto-applies on deploy.

Frontend unchanged (Transactions.jsx already resolves project_id→name via nameOf).
**Verified:** _derive + backfill logic test — a payment txn at a center with batches resolved project_id → correct project name; backend startup clean (no errors). Preview test-data centers lack batch projects so their 16 payment txns stay — (expected); production centers (e.g. BOCWW Garhwa) have batches so will resolve on deploy.

## Phase 106 (Jun 2026) — Partner payroll approver: employee salary breakdown not showing (403 fix)

**Issue:** When a PARTNER approves a Payroll Batch, the "Approve Payroll Batch" dialog showed only "N staff · Net payable ₹X" — the per-employee salary breakdown (added Phase 100) was missing.

**Root cause (backend):** `GET /api/payroll-batches/{batch_id}` role list did NOT include `partner`. The frontend loads the batch for any payroll approver (openAct else-if) but a partner got 403, which `.catch(()=>{})` silently swallowed → `payBatch` stayed null → breakdown never rendered. Additionally the endpoint's IDOR guard called `_scoped_center_ids(user)` WITHOUT `_enrich_user_with_associations(user)`, so even after adding partner it would 403 (empty `_associated_center_ids`).

**Fix (server.py, backend only):**
1. Added `"partner"` to `get_payroll_batch` allowed roles.
2. Added `await _enrich_user_with_associations(user)` before the IDOR scope check so a partner's mapped centers resolve.

Frontend unchanged (Phase 100 breakdown table already renders when payBatch.rows present).
**Verified (curl):** partner mapped to batch center → HTTP 200 + 252 rows (name/emp code/gross/deductions/net); partner at out-of-scope center → 403 (IDOR intact); admin → 200. Test mutation reverted.

## Phase 107 (Jun 2026) — Mess & Inventory Management Module (Phase 1 MVP)

New main menu "Mess Management" (/mess). Backend-calculated, center-scoped, Finance-linked.

**Backend (server.py — section 'MESS & INVENTORY MANAGEMENT MODULE'):**
- Collections: mess_items (global catalogue), mess_stock (per center+item, weighted-avg), mess_ledger (immutable transactions), mess_receipts (goods receipt + approval), mess_consumption.
- Weighted-average costing: _mess_apply_receipt (stock-in recomputes avg), _mess_apply_issue (atomic `{qty:{$gte}}` decrement → fail-closed, no negative stock).
- Goods Receipt: create (pending) → approve (admin/senior_manager/manager/accountant) → stock-in ACCEPTED qty only + ONE Finance expense txn source='mess_purchase' + ledger. Re-approve blocked. Duplicate invoice (center+supplier+invoice_no) → 409.
- Consumption/Wastage: multi-line, pre-validate + rollback-on-partial-failure, issues at weighted-avg.
- Dashboard: opening/received/consumption/closing values, mess expenses, meals, cost/person (consumption÷meals, guarded /0, NOT purchases → no double count), low-stock, pending bills.
- Unit conversion (_to_base_qty): base_unit / purchase_unit*conversion_factor; incompatible unit → 400.
- Center RBAC: _mess_scope + _mess_center_query (IDOR guard — out-of-scope center → 403; no centers → empty). Roles: view=admin/senior_manager/manager/center_manager/accountant/mess_staff/partner/viewer; entry=+center_manager/mess_staff; approve=admin/sm/manager/accountant; item-master write=admin/sm/manager.
- Excel export GET /mess/ledger/export.xlsx (openpyxl). Seed startup `_seed_mess_items` (16 default items, idempotent).

**Frontend:** /app/frontend/src/pages/MessManagement.jsx — 6 tabs (Dashboard, Item Master, Stock, Goods Receipt, Consumption, Stock Ledger), center+date filters, KPI cards, multi-line receipt/consumption dialogs, item CRUD, approve/reject, Excel export. Menu group grp_mess in Layout.jsx (messAccess gate) + route in App.js + i18n (en/hi).

**Tested:** iteration_84.json — backend 22/23 pytest pass (1 skipped: no unauthorized-role user; code verified), frontend all tabs/flows pass, no regression (transactions/payroll/approvals still 200). Fixed LOW a11y (added DialogDescription). Verified via curl: weighted-avg ₹58, insufficient→400, duplicate→409, dashboard cost/person ₹25.

**Phase 2 pending (NOT built):** Recipes/Menu master, Physical Stock Count, Daily Closing lock/reopen, Purchase Requests + low-stock→PO, PDF reports, purchase returns/supplier credits, payment-status updates, generic pending-approvals inbox wiring (currently dedicated approve endpoint), new `mess_staff` role assignment in User Management dropdown.

## Phase 108 (Jun 2026) — Mess Phase-2 (Daily Closing + Physical Stock Count) + Pending-Approvals inbox integration

**Improvement — Mess receipts in Pending Approvals inbox:**
- Extracted _mess_approve_core / _mess_reject_core; dedicated endpoints + generic inbox both use them.
- /api/approvals/pending now appends pending mess_receipts (request_type="mess_receipt", is_final_step, summary w/ amount/supplier/invoice) for MESS_APPROVE_ROLES, center-scoped.
- /api/approvals/act handles request_type="mess_receipt" (early branch before APPROVAL_TYPE_COLL lookup) → approve/reject via core. Added "mess_receipt" to ApprovalActionIn.request_type Literal. Frontend TYPE_META got mess_receipt entry (lime, Mess Receipt). Verified: receipt shows in inbox + approve via /approvals/act creates expense.

**Daily Mess Closing (lock/reopen):**
- _mess_closing_figures (opening/received/consumption/wastage/closing/mess_exp/meals/total_daily_mess_cost=consumption/cost_per_person guarded÷0).
- GET /mess/closing (preview+existing), POST /mess/closing (close, dup→409, snapshot+lock), POST /mess/closing/reopen (reason required, audit history). mess_post_consumption blocks a 'closed' (center,date) → 400 (locked-day guard). Roles: view=MESS_VIEW, close/reopen=MESS_APPROVE. Verified: close→locked, consume→400, dup→409, reopen→200.
- Frontend: Daily Closing tab (status banner, summary rows, Close/Reopen buttons).

**Physical Stock Count (adjustments):**
- POST /mess/stock-counts (MESS_APPROVE) → per item diff=counted-system, valued at weighted-avg, posts immutable 'adjustment' ledger rows + updates stock (never overwrites history); stores mess_stock_counts doc (system/counted/diff/diff_value/reason). GET /mess/stock-counts. Verified: count 240 vs 250 → stock=240 + adjustment ledger.
- Frontend: Stock Count tab (system qty + counted input + live diff, Post & Adjust, Past Counts).

Collections added: mess_closings, mess_stock_counts. Verified via curl + screenshots (both tabs render). No testing_agent re-run (all new endpoints curl-verified, frontend screenshot-confirmed).

**Phase-2 STILL PENDING (next batch):** Recipe/Menu master (expected vs actual variance), Purchase Requests + low-stock→PO workflow, PDF report exports, purchase returns/supplier credits, receipt payment-status updates, assigning the new mess_staff role in User Management dropdown.

## Phase 109 (Jun 2026) — Mess Goods Receipt → full Approval Workflow + Bill Upload + Auto Bill PDF

**Context:** Earlier mess_receipt was a single-step approve. User asked: (1a) connect Goods Receipt to the multi-level Approval Workflow with a NEW configurable chain request type + "Pending With ___" tracking; (2b+) payment ALSO routes through its own approval chain; (3) auto-generate a PDF bill after payment approval, with a configurable template in HR Settings (like Salary Slip); (4) option to upload the vendor's shop bill.

**Backend (server.py):**
- Added chain types `mess_receipt` (center_manager[optional]→senior_manager→accountant) and `mess_payment` (senior_manager→admin→accountant) to DEFAULT_CHAINS, ApprovalType + ApprovalActionIn Literals, and APPROVAL_TYPE_COLL (mess_receipt→mess_receipts, mess_payment→mess_payments). Both configurable in Approval Workflow UI.
- Removed the bespoke single-step mess_receipt branch in approval_act and the bespoke inbox append; mess docs now flow through the GENERIC chain engine (carry chain_id/current_level/chain_snapshot/chain_history + generic summary fields amount/date/purpose/description/vendor_name). Generic inbox builder surfaces them to the correct step approver with pending_with.
- mess_create_receipt now calls _attach_chain_to_request("mess_receipt") + notifies first-step approvers. Refactored posting into `_mess_post_receipt` (stock-in + mess_purchase expense, no status mutation); `_mess_approve_core` is now a legacy/admin single-step override (sets current_level=0). approval_act final branches: mess_receipt→_mess_post_receipt+status approved+expense_txn_id; mess_payment→_mess_finalize_payment.
- mess_list_receipts enriches pending rows with _enrich_with_approval_status (pending_with + current_step_label).
- Payment: `MessPaymentRaiseIn` + POST /mess/receipts/{id}/raise-payment (approved+unpaid only, dup 409) → creates mess_payment doc + mess_payment chain, flips receipt payment_status=payment_pending. On final approval _mess_finalize_payment marks receipt paid + generates bill. Reject of mess_payment frees receipt back to unpaid.
- Auto Bill PDF: new module /app/backend/mess_bill.py — build_mess_bill_pdf (reportlab default, line items + approval trail + signatures) and build_mess_bill_context+render_mess_bill (docxtpl DOCX template → LibreOffice PDF). _generate_mess_bill stores to object storage + registers db.files + db.mess_bills (bill_no MB-YY-NNNN). GET /mess/receipts/{id}/bill streams PDF (404 before paid).
- HR Settings template: POST/GET/DELETE /mess-bill-templates (admin/hr, DOCX, per-company or global) + _resolve_mess_bill_template. If present, bill renders via template; else default layout.
- /files/view: added mess_receipts to center-scoped carriers (approvers view uploaded shop bill) + mess_bill_templates to the public-template allowlist.
- Collections added: mess_payments, mess_bills, mess_bill_templates.

**Frontend:**
- MessManagement.jsx ReceiptsTab: removed inline Approve/Reject (approvals now via Pending Approvals inbox); added "Pending with: <names> · <step>" chip (data-testid pending-with-<id>), "Raise Payment" button+RaisePaymentDialog (approved+unpaid), "Download Bill · <bill_no>" (paid), vendor-bill attachment view. ReceiptDialog: shop-bill upload via /files/upload (data-testid receipt-bill-upload).
- ApprovalWorkflows TYPES: added Mess Goods Receipt + Mess Payment. PendingApprovals TYPE_META: added mess_payment. HrSettings: new "Mess Bill" tab → new component /app/frontend/src/components/MessBillTemplatesTab.jsx.

**Testing:** iteration_85.json — 100% (17/17 backend pytest + all frontend flows). Full chain advance L1→L2→L3, stock+expense on final, raise-payment→mess_payment chain, final payment→paid+bill MB-26-0001 (valid %PDF), pending_with, inbox surfacing, center RBAC 403, template 400/403 guards. No critical/minor issues. Backend changes require re-deploy to production.

**STILL PENDING (next batch):** Recipe/Menu master + expected-vs-actual variance, Purchase Requests + low-stock→PO workflow, report PDF/Excel exports, purchase returns/supplier credits, assigning new mess_staff role in User Management dropdown, modularise server.py mess module into routers.

## Phase 110 (Jun 2026) — Fix: Accountant can't see employee salary/account breakdown when approving Payroll Payment

**Bug:** In the "Approve & Pay Payroll Batch" dialog, the Accounts Team (accountant) saw "0/0 · ₹0" and NO employee name/amount/account-number breakdown.
**Root cause:** GET /api/payroll-batches/{id} applied a strict center IDOR guard. A center-scoped `accountant` (assigned_center_ids set) got 403 for batches whose center was outside their scope — even though they are the org-wide payroll payer/final approver (the /pay endpoint itself has NO center restriction for admin/accountant). The frontend `.catch(()=>{})` left payBatch.rows empty → breakdown hidden + "0/0". Reproduced on preview: accountant (center 9cf18e69) GET batch in center 599bb7e2 → 403.
**Fix (server.py get_payroll_batch ~12356):** Before the 403, also allow when the user is a legitimate participant: (a) current-step approver `_user_can_act_on_request(user,b)` [covers the one-screen Approve+Pay accountant], (b) already acted in chain_history, (c) role==accountant and batch status in pending_payment/partially_paid/paid [payer state — matches the unscoped /pay endpoint]. Non-participants outside scope still 403.
**Verified (curl):** accountant outside center → 200 with rows (staff_name, employee_code, net, bank_account_no_masked, ifsc). Regression: center_manager (non-participant) outside center → 403; own center → 200.
**Frontend (PendingApprovals.jsx):** Added "A/C No · IFSC" column to the Salary Breakdown table (shows r.bank_account_no_masked · r.ifsc, or "No bank details"). Backend already returns masked account + ifsc per row. data-testid breakdown-acct-<staff_id>.
**Note:** Exact in-dialog screenshot not reproducible on preview (no payroll batch currently in pending_approval); data path + RBAC confirmed via curl. Backend change requires re-deploy to production.

## Phase 111 (Jun 2026) — Accountant sees FULL Account No + IFSC for EVERY payment type

**Request:** "kisi bhi prakar ka payment ho Accountant ko pura Account number aur IFSC code dikhna chahiye" — full (unmasked) bank account + IFSC for all payment types.
**Audit of flows:**
- payment / advance_request → already showed full payee account + IFSC (entered payee details). No change.
- payroll → was MASKED (****1234). FIXED.
- reimbursement → paid to EMPLOYEE bank; dialog had NO payee block. FIXED.
- mess_payment → payee fields stored at raise-payment but dialog didn't render them. FIXED (frontend only; summary already carries payee_* via generic builder).
**Gating:** full bank is sensitive → exposed only to SALARY_VISIBLE_ROLES = {admin, hr, accountant, partner, manager, senior_manager} (same policy as salary visibility). center_manager/center_staff/viewer still get masked.
**Backend (server.py):**
- `_payroll_batch_out(batch_id, include_full_bank=False)`: staff projection now also pulls bank_name/account_holder_name; rows get bank_account_no_masked always, full bank_account_no ONLY when include_full_bank, plus ifsc/bank_name/account_holder_name. `get_payroll_batch` passes include_full = (role in SALARY_VISIBLE_ROLES).
- `list_pending_approvals`: post-pass for SALARY_VISIBLE_ROLES enriches reimbursement items' summary with the EMPLOYEE's bank (payee_account_no/ifsc/bank_name/account_holder) resolved by staff_id OR by requester user_id (created_by). Batched, no N+1.
**Frontend (PendingApprovals.jsx):**
- Payee Details block now renders for payment, advance_request, reimbursement, mess_payment (headers: "Payee Details (Employee Bank)" / "(Supplier)").
- Payroll Salary Breakdown "A/C No · IFSC" column shows full `bank_account_no` when present, else masked.
**Verified:** curl — admin/accountant (salary-visible) get full `918273645012`; center_manager gets only masked `****5012`. Reimbursement payee enrichment returns full employee account to admin/accountant. UI screenshot — reimbursement approval dialog shows "PAYEE DETAILS (EMPLOYEE BANK)" with Account No 550099887766 + IFSC ICIC0004321 + Bank. Backend change requires re-deploy to production.
**Preview test-data note:** set bank on staff 4296daf3 (payroll test) and 7566f043 (renamed "Reimb Employee", reimbursement test) — harmless preview seed.

## Phase 112 (Jun 2026) — Complete Mess Bill: GST invoice, dynamic placeholders, multi-item/multi-page DOCX
- `mess_bill.py` fully rewritten: `compute_mess_tax` (decimal, per-line CGST/SGST at rate÷2 or IGST, intra/inter decided by company-vs-supplier GSTIN state-code prefix, round-off; matches XPERT sample EXACTLY → taxable 5423.72, CGST 488.13, SGST 488.13, round-off 0.02, grand 6400); `build_mess_bill_context` exposes all placeholders (bill/company+buyer/supplier/GST/payment/supplier-bank/line s_no·hsn·tax_rate·tax_amount·taxable·amount/approvals); `build_mess_bill_pdf` professional multi-page invoice (repeatRows header, continuous S.No, KeepTogether totals, NumberedCanvas "Page X of Y" + repeating identity band — 28 items → 3 pages); `build_sample_template_docx` (python-docx: Word-native tblHeader repeat, cantSplit row-integrity, PAGE/NUMPAGES fields, 3-row {%tr for%}/data/{%tr endfor%} loop with {{loop.index}} — 28 items → 4 pages); `validate_template_bytes` (real docx + Jinja parse + sample render + unknown-placeholder warnings); INR/paise word helpers.
- server.py: MessReceiptLine +`gst_rate`+`hsn_sac` (optional); receipt creation computes tax from gst_rate when given (else flat tax amount) and stores `taxable`; `_generate_mess_bill` now loads the linked Vendor (supplier bank/GST/PAN/address — payee bank gated), computes tax, passes supplier+tax to context/pdf; NEW endpoints GET `/mess-bill-templates/sample`, POST `/mess-bill-templates/validate`, GET `/mess-bill-templates/preview?template_id=` (renders XPERT sample → PDF). Template priority: company-active → global-active → ReportLab default.
- Frontend: Goods Receipt LineEditor +HSN/SAC +GST% +Discount +Tax-amt row; MessBillTemplatesTab rebuilt — searchable collapsible placeholder categories (Bill/Company/Supplier/GST/Payment/Bank/Items/Approvals) with examples+copy, Download Sample, pre-upload Validate (errors/warnings gate upload), Preview Sample Bill, per-template Preview.
- Verified: GST math exact vs sample; default PDF 3pp & template render 4pp @28 items; sample template validates ok; endpoints 200; receipt stores HSN/GST%; HR Settings Mess Bill UI renders (all data-testids). NOT yet run through testing_agent (extensive manual verification done). Backend change needs re-deploy.

## Phase 113 (Jun 2026) — Goods Receipt: supplier dropdown-only + redesigned modal UI
- User req: "Supplier, only dropdown se choose (Carry From Vendor list)" + rebuild New Goods Receipt dialog to match provided mockup.
- Frontend (MessManagement.jsx `ReceiptDialog` fully rewritten): Supplier is now a **dropdown bound to Vendor Master** (`GET /vendors`, active only, shows `name · GSTIN`); on select sets both `supplier_id` + `supplier_name`; free-text input removed; save blocks if no supplier chosen; empty-vendor guidance ("add suppliers in Procurement → Vendors").
- New professional modal matching mockup: header (Package icon + title + subtitle), row1 Center/Invoice No/Invoice Date, row2 Supplier(dropdown)/PO No, full **Items table** (S.No · Item[+HSN/SAC sub-row] · Qty · Unit · Rate · Discount · GST%[select 0/5/12/18/28] · Accepted Qty · Line Total · Action), Add Line, **Amount Summary** (Subtotal, Total Discount, Total GST(rate%), blue Grand Total card w/ RefreshCw — all live-computed), Shop Bill upload. Dialog max-w-6xl. All data-testids present (receipt-supplier, line-*-N, receipt-subtotal/discount/gst/grand-total, etc).
- `newReceiptLine()` defaults gst_rate "18"; save sends gst_rate (number|null), hsn_sac, tax:0 (gst_rate drives tax server-side). LineEditor (consumption) untouched.
- Verified via UI e2e: created vendor "Shree Traders" (27ABCDE1234F1Z5) → dropdown populated → qty5×rate200 @18% → Line Total ₹1,180, Subtotal ₹1,000, GST(18%) ₹180, Grand ₹1,180 → Create Receipt succeeded ("routed to approval workflow"); new receipt shows supplier "Shree Traders". Backend already supported supplier_id (bill gen loads Vendor by supplier_id).

## Phase 114 (Jun 2026) — Full page reload on all menu/submenu navigation
- User req: every sidebar menu / submenu / nested nav / dropdown nav click must do a FULL browser page reload (not SPA routing) so each destination fetches fresh backend data. No redesign, no business-logic change.
- Frontend (Layout.jsx only): added module-level `hardNavigate(e, to)` → on plain left-click `e.preventDefault()` + `window.location.assign(to)`; modifier/middle clicks fall through (open-in-new-tab intact). Wired into: sidebar submenu NavLinks (desktop + mobile drawer, same SidebarBody), mobile bottom-tab NavLinks, header "Pending" pill, notifications dropdown item (`onNotifClick`), and the Module-Locked page buttons (Subscription / Back to Dashboard). Group header buttons still only expand/collapse (unchanged). Logout still uses SPA `nav("/login")`.
- Why safe: BrowserRouter at root (no basename) → `window.location.assign("/path")` resolves correctly. Auth is cookie-based + `loading` gate in ProtectedRoute prevents login-bounce during re-auth; `companyChosen` lives in sessionStorage which survives full reloads within a tab → no /select-company redirect loop. RBAC/center scoping unchanged (same NavLink `to`, same gating).
- Verified via Playwright marker test: set `window.__spaMarker` → click "Companies" submenu → marker GONE = FULL_RELOAD, URL `/companies`, breadcrumb + active highlight + expand/collapse intact, session preserved. 2nd nav (Procurement→Vendors) also FULL_RELOAD. Browser Back returns to `/companies` via full load with sidebar/session intact. Frontend-only change; takes effect in production after deploy completes.

## Phase 115 (Jun 2026) — Transactions page prod 500 (type='asset') + robust loading/error + navigation hybrid
- **Prod bug:** live /transactions showed Total 0 / "No data yet". Deployer RCA: GET /api/transactions **500s in production** because `TransactionOut.type` was a strict `Literal['investment','income','expense']` and prod has 1 txn with `type='asset'`; the whole list is validated at once (`[TransactionOut(**d) for d in docs]` @ server.py:3840) so that single row raised pydantic ValidationError and 500'd the ENTIRE response. Prod DB is correctly bound (501 txns, NOT empty, NOT an FY/scope issue). Preview had no 'asset' row so never reproduced. Frontend's missing catch rendered the 500 as a false "0 / No data yet".
- **Backend fix (server.py):** `TransactionOut.type` overridden to plain `str` (READ tolerates any legacy/auto-created value; INPUT `TransactionIn.type` stays strict Literal so NEW txns can only be investment/income/expense). `list_transactions` now serializes **per-row with try/except** (bad row logged + skipped, never 500s the whole endpoint). Verified: inserted a `type='asset'` row → endpoint returns HTTP 200 with the row included (previously 500); then cleaned up the test row.
- **Frontend fix (Transactions.jsx):** added `loading` + `error` state. `load(background=false)` → content skeleton on initial/filter-change; **error state + Retry** on failure (errors NEVER coerced into a false empty list); background refreshes (approve/reject/partner-approve/bulk/delete/import) pass `load(true)` to preserve rows; empty message now reads "No transactions found for the selected filters" only when API genuinely returns zero (else `no_data`). KPI cards show skeleton while loading. Verified: happy path 1160 rows; simulated 500 shows "Couldn't load transactions"+Retry (no false zero); Retry recovers.
- **Navigation hybrid (user chose option c):** reverted Phase 114 full-reload-on-every-menu-click → **SPA navigation restored** (Layout.jsx NavLinks/pending-pill/notifications/locked-buttons back to `nav()`; `hardNavigate` helper removed) so sidebar/header/selectors stay mounted during navigation (only content shows skeleton). **Company switch** (CompanySwitcher.jsx) and **FY switch** (FYContext.setFy) now do a hard refresh (`window.location.assign("/")` / `window.location.reload()`). Verified via marker: menu nav keeps shell (SPA), FY switch hard-refreshes.
- **Requires redeploy** for prod to pick up backend+frontend fixes. Open decision for user: is `type='asset'` a legitimate transaction type? If not, correct that 1 prod doc via DB Manager; the code fix is mandatory regardless so one stray value can't take the page down again. RCA: /app/deployer-agent-docs/RCA_9efa54d2-16fe-42d5-acb9-d02bc1b4e87a.MD

## Phase 116 (Jun 2026) — Mess bill PDF "Failed to load" fix + accountant center/partner/bank at mess payment
- **Issue 1 (bill PDF won't open):** when an HR-Settings DOCX template is used, `render_mess_bill` tries LibreOffice DOCX→PDF; LibreOffice is NOT baked in (installed best-effort at startup via `_ensure_libreoffice_installed`), so in prod it fell back to **DOCX bytes** — but `mess_download_bill` hard-coded `media_type="application/pdf"` + `.pdf` name, and the frontend hard-coded `a.download=...pdf`, so a DOCX got mislabelled as PDF → Chrome "Failed to load PDF document".
  - **Fix:** (a) `mess_bill._docx_to_pdf` now runs LibreOffice with a per-call `-env:UserInstallation=file://<tmp>/_lo_profile --norestore --nolockcheck` → prevents the headless shared-profile lock that made concurrent conversions (salary slip/offer letter/mess bill) silently fail in prod. (b) `mess_download_bill` **sniffs the actual bytes** (`%PDF`→pdf inline, `PK`→docx attachment) and serves the correct Content-Type + filename — fixes existing broken bills too. (c) `_mess_finalize_payment` stores `bill_content_type` + correct-ext filename. (d) Frontend `downloadBill` reads `blob.type` → opens PDF inline / downloads DOCX as `.docx`.
  - Verified: existing preview bills serve as valid `%PDF` inline; a DOCX-fallback bill serves as `application/vnd...wordprocessingml.document` attachment (valid `PK`); hardened conversion still yields valid `%PDF`; full new bill from template = valid PDF.
- **Issue 2 (accountant can't choose center/partner/bank at mess payment):** user wants the **final approver (accountant)** to pick the **SOURCE bank account (ledger debit)** + confirm **center/partner** allocation.
  - **Backend (server.py `/approvals/act` `mess_payment` branch):** on final approve → `_require_bank_account_if_configured(bank_account_id)` + `_post_bank_ledger(direction="debit", source="mess_payment")` (bank balance reduces); resolves `eff_center_id = txn_center_id or receipt.center_id`, `eff_partner_id = txn_partner_id or derive_from_center`; **re-allocates the linked expense txn** (center/partner + bank_account_id/bank_txn_id) and stamps the mess_payment. `ApprovalActionIn` already carried bank_account_id/txn_center_id/txn_partner_id/paid_by.
  - **Frontend (PendingApprovals.jsx):** added `mess_payment` to the final-step attribution flow — `needsPaidBy`, data-load branch, `centerMandatory`, `needsBankAccount`, bank-account dropdown render, and labels/help text all include mess_payment. Paid-By optional (captured at raise), Center + Bank mandatory, Partner optional.
  - Verified E2E via API+DB: receipt→approve→raise payment→**accountant final-approve with bank+center+partner** → bank balance debited exactly ₹1180, expense txn re-allocated + linked to bank txn, mess_payment stamped, bill = valid PDF. Frontend screenshot confirms the "Approve Mess Payment" dialog shows Center*/Partner/Paid By/Bank* selectors. Cleaned up all preview test data + restored bank balance.
- **Requires redeploy** for production. Behaviour change: once a bank account is configured (prod has one), the accountant MUST pick the debit account at mess-payment final approval (intended — enables ledger debit).

## Phase 117 (Jun 2026) — Regenerate existing mess bills per template + guaranteed PDF
- User: "existing bill invoice ko mess bill template ke anusar banaye aur bill PDF me nahi ho raha — ise PDF banaye." Older prod bills were generated before a template was uploaded / came out as DOCX.
- **Backend (server.py):**
  - `_generate_mess_bill(..., reuse_bill_no=None)`: template path now **only accepts a real PDF** (`rext == "pdf"`); if LibreOffice can't produce a PDF it **always falls back to the ReportLab PDF** → bill is GUARANTEED to be a valid PDF. Tracks `used_template`. `reuse_bill_no` lets regeneration keep the same bill number.
  - New endpoint `POST /mess/receipts/{id}/regenerate-bill` (role admin/accountant, center-scoped): only for PAID receipts; finds linked mess_payment (or reconstructs minimal), deletes the old `mess_bills` doc, regenerates via current active template reusing the same `bill_no`, updates receipt `bill_pdf_path/bill_no/bill_content_type/bill_pdf_filename`. If soffice missing it kicks off the (idempotent) `_ensure_libreoffice_installed()` in the background without blocking. Returns `{ok, bill_no, format, used_template}`.
- **Frontend (MessManagement.jsx `ReceiptsTab`):** added a **Regenerate** button (RefreshCw, spinner while busy) next to the Bill download button for PAID receipts, gated to admin/accountant (`canRegen`). Toast differentiates template-PDF vs default-layout-PDF fallback.
- Verified E2E (API+DB): uploaded sample global template → paid receipt MB-26-0003 → `regenerate-bill` returned `{format:'pdf', used_template:True}`, **same bill_no reused**, download = valid `%PDF`. Frontend screenshot shows the Regenerate button next to "Bill · MB-26-0002". Cleaned up all test data; bank balance intact (129173.09).
- **Requires redeploy** for production. On prod, regenerate yields a template-PDF when LibreOffice is available (startup install), else a default-layout PDF (still PDF). Existing bills also now download correctly via the Phase-116 byte-sniffing serve.

## Phase 118 (Jun 2026) — Payroll REJECTED → reopen → rectify → recalculate → resubmit lifecycle
- User gave target flow: REJECTED → HR reopens → rectify salary/attendance → recalculate totals → validate amounts → Resubmit for Approval → PENDING_APPROVAL → assigned approver → APPROVED/REJECTED. Gap: reopen was admin-only and there was NO resubmit — HR had to re-finalise which created a DUPLICATE batch (rejected one orphaned).
- **Backend (server.py):**
  - `POST /payroll-batches/{id}/reopen` now `require_role("admin","hr")`. HR may reopen non-financial batches (rejected/reopened); reopening a batch that already moved money (paid/approved/pending_payment/processing/partially_paid) reverses the txn and stays **admin-only** (403 guard for HR).
  - New `POST /payroll-batches/{id}/resubmit` (admin/hr) + `PayrollBatchResubmitIn`: only for `rejected`/`reopened`; **recalculates every row** via `_recalc_payroll` (from components), **validates** (blocks negative net with a per-employee message), recomputes batch gross/deductions/net_payable/amount + staff_count, **re-attaches the approval chain from Level 1** (`_attach_chain_to_request`, fresh `chain_history`), sets batch → `pending_approval`, re-locks rows (`batch_status=pending_approval, locked=True`), appends `resubmitted` audit entry (SAME batch — full trail preserved), clears rejected_reason/at. Auto-approves to `pending_payment` if no chain configured.
- **Frontend (HRMS.jsx `PayrollBatchDialog`):** `canReopen` now allows HR for rejected/reopened; new `canResubmit` (admin/hr on rejected/reopened); `submitResubmit()` calls `/resubmit` with optional remarks; footer shows **"Reopen"** + **"Resubmit for Approval"** (`data-testid=batch-resubmit`) buttons. Reopen label drops "(Admin)" for HR.
- Verified E2E (API+DB): seeded rejected batch → `resubmit` → `pending_approval`, current_level 1, "Pending at Admin", totals recomputed (21000/1000/20000), rows re-locked, audit=['rejected','resubmitted']; reopen → `reopened` + rows unlocked; negative-net → HTTP 400 "Emp One: negative net". Frontend screenshot: REJECTED batch dialog shows Reopen + Resubmit for Approval. Cleaned up all test data.
- **Requires redeploy** for production.
## Phase 119 (Jun 2026) — Frontend performance optimization (mobile & desktop)
- Task: raise Lighthouse perf (mobile 59, desktop 91) without breaking any feature. PageSpeed tests the UNAUTHENTICATED /login page, which previously eager-loaded the entire app bundle (all 60 pages + recharts + leaflet). Flagged: render-blocking CSS/JS (~1830ms), unused JS (~664 KiB), missing <main> landmark, invalid robots.txt.
- **Code splitting (biggest lever)** — `/app/frontend/src/App.js`: every page route converted from static `import` to `React.lazy(() => import(...))`; `Login` kept EAGER (landing page). `<Suspense fallback={<PageFallback/>}>` wraps `<Routes>`. `/app/frontend/src/components/Layout.jsx`: inner `<Suspense>` (data-testid `content-loading`) wraps the main-content IIFE so sidebar/header stay mounted during lazy chunk loads.
- **Fonts** — removed unused `@fontsource/chivo`, `@fontsource/ibm-plex-sans` (never referenced in CSS) and duplicate `@fontsource/jetbrains-mono` imports from `index.js`. CSS only uses Inter + JetBrains Mono, now loaded ONLY from Google Fonts via NON-blocking `<link rel="preload" as="style" onload="this.rel='stylesheet'">` + `<noscript>` fallback in `public/index.html`. Build now ships 0 bundled woff2 files.
- **SEO/a11y** — added `public/robots.txt` (allow public pages, disallow /api/). Login right-column changed from `<div>` to `<main>` (semantic landmark).
- **Build evidence (gzipped):** login critical-path JS dropped from ~845 kB (single monolith) to **183 kB** main.js (+20.8 kB css). **662 kB of JS now deferred** (loaded per-route on demand) — matches PageSpeed's ~664 KiB unused-JS finding. recharts (102 kB) and leaflet (48 kB) confirmed OUT of main bundle (grep: 0 hits in main.js).
- **Verified:** prod `yarn build` succeeds (57 chunks). Frontend testing agent (iteration_86) = 100%: all 47 lazy routes render, sidebar/header persist, no ChunkLoadError, charts + maps work, Login has exactly 1 `<main>`, fonts non-blocking, robots.txt present. No business logic / backend / payroll / financial rules touched.
- **Requires redeploy** for production (finance.masharaskills.com). Final PageSpeed numbers must be measured against the deployed prod build after redeploy.
- **Not done (infra-level, documented):** HTTP security headers (CSP, COOP, X-Frame-Options) and long-lived Cache-Control are set at the hosting/ingress layer, not in frontend source — cannot be changed safely from code without risking PostHog/fonts/API breakage.

## Phase 120 (Jun 2026) — Mess Item Master create/edit access for center_manager
- User: "Item create karne ka option center manager ko bhi dijiye" (Mess → Item Master).
- Backend (`server.py`): `MESS_ADMIN_ROLES` now `("admin","senior_manager","manager","center_manager")`. Used ONLY by `POST /mess/items` + `PUT /mess/items/{id}` — no other endpoint affected.
- Frontend (`MessManagement.jsx`): `API_ADMIN_ROLES` adds `"center_manager"` → `canAdmin` true → "Add Item" button + per-row edit pencil now render for center_manager.
- Verified: curl as center_manager (cmtest_salary@x.com) `POST /mess/items` → HTTP 200 item created (test item cleaned up); UI screenshot as center_manager shows "Add Item" button (add-item-btn count 1) + edit controls on Item Master.
- **Requires redeploy** for production.

## Phase 121 (Jun 2026) — Mess Monthly / Date-wise Stock Report (PDF)
- User: monthly report PDF showing per item — carry-forward from past month (Opening Balance), Received this month, Issued (consumption) this month, Remaining Balance; same also available date-wise (custom date range). Format per reference image (title "January-25"; cols Sr No | Description/Item Name | Unit | Opening Balance | Received | Issued | Remaining Balance).
- Backend (`server.py`, before Physical Stock Count section):
  - Helper `_mess_stock_report_rows(user, center_id, date_from, date_to)` aggregates `mess_ledger`: opening = Σ(qty_in-qty_out) for date < date_from (carry forward), received = Σ qty_in in [from,to], issued = Σ qty_out in [from,to], remaining = opening+received-issued. Respects mess center scope (`_mess_scope`/`_mess_center_query`). Only items with non-zero movement shown, sorted by name.
  - `_mess_report_label()` → "Month-YY" for a full calendar month, else "DD-Mon-YYYY to DD-Mon-YYYY".
  - `GET /api/mess/stock-report` → JSON preview {title, center_name, rows}.
  - `GET /api/mess/stock-report.pdf` → ReportLab PDF (A4), bold centered title, subtitle "Mess Stock Report · <center>", bordered 7-col table. StreamingResponse application/pdf. Role: MESS_VIEW_ROLES.
- Frontend (`MessManagement.jsx`): new "Monthly Report" tab (`mess-tab-report`) → `ReportTab`. Toggle Monthly (`<input type=month>`) vs Date Range (from/to). Uses the top Center selector. Live preview table (same cols) + "Download PDF" (opens inline). testids: report-mode-month/range, report-month, report-from/to, report-download-pdf, report-row-*.
- Verified: JSON Oct-26 (Rice open0 recv529 iss284 rem245 ✓); carry-forward June→July (rem12→open12 ✓); monthly+range PDFs valid %PDF-1.4; PDF structure analysis confirms title "October-26" + all 7 columns + correct math; UI screenshot shows tab, month picker, preview table, download button all working.
- **Requires redeploy** for production.

## Phase 122 (Jun 2026) — Mess Management module redesign (dashboard + branded PDF)
- Scope: redesign ONLY the Mess Management dashboard + PDF. Light/professional theme (navy header, white cards, blue-green accents). PDF logo = "Mashara" text wordmark. No other module touched; no data migration/seed; stock rules unchanged (Remaining = Opening + Received − Issued). design_guidelines.json produced by design agent.
- Backend (`server.py`, mess stock-report section): `_mess_stock_report_rows` now also returns per-row `status` (out<=0 / low<=max(min_stock,reorder_level) / available), `category`, `min_stock`, `reorder_level`, and a `summary` {total_items, available, low, out, received_by_unit, issued_by_unit}. `GET /mess/stock-report` returns rows+summary (additive, backward compatible — Monthly Report tab unaffected). `GET /mess/stock-report.pdf` rebuilt as branded print-ready A4: Mashara wordmark + FINANCE CONSOLE tagline, Generated/Generated-by, title "Mess Stock Report", Center/Period/Date-range meta, summary strip, 8-col table (Sr/Item+category/Unit/Opening/Received/Issued/Remaining/Status) with accessible status cell colors (green/amber/red bg + bold text), Prepared/Verified signature block, page footer. Reuses MESS_VIEW_ROLES + _mess_scope/_mess_center_query (center scoping enforced).
- Frontend (`MessManagement.jsx`): new `DashboardTab` = quick-action toolbar (Receive/Issue-Consume/Wastage/View History/Generate PDF) + 4 status KPI StatCards + Received/Issued-by-unit strips + filter bar (month period, search, status pills) + `InventoryTable` + preserved today's cost KPIs + low-stock + pending bills. `InventoryTable` = desktop sortable table (data-testid inv-sort-<k>) with pagination (inv-prev/next, 15/pg) and actions (inv-history-<id>, inv-addentry-<id>) + mobile expandable cards (inv-card-<id>, md breakpoint). `ItemHistoryDrawer` = per-item ledger modal (Date/Type/In/Out/Balance/By/Remarks). `StatusBadge` = icon+text (accessible). Center dropdown shows fallback label for unnamed centers.
- Fixes after test (iteration_87): memoized `filtered` so pagination no longer resets on unrelated re-render; month default now uses LOCAL date (was UTC — wrong month in IST pre-05:30 on the 1st); added inv-sort-<k> testids; center-name fallback.
- Verified: testing agent iteration_87 = 100% of testable features — KPIs, center scoping (center_manager gets 403 on other centers for stock-report/pdf/ledger), received/issued strips, Remaining math, status pills, search, sort, month carry-forward, history modal (17 Rice entries), branded PDF 200, quick actions, all 9 mess tabs render, /transactions regression OK, mobile cards, no console errors. Branded PDF structure confirmed via document analysis. Self-verified sort-by-remaining after fixes.
- NOT done (optional/out-of-scope, documented): pre-selecting the row's item in the Receipt dialog (opens standard dialog instead — safe reuse); mobile history modal uses horizontal scroll (not stacked); MessManagement.jsx > 700 lines (not split, per minimal-change).
- **Requires redeploy** for production.

## Phase 123 (Jun 2026) — Mess dashboard: Today's Cost Summary redesign + toggle
- User: redesign the Today's Cost Summary area (cost cards + Low Stock + Pending Bills) to the richer card/table style (ref screenshot), and move it behind a toggle beside "Record Wastage" (shown on select, hidden by default).
- Backend (`server.py` `/mess/stock`): additive enrichment — each stock row now also returns `consumption_rate_daily` (trailing-30-day avg qty_out ÷ 30), `est_days_left` (qty ÷ rate, null if no consumption), and `stock_status` (out/critical/low/ok). One extra ledger aggregation; backward compatible (StockTab/dashboard unaffected).
- Frontend (`MessManagement.jsx`): DashboardTab gained `showCost` toggle (data-testid qa-cost-summary) in quick-actions row (after Record Wastage) + lazy fetch of `/mess/receipts?status=pending`. Removed the always-on cost section; new `CostSummaryPanel` (rendered only when toggled) = 8 tinted `CostCard`s (icon circle + chevron) + Low Stock Alerts table (Item+category avatar, Current Stock, Rate, Days Left, accessible Status badge via LS_STATUS, View All→Stock tab) + Pending Purchase Bills table (Bill No=invoice_no, Vendor=supplier_name, Item(s), Amount, View→Goods Receipt tab, View All) + bottom `StatTile` stats bar (Meals Served, Avg Cost/Person, Food Cost today, Last Updated). onGoto={setTab} added. All figures real from `/mess/dashboard`, enriched `/mess/stock`, `/mess/receipts`; no fabricated data (rate/days show "—" when unknown). "Total Students" intentionally omitted (no reliable source).
- Verified (admin, center TEST_iter28_C_5f3eac with 1 low item + 3 pending bills): toggle shows/hides panel; 8 cost cards render; low-stock table shows Chana Dal/Pulses/Low Stock; pending table shows 3 real bills (GST-12508/XPERT ₹6,400 etc.); stats bar correct; enriched /mess/stock API confirmed via curl. Light theme preserved.
- **Requires redeploy** for production.

## Phase 124 (Jun 2026) — Reorder shortcut + approver sees mess-receipt item details
- Task 1 (reorder): low-stock row → one-click pre-filled Goods Receipt for that item, line removable.
  - Frontend (`MessManagement.jsx`): `ReceiptDialog` gained `prefillItemId` prop → initial `lines` has that item (unit from base_unit); still fully editable/removable (existing trash + Add Line). Parent added `receiptPrefill` state; `onReceive` now accepts an optional itemId → `setReceiptPrefill`; passed `prefillItemId` to dialog; reset on close/saved; generic "Receive Stock"/ReceiptsTab create reset prefill to null. Wired from: Low Stock Alerts table new "Reorder" button (data-testid ls-reorder-<id>, gated by canEntry), and InventoryTable "Entry"/"Add Stock Entry" buttons (now pass r.item_id). CostSummaryPanel got canEntry + onReorder props.
- Task 2 (approver item visibility): approve/reject/send-back modal showed only "N item(s) from vendor" — no line details.
  - Backend (`server.py` approvals/pending summary ~line 8537): added `"items": rec.get("lines") if req_type == "mess_receipt" else None` (additive).
  - Frontend (`PendingApprovals.jsx` acting modal): renders an item table (Item / Qty / Unit / Rate / Amount) from `acting.item.summary.items` when present, below amount/date — so approver verifies goods before acting.
- Verified: `/approvals/pending` returns summary.items for 4 mess receipts (Bread 5 packet ₹1,180 etc.); approve modal screenshot shows the item table; Reorder on Chana Dal opens New Goods Receipt pre-filled (center + Chana Dal/kg line) with removable line. Isolated to Mess + approvals; no other module touched.
- **Requires redeploy** for production.

## Phase 125 (Jun 2026) — Mandatory bill attachment + bill preview in approve modal
- Task A (bill attachment mandatory on goods receipts):
  - Backend (`server.py` `POST /mess/receipts`): `if not body.attachments: raise HTTPException(400, "A bill attachment is required for every goods receipt")` (before dup check). Never bypassable from frontend.
  - Frontend (`MessManagement.jsx` ReceiptDialog.save): blocks submit with toast "Bill attach karna zaroori hai" when no attachment; Shop Bill label now "(required)" with rose dashed border + "mandatory" hint until a file is attached.
- Task B (approver sees the bill): approve/reject/send-back modal attachments block upgraded from plain links to inline PREVIEW — image attachments render as <img> thumbnails, PDFs embed in an <iframe> (#toolbar=0&navpanes=0), others show a fallback; each keeps an "Open ↗" new-tab link. Uses existing `/api/files/view?path=` + summary.attachments. Benefits all approval types. (`PendingApprovals.jsx` approval-attachments-block, testid attach-preview-<id>.)
- Verified: curl create receipt w/o attachment → HTTP 400 "A bill attachment is required…"; created a throwaway receipt with a sample PDF bill via real API → approve modal showed item table (Rice 10 kg ₹55 ₹550) + embedded PDF preview iframe (sample_bill.pdf + Open link); test receipt + file cleaned from DB. Isolated to Mess + approvals.
- **Requires redeploy** for production.

## Phase 126 (Jun 2026) — Today's Cost Summary becomes a dedicated view
- User: when "Today's Cost Summary" (beside Record Wastage) is selected, ONLY that section should show.
- Frontend (`MessManagement.jsx` DashboardTab): wrapped the inventory dashboard blocks (status KPIs, received/issued strips, filter bar, InventoryTable) in `{!showCost && (<>…</>)}`. Now toggle ON → only CostSummaryPanel; toggle OFF → inventory dashboard. Quick-actions row (incl. toggle) always visible.
- Verified (admin, TEST_iter28_C): toggle ON hides mess-stat-total/mess-dash-search/mess-inventory-table and shows only mess-cost-summary; screenshot confirms.
- **Requires redeploy** for production.

## Phase 127 (Jun 2026) — Fix wrong per-line AMOUNT in approve-mess-receipt modal
- Bug (prod screenshot): approve modal item table showed AMOUNT = QTY value (e.g. Salt qty 450 → amount ₹450) instead of qty×rate; header/receipt total (₹1,99,07,100 = Σ qty×rate) was correct. Root cause: the AMOUNT cell trusted a stored `line_total`/`accepted_cost` that is unreliable/stale on older production receipt lines.
- Fix (`PendingApprovals.jsx` approval-items table): compute each row amount on the fly from the shown qty × unit_price (minus discount + tax) — never trust stored line_total. Added a Total row (data-testid approval-items-total) summing the computed line amounts so the approver can cross-check it equals the receipt amount. QTY = accepted_qty ?? qty, RATE = unit_price.
- Verified (preview, controlled receipt): Rice 15×₹30=₹450, Wheat 17×₹980=₹16,660, Total ₹17,110 — matches header Amount ₹17,110. For the prod case (Salt 450×₹30) AMOUNT now correctly shows ₹13,500 and the Total sums to ₹1,99,07,100. Test receipts/files cleaned up. No backend/data change; display-only fix.
- **Requires redeploy** for production.

## 2026-10-28 — Mess Goods Receipt UI tweaks
- Receipt list: "X item(s)" is now a toggle → expands an item-detail table (item, qty, unit, rate, amount + total) so requester/viewer sees what was received.
- New Goods Receipt form: removed Discount column + HSN/SAC field; widened Qty column; GST % kept but now defaults to 0% (GST_RATE_OPTIONS unchanged). Amount Summary drops the Total Discount tile.
- Frontend-only (MessManagement.jsx). Payload still sends discount:0 / hsn_sac:null; no backend change. Verified via screenshots in preview.

## 2026-10-31 — Centralized Unit Conversion Engine (Mess module)
User decisions: rate ALWAYS per item base unit; roll out across whole Mess module; do NOT modify historical receipts (read-only review list instead).
- New engine: backend/unit_conversion.py + frontend/src/lib/units.js (weight/volume/count global tables: kg/gram/mg/quintal/ton, litre/ml, piece/dozen/pair; packaging units via item conversion_factor). Single source of truth; backend authoritative.
- Goods Receipt: qty normalised to base; unit_price is per BASE unit; line stores qty_base/accepted_qty_base/rate_per_base/rate_basis. FIX: 500 gram @ Rs400/kg now = Rs200 (was Rs2,00,000). UI shows converted preview (= 0.5 kg) + "per <base>" hint; compatible-unit dropdown; incompatible-unit guard.
- Approval modal + receipt-list item toggle + mess_bill.py GST breakdown all use base-normalised displayLine(). Consumption/Wastage accept any compatible unit (default = consumption_unit). Stock-in on approval uses stored accepted_qty_base.
- Item Master: added consumption_unit (validated vs base) + allow_decimal (enforced on receipt/consumption). Dropdown limited to compatible units.
- Read-only historical "Unit Review" (GET /mess/receipts/unit-review + Unit Review dialog) flags legacy mismatched lines with stored-vs-corrected amounts; changes nothing.
- Also fixed pre-existing cross-center avg_cost contamination (removed global mess_items.avg_cost overwrite on approval) + duplicate React keys in stock/inventory/report tables.
- Tested: testing_agent iteration_88 (10/11 API + all frontend flows); all 5 action items fixed & self-verified via API (consumption_unit 400, allow_decimal 400, 2 dozen@10/pc=240) and screenshots. Test data cleaned up.

## 2026-11-02 — Mess→Accounting finance fixes (partner, unpaid status, audit tool)
Root causes: (a) Niranjan auto-allocation = _derive_context_for_center partner heuristic (most-common past txn) used by mess expense creation; (b) no payment tracking on the mess expense txn (showed Approved regardless of payment); (c) quotation flow was ALREADY correct (no txn on create/submit/approve, only on payment). Preview DB != production (prod data correctable only via the admin tool).
User decisions: txn at bill approval but Unpaid till payment; partner MANUAL by accountant (no auto-derive); keep existing payment-request (ensure Center Manager sees mess Raise Payment after approval); build safe Admin Audit & Fix; show Payment Status/Paid/Balance + filter; partial payment later.
Implemented (backend server.py): _mess_post_receipt sets partner_id=None + payment_status=unpaid/paid_amount=0/balance=amount on the expense txn; mess_payment approval (/approvals/act) removed partner auto-derive, validates partner exists, marks the SAME expense txn paid (paid_amount/balance=0) with accountant partner (no duplicate); TransactionOut + list_transactions gained payment_status/paid_amount/balance (+ payment_status filter); NEW admin endpoints GET/POST /api/admin/mess-partner-audit(/fix) — JOINS mess_receipts so PAID bills are never touched, only unpaid auto-assigned partners nulled, backfills payment_status from receipts, logs old partner to audit_corrections (non-destructive, admin-only).
Frontend: Transactions.jsx = PaymentBadge, Paid/Balance under amount, payment badge in status cell, Payment Status advanced filter + chip, drawer payment fields, admin Partner Audit dialog (confirm + stale-reset). PendingApprovals.jsx = mess_payment partner picker manual (placeholder Unassigned), fallback to all partners when center has none mapped. MessManagement.jsx Raise Payment already gated canEntry(incl center_manager)+approved+unpaid.
Tested: testing_agent iteration_89 (backend 10/10, all 7 features pass). Critical issue (fix must not unassign PAID bills) fixed + re-verified via API (paid txn partner kept, unpaid nulled, 19 legacy backfilled). All synthetic test data cleaned; Rice stock reverted.
NOT changed (pre-existing, out of scope): brute-force lockout, admin seed password reset, edit-lock on auto-generated txns, native date inputs.

## 2026-11-02 — Expense Booking: mandatory Work Order selection
- Reuses existing Batch Management Work Order master (db.work_orders) — NO new module/duplicate. GET /work-orders?center_id=X&include_inactive=false.
- New Transaction dialog (type=Expense): Center select first → then a MANDATORY searchable "Select Work Order" dropdown (Popover+Command) showing WO number + scheme/name, filtered to that center. Changing center resets the WO. If center has no WO → clear message + submit blocked. (txn-work-order, wo-search, wo-option-<id>, wo-need-center, wo-none)
- Backend: TransactionIn.work_order_id (+ TransactionOut.work_order_no enriched in list_transactions). create_transaction REQUIRES work_order_id when type==expense AND no source (manual booking); validates WO exists + belongs to center. update_transaction validates-only (does not block editing legacy expenses). Frontend force-requires only on NEW expenses.
- Exemptions (so existing flows unbroken): income, auto-sourced expenses (mess_purchase/quotation), and Stock quick-add (now sends source="stock_entry"). CSV import uses separate /transactions/import.
- WO reference shown in the transaction details drawer; saved permanently on the txn; available in list/reports.
- Tested via API (expense no-WO=400, wrong-center=400, valid=200 + work_order_no enriched, income/stock exempt=200) and UI screenshot (center-first → searchable WO dropdown lists WO-BG-SEED-01). Test data cleaned.


## 2026-11-02 — Work Order linkage: Quotation/Payment Request + Transactions/Reports column & filter
- End-to-end WO linkage completed (reuses Batch Management db.work_orders; NO duplicate module). Chain: Quotation → Payment → auto-created expense Transaction all carry work_order_id + work_order_no.
- Quotations.jsx (route /quotations, sidebar "Payment Request"): New Quotation form now has Center-first MANDATORY-for-expense Work Order picker (Popover+Command, searchable) right after Center; changing center resets WO; empty-center hint + no-WO hint. New "Work Order" column in the quotation list. Testids: q-center, q-wo-no-center, q-wo-trigger, q-wo-search, q-wo-option-<id>, q-wo-empty-hint, quotation-wo-<id>.
- Backend server.py: QuotationIn.work_order_id; create_quotation requires WO for category==expense, validates WO exists + belongs to center, stamps work_order_no (optional for investment/asset). list_quotations enriches work_order_no. QuotationResubmitIn.work_order_id (re-validated vs quotation center). create_payment copies WO from quotation. Payment→txn (/approvals/act payment final step) copies WO, but DROPS it if the approver switches txn_center_id to a center the WO doesn't belong to (center-consistency guard).
- Transactions.jsx: new "WORK ORDER" column (cell txn-wo-<id>) after Organization; Advanced Filters drawer has a "Work Order" select (adv-filter-work-order) populated from GET /work-orders (scoped to center filter if set) + active chip + Clear All. Backend GET /api/transactions accepts work_order_id filter.
- Reports.jsx: DIMS gained "work_order" → new "Work Order" tab (report-tab-work_order) with investment/income/expense/profit grouped by WO (+ Unassigned row) + CSV export. Backend GET /api/dashboard/summary returns by_work_order (breakdown() gained name_field; uses wo_number). i18n: work_order / by_work_order (en + hi).
- Tested: testing_agent iteration_90 — all 8 features PASS (backend 100%, frontend 100%, pytest 9/9), incl. full quotation→payment→transaction WO propagation verified in Transactions column + drawer, filter, and Reports tab. 2 minor items fixed post-test (center-consistency guard + WO badge whitespace-nowrap). All synthetic test data cleaned (bank balances + QRN counter restored).


---

## [2026-06 / Nov session] TDS shown as "Deduction" (not "Expense")

**Request (Hindi):** Milestone TDS deductions were appearing under "Expense" on the
Transactions page. User wants them presented as a separate **Deduction** category —
with Profit / Partner-settlement figures UNCHANGED (user explicitly chose "only
label/group changes"), applied to BOTH existing + new TDS records.

**Approach (display-only reclassification, zero data migration):**
- TDS txns remain stored as `type: "expense"` with marker `source: "tds_deduction"`.
  Keeping the stored type = expense means every money calc (dashboard profit,
  settlement, partner share, MIS, bank reconciliation) stays byte-for-byte identical.
- They are presented as a distinct "Deduction" bucket wherever shown.
- Because existing 47 TDS rows already carry `source=tds_deduction`, old+new are both
  covered automatically — no DB migration.

**Changes:**
- Backend `GET /api/transactions` (`list_transactions`): `type` param is now `str`.
  `type=expense` → excludes `source=tds_deduction`; `type=deduction` → returns only
  `source=tds_deduction`; income/investment unchanged.
- Frontend `Transactions.jsx`: amber "Deduction" badge (Percent icon) + amber amount for
  TDS rows (via `txnDispType()` helper keyed on source); new **Total Deductions** KPI card
  (grid 5→6 cols, Total Expense now excludes TDS); "Deduction" option in the type filter;
  detail drawer Type/label/icon/color show Deduction.
- i18n: added `deduction` / `total_deductions` (EN + HI "कटौती" / "कुल कटौती").

**NOT changed (intentionally):** Finance dashboard / MIS / Reports / settlement still
treat TDS as expense in their money math, so Profit & Partner numbers are unchanged.

**Tested:** backend curl (type=deduction → 47 rows all tds; type=expense → 0 tds; all →
47 tds present) + UI screenshots (KPI, list badges, filter chip, detail drawer). Self-tested.



---

## TDS "Deduction" consistency across Dashboard & Reports (2026-06)
- Extended `GET /api/dashboard/summary` to bucket TDS rows (`source == "tds_deduction"`, stored as `type=expense`) into a separate `deduction` figure in `totals`, `monthly`, and every `by_*` breakdown.
- Profit math is **unchanged**: `profit = income − expense(excl TDS) − deduction` ≡ `income − expense(incl TDS)`. Verified ₹1,26,95,953 identical before/after; deduction total ₹1,29,741.
- Finance **Dashboard.jsx**: added "Total Deductions" KPI (amber, `kpi-deduction`), amber Deduction pie slice, and a Deduction column in the by-dimension table.
- **Reports.jsx**: added Deduction column (amber) to all dimension tables + CSV export; Expense column now excludes TDS.
- `KpiCard` gained an amber `accent="deduction"` tone.
- NOTE: the MIS Dashboard (`/mis/*`) shows skills/training metrics only (enrolled/certified/placement/mobilisation) — it has no income/expense/TDS, so no deduction line applies there.
- No DB migration; applies to all historic + future TDS rows automatically.



---

## Phase 92 — Work Order on Income + Milestone, Admin Bulk-Assign, DEMO Work Order (2026-06)
Request (Hindi): income entry me Work Order option do (milestone me bhi) taki transaction me WO dikhe; aur admin ek saath multiple transactions select karke Work Order/Partner etc assign kar sake. Choice: WO income me bhi **mandatory**; bulk-assign saari fields (WO/Partner/Company/Center/Project) par **sirf khaali rows** bhare (non-destructive); jis center ka WO nahi uske liye auto **"DEMO Work Order"** ban jaye (mandatory rahe, baad me update ho sake).

**Backend (`server.py`)**
- `_ensure_demo_work_order(center_id)` (~L1269): agar center ke paas koi WO nahi to placeholder `wo_number="DEMO Work Order"`, `is_demo=True` auto-create karta hai (idempotent — ek hi banta hai). Derives company/project via `_derive_context_for_center`, fy via `_current_fy_value()`.
- `create_transaction` (~L3999): ab `type in (expense, income)` + no `source` par `work_order_id` **mandatory** (400 "Work Order is required for booking"). Auto-sourced rows (milestone/fooding/quotation/stock/mess) exempt.
- `GET /work-orders` (~L15210): naya `ensure_demo` query param → center diya + `ensure_demo=true` par DEMO WO ensure karke list return.
- `POST /transactions/bulk-assign` (admin-only, after bulk-delete ~L4140): `{ids, company_id?, partner_id?, center_id?, project_id?, work_order_id?}`. Har field sirf un rows par set hoti hai jahan woh **khaali** (missing/null/"") hai. WO set hone par `work_order_no` bhi denormalize. Returns `{updated, by_field}`.
- `ReceivePaymentIn` (~L13636): naya `work_order_id` field. `receive_batch_payment` (PATCH `/batch-payments/{pid}/receive`, ~L14375): WO resolve+validate (batch center se match; na ho to DEMO WO fallback), phir **chaaro** generated txn dicts (income, candidate_recovery, assessment_fee, tds_deduction) par `work_order_id`+`work_order_no` stamp. Wrong-center WO → 400 + rollback.

**Frontend**
- `Transactions.jsx`: WO load effect income+expense dono ke liye chalta hai + `ensure_demo=true`; `save()` validation income+expense par WO zaroori; WO picker dono types par; admin bulk toolbar me **Assign** button (`btn-bulk-assign`) + bulk-assign Dialog (`bulk-assign-dialog`, selectors `bulk-assign-{company,partner,center,project}`, `bulk-assign-work-order`, apply `bulk-assign-apply`).
- `Programs.jsx`: receive dialog me **Work Order** selector (`recv-wo-select`), center ke WO ensure_demo se load, default first WO; `confirmReceive` body me `work_order_id`.

**Testing**: iteration_91.json — backend 100% (12/12), frontend 100%. Verified: income WO mandatory (400/toast), DEMO WO auto+idempotent, milestone receive stamps WO on all 4 txns, bulk-assign only-empty non-destructive, bulk-assign 403 for non-admin, Deductions KPI unchanged (₹1,29,741). No critical bugs. Minor optional items: bulk-assign doesn't validate WO/center consistency or entity-id existence (create_transaction still rejects WO/center mismatch). UI polish applied: bulk-assign grid 2x2; receive WO placeholder relabeled "Auto-select (center default)".

---

## Phase 93 — Approvals card: show Requester + Leave period (Staff App) (2026-06)
Bug (Hindi): Staff App Approvals screen par (a) requester ka detail show nahi ho raha tha; (b) Leave request par "kab se kab tak" (from–to) dates approver ko nahi dikh rahi thi.
- Root cause: `/approvals/pending` already returned `requester_name` + `requester{employee_code,department,designation}`, but the Staff App card in `CheckIn.jsx` `PendingApprovalsTab` never rendered them; and the `summary` only had `date` (=start_date) with no `end_date` for leave.
- Backend (`server.py`, ~L8764): added `start_date` + `end_date` to the pending-approval `summary` dict.
- Frontend (`CheckIn.jsx` `PendingApprovalsTab` card): now renders a requester line (Users icon + name · employee_code · designation/department, testid `approval-requester-<id>`) and, for `request_type==="leave"`, a period line (CalendarDays icon + `start → end · N days`, testid `approval-leave-period-<id>`). Leave cards hide the redundant single "Date:" chip.
- Verified: curl payload has requester + start/end; screenshot shows requester on all 220 cards and leave period on 28 leave rows. Self-tested (no regression to approve/sendback/reject).

---

## Phase 94 — HRMS TODAY status: Resigned / Absent / On Leave + active-only KPIs (2026-06)
Request (Hindi): jiska last working day (exit_date) set hai use "Resigned" dikhao (Present ki jagah) aur active employee dashboard me mat ginno; jo resigned nahi hai par attendance mark nahi kiya → "Absent"; us date ka leave approved ho → "On Leave".
- Backend `/staff` (`today_status`): precedence = Resigned (`exit_date` set & <= today IST) > Present/Half (attendance) > On Leave (approved leave covering today) > explicit Absent/Leave > **Absent** (unmarked non-resigned). Earlier unmarked returned null ("—"); ab "absent".
- Backend new `GET /hrms/today-summary?date=` → `{date,total_active,present,absent,leave,resigned}`. Resigned excluded from all active counts; unmarked non-resigned = Absent; approved leave = On Leave; present incl half. Center-scoped via `_center_scope_query`.
- Frontend `HRMS.jsx`: `StaffTodayChip` me naya `resigned` → slate "Resigned" badge. KPI strip ab `/hrms/today-summary` (attDate) se aata hai — Total Employees = active only (resigned excluded), Absent Today = unmarked non-resigned, Leave Today = approved leaves. Falls back to local attMap until summary resolves.
- Leave final status confirmed = "approved" (approval engine, server.py ~L8200s).
- Verified (preview, 257 staff): summary total_active=250, resigned=7 (excluded), unmarked → absent=250; inserted approved leave → leave=1/absent=249 and that staff today_status="leave"; resigned rows today_status="resigned". Screenshot: Total 250 / Absent 250 (pehle 0 tha). Self-tested (curl + mongo + screenshot), test leave cleaned up.

---

## Phase 95 — Payroll HR Review → Submit for Approval (all centers, idempotent) (2026-06)
Request: After HR Review, provide a clear "Submit for Approval" (bulk, all centers). Previous finalisation moved only some employees to Approval Pending; rest stuck in HR Review. Must be idempotent (no duplicate payroll entries, preserve existing finalized records + approval history), hold employees with attendance/salary issues separately with reasons, and show a pre-submit summary (Total Centers, Total Employees, Already Approval Pending, Remaining HR Review, Employees with Issues).

**Root cause**: `payroll_finalise` had a per-CENTER duplicate guard — if a center already had any active batch for the month, the ENTIRE center's remaining draft rows were skipped. Batched payroll rows keep `status="draft"` (only `batch_status` flips), so remaining employees never got re-batched → stuck in HR Review.

**Backend (`server.py`)**:
- `_ACTIVE_BATCH_STATUSES` + `_payroll_issue_reason(row)` (hold when valid attendance days <=0 or net<0). (~L12360)
- `payroll_finalise` rewritten: selects draft rows NOT already in an active batch (idempotent — excludes by batch_status), splits per center into eligible vs held (issues), creates a NEW batch for eligible even if the center already has one (incremental, no dup rows), returns `{batches, held_for_issues, skipped_duplicates:[]}`. (~L12440)
- NEW `GET /payroll/finalise-preview` — non-mutating summary counts + issues list. (~L12600)
- `payroll_run` guard fixed: skip rows where `batch_status in _ACTIVE_BATCH_STATUSES` or `locked` (was only checking `status != draft`, which wrongly recalculated batched rows). (~L9930)
- `finalize_attendance` auto-LOP loop skips staff already in an active batch (prevents modifying finalized records). (~L12710)
- Row↔batch status sync: auto-approve branch + final-approval branch now set payroll rows' `batch_status="pending_payment"` so UI chips match the batch. (~L8588, ~L12584)

**Frontend (`HRMS.jsx`)**: "Submit for Approval" button (always visible to admin/HR, even when a batch exists/locked) → opens preview dialog (`submit-approval-dialog`) with 6 stat cards + held-list w/ reasons + remarks; confirm disabled when remaining=0; posts finalize-attendance (all centers or scoped). `PreviewStat` component added.

**Testing**: iteration_92.json (found HIGH recalc bug + status-sync gap — both fixed). Dedicated pytest `tests/test_phase93_payroll_submit_for_approval.py` → 11/11 PASS after fixes (incremental batching despite existing batch, idempotency, issue-hold, preview counts, no duplicate rows, paid skipped, rejected resubmittable, batched rows NOT recalculated on re-run, row status synced). Frontend dialog flow verified 100% by testing agent. NOT YET on production — needs deploy.

---

## Phase 96 — Fix: Work Order not showing in Transactions picker for a center that has one (2026-06)
Bug (production finance.masharaskills.com/transactions): After selecting a Center in New Transaction, WO picker shows "Is center ke liye koi Work Order nahi mila" even though a Work Order exists in Batch Management for that center.
- Root cause: the Transactions form WO loader (and milestone receive loader) called `GET /work-orders` with `include_inactive=false`, which drops any WO whose effective_status is EXPIRED (expiry_date in the past) / cancelled / completed. A center whose WO had a past expiry_date therefore returned 0 results. `ensure_demo` did NOT add a placeholder because a WO *does* exist (it just got filtered out) → empty picker.
- Reproduced in preview: center with one WO (expiry 2026-01-01) → `include_inactive=false&ensure_demo=true` returns count 0; `include_inactive=true` returns the WO (effective_status "expired").
- Fix (frontend only): `Transactions.jsx` (L161) and `Programs.jsx` (L545) WO loaders now send `include_inactive=true` so every existing WO for the center is shown regardless of expiry/active status. The Transactions picker already appends the status (e.g. "· expired") for non-active WOs so HR can tell. No backend change.
- Status: fixed + backend-verified in PREVIEW. Needs DEPLOY to reach production. If after deploy a center still shows none, the WO's stored center_id likely differs from the selected center (data issue) — investigate separately.

---

## Phase 97 — Work Order picker visible in ALL logins (not just admin) (2026-06)
Bug (production): WO picker/choose option only appeared for the admin login; other logins (manager "Shailendra Kumar", company_admin, partner, etc.) saw nothing. Request: give the right to all logins, everywhere a WO can be chosen.
- Root cause (two layers, both blocking non-super-admins):
  1. `GET /work-orders` endpoint gate was `require_role(*WO_READ_ROLES)` → excluded partner, company_admin, center_staff.
  2. RBAC menu middleware: `/api/work-orders` was in the Batch Management menu's view `prefixes`, so ANY role whose Batch Management "view" permission is OFF (e.g. production manager had it disabled; company_admin defaults to all-off since it's a non-system role) got `403 "you do not have 'view' permission for this section"`. super_admin bypasses (ADMIN_ROLE_KEYS) → that's why only admin worked.
- Fix (backend):
  1. `GET /work-orders` list gate → `Depends(get_current_user)` (any authenticated user). `_wo_center_filter` still isolates center_manager to assigned centres; write endpoints stay `require_role(*TARGET_ADMIN_ROLES)` (admin/manager/senior_manager).
  2. Removed `/api/work-orders` from the `batch` menu `prefixes` in MENU_REGISTRY → WO-list VIEW no longer requires Batch Management permission. Writes still enforced via `_ACTION_PREFIX_MENU` (`/api/work-orders`→batch for create/edit/delete) + the endpoint role gate.
- Fix (frontend): `Quotations.jsx` WO loader now `include_inactive:true` for consistency with the other pickers.
- Verified (preview): company_admin (zero menu perms) WO read 403→200 (3 WOs); partner/manager 200; center with no WO → DEMO Work Order auto-created so picker never empty; center_manager 200 (center-scoped); WO CREATE still blocked for non-privileged roles (manager allowed, reaches validation). All WO pickers (Transactions expense/income, Milestone receive, Quotations, Bank Guarantees, Batch Mgmt) share this endpoint → fixed everywhere at once.
- NOTE: test_credentials.md labels kumarshailendra259@gmail.com as "partner" but /auth/me returns role "manager" (stale label).
- Status: fixed + verified in PREVIEW. Needs DEPLOY to reach production.

---

## Phase 98 — Mess Goods Receipt: Work Order picker (replaces PO No.) + Remarks (2026-06)
Request: Mess → New Goods Receipt me PO No. ki jagah center-wise Work Order choose option do; aur Remarks field do taaki approver remarks padhkar approve kar sake.
- Backend (`server.py`): `MessReceiptIn` + fields `work_order_id`, `work_order_no`, `remarks` (po_no kept optional for back-compat). `mess_create_receipt` validates WO + denormalises wo_number, stores remarks, and appends remarks into the approval `description` (so it shows on the Pending-Approvals card). `_mess_post_receipt` stamps `work_order_id`+`work_order_no` onto the generated mess-purchase expense transaction → shows in Transactions/Reports under the WO.
- Frontend (`MessManagement.jsx` ReceiptDialog): removed PO No. input; added center-scoped Work Order `<select>` (`receipt-work-order`, include_inactive=true + ensure_demo=true → never empty) and a full-width Remarks `<textarea>` (`receipt-remarks`). Payload now sends work_order_id/work_order_no/remarks.
- Verified (preview): created a receipt with WO+remarks → doc stored work_order_id/work_order_no/remarks; approver-facing description = "1 item(s) from Shree Traders · Remarks: ...". Frontend screenshot: PO field gone, WO picker + Remarks present, WO options populate on center select (DEMO Work Order). Test receipt cleaned up.
- Status: fixed + verified in PREVIEW. Needs DEPLOY for production.

---

## Phase 99 — Global Work Order Mandatory Mapping + Work Order P&L report (2026-06)
Request: EVERY financial transaction (income & expense) must carry a Work Order, sourced from Batch Management WO Master, center-scoped. Auto-generated records inherit WO from source; centerless manual flows pick center-then-WO; consolidated payments keep WO at line level; add a "Work Order P&L" Reports tab. Existing records/IDs/accounting/approval history MUST stay untouched.
- Backend (`server.py`):
  - Central helper `_derive_wo_for_txn(center_id)` → resolves a center's WO (DEMO fallback via `_ensure_demo_work_order`) for auto-created forward flows.
  - Forward flows wired to stamp work_order_id/work_order_no: reimbursement, asset, payment branch, reimbursement payment, payroll payment, fooding, advance release, advance settlement/write-off.
  - Reversal/refund flows (payroll batch reversal x3) INHERIT work_order_id/work_order_no from the ORIGINAL txn (source inheritance).
  - New report endpoint `GET /api/reports/work-order-pnl` → aggregates db.transactions by work_order_id: {rows:[{work_order_id, work_order_no, center_name, income, expense, net}], totals}. WO-less historical txns grouped as "— Unassigned —"; existing docs never mutated (SHA-256 snapshot of 1160 historical rows identical pre/post run).
  - create_transaction now also denormalises work_order_no onto the stored doc + response; update_transaction PRESERVES existing work_order_id/work_order_no when the caller omits it (TransactionIn defaults it None) → no silent data loss on partial edits.
- Frontend (`Reports.jsx`): new "Work Order P&L" tab (data-testid report-tab-wo_pnl, wo-pnl-table, wo-pnl-row-*, export-wo_pnl) — WO-wise Income/Receipts, Expense/Payments, Net + Center column + totals footer + CSV export.
- Testing (iteration_93): new suite 18 passed / 2 failed (both fixed this turn: POST response missing work_order_no; PUT erasing WO), phase90 + phase92 re-ran green. Both fixes curl-verified in preview (create returns work_order_no; edit amount keeps WO).
- Status: implemented + verified in PREVIEW. Needs DEPLOY for production.

---

## Phase 100 — Advanced category-based Sidebar redesign (frontend-only) (2026-06)
Request: Redesign the sidebar into a modern enterprise navigation — standalone Dashboard, 9 business categories + a bottom "System & Administration" section, smart single-accordion, collapsible icon-rail with tooltips, global search (Ctrl/Cmd+K), Favorites/Pinned, Recent Pages, category color identity, responsive drawer. HARD CONSTRAINT: no changes to routes, RBAC, permissions, center-mapping, badges, or backend. User choices: omit non-existent pages (Masters/Settings/Help), keep /reports as single reports entry, persist preferences on-device (localStorage).
- Implementation (`components/Layout.jsx`, full rewrite): central `navGroups` config (9 categories, each with `color`) + `systemGroup` (Subscription, Companies Super-Admin, Roles & Permissions, Login History) + standalone `dashboardNav`. Reuses every existing route/icon/role-gate/`module`. RBAC preserved exactly: `canSee()` logic unchanged + per-item `menu` gate via `usePerm().can` (relocated admin items keep their original menu), group-level `can(menu,'view')` kept.
  - Single-accordion: `openGroup` string state; opening one closes others; active route auto-expands its category.
  - Collapse rail: `SidebarRail` icon-only mode, persisted in localStorage `sb_collapsed`; category icon click expands + opens group.
  - Search: built from `itemIndex` (visible items only → permission-safe), match highlight, parent-category label, arrow/enter/escape keys, empty state; Ctrl/Cmd+K viewport-aware (desktop focuses sidebar input, mobile opens drawer).
  - Favorites (`sb_fav_<uid>`) via per-item pin button; Recent (`sb_recent_<uid>`, max 5, newest-first, dedup, excludes dashboard home). Both sections only render when ≥1 item resolves in the permission-filtered index.
  - Badges preserved (`badgeFor`): Transactions, HRMS, Pending Approvals + summed group badge when collapsed.
  - CSS: new `.sb-*` classes in index.css. i18n: new keys in i18n.js (EN+HI).
- Testing (iteration_94): RBAC parity verified across admin/company_admin/hr/center_manager (0 extra items, 0 search leaks), 41/41 routes load, all features work. 1 CRITICAL fixed: Ctrl/Cmd+K opened the hidden mobile Sheet on desktop (overlay blocked clicks) — fixed with viewport check + separate desktop/drawer search refs. Also fixed empty Favorites/Recent header. All 3 fixes screenshot-verified.
- KNOWN (not fixed, reported to user): collapsed-rail styled tooltip clipped by overflow (native title tooltip still works); /hrms/financial-history highlights both HRMS+child (not longest-prefix); pin hidden on touch; company_admin sees near-empty sidebar because backend returns all-false menu perms (pre-existing, not a regression).
- Status: implemented + verified in PREVIEW. Needs DEPLOY for production.

---

## Phase 101 — Dashboard redesign: operational overview hero (2026-06)
Request: Redesign the (finance-role) Dashboard to match a provided mockup — welcome hero, 4 operational KPI cards, Finance Overview chart, Transaction Status donut, Pending Actions (dark card), Organization Overview, Recent Activity, Quick Actions. Wire everything to REAL data (no fake numbers); keep existing detailed analytics.
- Backend (`server.py`): NEW read-only `GET /api/dashboard/overview` (require_finance_visible, reuses `_txn_scope_for_user` + `_scoped_center_ids`). Returns transaction status counts (total/approved/pending/rejected), org counts (active_users scoped by company, active_batches via db.batches status!=closed), pending_actions (approvals via list_pending_approvals, payment_requests via quotations in-flight, advances pending, hr_actions = reimbursements+unpaid payroll, partner_settlement), and recent_activity (last 6 scoped txns with creator name). No existing endpoint/data changed.
- Frontend (`pages/Dashboard.jsx`): new hero (gradient welcome banner + context chips + decorative), 4 clickable KPI cards (Total Transactions, Pending Approvals, Total Income w/ real MoM%, Total Expense w/ real MoM%), Finance Overview income-vs-expense line chart, Transaction Status donut (Completed/Pending/Failed %), dark Pending Actions list, Organization Overview (Company/Centers from entities, Active Users/Batches from overview) + center-wise activity bars derived from by_center volume, Recent Activity feed, Quick Actions grid (role-gated: Add User admin-only, Manage Centers mgr+). Existing Detailed Analytics (filters, monthly trend, distribution, company/partner charts, breakdown, milestone, fooding, Today/Upcoming widgets) preserved below. CSS: .dash-hero/.dash-kpi/.dash-qa/.dash-bar in index.css. Dashboard.jsx serves finance roles only (center_manager uses CenterManagerDashboard — untouched).
- Verified: backend curl (real values: 1163 txns 1006/125/32, 220 approvals, org counts, activity). Frontend screenshots (admin): all 8 hero sections render with real data; KPI→/transactions, Pending Advances→/advances, Quick Action View Reports→/reports navigation all work. Non-admin multi-company users hit the pre-existing company selector first (graceful; overview .catch handles unauthorized).
- Status: implemented + verified in PREVIEW. Needs DEPLOY for production.

## Phase 101.1 — Dashboard Center Focus (2026-06)
Added a center-focus selector in the Dashboard hero (replaces the static center chip; data-testid `dashboard-center-focus`, lists all centers the user can access + "All Centers"). Selecting a center re-scopes the ENTIRE dashboard to just that center.
- Backend (`/api/dashboard/overview`): now narrows by `center_id` when provided — transaction status counts, org counts (active_batches by center, active_users by assigned_center_ids), and the center-bearing pending queues (payment_requests/quotations, advances, reimbursements, payroll). `list_pending_approvals` stays the user's action inbox (no center arg; TypeError-safe fallback). Settlements have no center field → unchanged.
- Frontend (`Dashboard.jsx`): the selector is bound to `filters.center_id`, so `/dashboard/all` (KPIs, finance chart, by_center activity, breakdown, detailed analytics) and `/dashboard/overview` (tx status, pending actions, org, recent activity) all re-fetch center-scoped. Verified in preview: focusing TEST_Center_Phase72 → Total Transactions 1163→15, donut 100% completed, income ₹0 / expense ₹64,740, pending actions & org counts narrowed, recent activity = that center's txns.
- Status: implemented + verified in PREVIEW. Needs DEPLOY for production.

## Phase 102 — Mobile optimization: header cleanup + dashboard hero fix (2026-06)
Scope (user-chosen): clean up the top header on mobile; priority flows = Dashboard, Approvals, Check-in, HRMS, Attendance. (User declined table card-views / forms / tap-target passes for now.)
- Audit (390x844): login, transactions, pending-approvals, HRMS all render with NO page-level horizontal overflow and have the mobile bottom-nav. Wide data tables (e.g. Transactions ~1097px) sit in overflow-x-auto cards (side-scroll) — left for later per user.
- FIX (regression from Phase 101): Dashboard hero FY/Print controls were `absolute top-4 right-4` and overlapped the "Welcome back" title on phones. Now they flow normally on mobile (right-aligned above the title) and float only at md+. (`pages/Dashboard.jsx`)
- Header cleanup (`components/Layout.jsx` + `components/CompanySwitcher.jsx`): mobile header now shows a compact logo mark (Landmark in rounded square) + "Mashara" wordmark instead of a truncated "Mashara Finance"; FY switcher hidden on mobile (`hidden md:block` wrapper) — available in dashboard hero + finance pages inline; CompanySwitcher icon-only on mobile (name hidden <sm, max-w 44px) for multi-company users; user menu shows an initials avatar on mobile instead of a truncated name; hamburger enlarged to h-10 w-10 rounded-lg for easier tapping.
- Verified in preview at 390px: dashboard + HRMS headers clean, no overflow, hero title no longer overlapped.
- KNOWN/deferred (reported to user): language (EN/HI) toggle is hidden on mobile header (pre-existing, `hidden xs:/sm:`); wide tables still side-scroll; forms/dialogs and tap-target pass not done.
- Status: implemented + verified in PREVIEW. Needs DEPLOY for production.

## Phase 103 — Finance (Milestones) page visual redesign to match mockup (2026-06)
Request: redesign the Finance page (`/programs`, `pages/Programs.jsx`) to match a provided screenshot exactly, including colors. PURE visual restyle — all data, handlers, state and data-testids preserved; no backend/logic change.
- Hero: gradient rounded card (brand→violet) with BarChart3 icon in rounded square, title "Projects · Batches · Milestones" + subtitle + Print/admin buttons.
- Project tabs: rounded pill style (active = brand-soft).
- Center/Batch selectors: rounded card, icons inside triggers (Building2/Users), rounded New Batch + edit/lock/delete icon buttons.
- 4 summary cards with colored icon tiles: Batch (blue Database), Center (orange CalendarDays), Total Configured (purple Settings2, purple tint), Total Received (green CheckCircle2, emerald tint).
- Milestone Auto-Calculation: rounded card, Calculator icon tile, blue candidates/passed/placed/failed badge, bordered table with category chips + role-total row, 3 colored milestone boxes — 1st blue ("Role 30% / Lumpsum / Total"), 2nd purple ("40% + Passed", red recovery), 3rd green ("30% + Placed").
- Income Split: rounded card, Users icon, company card (blue tint + %badge + "(For N)") and partner cards with green "✓ Received" line.
- Tabs: segmented pill style (active brand bg); renamed "Fooding Income" → "Feeding Income".
- Milestone cards (MilestoneCard): rounded white cards, pill status badges (green Received / gray Not configured / amber Pending), colored amounts (TDS/Recovery/Assessment red, Net emerald), empty-state with illustration + Configure button, outline Update button. "Other (manual)" rendered full-width below the 1st/2nd/3rd grid.
- Milestone Details: rounded card with Receipt icon header + "All Milestones" chip, table with green RECEIVED / amber status chips.
- Verified in preview with real batch data (TEST_proj_659ed6 / TEST_batch_91c6c3): hero, selectors, 4 cards, auto-calc table + 3 colored boxes all render correctly; compiles clean.
- Status: implemented + verified in PREVIEW. Needs DEPLOY for production.
