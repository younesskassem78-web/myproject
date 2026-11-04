import { Pipe, PipeTransform } from '@angular/core';
import { AR } from './ar';
import { FR } from './fr';

/**
 * Translations: English text is the key, so a missing translation simply shows English.
 * The language is fixed for the life of the page; switching saves the choice and reloads, which also
 * re-formats every date and amount for the new language (Angular's LOCALE_ID is set at startup).
 */
export type Lang = 'en' | 'ar' | 'fr';
export const LANGS: { code: Lang; name: string }[] = [
  { code: 'en', name: 'English' }, { code: 'ar', name: 'العربية' }, { code: 'fr', name: 'Français' },
];
const KEY = 'myterra_lang';
/** Same key whichever apostrophe or spacing the text was typed with. */
export const norm = (text: string) => text.replace(/\s+/g, ' ').replace(/’/g, "'").trim();
const index = (d: Record<string, string>) => Object.fromEntries(Object.entries(d).map(([k, v]) => [norm(k), v]));
const DICTS: Record<Lang, Record<string, string>> = { en: {}, ar: index(AR), fr: index(FR) };

function detect(): Lang {
  let saved: string | null = null;
  try { saved = localStorage.getItem(KEY); } catch { /* storage blocked: fall back to the browser */ }
  if (saved === 'en' || saved === 'ar' || saved === 'fr') return saved;
  const browser = (typeof navigator !== 'undefined' ? navigator.language : 'en').slice(0, 2);
  return browser === 'ar' || browser === 'fr' ? browser : 'en';
}

export const LANG: Lang = detect();
export const LOCALE = { en: 'en-US', ar: 'ar', fr: 'fr' }[LANG];
export const RTL = LANG === 'ar';

/** "Hi, {name}" + { name: 'Rana' } → the translated text with values filled in. */
export function t(text: string, params?: Record<string, string | number | null | undefined>): string {
  const out = DICTS[LANG][norm(text)] ?? text.replace(/\s+/g, ' ').trim(); // templates may wrap text over lines
  return params ? out.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? '')) : out;
}

export function setLang(lang: Lang) {
  try { localStorage.setItem(KEY, lang); } catch { /* the choice just won't be remembered */ }
  location.reload();
}

/** Template form: {{ 'Sign in' | t }} or {{ 'Hi, {name}' | t: { name: n } }} */
@Pipe({ name: 't' })
export class TPipe implements PipeTransform {
  transform(text: string, params?: Record<string, string | number | null | undefined>): string {
    return t(text, params);
  }
}
