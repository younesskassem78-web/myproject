/**
 * ROUND 1 — every page, opened directly, at desktop, tablet and phone sizes:
 * loads, shows its main content, no console errors, no sideways scrolling, no serious accessibility problems.
 * Plus: every menu link works.
 */
import { expect, test } from '@playwright/test';
import { ADMIN, DEMO, Session, apiAs, apiLogin, expectAccessible, expectNoHorizontalOverflow, useSession, watchErrors } from './helpers';

const VIEWPORTS = { desktop: { width: 1366, height: 860 }, tablet: { width: 820, height: 1180 }, phone: { width: 390, height: 844 } };

let demo: Session, admin: Session, invoiceId = '', ticketId = '';

test.beforeAll(async () => {
  demo = await apiLogin(DEMO);
  admin = await apiLogin(ADMIN);
  const api = await apiAs(demo);
  invoiceId = (await (await api.get('invoices')).json())[0].id;
  ticketId = (await (await api.get('tickets')).json())[0].id;
});

type Who = 'anon' | 'customer' | 'admin';
const pages: { path: () => string; who: Who; expectText: string }[] = [
  { path: () => '/login', who: 'anon', expectText: 'Sign in' },
  { path: () => '/apply', who: 'anon', expectText: 'Apply for home internet' },
  { path: () => '/forgot', who: 'anon', expectText: 'Reset your password' },
  { path: () => '/status', who: 'anon', expectText: 'Network status' },
  { path: () => '/dashboard', who: 'customer', expectText: 'GB used' },
  { path: () => '/billing', who: 'customer', expectText: 'Payment history' },
  { path: () => `/billing/${invoiceId}`, who: 'customer', expectText: 'Billed to' },
  { path: () => '/speed-test', who: 'customer', expectText: 'Past results' },
  { path: () => '/support', who: 'customer', expectText: 'Report a problem' },
  { path: () => `/support/${ticketId}`, who: 'customer', expectText: 'Slow internet in the evening' },
  { path: () => '/plan', who: 'customer', expectText: 'Your plan' },
  { path: () => '/settings', who: 'customer', expectText: 'Change password' },
  { path: () => '/admin', who: 'admin', expectText: 'Monthly recurring revenue' },
  { path: () => '/admin/applications', who: 'admin', expectText: 'Applications' },
  { path: () => '/admin/customers', who: 'admin', expectText: 'demo@myterra.app' },
  { path: () => '/admin/plans', who: 'admin', expectText: 'Add a plan' },
  { path: () => '/admin/billing', who: 'admin', expectText: 'Issue this month' },
  { path: () => '/admin/outages', who: 'admin', expectText: 'Report an outage' },
  { path: () => '/admin/tickets', who: 'admin', expectText: 'Needs attention' },
  { path: () => `/admin/tickets/${ticketId}`, who: 'admin', expectText: 'Reply to the customer' },
  { path: () => '/admin/audit', who: 'admin', expectText: 'Audit log' },
];

for (const [size, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(`round 1 @ ${size}`, () => {
    test.use({ viewport });
    for (const p of pages) {
      test(`${p.who} ${p.path().replace(/[0-9a-f-]{36}/, ':id')}`, async ({ page }) => {
        if (p.who !== 'anon') await useSession(page, p.who === 'admin' ? admin : demo);
        const errors = watchErrors(page);
        await page.goto(p.path());
        await expect(page.locator('main').getByText(p.expectText).first()).toBeVisible();
        await page.waitForLoadState('networkidle');
        expect(page.url(), 'should not be redirected').toContain(p.path());
        await expectNoHorizontalOverflow(page);
        await expectAccessible(page);
        expect(errors).toEqual([]);
      });
    }
  });
}

test.describe('round 1: menus', () => {
  const customerLinks = ['Billing', 'Speed test', 'Support', 'Plan', 'Settings', 'Overview'];
  const adminLinks = ['Applications', 'Customers', 'Plans', 'Billing', 'Outages', 'Tickets', 'Audit log', 'Overview'];
  const urlFor: Record<string, RegExp> = {
    Overview: /\/(dashboard|admin)$/, Billing: /billing$/, 'Speed test': /speed-test$/, Support: /support$/, Plan: /plan$/,
    Settings: /settings$/, Applications: /applications$/, Customers: /customers$/, Plans: /plans$/, Outages: /outages$/,
    Tickets: /tickets$/, 'Audit log': /audit$/,
  };

  for (const [who, links] of [['customer', customerLinks], ['admin', adminLinks]] as const) {
    test(`${who} side menu reaches every page`, async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.desktop);
      await useSession(page, who === 'admin' ? admin : demo);
      await page.goto(who === 'admin' ? '/admin' : '/dashboard');
      for (const label of links) {
        await page.locator('.sidebar').getByRole('link', { name: label, exact: true }).click();
        await expect(page).toHaveURL(urlFor[label]);
      }
    });

    test(`${who} phone menu reaches every page`, async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.phone);
      await useSession(page, who === 'admin' ? admin : demo);
      await page.goto(who === 'admin' ? '/admin' : '/dashboard');
      const bar = page.locator('.bottom-nav');
      for (const label of links) {
        const direct = bar.getByRole('link', { name: label, exact: true });
        if (await direct.count()) await direct.click();
        else {
          await bar.getByRole('button', { name: 'More' }).click();
          await page.locator('.more-sheet').getByRole('link', { name: label }).click();
        }
        await expect(page).toHaveURL(urlFor[label]);
      }
    });
  }
});

test.describe('round 1 @ desktop, dark mode', () => {
  test.use({ viewport: VIEWPORTS.desktop, colorScheme: 'dark' });
  for (const p of pages) {
    test(`dark ${p.who} ${p.path().replace(/[0-9a-f-]{36}/, ':id')}`, async ({ page }) => {
      if (p.who !== 'anon') await useSession(page, p.who === 'admin' ? admin : demo);
      const errors = watchErrors(page);
      await page.goto(p.path());
      await expect(page.locator('main').getByText(p.expectText).first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(await page.evaluate(() => document.documentElement.dataset['theme'])).toBe('dark');
      await expectAccessible(page);
      expect(errors).toEqual([]);
    });
  }
});
