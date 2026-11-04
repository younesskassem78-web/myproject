// Every text shown to visitors and customers must have an Arabic and a French translation.
// Run: npm run check:i18n  (exits 1 and lists what's missing)
import { readFileSync } from 'node:fs';

const APP = new URL('../src/app/', import.meta.url);
const read = p => readFileSync(new URL(p, APP), 'utf8');
const norm = s => s.replace(/\\'/g, "'").replace(/\s+/g, ' ').replace(/’/g, "'").trim();

const FILES = ['app.ts', 'shared/notification-bell.ts', 'shared/lang-switch.ts', 'core/errors.ts',
  ...'login apply forgot status dashboard billing invoice speed-test support ticket plan settings pay-dialog'.split(' ').map(f => `pages/${f}.ts`)];
// Shown as-is in every language: names, addresses, examples.
const SKIP = new Set(['myterra', 'MyTerra Internet', 'you@example.com', 'support&#64;myterra.app', 'MM/YY']);

const SQ = String.raw`'((?:[^'\\]|\\.)*)'`;
const DQ = String.raw`"([^"]*)"`;
const used = new Set();
const add = k => { const n = norm(k); if (/[A-Za-z]/.test(n) && !SKIP.has(n)) used.add(n); };
for (const f of FILES) {
  const s = read(f);
  for (const m of s.matchAll(new RegExp(`${SQ}\\s*\\|\\s*t\\b|${DQ}\\s*\\|\\s*t\\b`, 'g'))) add(m[1] ?? m[2]);
  for (const m of s.matchAll(new RegExp(`(?<![\\w.])t\\(\\s*(?:${SQ}|${DQ})`, 'g'))) add(m[1] ?? m[2]);
  // (cond ? 'a' : 'b') | t  — the parentheses may contain calls like theme()
  for (const m of s.matchAll(/\{\{\s*\((.*?)\)\s*\|\s*t\b/g)) for (const lit of m[1].matchAll(new RegExp(SQ, 'g'))) add(lit[1]);
  for (const m of s.matchAll(/t\(this\.busy\(\) \? '([^']*)' : '([^']*)'\)/g)) { add(m[1]); add(m[2]); }
  for (const m of s.matchAll(/label: '([^']*)'/g)) add(m[1]);
  for (const name of ['STATUS', 'KIND', 'STATUS_LABEL', 'CATEGORY_LABEL', 'OUTAGE_LABEL']) {
    const block = s.match(new RegExp(`\\b${name}\\b[^=\\n]*= \\{([\\s\\S]*?)\\};`));
    if (block) for (const lit of block[1].matchAll(/:\s*'([^']*)'/g)) add(lit[1]);
  }
  const phase = s.match(/phaseLabel = computed\(\(\) => t\(\{([\s\S]*?)\}/);
  if (phase) for (const lit of phase[1].matchAll(/:\s*'([^']*)'/g)) add(lit[1]);
}
// values like 'admin' or 'dark' inside conditions aren't text; ignore lowercase single words used as codes
for (const code of ['dark', 'light', 'balance', 'overdue', 'step', 'customer', 'admin', 'verify', 'review', 'done']) used.delete(code);

let missing = 0;
for (const lang of ['ar', 'fr']) {
  const src = read(`core/i18n/${lang}.ts`);
  const keys = new Set();
  for (const m of src.matchAll(new RegExp(`^\\s*(?:${SQ}|${DQ}):`, 'gm'))) keys.add(norm(m[1] ?? m[2]));
  const gaps = [...used].filter(k => !keys.has(k));
  missing += gaps.length;
  if (gaps.length) console.log(`${lang}: ${gaps.length} missing\n  ` + gaps.join('\n  '));
}
console.log(`${used.size} texts checked, ${missing ? missing + ' translations missing' : 'all translated in ar and fr'}`);
process.exit(missing ? 1 : 0);
