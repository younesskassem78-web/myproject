import { Injectable, signal } from '@angular/core';

export type Theme = 'light' | 'dark';
const KEY = 'myterra_theme';

/** Light or dark. Follows the system until the person picks one, then remembers it. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>(this.initial());

  constructor() { this.apply(this.theme()); }

  /** Switches theme. With a click, the new theme spreads out in a circle from the button (where the browser can). */
  toggle(from?: MouseEvent) {
    const next: Theme = this.theme() === 'dark' ? 'light' : 'dark';
    const swap = () => {
      this.theme.set(next);
      try { localStorage.setItem(KEY, next); } catch { /* private mode: just don't remember */ }
      this.apply(next);
    };
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!from || reduced || typeof document.startViewTransition !== 'function') return swap();

    const root = document.documentElement;
    root.classList.add('theme-switching'); // turns off the page cross-fade so only the circle shows
    const transition = document.startViewTransition(swap);
    const { clientX: x, clientY: y } = from;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    transition.ready.then(() => root.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: 480, easing: 'cubic-bezier(0.2, 0, 0, 1)', pseudoElement: '::view-transition-new(root)' },
    )).catch(() => { /* skipped, e.g. a second click: the theme still switches */ });
    transition.finished.catch(() => {}).finally(() => root.classList.remove('theme-switching'));
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
