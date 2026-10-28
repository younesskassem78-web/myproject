# MyTerra v2 — Design

## Why
Turn the demo portal into something that looks and behaves like a real ISP self-care product. Every feature must answer a question customers today phone the call centre for (research: proactive outage notices, usage alerts, bills and payments, plan changes, troubleshooting and ticket follow-up are what operators push to self-service to cut calls).

## Features (what problem each solves)

1. **Billing** — "How much do I owe?" Monthly invoices (plan price), statuses unpaid / paid / overdue, pay with the card pop-up or from account balance, autopay with a saved card (brand + last 4 only), printable invoice, payment history. Admin "Run billing for this month" issues invoices once per customer per month (safe to run twice) and charges autopay customers.
2. **Network status** — "Is it me or the network?" Admin opens / updates / resolves outages per city. Public `/status` page. Dashboard banner when the customer's city has an active outage. Affected customers get a notification and email.
3. **Speed test** — "My internet is slow, prove it." In-browser test (ping, download, upload) against the MyTerra server, result saved, history compared to the plan's advertised speed. The latest result can be attached to a support ticket.
4. **Support conversations** — "Did anyone answer?" Tickets get a category, a message thread (customer and admin replies), status changes notify the customer. A 3-step troubleshooter shows before opening a connection ticket (check status, restart router, run speed test).
5. **Notifications** — "Tell me before it's a problem." Bell with unread count: invoice issued, payment received, outage in your city, ticket reply / status, data use 80 % and 100 % (once per month each), installation updates.
6. **Installation tracker** — "When is the technician coming?" New customers see scheduled → technician assigned → installed, with the date. Admin moves it forward.
7. **Change plan** — side-by-side plan comparison; change takes effect now and the next invoice uses the new price.
8. **Admin overview** — KPIs (active customers, monthly recurring revenue, unpaid total, open tickets, pending applications, active outages), revenue for the last 6 months, audit log of every admin action.
9. **Security** — sessions expire after 30 days, sign-out deletes the session on the server, 5 wrong passwords in 15 minutes locks sign-in for that email for 15 minutes, forgot-password with an email code, change password in Settings.
10. **Design** — app shell with sidebar (desktop) and bottom bar (phone), dark mode (follows the system, with a toggle), same pine / amber identity.

## Non-goals
Real payments, real network data, live chat, native mobile app, multi-language.

## Decisions (my calls)
- Plans gain `speed_mbps` (50 GB → 100 Mbps, 100 GB → 300 Mbps).
- Invoice number format `INV-YYYYMM-XXXX` (first 4 hex of the user id).
- Invoices due 15 days after issue; unpaid past due shows as overdue (computed, not stored).
- Paying an invoice by card records a payment row (brand, last 4); paying from balance needs enough balance.
- Speed test uses 8 MB down / 4 MB up; capped server side at 25 MB per request.
- Backend split into routers by feature; schema stays in `db.py` with `create … if not exists` + `alter … add column if not exists` (Alembic is the upgrade path).
