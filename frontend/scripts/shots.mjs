// Screenshots of every page at desktop and phone width, light and dark, for design review.
// Usage (dev servers running): node scripts/shots.mjs <out-dir> [light|dark]
import { chromium } from '@playwright/test';

const SITE = 'http://localhost:4200';
const [out = 'shots', theme = 'light'] = process.argv.slice(2);
const PUBLIC = ['/', '/login', '/apply', '/forgot', '/status'];
const CUSTOMER = ['/dashboard', '/billing', '/speed-test', '/support', '/plan', '/settings'];
const ADMIN = ['/admin', '/admin/applications', '/admin/customers', '/admin/plans', '/admin/billing',
  '/admin/outages', '/admin/tickets', '/admin/reports', '/admin/audit', '/admin/account'];
const SIZES = { desk: { width: 1366, height: 860 }, tablet: { width: 820, height: 1180 }, phone: { width: 390, height: 844 } };

const browser = await chromium.launch({ channel: 'chrome' }); // the installed Chrome, as in playwright.config.ts
async function signIn(page, email, password) {
  await page.goto(SITE + '/login');
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(u => !u.pathname.startsWith('/login'));
}
for (const [size, viewport] of Object.entries(SIZES)) {
  for (const [who, paths] of [['public', PUBLIC], ['demo', CUSTOMER], ['admin', ADMIN]]) {
    const ctx = await browser.newContext({ viewport });
    await ctx.addInitScript(t => localStorage.setItem('myterra_theme', t), theme);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    if (who === 'demo') await signIn(page, 'demo@myterra.app', 'demo1234');
    if (who === 'admin') await signIn(page, 'admin@myterra.app', 'admin1234');
    for (const p of paths) {
      await page.goto(SITE + p);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(400);
      const name = `${size}-${theme}${p.replaceAll('/', '_') || '_home'}.png`;
      await page.screenshot({ path: `${out}/${name}`, fullPage: true });
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      console.log(name, wide ? 'SIDEWAYS-SCROLL' : '', errors.splice(0).join(' | '));
    }
    await ctx.close();
  }
}
await browser.close();
