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

const isLang = (v: string | null): v is Lang => v === 'en' || v === 'ar' || v === 'fr';

function detect(): Lang {
  // 1. ?lang=ar in the address (works even where the browser won't save anything; shareable)
  const fromUrl = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('lang') : null;
  if (isLang(fromUrl)) {
    try { localStorage.setItem(KEY, fromUrl); } catch { /* not remembered, but this page still uses it */ }
    return fromUrl;
  }
  // 2. the choice saved last time  3. the browser's own language
  let saved: string | null = null;
  try { saved = localStorage.getItem(KEY); } catch { /* storage blocked: fall back to the browser */ }
  if (isLang(saved)) return saved;
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

/** Switch language: remember it and load the page again with ?lang= in the address, so it applies even if storage is blocked. */
export function setLang(lang: Lang) {
  try { localStorage.setItem(KEY, lang); } catch { /* the address below still carries it */ }
  const url = new URL(location.href);
  url.searchParams.set('lang', lang);
  location.assign(url.toString());
}

/** Template form: {{ 'Sign in' | t }} or {{ 'Hi, {name}' | t: { name: n } }} */
@Pipe({ name: 't' })
export class TPipe implements PipeTransform {
  transform(text: string, params?: Record<string, string | number | null | undefined>): string {
    return t(text, params);
  }
}
