/**
 * ROUND 2 — complete journeys through the real UI, with every write read back independently through the API
 * (and after a page reload) to prove it reached the database, not just the page's memory.
 */
import { Page, expect, test } from '@playwright/test';
import { ADMIN, CARD, DEMO, SARA, apiAs, apiLogin, signInUI, unique, useSession } from './helpers';

test.describe.configure({ mode: 'serial' });

async function payInDialog(page: Page, button: RegExp = /^Pay /) {
  const d = page.locator('dialog[open]');
  await d.locator('input[name=holder]').fill(CARD.holder);
  await d.locator('input[name=number]').fill(CARD.number);
  await d.locator('input[name=expiry]').fill(CARD.expiry);
  await d.locator('input[name=cvc]').fill(CARD.cvc);
  await d.getByRole('button', { name: button }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0, { timeout: 15_000 });
}

const acceptDialogs = (page: Page) => page.on('dialog', d => d.accept());

test('sign-up: apply with codes and payment -> admin approves -> customer signs in', async ({ page, browser }) => {
  const email = `${unique('new')}@example.com`;
  const install = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
  await page.goto('/apply');
  await page.locator('input[name=name]').fill('Rana Test');
  const emailField = page.locator('app-verify-field[channel=email]');
  await emailField.locator('input').first().fill(email);
  await emailField.getByRole('button', { name: 'Send code' }).click();
  await emailField.getByRole('button', { name: 'Use this code' }).click();
  await expect(emailField.getByText('Verified')).toBeVisible();
  const phoneField = page.locator('app-verify-field[channel=sms]');
  await phoneField.locator('input').first().fill(`+9617${Math.floor(1e6 + Math.random() * 8e6)}`);
  await phoneField.getByRole('button', { name: 'Send code' }).click();
  await phoneField.getByRole('button', { name: 'Use this code' }).click();
  await expect(phoneField.getByText('Verified')).toBeVisible();
  await page.locator('input[name=password]').fill('rana12345');
  await page.locator('input[name=birth]').fill('1994-03-02');
  await page.locator('input[name=idn]').fill('LB998877');
  await page.locator('input[name=city]').fill('Beirut');
  await page.locator('input[name=street]').fill('Verdun St, Bldg 9');
  await page.locator('input[name=install]').fill(install);
  await page.locator('.plan-option', { hasText: 'Fiber 50 GB' }).click();
  await page.locator('input[name=terms]').check();
  await page.getByRole('button', { name: 'Continue to payment' }).click();
  await payInDialog(page);
  await expect(page.getByText('Application sent')).toBeVisible();

  // Sign-in is refused until approval (read through the API).
  const anon = await apiAs();
  const early = await anon.post('login', { data: { email, password: 'rana12345' } });
  expect(early.status()).toBe(403);

  // Admin approves through the UI.
  const adminPage = await browser.newPage();
  acceptDialogs(adminPage);
  await useSession(adminPage, await apiLogin(ADMIN));
  await adminPage.goto('/admin/applications');
  const row = adminPage.locator('tr', { hasText: email });
  await row.getByRole('button', { name: 'Approve' }).click();
  await expect(adminPage.getByText('We emailed them a sign-in link')).toBeVisible();
  await adminPage.reload();
  await expect(adminPage.locator('tr', { hasText: email }).getByText('Approved')).toBeVisible();
  await adminPage.close();

  // Customer signs in through the form; installation and first bill are there and survive a reload.
  await signInUI(page, { email, password: 'rana12345' });
  await expect(page.getByText('Your installation')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Your installation')).toBeVisible();
  const me = await apiAs(await apiLogin({ email, password: 'rana12345' }));
  expect((await (await me.get('me')).json()).install_status).toBe('scheduled');
  const bills = await (await me.get('invoices')).json();
  expect(bills[0].status).toBe('paid');
  expect((await (await me.get('payments')).json())[0]).toMatchObject({ kind: 'signup', card_last4: '4242', amount: 20 });
});

test('billing: pay a bill by card, top up, turn on autopay — all persisted', async ({ page }) => {
  const demo = await apiLogin(DEMO);
  const api = await apiAs(demo);
  const before = await (await api.get('me')).json();
  await useSession(page, demo);
  await page.goto('/billing');

  await page.locator('.panel-dark').getByRole('button', { name: 'Pay by card' }).click();
  await payInDialog(page);
  await expect(page.getByText(/Paid INV-.*Thank you/)).toBeVisible();
  await page.reload();
  await expect(page.locator('.panel-dark').getByText('Nothing to pay right now')).toBeVisible();
  const inv = (await (await api.get('invoices')).json())[0];
  expect(inv.status).toBe('paid');
  // Paying the same bill again is refused.
  expect((await api.post(`invoices/${inv.id}/pay`, { data: { method: 'card', card: CARD } })).status()).toBe(409);

  await page.locator('input[name=amount]').fill('15');
  await page.getByRole('button', { name: 'Top up' }).click();
  await payInDialog(page);
  await expect(page.getByText('Added $15.00 to your balance.')).toBeVisible();
  await page.goto('/dashboard');
  await page.goto('/billing');
  const after = await (await api.get('me')).json();
  expect(after.balance).toBeCloseTo(before.balance + 15, 2);
  await expect(page.getByText(`$${after.balance.toFixed(2)}`).first()).toBeVisible();

  await page.getByRole('button', { name: 'Add a card' }).click();
  await payInDialog(page, /Save card/);
  await expect(page.getByText('Autopay is on.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('On. We charge your Visa ending in 4242')).toBeVisible();
  expect((await (await api.get('billing')).json()).autopay).toBe(true);
});

test('support: customer opens a ticket, staff reply and close it, customer reopens', async ({ page, browser }) => {
  const subject = unique('Router keeps rebooting ');
  await useSession(page, await apiLogin(DEMO));
  await page.goto('/support');
  await page.locator('input[name=subject]').fill(subject);
  await page.locator('textarea[name=message]').fill('It restarts every hour since yesterday.');
  await page.getByRole('button', { name: 'Send ticket' }).click();
  await page.waitForURL(/\/support\/[0-9a-f-]{36}$/);
  const ticketId = page.url().split('/').pop()!;
  await expect(page.getByRole('heading', { name: subject })).toBeVisible();

  const staff = await browser.newPage();
  await useSession(staff, await apiLogin(ADMIN));
  await staff.goto('/admin/tickets');
  await staff.getByRole('link', { name: subject }).click();
  await staff.locator('textarea[name=reply]').fill('Please swap the power adapter, we are sending a new one.');
  await staff.getByRole('button', { name: 'Send reply' }).click();
  await expect(staff.getByText('we are sending a new one')).toBeVisible();
  await staff.getByLabel('Status').selectOption('resolved');
  await expect.poll(async () => (await (await (await apiAs(await apiLogin(ADMIN))).get(`admin/tickets/${ticketId}`)).json()).status).toBe('resolved');
  await staff.close();

  await page.reload();
  await expect(page.getByText('we are sending a new one')).toBeVisible();
  await expect(page.getByText('Resolved').first()).toBeVisible();
  const notes = await (await (await apiAs(await apiLogin(DEMO))).get('notifications')).json();
  expect(notes.items.some((n: { link: string }) => n.link === `/support/${ticketId}`)).toBe(true);

  await page.locator('textarea[name=reply]').fill('The new adapter did not help.');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(page.getByText('The new adapter did not help.')).toBeVisible();
  const t = await (await (await apiAs(await apiLogin(DEMO))).get(`tickets/${ticketId}`)).json();
  expect(t.status).toBe('open');
  expect(t.messages.map((m: { from_staff: boolean }) => m.from_staff)).toEqual([true, false]);
});

test('admin plans: create, edit, hide and delete — each persisted', async ({ page }) => {
  acceptDialogs(page);
  const admin = await apiLogin(ADMIN);
  const api = await apiAs(admin);
  const name = unique('Fiber Test ');
  await useSession(page, admin);
  await page.goto('/admin/plans');
  await page.locator('input[name=pname]').fill(name);
  await page.locator('input[name=pgb]').fill('200');
  await page.locator('input[name=pspeed]').fill('500');
  await page.locator('input[name=pprice]').fill('40');
  await page.getByRole('button', { name: 'Add plan' }).click();
  await expect(page.getByText(`Added ${name}.`)).toBeVisible();
  const created = (await (await api.get('admin/plans')).json()).find((p: { name: string }) => p.name === name);
  expect(created).toMatchObject({ data_gb: 200, speed_mbps: 500, price: 40, active: true });

  await page.reload();
  await page.getByLabel(`Price for ${name}`).fill('55');
  await page.locator('tr', { has: page.getByLabel(`Name of ${name}`) }).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(`Saved ${name}.`)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(`Price for ${name}`)).toHaveValue('55');

  await page.locator('tr', { has: page.getByLabel(`Name of ${name}`) }).getByRole('button', { name: 'Hide' }).click();
  await expect(page.getByText(`Hid ${name}.`)).toBeVisible();
  const publicPlans = await (await (await apiAs()).get('plans')).json();
  expect(publicPlans.some((p: { name: string }) => p.name === name)).toBe(false);

  await page.locator('tr', { has: page.getByLabel(`Name of ${name}`) }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText(`Deleted ${name}.`)).toBeVisible();
  expect((await (await api.get('admin/plans')).json()).some((p: { name: string }) => p.name === name)).toBe(false);
});

test('admin customers: add, change balance, deactivate, reactivate, delete', async ({ page }) => {
  acceptDialogs(page);
  const admin = await apiLogin(ADMIN);
  const api = await apiAs(admin);
  const anon = await apiAs();
  const email = `${unique('cust')}@example.com`;
  await useSession(page, admin);
  await page.goto('/admin/customers');
  await page.getByText('Add a user').click();
  const form = page.locator('form.inline-form');
  await form.locator('input[name=name]').fill('Karim Test');
  await form.locator('input[name=email]').fill(email);
  await form.locator('input[name=password]').fill('karim12345');
  await form.locator('select[name=plan]').selectOption({ label: 'Fiber 50 GB' });
  await form.locator('input[name=city]').fill('Saida');
  await form.getByRole('button', { name: 'Add user' }).click();
  await expect(page.getByText(`Added ${email}.`)).toBeVisible();
  const find = async () => (await (await api.get('admin/users')).json()).find((u: { email: string }) => u.email === email);
  expect(await find()).toMatchObject({ name: 'Karim Test', city: 'Saida', role: 'customer', active: true, balance: 0 });

  const balance = page.getByLabel(`Balance for ${email}`);
  await balance.fill('33.5');
  await balance.blur();
  await expect(page.getByText(`Saved ${email}'s balance.`)).toBeVisible();
  expect((await find()).balance).toBe(33.5);
  await balance.fill('');
  await balance.blur();
  await expect(page.getByText('Nothing was saved')).toBeVisible();
  expect((await find()).balance).toBe(33.5);

  await page.locator('tr', { hasText: email }).getByRole('button', { name: 'Deactivate' }).click();
  await expect(page.getByText(`Deactivated ${email}.`)).toBeVisible();
  expect((await anon.post('login', { data: { email, password: 'karim12345' } })).status()).toBe(403);
  await page.locator('tr', { hasText: email }).getByRole('button', { name: 'Activate' }).click();
  await expect(page.getByText(`Activated ${email}.`)).toBeVisible();
  expect((await anon.post('login', { data: { email, password: 'karim12345' } })).status()).toBe(200);

  await page.locator('tr', { hasText: email }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText(`Deleted ${email}.`)).toBeVisible();
  expect(await find()).toBeUndefined();
  expect((await anon.post('login', { data: { email, password: 'karim12345' } })).status()).toBe(401);
  const audit = await (await api.get('admin/audit')).json();
  expect(audit.filter((a: { target: string }) => a.target === email).map((a: { action: string }) => a.action))
    .toEqual(expect.arrayContaining(['added customer', 'changed balance', 'changed active', 'deleted user']));
});

test('outages: admin opens one, Beirut customer sees it, admin resolves it', async ({ page, browser }) => {
  const title = unique('Fibre cut in Achrafieh ');
  const staff = await browser.newPage();
  await useSession(staff, await apiLogin(ADMIN));
  await staff.goto('/admin/outages');
  await staff.locator('input[name=city]').fill('Beirut');
  await staff.locator('input[name=title]').fill(title);
  await staff.locator('textarea[name=message]').fill('A digger cut our cable. Repair crew on site.');
  await staff.getByRole('button', { name: 'Notify customers' }).click();
  await expect(staff.getByText('Customers in Beirut have been notified.')).toBeVisible();

  await useSession(page, await apiLogin(DEMO));
  await page.goto('/dashboard');
  await expect(page.locator('.banner', { hasText: title })).toBeVisible();
  await page.goto('/status');
  await expect(page.getByText(title)).toBeVisible();

  const card = staff.locator('article', { hasText: title });
  await card.locator('select').selectOption('resolved');
  await card.getByRole('button', { name: 'Send update' }).click();
  await expect(staff.getByText('Marked resolved.')).toBeVisible();
  await staff.close();

  await page.goto('/dashboard');
  await expect(page.getByText('GB used')).toBeVisible();
  await expect(page.locator('.banner', { hasText: title })).toHaveCount(0);
  await page.goto('/status');
  await expect(page.locator('.outage.resolved', { hasText: title })).toBeVisible();
});

test('billing run is safe to run twice', async ({ page }) => {
  acceptDialogs(page);
  await useSession(page, await apiLogin(ADMIN));
  await page.goto('/admin/billing');
  await page.getByRole('button', { name: /Issue this month/ }).click();
  await expect(page.locator('.notice')).toBeVisible();
  await page.getByRole('button', { name: /Issue this month/ }).click();
  await expect(page.getByText('Everyone already has a bill for this month.')).toBeVisible();
});

test('settings: change password, sign out, sign in with the new one', async ({ page }) => {
  await useSession(page, await apiLogin(SARA));
  await page.goto('/settings');
  await page.locator('input[name=current]').fill(SARA.password);
  await page.locator('input[name=password]').fill('sara-new-pass1');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Password changed.')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(/login/);
  const anon = await apiAs();
  expect((await anon.post('login', { data: SARA })).status()).toBe(401);
  await signInUI(page, { email: SARA.email, password: 'sara-new-pass1' });
  await expect(page).toHaveURL(/dashboard/);
  // put it back for the other tests
  const s = await apiAs(await apiLogin({ email: SARA.email, password: 'sara-new-pass1' }));
  expect((await s.post('account/password', { data: { current: 'sara-new-pass1', password: SARA.password } })).status()).toBe(200);
});

test('plan change persists', async ({ page }) => {
  acceptDialogs(page);
  await useSession(page, await apiLogin(SARA));
  await page.goto('/plan');
  await page.locator('.plan-card', { hasText: 'Fiber Unlimited' }).getByRole('button').click();
  await expect(page.getByText("You're now on Fiber Unlimited.")).toBeVisible();
  await page.reload();
  await expect(page.locator('.plan-card.current', { hasText: 'Fiber Unlimited' })).toBeVisible();
  expect((await (await (await apiAs(await apiLogin(SARA))).get('me')).json()).plan.name).toBe('Fiber Unlimited');
});

test('speed test runs and is saved to history', async ({ page }) => {
  const demo = await apiLogin(DEMO);
  const before = (await (await (await apiAs(demo)).get('speedtests')).json()).results.length;
  await useSession(page, demo);
  await page.goto('/speed-test');
  await page.getByRole('button', { name: 'Start test' }).click();
  await expect(page.getByRole('button', { name: 'Test again' })).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.locator('tbody tr')).toHaveCount(before + 1);
});

test('forgot password asks for the code without revealing accounts', async ({ page }) => {
  for (const email of [DEMO.email, 'nobody-here@example.com']) {
    await page.goto('/forgot');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByText('Check your email')).toBeVisible();
    await expect(page.locator('.demo-code')).toHaveCount(0);  // reset codes are never shown on screen
  }
});
