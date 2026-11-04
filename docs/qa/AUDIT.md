# MyTerra QA audit — report

Audit date: 2026-10-29. Status: **complete** (see "Final verification" for the last run's numbers).

## A. Inventory
- **Frontend:** Angular 22 (standalone components, signals, zoneless), Chart.js, Vitest unit tests, Playwright browser tests. **21 page routes** (+1 catch-all redirect).
- **Backend:** FastAPI 0.162 / Python 3.12, psycopg 3 + connection pool, parameterised SQL (no ORM). **54 endpoints** in 7 routers.
- **Database:** PostgreSQL 16, **15 tables**, UUID primary keys. Schema is created and upgraded idempotently by `backend/app/db.py` at startup (additive `create … if not exists` / `alter … add column if not exists` / guarded constraint blocks; nothing is ever dropped outside the test reset).
- **Auth:** server-side bearer sessions (`tokens`, 30-day expiry), roles `customer`/`admin`; Angular guards are UI-only, every admin endpoint is checked on the server.
- **Integrations:** Gmail SMTP and Twilio (demo mode without credentials).

### Table → feature → API map
| Table | Used by | Endpoints |
|---|---|---|
| users | accounts, admin customers | `POST /login`, `GET /me`, `POST /plan`, `POST /account/password`, `/admin/users*`, approve |
| plans | plan list, plan change, admin plans | `GET /plans`, `/admin/plans*` |
| applications | sign-up | `POST /apply`, `/admin/applications*` |
| verifications | email/SMS codes, password reset | `/verify/send`, `/verify/check`, `/password/forgot`, `/password/reset` |
| tokens | sessions | `POST /login`, `POST /logout`, every signed-in call |
| login_failures | sign-in lockout (per email and per address) | `POST /login` |
| invoices | bills | `/invoices*`, `GET /billing`, `/admin/invoices`, `/admin/billing/run`, approve |
| payments | payments, top-ups, autopay | `GET /payments`, `/invoices/{id}/pay`, `/topup`, billing run, approve |
| outages | network status | `GET /status`, `GET /me`, `/admin/outages*` |
| notifications | bell | `/notifications*` (written by billing, outages, tickets, plan, usage, installs) |
| tickets, ticket_messages | support | `/tickets*`, `/admin/tickets*` |
| speed_tests | speed test, ticket attachments | `/speedtests`, `/speedtest/*`, `POST /tickets` |
| audit_log | admin accountability | `/admin/audit`, `/admin/overview` (written by every admin action) |
| usage_alerts | 80 % / 100 % data warnings | `GET /usage` |

## B. Defects found and fixed
| # | Where | Root cause | Fix | Verified by |
|---|---|---|---|---|
| D1 | `tickets.speed_test_id` | Column had no foreign key: a ticket could point at a deleted speed test | FK to `speed_tests(id) on delete set null` (existing dangling values nulled first) | `test_ticket_speed_test_is_a_foreign_key` |
| D2 | 11 lookup columns | No indexes on FK / filter columns (tickets.user_id, payments.user_id/invoice_id, tokens.user_id, …) | `create index if not exists` × 11 | `test_lookup_columns_are_indexed` |
| D3 | `login_failures`, `verifications` | Rows never deleted, tables grow forever | Prune rows older than a day on each write | `test_old_failures_and_codes_are_pruned` |
| D4 | Admin customers / plans tables (`admin.ts`) | `Number('') === 0`: clearing a box and clicking away saved 0 | Strict `num()` parser; blank or invalid input is refused with a message | unit `D4 …` ×5 + E2E customers journey |
| D5 | `PATCH /admin/users` | Role could become `customer` with no plan → that customer's overview failed | Server refuses (422) unless a plan is set | `test_cannot_turn_a_planless_admin_into_a_customer` |
| D6 | `adminGuard` | Signed-in customers opening `/admin` were sent to the sign-in page | Customers go to `/dashboard`, signed-out visitors to `/login` | unit `D6 …` ×3 + E2E round 3 |
| D7 | `POST /login` | Lockout was per email only: one address could try a password against many accounts | Also lock an address after 30 failures in 15 min | `test_too_many_failures_from_one_address` |
| D8 | Docker backend | Behind nginx every request would look like it came from nginx | `--forwarded-allow-ips *` inside the private compose network | config review (Docker not available locally) |
| D9 | Admin list endpoints | Unbounded lists (users, applications, tickets) | `limit`/`offset` (max 1000) + `X-Total-Count` on all admin lists | `test_admin_lists_take_limit_and_offset` |
| D10 | Plan page | A customer on a hidden plan didn't see their own plan | Current plan is always shown, marked "no longer sold" | unit `D10 …` |
| D11 | Apply page | With no plans for sale the form could never be completed, silently | Clear "applications are closed" message | unit `D11 …` |
| D12 | Status page, outages, ticket threads | WCAG colour contrast below 4.5:1 (muted text on tinted bubbles; opacity on resolved outages) | Contrast-safe styles | Playwright + axe, light and dark |
| D13 | Every table on phones | Horizontally scrolling regions weren't keyboard-reachable (WCAG 2.1.1) | `tabindex="0"`, `role="region"`, label, focus ring | Playwright + axe at 390 px |

Earlier in the same session (before this audit, with tests): notification bell showing stale data, phone menu missing pages, API ~270 ms per request (fixed with a connection pool + same-origin proxy, now ~8 ms), reset-code namespace reachable from public endpoints, unreachable-server message.

## C. Three-round testing
- **Round 1 (UI):** every page opened directly at 1366 / 820 / 390 px wide and in dark mode; checks main content, no redirect, no console errors or uncaught exceptions, no sideways scrolling, no serious/critical WCAG 2.1 AA violations (axe). Plus side menu and phone menu reach every page. `frontend/e2e/round1-pages.spec.ts`
- **Round 2 (API & DB):** full journeys through the UI; every write read back independently through the API and after a reload. `frontend/e2e/round2-journeys.spec.ts` + backend pytest suite (real PostgreSQL test database).
- **Round 3 (regression & security):** access control, forged/expired/ended sessions, hostile input, double submits, declined cards, concurrent duplicates, security headers (`frontend/e2e/round3-security.spec.ts`), then every suite re-run.

| Page / route | Round 1: UI | Round 2: API & DB | Round 3: Regression | Final |
|---|---|---|---|---|
| /login | ✅ 3 sizes + dark | ✅ sign-in journeys, lockouts (pytest) | ✅ redirects, sessions | PASS |
| /apply | ✅ | ✅ full sign-up → approval → sign-in | ✅ concurrent duplicate apply | PASS |
| /forgot | ✅ | ✅ no account disclosure; reset (pytest) | ✅ codes never shown | PASS |
| /status | ✅ | ✅ outage open → visible → resolved | ✅ | PASS |
| /dashboard | ✅ | ✅ install tracker, outage banner, persisted | ✅ | PASS |
| /billing | ✅ | ✅ pay, top-up, autopay, all persisted | ✅ double-click, declined card, 409 re-pay | PASS |
| /billing/:id | ✅ | ✅ invoice read (pytest), cross-account 404 | ✅ | PASS |
| /speed-test | ✅ | ✅ run → saved → history after reload | ✅ | PASS |
| /support | ✅ | ✅ create ticket (+speed test attach, pytest) | ✅ hostile input | PASS |
| /support/:id | ✅ | ✅ staff reply → customer sees → reopen | ✅ | PASS |
| /plan | ✅ | ✅ change persisted | ✅ | PASS |
| /settings | ✅ | ✅ password change → sign out → new sign-in | ✅ | PASS |
| /admin | ✅ | ✅ KPIs (pytest) | ✅ customer blocked | PASS |
| /admin/applications | ✅ | ✅ approve via UI, persisted | ✅ | PASS |
| /admin/customers | ✅ | ✅ add / balance / blank refused / deactivate / activate / delete, audit trail | ✅ | PASS |
| /admin/plans | ✅ | ✅ create / edit / hide / delete persisted | ✅ | PASS |
| /admin/billing | ✅ | ✅ run twice safely | ✅ concurrent runs: no duplicates | PASS |
| /admin/outages | ✅ | ✅ open / resolve, city notified | ✅ | PASS |
| /admin/tickets | ✅ | ✅ open ticket, status change | ✅ | PASS |
| /admin/tickets/:id | ✅ | ✅ staff reply, status | ✅ | PASS |
| /admin/audit | ✅ | ✅ entries for every admin change | ✅ | PASS |

## D. Database integrity
- All 15 tables, 12 foreign keys (incl. new D1) and 11 new indexes verified in the real database after the upgrade.
- Real-data checks (orphans, duplicate monthly bills, paid bills without payments, payment totals vs bill amounts, dangling notification links): **0 problems**.
- Migration: backup `backups/myterra-before-audit-*.dump` → restored into a copy → upgrade run twice (idempotent) → row counts identical → applied to the real database → verified.
- Persistence: every create/update/delete in the journeys above is read back through an independent API call and after a page reload.
- Deletion rules: deleting a customer cascades to their sessions, bills, payments, tickets, speed tests and notifications; plans in use cannot be deleted (409). See "Remaining work".

## E. Remaining work
| Severity | Item |
|---|---|
| Medium | Deleting a customer also deletes their bills and payments (cascade). A real operator would archive. Needs a product decision. |
| Medium | Outage and billing emails are sent during the request; a large city or customer base should use a background queue. |
| Medium | Admin list screens show the first 500 rows; the API pages (`limit`/`offset`), the screens don't yet. |
| Low | Session token is kept in `localStorage` (mitigated by strict CSP and no `innerHTML`); an httpOnly cookie would be stronger. |
| Low | Schema upgrades live in `db.py` (idempotent, additive). Alembic would add versioned down-migrations. |
| Blocked | Docker images and the CI workflow were not run: Docker is not installed and the project is not on GitHub. |
| Blocked | Real email/SMS sending not tested end to end: no Gmail/Twilio credentials (the code paths are tested with fakes). |

## F. Final verification (last full run, 2026-10-29)
| Check | Result |
|---|---|
| Backend lint (ruff: E, F, W, B) | clean |
| Backend tests (pytest, real PostgreSQL) | **133 passed**, 0 failed, 0 skipped — coverage **96 %** |
| Backend dependencies (pip-audit) | no known vulnerabilities |
| Frontend unit tests (Vitest) | **83 passed** in 15 files, 0 failed — line coverage **80 %** |
| Production build (`ng build --configuration production`) | success, no warnings, 384.85 kB initial |
| Frontend dependencies (npm audit) | 0 vulnerabilities |
| Browser tests (Playwright, real Chrome, 3 rounds) | **109 passed**, 0 failed, 0 flaky, 0 skipped |
| API / server log during browser runs | no exceptions or tracebacks |

## G. Readiness
**PASS WITH LIMITATIONS** — no known critical or high defects; every page passed all three rounds. Not verified: Docker images, the CI workflow, and real email/SMS delivery (see "Remaining work").

---

# Audit 2 — 2026-11-04 (after live email, step-by-step sign-up and password reset)

Scope: what changed since audit 1 plus a fresh real-user pass. Backup first: `backups/myterra-before-audit2-20261104-0834.dump` (all 15 tables).

## Incident found during start-up
The PostgreSQL server had crashed on 2026-11-03 23:56 (Windows exception 0xC0000142, a process failing to start while the PC had ~0.9 GB of 7.8 GB memory free). It recovered automatically on restart; row counts checked, no data lost. Cause is the machine's memory pressure, not the app.

## Defects found and fixed
| # | Severity | Problem (root cause) | Fix | Verified by |
|---|---|---|---|---|
| E1 | High | Every email was sent inside the request; Brevo takes **5.2 s** per email (measured). Opening an outage for a city emailed customers one by one inside the transaction (100 customers ≈ 9 min, far past any timeout); paying a bill waited 5 s for the receipt. | Notification emails go to a 4-worker background sender (`deps.send_email_later`). Codes, password reset, approve and reject still send inline because the person must know if it failed. | `test_outage_request_does_not_wait_for_email` (fails before the fix), `test_failed_background_email_is_logged_not_raised` |
| E2 | High | No per-address limit on code emails: one visitor could request codes for hundreds of addresses, using up the 300/day free email quota and tying up server threads for 5 s each. | Max 10 code emails per hour per network address (new `verifications.ip` column + index); the reset page shows this limit instead of pretending a code was sent. | `test_one_address_cannot_send_unlimited_code_emails` |
| E3 | High (data) | Deleting a customer cascaded to their bills and payments (financial records). | Refused with 409 when bills or payments exist; deactivate instead. Customers without billing history can still be deleted. | `test_customer_with_bills_cannot_be_deleted`, `test_delete_customer_without_bills_removes_their_tickets` |
| E4 | Medium | When the email service failed, the API's 502 "We couldn't send the email" was shown as "Can't reach the MyTerra server" (status checked before the message). | The API's own message wins; connection text only when there is none. | unit `shows the server's own message even on a 502` |
| E5 | Medium | A missing field showed a bare "Field required" (seen by the user on sign-up payment). | Names the field: "Birth date is missing." | unit `names the missing field` |
| E6 | Medium | Lists said "No bills yet", "No tickets yet", etc. while still loading; billing, invoice, ticket and settings were blank while loading. | "Loading…" until data arrives; skeleton placeholder on single-item pages (10 pages). | unit `says Loading, not "No bills yet"` |
| E7 | Medium | Approve/Reject gave no feedback for the ~5 s the approval email takes; double clicks were likely. | "Approving…" with spinner, row buttons locked until done. | unit `shows Approving… and locks the buttons` |
| E8 | Medium (a11y) | Review step of sign-up: Edit buttons inside a definition list (`<dl>`) broke screen-reader structure. Found by adding WCAG 2.2 checks to every sign-up and reset step. | Edit buttons moved into their own `<dd>`. | Playwright + axe (WCAG 2.2 AA) on every step |

Also done in the days before this audit (each with tests): bare site address showed an empty page; sign-up split into 5 steps with only the email verified and required fields marked; +961 added to Lebanese numbers automatically; existing accounts told at the code step; password reset split into email → code → new password, with the code checked before the password and unknown emails told clearly; email moved from Gmail-only to any SMTP service (Brevo).

## Three rounds
- **Round 1 (before changes):** backend 138 passed, frontend 84 passed, browser 109 passed.
- **Round 2 (after fixes):** backend 142 passed; frontend 88 passed; browser: the new WCAG 2.2 per-step checks failed once on E8 → fixed → journeys and security re-run 21/21 passed.
- **Round 3 (full regression):** frontend 88 passed; browser **109 passed, 0 failed, 0 flaky, 0 skipped** (desktop, tablet, phone, dark mode; WCAG 2.2 AA; journeys with database read-back; access control and hostile input).

## Database
- New: `verifications.ip` + index `verifications_ip` (additive). Rehearsed on a restored copy of today's backup: run twice, row counts identical, then applied to the real database and verified. Real data unchanged (7 users, 4 applications, 8 bills, 6 payments, 2 tickets).

## Final checks
| Check | Result |
|---|---|
| Backend lint (ruff E, F, W, B) | clean |
| Backend tests | 142 passed |
| Frontend unit tests | 88 passed |
| Production build | success, no warnings, 386 kB initial |
| npm audit / pip-audit | 0 / 0 known vulnerabilities |
| Browser tests (3 rounds, WCAG 2.2 AA) | 109 passed |

## Not done / limitations
| Severity | Item |
|---|---|
| Medium | Background email queue is in memory: a restart drops unsent emails, and one can leave before its transaction commits. Upgrade: jobs table + worker. |
| Medium | Admin screens show the first 500 rows (API pages, screens don't yet). |
| Low | Session token in `localStorage` (mitigated by strict CSP, no `innerHTML`). |
| Low | Revealing whether an email has an account (reset and sign-up) is a deliberate usability choice; limited by the per-address code limit. |
| Not run | Lighthouse and OWASP ZAP (not installed; the machine is short on memory), Docker images, CI on GitHub, real SMS (no Twilio). |

**Readiness: PASS WITH LIMITATIONS** — no known critical or high defects remain.
