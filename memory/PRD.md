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
- Role-based access (admin / manager / viewer)
- Entity CRUD for company / partner / center / project
- Transaction CRUD (type: investment | income | expense) with filters by entity + date range
- **Line items per transaction** (name, quantity, rate, amount) with auto-compute and item-wise aggregation across all txns
- **Document attachments per transaction** (bills, receipts, invoices up to 10MB) via Emergent Object Storage
- CSV import for transactions (auto-creates referenced entities by name)
- CSV export from transactions list + per-dimension reports
- Dashboard with KPI cards, monthly trend line chart, distribution pie chart, breakdown tabs (company / partner / center / project / **item**)
- Reports page with per-dimension P&L tables + CSV export (now includes items)
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
