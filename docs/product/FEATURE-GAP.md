# MyTerra — feature gap analysis and build checklist

Started 2026-11-04. Status key: ☐ not started · ◐ in progress · ☑ built and tested · ⛔ blocked · ✗ decided against.

## What MyTerra is
A self-service portal for a home-internet provider in Lebanon. Customers check data use, pay bills, report problems and change plans without calling. Staff approve sign-ups, run billing, post outages and answer tickets.

## Research (what real providers and ISP back-office tools offer)
Sources were vendor help pages and app-store listings, read on 2026-11-04. Third-party claims are marked as such.

| Provider / tool | Relevant features found |
|---|---|
| IDM (Lebanon) | Web portal and app: check consumption, refill the account, change plan; **buy extra GB online by card** (12/24/48 GB packs for fiber); pay at OMT, Whish, Liban Post. ([fiber FAQ](https://idm.net.lb/fiber-faq.html), [4G FAQ](https://idm.net.lb/4g-faq.html)) |
| Virgin Media (UK) | **Track the installation order**; **reschedule an engineer visit online if it's more than 24 h away, up to 3 times**; moving home from the account. ([manage appointment](https://www.virginmedia.com/help/broadband/manage-appointment/appointment-management), [track order](https://www.virginmedia.com/help/track-my-order)) |
| Xfinity (US) | Assistant for "when is my appointment", outage checks with restore estimate, usage meter, restart devices. ([Xfinity Assistant](https://www.xfinity.com/support/articles/call-back-my-account-app)) |
| Starlink | Data used this billing period; **pause / paid standby mode**; billing problems handled by support tickets. ([Starlink support](https://www.starlink.com/support/article/37bb3b47-9525-7224-5f0a-6d016ce26975)) |
| Splynx / Sonar (ISP back office) | Customer portal (invoices, payments, usage, tickets); **revenue reports**; **data export** (CSV/Excel; PDF and BI per vendor marketing). ([Splynx billing](https://splynx.com/isp-billing/), [Sonar](https://sonar.software/isp-billing-finance-reporting/)) |

## Gap analysis
| Feature | MyTerra before | Priority | Problem it solves | Decision |
|---|---|---|---|---|
| Usage meter, 80/100 % alerts | ✔ | — | | have |
| Pay bills, autopay, invoices, top-up | ✔ | — | | have |
| Outage banner + public status | ✔ | — | | have |
| Tickets, speed test, plan change, install tracker | ✔ | — | | have |
| **Buy extra data** | ✘ (the 100 % alert said "upgrade your plan", nothing else) | P1 | "I ran out of data mid-month": buy a pack instead of changing plan | ☐ build |
| **Reschedule installation** | ✘ (only staff could change it) | P1 | Customer can't be home that day | ☐ build (Virgin rules: >24 h away, max 3 times) |
| **Notification preferences** | ✘ (every alert also emailed) | P1 | Control over emails; required for good practice (GDPR-style consent for non-essential mail) | ☐ build |
| **Signed-in devices + sign out everywhere** | ✘ | P1 | Lost phone / shared computer | ☐ build |
| **Admin: server-side search, paging, CSV export** | ◐ (first 500 rows, search in the browser only) | P1 | Works past 500 customers; data out to Excel | ☐ build |
| **Admin: revenue report by date range + CSV** | ◐ (overview chart only) | P1 | Monthly accounting | ☐ build |
| **Bill due reminders** | ✘ | P2 | Fewer overdue bills | ☐ build (sent with the billing run) |
| SEO basics (robots.txt, description, private pages not indexed) | ✘ | P1 | Public pages findable, account pages hidden | ☐ build |
| Pause / vacation hold | ✘ | P3 | Seasonal homes | ✗ for now: needs pro-rated billing rules from the business |
| Moving home request | ✘ | P3 | | ✗ for now: a support ticket covers it |
| Arabic / French interface | ✘ | P3 | Lebanese customers | ✗ for now: large translation job, needs real translations |
| Pay with cash at OMT / Whish | ✘ | P3 | Customers without cards | ⛔ needs a real payment partner |
| AI chat assistant | ✘ | P3 | | ✗: the troubleshooter + tickets already answer the common questions; no measurable gain |
| Router / Wi-Fi management | ✘ | P3 | | ⛔ needs real router integration (TR-069) |

## Build checklist
| # | Feature | Status | Where | Tests |
|---|---|---|---|---|
| 1 | Buy extra data (10/25/50 GB packs, card, counted in the usage meter, shown in payments and reports) | ☑ | Overview → "Add extra data"; `POST /api/data-packs`; table `data_addons` | `test_data_packs.py` (7), dashboard unit test, browser journey |
| 2 | Reschedule installation (>24 h ahead, max 3 times, notification) | ☑ | Overview → installation card → "Change date"; `POST /api/installation/reschedule`; `users.install_reschedules` | `test_reschedule.py` (6), 2 unit tests, browser journey |
| 3 | Email preferences (4 topics; in-app alerts and security emails always on) | ☑ | Settings → "Email me about"; `GET/PUT /api/account/email-preferences`; `users.email_opt_out` | `test_email_prefs.py` (4), unit test, browser journey |
| 4 | Signed-in devices, sign out one or all others; tokens stored as SHA-256 fingerprints | ☑ | Settings → "Signed-in devices"; `/api/account/sessions*`; `tokens.id/user_agent/ip/last_used_at` | `test_sessions.py` (6), 2 unit tests, browser journey |
| 5 | Admin server-side search and paging (customers, bills by status) + customer CSV | ☑ | Admin → Customers / Billing; `?q=&status=&limit=&offset=` | `test_reports.py`, browser journey |
| 6 | Revenue report by date range + CSV exports (customers, bills, payments; formula-safe) | ☑ | Admin → Reports; `/api/admin/reports/revenue`, `/api/admin/export/*.csv` | `test_reports.py` (9), unit test, browser journey |
| 7 | Bill-due reminders (once per bill, within 3 days, not for autopay) | ☑ | Sent by Admin → Billing → "Issue this month's bills"; `invoices.reminded_at` | `test_reminders.py` (3) |
| 8 | SEO basics: description, Open Graph, robots.txt, `noindex` on every private page | ☑ | `index.html`, `public/robots.txt`, `app.ts` | browser test |

Not built (see the decisions above): pause service, moving-home flow, Arabic/French, cash payments at OMT/Whish, AI chat, router management, sitemap (needs the final domain name).
