// Guided tour of MyTerra's features in a visible Chrome window. Nothing is paid, sent or saved:
// payment windows and forms are opened and then cancelled.
import { chromium } from '@playwright/test';

const SITE = 'http://localhost:4200';
const out = process.argv[2];
const browser = await chromium.launch({ channel: 'chrome', headless: false, slowMo: 110, args: ['--window-size=1300,900'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 780 }, recordVideo: { dir: out, size: { width: 1280, height: 780 } } });
const page = await ctx.newPage();
const TOTAL = 30;
let n = 0;

async function say(title, text, ms = 4500, isNew = false) {
  n++;
  await page.evaluate(([t, x, label, fresh]) => {
    document.getElementById('tour-cap')?.remove();
    const d = document.createElement('div');
    d.id = 'tour-cap';
    d.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:99999;max-width:780px;' +
      'background:#0f2f27;color:#fff;padding:14px 20px;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.35);' +
      'font:15px/1.45 system-ui,sans-serif;border:2px solid #f0ad3a;pointer-events:none';
    const tag = fresh ? '<span style="background:#f0ad3a;color:#1b1300;border-radius:6px;padding:1px 7px;margin-left:8px;font-size:12px">NEW</span>' : '';
    d.innerHTML = `<div style="color:#f0ad3a;font-weight:700;margin-bottom:4px">${label} · ${t}${tag}</div>${x}`;
    document.body.appendChild(d);
  }, [title, text, `Stop ${n} of ${TOTAL}`, isNew]);
  await page.waitForTimeout(ms);
}
const go = async path => { await page.goto(SITE + path); await page.waitForLoadState('networkidle'); };
const scroll = async (y = 500) => { await page.mouse.wheel(0, y); await page.waitForTimeout(900); };
async function signIn(email, password) {
  await go('/login');
  await page.locator('input[type=email]').pressSequentially(email, { delay: 35 });
  await page.locator('input[type=password]').pressSequentially(password, { delay: 35 });
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(u => !u.pathname.startsWith('/login'));
  await page.waitForLoadState('networkidle');
}
const closeDialog = () => page.locator('dialog[open]').getByRole('button', { name: /cancel|close/i }).first().click();

// ---------- visitors ----------
await go('/login');
await page.evaluate(() => localStorage.clear());
await go('/login');
await say('Sign in', 'Welcome to MyTerra. Customers and staff sign in here; new people apply; anyone can reset a password.');
await go('/apply');
await say('Apply in 5 steps', 'Plan, details, address, email code, review and pay. Required fields are marked *, the +961 is added for you, and you can’t skip a step.', 5000);
await page.locator('.plan-option').first().click();
await page.getByRole('button', { name: 'Continue', exact: true }).click();
await say('Your details', 'Only the email gets a code now, on its own step.', 3500);
await go('/forgot');
await say('Forgot password', 'Email → code → new password, one step at a time.', 3500);
await go('/status');
await say('Network status', 'Public: is it down in my area, or is it just me?', 3500);

// ---------- customer ----------
await signIn('demo@myterra.app', 'demo1234');
await say('Customer overview', 'Data used this month, amount due and outages in their city, at a glance.');
await page.getByRole('button', { name: 'Add extra data' }).click();
await page.waitForTimeout(800);
await say('Buy extra data', 'Ran out mid-month? Pick a 10, 25 or 50 GB pack for the rest of the month instead of changing plan (like IDM’s extra-GB packs).', 5000, true);
await page.getByRole('button', { name: /^25 GB/ }).click();
await say('Pay by card', 'The usual card window. The tour cancels here, so nothing is charged.', 4000, true);
await closeDialog();
await page.getByRole('button', { name: 'Cancel', exact: true }).click().catch(() => {});
await go('/dashboard');
const visit = page.getByRole('button', { name: 'Change date' });
if (await visit.count()) {
  await visit.scrollIntoViewIfNeeded();
  await say('Your installation', 'While the technician visit is still to come, the customer sees its progress and date…', 4000);
  await visit.click();
  await say('Move the visit yourself', 'Can’t be home that day? Pick a new date, up to 3 times, if the visit is more than 24 hours away (Virgin Media’s rules). The tour cancels without saving.', 6000, true);
  await page.getByRole('button', { name: 'Cancel' }).first().click();
} else { n += 2; }

await go('/billing');
await say('Billing', 'Pay by card or balance, top up, autopay, every bill and payment. Extra-data purchases show up here too.');
await go('/speed-test');
await say('Speed test', 'Ping, download and upload, compared with the plan’s speed, with history.', 3500);
await go('/support');
await say('Support', 'Quick fixes first, then a ticket with an optional speed-test result attached.', 3500);
await go('/plan');
await say('Change plan', 'Switch plans without calling anyone.', 3000);
await go('/settings');
await say('Settings', 'Details, password and appearance…', 3000);
await scroll(450);
await say('Choose which emails you get', 'Bills, outages, support replies, installation: switch any of them off. You still see everything in the app, and security emails always arrive.', 6000, true);
await scroll(500);
await say('Signed-in devices', 'Every device signed in to this account, with “Sign out” per device or for all others. Lost your phone? One click. (Behind the scenes, sign-in tokens are now stored only as fingerprints.)', 6500, true);
await page.setViewportSize({ width: 390, height: 780 });
await go('/dashboard');
await say('On a phone', 'Bottom menu instead of the sidebar; “More” holds the rest.', 4000);
await page.setViewportSize({ width: 1280, height: 780 });
await go('/dashboard');
await page.getByRole('button', { name: 'Sign out' }).first().click();

// ---------- staff ----------
await signIn('admin@myterra.app', 'admin1234');
await say('Admin overview', 'Customers, monthly revenue, unpaid and overdue bills, waiting applications, tickets, outages.');
await go('/admin/applications');
await say('Applications', 'Approve (shows “Approving…” while the email goes out) or reject with a refund note.', 4000);
await go('/admin/customers');
await say('Customers', 'Everyone, with plan, balance and what they owe.', 3500);
await page.getByRole('searchbox', { name: 'Search' }).pressSequentially('beirut', { delay: 60 });
await page.waitForTimeout(1200);
await say('Search on the server', 'Search by name, email, phone or city across every customer, not just the first 500. 50 at a time with “Show more”, and a CSV download for Excel.', 6000, true);
await go('/admin/plans');
await say('Plans', 'Add, edit, hide or remove plans.', 3000);
await go('/admin/billing');
await say('Billing run', 'One click issues this month’s bills, charges autopay, and now also reminds customers whose bill is due within 3 days.', 5500, true);
await page.locator('select[name=status]').selectOption('paid');
await page.waitForTimeout(1200);
await say('Filter bills', 'Status and search are handled by the server, so every bill is reachable.', 4000, true);
await go('/admin/outages');
await say('Outages', 'Open an outage and everyone in that city is told in the app and by email, sent in the background.', 4000);
await go('/admin/tickets');
await say('Tickets', 'Every customer ticket: filter, reply, change status.', 3500);
await go('/admin/reports');
await say('Reports', 'Money received, bills issued, still unpaid and new customers for any date range, straight from the database.', 5500, true);
await page.getByRole('button', { name: 'This year' }).click();
await page.waitForTimeout(1200);
await scroll(500);
await say('By type, by month, download', 'Breakdown by payment type and month, and CSV files of payments, bills and customers for your accountant.', 6000, true);
await go('/admin/audit');
await say('Audit log', 'Every admin change: who, what and when. That’s the tour!', 5000);

await ctx.close();
await browser.close();
