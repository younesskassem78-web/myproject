/**
 * ROUND 2 — the features added on 2026-11-04, through the real UI, each write read back through the API.
 * Uses Sara for account-level changes so the other journeys keep their expected starting data.
 */
import { expect, test } from '@playwright/test';
import { ADMIN, CARD, DEMO, SARA, apiAs, apiLogin, expectAccessible, useSession } from './helpers';

test.describe.configure({ mode: 'serial' });

const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };

test('customer buys extra data from the overview', async ({ page }) => {
  const demo = await apiLogin(DEMO);
  const before = await (await (await apiAs(demo)).get('usage')).json();
  await useSession(page, demo);
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Add extra data' }).click();
  await page.getByRole('button', { name: /^10 GB/ }).click();
  const d = page.locator('dialog[open]');
  await d.locator('input[name=holder]').fill(CARD.holder);
  await d.locator('input[name=number]').fill(CARD.number);
  await d.locator('input[name=expiry]').fill(CARD.expiry);
  await d.locator('input[name=cvc]').fill(CARD.cvc);
  await d.getByRole('button', { name: /^Pay / }).click();
  await expect(page.getByText('10 GB added')).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(page.getByText('Includes 10 GB extra data')).toBeVisible();
  const after = await (await (await apiAs(demo)).get('usage')).json();
  expect(after.limit_gb).toBe(before.limit_gb + 10);
  expect((await (await (await apiAs(demo)).get('payments')).json())[0]).toMatchObject({ kind: 'data', amount: 3 });
});

test('customer moves their installation visit', async ({ page }) => {
  const admin = await apiAs(await apiLogin(ADMIN));
  const sara = (await (await admin.get('admin/users', { params: { q: 'sara@myterra.app' } })).json())[0];
  await admin.patch(`admin/users/${sara.id}`, { data: { install_status: 'scheduled', install_date: day(5) } });
  const s = await apiLogin(SARA);
  await useSession(page, s);
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Change date' }).click();
  await page.locator('input[name=newDate]').fill(day(9));
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Visit moved')).toBeVisible();
  await expectAccessible(page);
  const me = await (await (await apiAs(s)).get('me')).json();
  expect(me.install_date).toBe(day(9));
  expect(me.install_reschedules).toBe(1);
});

test('customer turns off outage emails and it is saved', async ({ page }) => {
  const s = await apiLogin(SARA);
  await useSession(page, s);
  await page.goto('/settings');
  await page.getByLabel('Outages in my area').uncheck();
  await expect(page.getByText('Saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Outages in my area')).not.toBeChecked();
  expect(await (await (await apiAs(s)).get('account/email-preferences')).json()).toMatchObject({ outage: false, billing: true });
  await expectAccessible(page);
});

test('customer signs out every other device', async ({ page }) => {
  const other = await apiLogin(SARA);
  const here = await apiLogin(SARA);
  await useSession(page, here);
  await page.goto('/settings');
  await expect(page.getByText('This device')).toBeVisible();
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: 'Sign out all other devices' }).click();
  await expect(page.getByText(/Signed out \d+ other/)).toBeVisible();
  expect((await (await apiAs(other)).get('me')).status()).toBe(401);
  expect((await (await apiAs(here)).get('me')).status()).toBe(200);
});

test('admin searches customers on the server and downloads a CSV', async ({ page }) => {
  await useSession(page, await apiLogin(ADMIN));
  await page.goto('/admin/customers');
  await page.getByRole('searchbox', { name: 'Search' }).fill('tripoli');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).toContainText('sara@myterra.app');
  await expect(page.getByText('Showing 1 of 1')).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^myterra-customers-.*\.csv$/);
});

test('admin reports show real totals and export payments', async ({ page }) => {
  await useSession(page, await apiLogin(ADMIN));
  await page.goto('/admin/reports');
  await expect(page.getByText('Money received', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Extra data' })).toBeVisible();  // the pack bought in the first test
  await expectAccessible(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Payments (CSV)' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^myterra-payments-.*\.csv$/);
});

test('search engines: public pages indexable, private pages not', async ({ page, request }) => {
  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toContain('Disallow: /admin');
  await page.goto('/login');
  await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', 'index, follow');
  await useSession(page, await apiLogin(DEMO));
  await page.goto('/dashboard');
  await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', 'noindex, nofollow');
  await expect(page.locator('meta[name=description]')).toHaveAttribute('content', /MyTerra/);
});
