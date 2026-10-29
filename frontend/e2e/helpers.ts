import AxeBuilder from '@axe-core/playwright';
import { APIRequestContext, Page, expect, request as pwRequest } from '@playwright/test';

export const API = 'http://127.0.0.1:8011/api';
export const CARD = { holder: 'Test Person', number: '4242424242424242', expiry: '12/30', cvc: '123' };
export const DEMO = { email: 'demo@myterra.app', password: 'demo1234' };
export const SARA = { email: 'sara@myterra.app', password: 'sara1234' };
export const ADMIN = { email: 'admin@myterra.app', password: 'admin1234' };

export interface Session { token: string; name: string; role: string; }

/** Signs in through the API (fast) and returns the session. */
export async function apiLogin(who: { email: string; password: string }): Promise<Session> {
  const ctx = await pwRequest.newContext();
  const r = await ctx.post(`${API}/login`, { data: who });
  expect(r.status(), `login ${who.email}`).toBe(200);
  const s = await r.json();
  await ctx.dispose();
  return s;
}

/** An API client acting as `session`, for independent read-backs of what the UI saved. */
export async function apiAs(session?: Session): Promise<APIRequestContext> {
  return pwRequest.newContext({
    baseURL: API + '/',
    extraHTTPHeaders: session ? { Authorization: `Bearer ${session.token}` } : {},
  });
}

/** Puts a session into the browser so pages open already signed in. */
export async function useSession(page: Page, s: Session) {
  await page.addInitScript(([token, name, role]) => {
    localStorage.setItem('myterra_token', token);
    localStorage.setItem('myterra_name', name);
    localStorage.setItem('myterra_role', role);
  }, [s.token, s.name, s.role]);
}

/** Signs in through the real sign-in form. */
export async function signInUI(page: Page, who: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(dashboard|admin)/);
}

/** Collects console errors and uncaught exceptions for the page's lifetime. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  return errors;
}

export async function expectNoHorizontalOverflow(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth,
  }));
  expect(scroll, 'page is wider than the screen').toBeLessThanOrEqual(client + 1);
}

/** WCAG 2.1 A/AA checks; serious and critical problems fail the test. */
export async function expectAccessible(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map(v => `${v.id}: ${v.help} (${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(', ')})`)).toEqual([]);
}

export const unique = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
