# MyTerra

A customer portal for a home internet provider. Sign in, see your plan and this month's data use, top up your balance (demo, no real payment), and report problems with support tickets.

- **Backend:** Python + FastAPI, fake data kept in memory (resets on restart)
- **Frontend:** Angular + Chart.js

## Run it

Backend (port 8001):

```bash
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m uvicorn app.main:app --port 8001
```

Frontend (port 4200), in a second terminal:

```bash
cd frontend
npm install
npx ng serve
```

Open http://localhost:4200.

## Demo accounts

| Email | Password | Plan |
|---|---|---|
| demo@myterra.app | demo1234 | Fiber 50 GB, $20/month |
| sara@myterra.app | sara1234 | Fiber 100 GB, $30/month |

## Tests

```bash
cd backend && .venv\Scripts\python -m pytest
cd frontend && npx ng test --watch=false
```

## API

| Method | Path | What it does |
|---|---|---|
| POST | /api/login | Email + password, returns a token |
| GET | /api/me | Name, balance and plan |
| GET | /api/usage | This month's daily data use |
| POST | /api/topup | Add 0–500 to the balance (fake) |
| GET | /api/tickets | Your support tickets, newest first |
| POST | /api/tickets | Create a ticket |

Interactive API docs: http://localhost:8001/docs
