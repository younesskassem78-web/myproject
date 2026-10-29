# MyTerra QA audit — progress report

Started 2026-10-29. This file is the checkpoint: if work stops, resume from "Next step".

## Inventory (phase 1)
- Frontend: Angular 22 (standalone, signals, zoneless), Vitest unit tests, Chart.js. 21 page routes + 1 redirect.
- Backend: FastAPI 0.162, Python 3.12, psycopg 3 (no ORM, parameterised SQL), psycopg-pool. 54 endpoints in 7 routers.
- Database: PostgreSQL 16, 15 tables, UUID keys. Schema is created/upgraded idempotently by `app/db.py` on startup.
- Auth: bearer tokens stored in `tokens` table (30-day expiry), roles customer/admin, guards in Angular (UI only) + server checks.
- Integrations: Gmail SMTP, Twilio (both in demo mode locally).
- Baseline before this audit: backend 123 passed, frontend 73 passed, production build OK, ruff clean.
- Backup of the real database before any schema change: `backups/myterra-before-audit-*.dump` (pg_dump custom format).

## Checklist
- [x] Route / endpoint / table inventory
- [x] Real-data integrity queries (orphans, duplicates, money totals): all 0
- [ ] Schema fixes: missing FK `tickets.speed_test_id`, missing FK indexes, unbounded `login_failures`/`verifications`
- [ ] Migration rehearsal on a restored copy of the real DB, then apply to real DB
- [ ] Bug fixes found during audit (see "Defects")
- [ ] Browser E2E suite (Playwright) with a dedicated database: 3 rounds per page
- [ ] Coverage measurement
- [ ] Final verification + report

## Defects
| # | Area | Defect | Status |
|---|---|---|---|
| D1 | DB | `tickets.speed_test_id` has no foreign key | open |
| D2 | DB | No index on 8 FK/lookup columns | open |
| D3 | DB | `login_failures`, `verifications` grow forever | open |

## Next step
Schema fixes D1-D3, rehearse on restored copy.
