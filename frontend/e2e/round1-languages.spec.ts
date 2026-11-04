/**
 * ROUND 1 — the visitor and customer pages in Arabic (right-to-left) and French: translated, laid out in the
 * right direction, no sideways scrolling, no serious accessibility problems.
 */
import { Page, expect, test } from '@playwright/test';
import { DEMO, apiLogin, expectAccessible, expectNoHorizontalOverflow, useSession, watchErrors } from './helpers';

async function inLanguage(page: Page, lang: string) {
  await page.goto('/login');
  await page.evaluate(l => localStorage.setItem('myterra_lang', l), lang);
}

const CASES = [
  { lang: 'ar', dir: 'rtl', login: 'تسجيل الدخول', dashboard: 'الاستهلاك اليومي', apply: 'اختر باقة' },
  { lang: 'fr', dir: 'ltr', login: 'Se connecter', dashboard: 'Consommation par jour', apply: 'Choisissez un forfait' },
];

for (const c of CASES) {
  for (const viewport of [{ width: 1366, height: 860 }, { width: 390, height: 844 }]) {
    test(`${c.lang} @ ${viewport.width}px: public and customer pages`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const errors = watchErrors(page);
      await inLanguage(page, c.lang);
      for (const [path, text] of [['/login', c.login], ['/apply', c.apply]] as const) {
        await page.goto(path);
        await expect(page.locator('html')).toHaveAttribute('dir', c.dir);
        await expect(page.locator('html')).toHaveAttribute('lang', c.lang);
        await expect(page.getByText(text).first()).toBeVisible();
        await expectNoHorizontalOverflow(page);
        await expectAccessible(page);
      }
      await useSession(page, await apiLogin(DEMO));
      for (const path of ['/dashboard', '/billing', '/settings']) {
        await page.goto(path);
        await expect(page.locator('main')).toBeVisible();
        await expectNoHorizontalOverflow(page);
        await expectAccessible(page);
      }
      await page.goto('/dashboard');
      await expect(page.getByText(c.dashboard)).toBeVisible();
      expect(errors).toEqual([]);
    });
  }
}

test('the language menu switches and remembers the choice', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('combobox', { name: 'Language' }).selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'تسجيل الدخول' })).toBeVisible();
  await page.getByRole('combobox', { name: 'اللغة' }).selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});
