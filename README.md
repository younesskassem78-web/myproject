# MyTerra

A self-service portal for a home internet provider. Customers manage their own service instead of calling support; staff run the business from an admin console.

**Stack:** Angular 22 + Chart.js · Python 3.12 + FastAPI · PostgreSQL 16 (UUID keys) · Gmail SMTP (email) · Twilio (SMS)

## What it does

| For customers | Problem it solves |
|---|---|
| **Overview**: data used this month, daily chart, amount due, quick actions | "How much have I used? What do I owe?" |
| **Network status** banner + public `/status` page | "Is my internet down, or is it everyone?" |
| **Speed test** (ping, download, upload) with history vs. plan speed | "It's slow. Prove it." |
| **Billing**: monthly bills, pay by card or balance, autopay, printable invoices, payment history | "Where's my bill? Did my payment go through?" |
| **Support**: troubleshooter, tickets with a reply thread, attach a speed test | "Did anyone answer me?" |
| **Notifications**: bill ready, payment received, outage nearby, support reply, data at 80% / 100%, installation updates | Finding out before it's a problem |
| **Installation tracker**: booked, technician assigned, installed | "When is the technician coming?" |
| **Change plan**, **Settings** (password, dark mode) | Self-service instead of a call |
| **Apply**: verified email + SMS codes, address, ID, install date, first-month card payment | Signing up without visiting a shop |

| For staff (admin) | |
|---|---|
| **Overview**: active customers, monthly recurring revenue, unpaid and overdue bills, waiting applications, open tickets, active outages, payments chart |
| **Applications**: approve (creates the account, the paid first bill and the install booking, emails a sign-in link) or reject (emails a refund note) |
| **Customers**: add, change plan / role / balance / installation step, reset password, deactivate, delete |
| **Plans**: add, edit speed / data / price, hide, delete when unused |
| **Billing**: issue this month's bills (safe to run twice, charges autopay), search and filter all bills |
| **Outages**: open, update, resolve; customers in that city are notified by app and email |
| **Tickets**: filter, reply, change status (customer is notified) |
| **Audit log**: every admin change, who and when |

Payments are **simulated**: no money moves and only card brand + last 4 digits are ever stored. Test card `4242 4242 4242 4242` (any future date); `4000 0000 0000 0002` is always declined.

## Run it locally

### 1. Database
MyTerra uses its own PostgreSQL 16 server on port 5433, stored in `.pgdata/`:

```bash
"C:\Program Files\PostgreSQL\16\bin\pg_ctl.exe" -D .pgdata -o "-p 5433" -l .pgdata/server.log start
```

Copy `backend/.env.example` to `backend/.env` and fill in the database password. On first start the API creates the tables, upgrades older databases in place (new columns only, nothing is dropped) and adds demo data.

### 2. Backend (http://127.0.0.1:8001)
```bash
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements-dev.txt
.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8001
```

### 3. Frontend (http://localhost:4200)
```bash
cd frontend
npm install
npx ng serve
```
The dev server forwards `/api` to the backend (`proxy.conf.json`), so the site and API share one address.

### Demo accounts
| Email | Password | |
|---|---|---|
| admin@myterra.app | admin1234 | Admin |
| demo@myterra.app | demo1234 | Customer in Beirut, Fiber 50 GB, unpaid bill |
| sara@myterra.app | sara1234 | Customer in Tripoli (has an active outage), Fiber 100 GB |

Demo data is only created when `DEMO_DATA` is not `false`. **Never deploy with demo data.**

### Email and SMS
Without credentials MyTerra runs in **demo mode**: codes and emails are printed in the backend window. To send for real, add to `backend/.env`:
- **Gmail** (free, ~500/day): turn on 2-Step Verification, create an app password at https://myaccount.google.com/apppasswords, set `GMAIL_USER` and `GMAIL_APP_PASSWORD`.
- **Twilio trial** (free credit, only to numbers you verify in Twilio): set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`.

## Configuration
All settings are environment variables; see `backend/.env.example` (local) and `.env.example` (Docker). Key ones:

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | – | PostgreSQL connection string |
| `APP_ENV` | `development` | `production` hides `/docs` |
| `APP_URL` | `http://localhost:4200` | Website address used in email links |
| `DEMO_DATA` | `true` | `false` = empty database plus one admin from `ADMIN_EMAIL` / `ADMIN_PASSWORD` |
| `CORS_ORIGINS` | `http://localhost:4200` | Only needed when the site and API are on different addresses |
| `PASSWORD_ITERATIONS` | `600000` | PBKDF2 rounds (OWASP 2023) |
| `DB_POOL_SIZE` | `10` | Database connections kept open |

## Deploy (Docker)
```bash
cp .env.example .env      # set POSTGRES_PASSWORD, ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL
docker compose up --build
```
The site runs on http://localhost:8080. nginx serves the Angular build and forwards `/api` to the API container; PostgreSQL data lives in the `pgdata` volume. Put the stack behind HTTPS (a load balancer or a reverse proxy such as Caddy) before going public. `GET /api/health` returns 200 when the API and database are up, 503 when the database is unreachable.

## Tests and checks
```bash
cd backend
.venv\Scripts\python -m pytest -q                 # uses the myterra_test database, never the real one
.venv\Scripts\python -m ruff check app tests
.venv\Scripts\python -m pip_audit -r requirements.txt
cd ../frontend
npx ng test --watch=false
npx ng build --configuration production
npm audit
```
Browser tests (Playwright, real Chrome) start their own API on port 8011 against a throwaway `myterra_e2e` database (set `E2E_DATABASE_URL` in `backend/.env`; the server refuses any database whose name doesn't end in `_e2e`) and their own site on port 4300:

```bash
cd frontend
npx playwright test          # report in frontend/e2e-report
```

They cover every page at desktop, tablet and phone sizes and in dark mode (content, console errors, sideways scrolling, WCAG 2.1 AA via axe), full journeys with every write read back from the database, and access-control / session / hostile-input checks. The audit report is in `docs/qa/AUDIT.md`.

`.github/workflows/ci.yml` runs all of these on every push, with a PostgreSQL service.

## Security notes
- Passwords: PBKDF2-SHA256, 600,000 rounds, random salt; older hashes are upgraded at the next sign-in.
- Sessions: random 256-bit tokens stored server-side, expire after 30 days, deleted on sign-out, password change or deactivation.
- Sign-in: 5 wrong passwords in 15 minutes locks that email for 15 minutes. Password reset by emailed 6-digit code (5 tries per code, 10-minute expiry); the response never reveals whether an account exists.
- Every query is parameterised; every customer endpoint is scoped to the signed-in user (tested for cross-account access).
- Security headers on the API (`nosniff`, `DENY` framing, `no-store` caching) and a strict Content-Security-Policy in nginx.

## API
Interactive docs (development only): http://127.0.0.1:8001/docs

## Known limitations
- Payments, data usage and network speeds are simulated; the speed test measures to the MyTerra server.
- No general per-IP rate limiting (sign-in and code endpoints are limited).
- Deleting a customer also deletes their bills and payments; a real operator would archive instead.
- Outage and billing emails are sent during the request; move them to a background queue for large customer bases.
