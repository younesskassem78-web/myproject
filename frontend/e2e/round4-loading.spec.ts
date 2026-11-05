/**
 * ROUND 4 — loading on weak connections: placeholders, retries, offline notice, failed and repeated requests.
 * Network trouble is simulated in the browser (Playwright routes, offline mode, Chrome's latency emulation),
 * against the real API underneath.
 */
import { Page, expect, test } from '@playwright/test';
import { ADMIN, DEMO, Session, apiLogin, useSession, watchErrors } from './helpers';

let demo: Session, admin: Session;
test.beforeAll(async () => {
  demo = await apiLogin(DEMO);
  admin = await apiLogin(ADMIN);
});

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
const noLoadingLeft = async (page: Page) => {
  await expect(page.locator('app-skeleton')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('.load-error')).toHaveCount(0);
};

test('slow server: the page shows a placeholder shaped like the overview, then the real content', async ({ page }) => {
  await useSession(page, demo);
  await page.route('**/api/usage', async r => { await delay(1500); await r.continue(); });
  await page.goto('/dashboard');
  await expect(page.getByRole('status').filter({ hasText: 'Loading your account' })).toBeVisible();
  await expect(page.getByText('GB used')).toBeVisible({ timeout: 15_000 });
  await noLoadingLeft(page);
});

test('server error: a clear message with Try again, which recovers once the server is back', async ({ page }) => {
  await useSession(page, demo);
  await page.route('**/api/usage', r => r.fulfill({ status: 500, body: '{}' }));
  await page.goto('/dashboard');
  const box = page.locator('.load-error');
  await expect(box).toContainText('Can’t load your account.');
  await page.unroute('**/api/usage');
  await box.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('GB used')).toBeVisible();
  await expect(box).toHaveCount(0);
});

test('server error in Arabic: the retry button is translated', async ({ page }) => {
  await useSession(page, demo);
  await page.route('**/api/tickets', r => r.fulfill({ status: 500, body: '{}' }));
  await page.goto('/support?lang=ar');
  await expect(page.locator('.load-error').getByRole('button', { name: 'حاول مجدداً' })).toBeVisible();
});

test('dropped connection on a read: retried automatically, the person never sees an error', async ({ page }) => {
  await useSession(page, demo);
  let calls = 0;
  await page.route('**/api/billing', r => (++calls === 1 ? r.abort('internetdisconnected') : r.continue()));
  await page.goto('/billing');
  await expect(page.getByRole('heading', { name: 'Payment history' })).toBeVisible({ timeout: 15_000 });
  await noLoadingLeft(page);
  expect(calls).toBe(2);
});

test('a write that fails is never repeated automatically, and what was typed is kept', async ({ page }) => {
  await useSession(page, demo);
  await page.goto('/support');
  await noLoadingLeft(page);
  let posts = 0;
  await page.route('**/api/tickets', r => {
    if (r.request().method() !== 'POST') return r.continue();
    posts++;
    return r.abort('internetdisconnected');
  });
  await page.getByLabel('Short summary').fill('Router light is red');
  await page.getByLabel('Details').fill('Since this morning.');
  await page.getByRole('button', { name: 'Send ticket' }).click();
  await expect(page.locator('form .error')).toBeVisible();
  await delay(4000); // longer than any retry back-off
  expect(posts).toBe(1);
  await expect(page.getByLabel('Short summary')).toHaveValue('Router light is red');
  await expect(page.getByLabel('Details')).toHaveValue('Since this morning.');
});

test('repeated clicks on a busy button send one request, and the button keeps its size while it spins', async ({ page }) => {
  await useSession(page, demo);
  await page.goto('/support');
  await noLoadingLeft(page);
  let posts = 0;
  await page.route('**/api/tickets', async r => {
    if (r.request().method() !== 'POST') return r.continue();
    posts++;
    await delay(1500);
    await r.fulfill({ status: 503, body: '{"detail":"Busy, try later."}', contentType: 'application/json' });
  });
  await page.getByLabel('Short summary').fill('Double click test');
  await page.getByLabel('Details').fill('Clicked many times.');
  const send = page.locator('form button[type=submit]'); // its label changes to "Sending…" while busy
  const before = await send.boundingBox();
  await send.click();
  await send.click({ force: true });
  await send.click({ force: true });
  await expect(send).toHaveClass(/loading/);
  const during = await send.boundingBox();
  expect(Math.abs(during!.height - before!.height)).toBeLessThan(1);
  await expect(page.locator('form .error')).toContainText('Busy, try later.');
  await expect(send).not.toHaveClass(/loading/);
  expect(posts).toBe(1);
});

test('offline and back: a notice appears, then says the connection is back, then goes away', async ({ page, context }) => {
  await useSession(page, demo);
  await page.goto('/dashboard');
  await expect(page.getByText('GB used')).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText('You’re offline.', { exact: false })).toBeVisible();
  await expect(page.getByText('GB used')).toBeVisible(); // what was already on screen stays
  await context.setOffline(false);
  await expect(page.getByText('You’re back online.')).toBeVisible();
  await expect(page.locator('.offline-banner')).toHaveCount(0, { timeout: 8000 });
});

test('slow page change: a bar runs along the top until the new page arrives', async ({ page }) => {
  await useSession(page, demo);
  await page.goto('/dashboard');
  await expect(page.getByText('GB used')).toBeVisible();
  await page.route(/chunk-.*\.js/, async r => { await delay(1200); await r.continue(); });
  await page.locator('.sidebar').getByRole('link', { name: 'Speed test' }).click();
  await expect(page.locator('.nav-progress')).toHaveClass(/on/);
  await expect(page.getByRole('heading', { name: 'Speed test' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.nav-progress')).not.toHaveClass(/on/);
});

test('empty and large lists: an honest empty message, and hundreds of rows render', async ({ page }) => {
  await useSession(page, demo);
  await page.route('**/api/tickets', r => r.request().method() === 'GET' ? r.fulfill({ json: [] }) : r.continue());
  const many = Array.from({ length: 400 }, (_, i) => ({
    id: `p${i}`, kind: 'invoice', amount: 20, method: 'card', card_brand: 'Visa', card_last4: '4242', created_at: '2026-10-01T10:00:00Z',
  }));
  await page.route('**/api/payments', r => r.fulfill({ json: many }));
  await page.goto('/support');
  await expect(page.getByText('No tickets yet.', { exact: false })).toBeVisible();
  await page.goto('/billing');
  await expect(page.locator('.history li')).toHaveCount(400);
});

/** Chrome's own network emulation: every request waits `latency` ms (like a far-away mobile mast). */
async function slowNetwork(page: Page, latency: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency, downloadThroughput: -1, uploadThroughput: -1 });
}

for (const [who, paths] of [
  ['customer', ['/dashboard', '/billing', '/speed-test', '/support', '/plan', '/settings', '/status']],
  ['staff', ['/admin', '/admin/applications', '/admin/customers', '/admin/billing', '/admin/tickets', '/admin/reports', '/admin/audit']],
] as const) {
  test(`high latency (600 ms per request): every ${who} page finishes loading, nothing stuck`, async ({ page }) => {
    test.setTimeout(180_000);
    const errors = watchErrors(page);
    await slowNetwork(page, 600);
    await useSession(page, who === 'customer' ? demo : admin);
    for (const path of paths) {
      await page.goto(path);
      await noLoadingLeft(page);
    }
    expect(errors).toEqual([]);
  });
}
