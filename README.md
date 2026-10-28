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

### Email and SMS (optional)

Without these settings MyTerra runs in **demo mode**: verification codes and emails are printed in the backend window instead of being sent. To send for real, add these lines to `backend/.env` and restart the backend.

**Email through Gmail** (free, about 500 emails a day):
1. Turn on 2-Step Verification for your Google account.
2. Open https://myaccount.google.com/apppasswords, create an app password named "MyTerra" and copy the 16 letters.
3. Add:
   ```
   GMAIL_USER=you@gmail.com
   GMAIL_APP_PASSWORD=abcd efgh ijkl mnop
   ```

**SMS through a Twilio trial** (free credit; only sends to numbers you verify in Twilio):
1. Sign up at https://www.twilio.com/try-twilio and verify your own mobile number.
2. In the Twilio console, get a trial phone number, and copy the Account SID and Auth Token.
3. Add:
   ```
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN=your_auth_token
   TWILIO_FROM=+1xxxxxxxxxx
   ```

## Applying

The apply page asks for name, email and mobile number (each confirmed with a 6-digit code), password, date of birth (18+), ID number, address, preferred installation date, plan and a first-month card payment.

The payment is fake: nothing is charged, and only the card type and last 4 digits are stored. Use `4242 4242 4242 4242` with any future expiry. `4000 0000 0000 0002` is always declined.

Emails go out when an application is received, approved (with a sign-in link, never the password) and rejected (with a refund note).

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
