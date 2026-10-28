# MyTerra — Design

## What it is
MyTerra is a demo customer portal for an imaginary internet provider. A customer logs in and manages their internet: sees their plan, checks data usage, tops up their balance, and reports problems. It is a portfolio project: small enough to finish, polished enough to show.

## Goals
- Log in with email and password.
- See the current plan, e.g. "Fiber 50 GB — $20/month", and the account balance.
- See this month's data usage as a chart (one bar per day) with used vs. limit.
- Top up the balance (fake: no real payment, the balance just goes up).
- Report a problem: write a ticket (subject + message), see all own tickets and their status.

## Non-goals
- Real payments, real signup, password reset, email.
- A real database (fake data in memory is fine; it resets when the server restarts).
- Admin panel (ticket status changes are seeded, not managed).
- Flutter phone app — later, separate plan, same backend.

## Anti-goals
- Looks like a tutorial: unstyled pages, broken states, crashes on bad input.
- Too big to finish.

## Decided (my calls, the user can override)
- Backend: Python 3.12 + FastAPI, tested with pytest. Data in Python dicts.
- Auth: random token returned on login, sent as `Authorization: Bearer <token>`.
- Frontend: Angular (latest, standalone components), Chart.js for the usage chart.
- Demo accounts: `demo@myterra.app` / `demo1234` (Fiber 50 GB, $20/month, balance $5.00) and `sara@myterra.app` / `sara1234` (Fiber 100 GB, $30/month, balance $12.50).
- Ticket statuses: `open`, `in_progress`, `resolved`. New tickets start `open`.
- Top-up amount: more than 0, at most 500.

## Left to the builder
Visual style (clean, modern, mobile-friendly), exact copy, colors.
