# MyTerra handoff (2026-11-12)

Portfolio project: self-service portal for a home fibre internet provider in Lebanon. The owner is not deeply technical:
talk in simple, plain English and keep reports short (few screenshots, results not full logs).

## Project
- Path C:\Users\TT\myterra (Windows 11, Git Bash + PowerShell). Branch feature/myterra, pushed to
  github.com/younesskassem78-web/myproject. Keep main equal: `git branch -f main HEAD`, push both.
  Commits end with: Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Stack: Angular 22 (standalone, signals, zoneless) + FastAPI (Python 3.12, psycopg 3, raw SQL) + PostgreSQL 16.
- Read first: README.md, docs/product/FEATURE-GAP.md, docs/qa/AUDIT.md, docs/design/DESIGN-SYSTEM.md.

## Running it
- The app's preview panel can start both servers (.claude/launch.json: "backend" port 8001, "frontend" port 4200).
- DB: `"C:\Program Files\PostgreSQL\16\bin\pg_ctl.exe" -D .pgdata -o "-p 5433" -l .pgdata/server.log start`
  (databases: myterra real, myterra_test pytest, myterra_e2e Playwright).
- Only ~1 GB free RAM: stop the preview servers before the Playwright suite (it starts its own on 8011/4300).
- Test accounts: demo@myterra.app / demo1234, admin@myterra.app / admin1234 (owner). Secrets live in backend/.env (never print).

## Rules
- Back up and rehearse before schema changes: `python backend/scripts/rehearse_upgrade.py`.
- Never drop real data, never weaken tests, verify before claiming. Ask before anything paid, irreversible or emailing real people.
- AUTO_BILLING=false on purpose (real Gmail addresses would be billed/emailed). Ask first.
- Every visible text in English, Arabic, French: `npm run check:i18n`.
- Design: keep the classic look (pine #1d6b58 / #134a3d, amber #f0ad3a, mint #eaf0ee, Bricolage Grotesque, pill buttons).
  Any visual redesign: show 2-4 options first, build only the chosen one.
- Files are a mix of CRLF and LF line endings: edit without changing a file's existing endings.

## Current state (all committed and pushed, last commit 770ff9e)
- Nov 5: design-system tidy-up, loading system (retries for reads only, offline notice, skeletons, Try again),
  one alignment system on all pages. Nov 6: ten finishing touches (fibre light, live pulse, count-up numbers,
  plan light border, card spotlight, page cross-fade + circular theme switch, scroll-in, signal rings, button shine,
  promise strip). Sign-in page now lazy-loaded (initial bundle 452 kB, budget 500 kB).
- Tests last run: unit 122/122, Playwright 143/143, i18n complete, production build clean.
- Local only: branch design/lightline-dark (rejected dark redesign, kept for reference).
- Tools: plugin ui-ux-pro-max installed; 21st.dev MCP added (its API key was pasted in chat: user should rotate it).

## Still to do
1. Browser tests for the two-step sign-in screens (login code step, Settings setup card, admin reset).
2. Deployment guide + setup for one cheap host (small VPS, existing docker-compose + Caddy for HTTPS), daily DB backups
   with a restore test. Docker isn't installed here: mark what couldn't be verified. Don't deploy or spend money without asking.
3. Update README and docs/product/FEATURE-GAP.md (roles, automation, i18n, 2FA, home page, loading, touches).
4. Known limits: Arabic/French written by AI (need native review); staff console English only; payments simulated; SMS not configured.
