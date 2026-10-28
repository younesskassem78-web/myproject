# MyTerra

A customer portal for a home internet provider.

- **Customers** sign in, see their plan and this month's data use, top up their balance (demo, no real payment) and send support tickets.
- **New people** apply for an account and pick a plan. Once an admin approves, the account is created and they sign in with the password they chose.
- **Admins** approve or reject applications and manage everything: users (create, change plan, role and balance, reset password, activate, deactivate, delete), plans (create, edit, hide, delete) and ticket status.

Stack: Python + FastAPI + PostgreSQL (all ids are UUIDs) · Angular + Chart.js

## Run it

### 1. Database

MyTerra uses its own PostgreSQL 16 server on port 5433, stored in `.pgdata/` in this folder. Start it:

```bash
"C:\Program Files\PostgreSQL\16\bin\pg_ctl.exe" -D .pgdata -o "-p 5433" -l .pgdata/server.log start
```

The connection details are in `backend/.env` (not committed):

```
DATABASE_URL=postgresql://postgres:<password>@localhost:5433/myterra
TEST_DATABASE_URL=postgresql://postgres:<password>@localhost:5433/myterra_test
```

On first start the backend creates the tables and adds the demo data.

### 2. Backend (port 8001)

```bash
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m uvicorn app.main:app --port 8001
```

### 3. Frontend (port 4200)

```bash
cd frontend
npm install
npx ng serve
```

Open http://localhost:4200.

## Demo accounts

| Email | Password | Role |
|---|---|---|
| admin@myterra.app | admin1234 | Admin |
| demo@myterra.app | demo1234 | Customer, Fiber 50 GB |
| sara@myterra.app | sara1234 | Customer, Fiber 100 GB |

Change the admin password from the Admin page before showing this to anyone online.

## Tests

```bash
cd backend && .venv\Scripts\python -m pytest       # uses the myterra_test database
cd frontend && npx ng test --watch=false
```

## API

Interactive docs: http://localhost:8001/docs

| Who | Method | Path |
|---|---|---|
| Anyone | GET | /api/plans |
| Anyone | POST | /api/apply |
| Anyone | POST | /api/login |
| Customer | GET | /api/me, /api/usage, /api/tickets |
| Customer | POST | /api/topup, /api/tickets |
| Admin | GET | /api/admin/applications, /api/admin/users, /api/admin/plans, /api/admin/tickets |
| Admin | POST | /api/admin/applications/{id}/approve, /api/admin/applications/{id}/reject |
| Admin | POST, PATCH, DELETE | /api/admin/users, /api/admin/plans |
| Admin | PATCH | /api/admin/tickets/{id} |
