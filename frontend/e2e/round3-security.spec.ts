/**
 * ROUND 3 — access control, sessions, hostile input and repeated submits, through the browser and the API.
 * (Followed by a full re-run of every automated suite: see docs/qa/AUDIT.md.)
 */
import { expect, test } from '@playwright/test';
import { ADMIN, CARD, DEMO, SARA, apiAs, apiLogin, useSession, watchErrors } from './helpers';

test.describe.configure({ mode: 'serial' });

test('signed-out visitors are sent to sign in from every private page', async ({ page }) => {
  for (const path of ['/dashboard', '/billing', '/speed-test', '/support', '/plan', '/settings', '/admin', '/admin/customers']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
  }
});

test('customers cannot open admin pages; admins land on the admin side', async ({ page, browser }) => {
  await useSession(page, await apiLogin(DEMO));
  for (const path of ['/admin', '/admin/customers', '/admin/audit']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/dashboard$/);
  }
  const admin = await browser.newPage();
  await useSession(admin, await apiLogin(ADMIN));
  await admin.goto('/billing');
  await expect(admin).toHaveURL(/\/admin$/);
  await admin.close();
});

test('the server refuses admin actions and other people\'s data, whatever the UI does', async () => {
  const demo = await apiAs(await apiLogin(DEMO));
  const sara = await apiAs(await apiLogin(SARA));
  for (const [method, path] of [['get', 'admin/users'], ['get', 'admin/overview'], ['post', 'admin/billing/run'],
                                ['get', 'admin/audit'], ['post', 'admin/outages']] as const) {
    expect((await demo[method](path, { data: {} })).status(), `${method} ${path}`).toBe(403);
  }
  const saraInvoice = (await (await sara.get('invoices')).json())[0];
  expect((await demo.get(`invoices/${saraInvoice.id}`)).status()).toBe(404);
  expect((await demo.post(`invoices/${saraInvoice.id}/pay`, { data: { method: 'balance' } })).status()).toBe(404);
  const anon = await apiAs();
  expect((await anon.get('me')).status()).toBe(401);
  expect((await anon.get('admin/users')).status()).toBe(401);
});

test('a forged or expired session sends the browser back to sign in', async ({ page }) => {
  await useSession(page, { token: 'forged-token', name: 'Mallory', role: 'admin' });
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate(() => localStorage.getItem('myterra_token'))).toBeNull();
});

test('signing out ends the session on the server', async ({ page }) => {
  const s = await apiLogin(DEMO);
  await useSession(page, s);
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(/login/);
  await expect.poll(async () => (await (await apiAs(s)).get('me')).status()).toBe(401);
});

test('hostile text is stored and shown as plain text, never run', async ({ page }) => {
  const errors = watchErrors(page);
  let dialogs = 0;
  page.on('dialog', d => { dialogs++; d.dismiss(); });
  const evil = `<img src=x onerror="alert('xss')"> '; drop table users; --`;
  const demo = await apiLogin(DEMO);
  const t = await (await (await apiAs(demo)).post('tickets', { data: { subject: evil, message: evil, category: 'other' } })).json();
  await useSession(page, demo);
  await page.goto(`/support/${t.id}`);
  await expect(page.getByRole('heading', { name: evil })).toBeVisible();
  expect(await page.locator('img[src="x"]').count()).toBe(0);
  expect(dialogs).toBe(0);
  // the "drop table" text did nothing: users are still there
  expect((await (await apiAs(await apiLogin(ADMIN))).get('admin/users')).status()).toBe(200);
  expect(errors.filter(e => !e.includes('404'))).toEqual([]);
});

test('double-clicking Pay charges once', async ({ page }) => {
  const sara = await apiLogin(SARA);
  const api = await apiAs(sara);
  const before = (await (await api.get('payments')).json()).length;
  await useSession(page, sara);
  await page.goto('/billing');
  await page.locator('input[name=amount]').fill('7');
  await page.getByRole('button', { name: 'Top up' }).click();
  const d = page.locator('dialog[open]');
  await d.locator('input[name=holder]').fill(CARD.holder);
  await d.locator('input[name=number]').fill(CARD.number);
  await d.locator('input[name=expiry]').fill(CARD.expiry);
  await d.locator('input[name=cvc]').fill(CARD.cvc);
  await d.getByRole('button', { name: /^Pay / }).dblclick();
  await expect(page.getByText('Added $7.00 to your balance.')).toBeVisible();
  expect((await (await api.get('payments')).json()).length).toBe(before + 1);
});

test('a declined card changes nothing', async ({ page }) => {
  const sara = await apiLogin(SARA);
  const api = await apiAs(sara);
  const balance = (await (await api.get('me')).json()).balance;
  await useSession(page, sara);
  await page.goto('/billing');
  await page.locator('input[name=amount]').fill('9');
  await page.getByRole('button', { name: 'Top up' }).click();
  const d = page.locator('dialog[open]');
  await d.locator('input[name=holder]').fill(CARD.holder);
  await d.locator('input[name=number]').fill('4000000000000002');
  await d.locator('input[name=expiry]').fill(CARD.expiry);
  await d.locator('input[name=cvc]').fill(CARD.cvc);
  await d.getByRole('button', { name: /^Pay / }).click();
  await expect(d.getByText('Your card was declined')).toBeVisible();
  expect((await (await api.get('me')).json()).balance).toBe(balance);
});

test('security headers reach the browser', async ({ page }) => {
  const r = await page.request.get('/api/plans');
  expect(r.headers()['x-content-type-options']).toBe('nosniff');
  expect(r.headers()['x-frame-options']).toBe('DENY');
  expect(r.headers()['cache-control']).toBe('no-store');
});

test('concurrent duplicate requests do not create duplicates', async () => {
  const admin = await apiAs(await apiLogin(ADMIN));
  // Two billing runs at once: at most one bill per customer per month.
  await Promise.all([admin.post('admin/billing/run'), admin.post('admin/billing/run')]);
  const bills = await (await admin.get('admin/invoices')).json();
  const keys = bills.map((b: { user_email: string; period: string }) => `${b.user_email}|${b.period}`);
  expect(new Set(keys).size).toBe(keys.length);
  // Two applications for the same email at once: only one is accepted.
  const anon = await apiAs();
  const email = `twice${Date.now()}@example.com`;
  const phone = `+9617${Date.now() % 10_000_000}`;
  const codes: string[] = [];
  for (const [channel, target] of [['email', email], ['sms', phone]] as const) {
    const sent = await (await anon.post('verify/send', { data: { channel, target } })).json();
    codes.push((await (await anon.post('verify/check', { data: { channel, target, code: sent.demo_code } })).json()).verification_id);
  }
  const plan = (await (await anon.get('plans')).json())[0].id;
  const body = { name: 'Twice', email, phone, password: 'twice12345', birth_date: '1990-01-01',
    id_number: 'LB12345', city: 'Beirut', street: 'X', install_date: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10),
    plan_id: plan, accept_terms: true, card: CARD, email_verification_id: codes[0], phone_verification_id: codes[1] };
  const results = await Promise.all([anon.post('apply', { data: body }), anon.post('apply', { data: body })]);
  const statuses = results.map(r => r.status()).sort();
  expect(statuses[0]).toBe(201);
  expect([400, 409]).toContain(statuses[1]);
});
