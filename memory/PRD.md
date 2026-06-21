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
- **Reimbursement 3-stage approval** — staff submits → L1 (snapshot of staff.reports_to, only that user can approve) → Accountant → Pay. On Pay, auto-creates an approved `expense` transaction so the dashboard P&L stays in sync. Step-wise badge UI visible to all roles.
- **Payroll** — admin/accountant runs monthly payroll; per-staff gross computed as `per_day_rate × days_present` (falls back to prorated monthly_salary). Pay action auto-creates the offsetting expense transaction.
- Bilingual UI (English / Hindi) toggle in header, persists in localStorage
- Swiss-style high-contrast light theme with International Klein Blue accents

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
