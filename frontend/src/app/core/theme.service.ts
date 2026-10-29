import { Injectable, signal } from '@angular/core';

export type Theme = 'light' | 'dark';
const KEY = 'myterra_theme';

/** Light or dark. Follows the system until the person picks one, then remembers it. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>(this.initial());

  constructor() { this.apply(this.theme()); }

  toggle() {
    const next: Theme = this.theme() === 'dark' ? 'light' : 'dark';
    this.theme.set(next);
    try { localStorage.setItem(KEY, next); } catch { /* private mode: just don't remember */ }
    this.apply(next);
  }

  private initial(): Theme {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch { /* ignore */ }
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  private apply(t: Theme) { document.documentElement.dataset['theme'] = t; }
}
