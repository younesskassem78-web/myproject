import { AfterViewInit, Directive, ElementRef, OnDestroy, inject } from '@angular/core';

/** A formatted number: "300", "1,210", "5.26", "$20.00", French "1 210,00" (narrow no-break space). */
const NUMBER = /\d{1,3}(?:([,.  ])\d{3})+(?:([.,])(\d{1,2}))?|\d+(?:([.,])(\d{1,2}))?/;

/**
 * The text with its first number shown at `progress` (0..1) of its value, in the same format:
 * countFrame('$1,210', 0.5) → '$605'. Text without a number comes back unchanged.
 */
export function countFrame(text: string, progress: number): string {
  const m = NUMBER.exec(text);
  if (!m) return text;
  const token = m[0];
  const group = m[1] ?? '';
  const decimalMark = m[2] ?? m[4] ?? '';
  const decimals = (m[3] ?? m[5] ?? '').length;
  const integer = (decimals ? token.slice(0, token.length - decimals - 1) : token).replace(/\D/g, '');
  const final = Number(integer + (decimals ? '.' + token.slice(-decimals) : ''));
  const [int, frac] = (final * progress).toFixed(decimals).split('.');
  const grouped = group ? int.replace(/\B(?=(\d{3})+(?!\d))/g, group) : int;
  return text.slice(0, m.index) + grouped + (frac ? decimalMark + frac : '') + text.slice(m.index + token.length);
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/**
 * Rolls the first number in the element up from zero when it first comes into view (about 0.9 s).
 * Skipped when the person prefers reduced motion. If Angular changes the text meanwhile, Angular's value wins.
 */
@Directive({ selector: '[countUp]' })
export class CountUp implements AfterViewInit, OnDestroy {
  private el: HTMLElement = inject(ElementRef).nativeElement;
  private observer?: IntersectionObserver;
  private frame = 0;

  ngAfterViewInit() {
    if (typeof IntersectionObserver === 'undefined') return;
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    this.observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      this.observer?.disconnect();
      this.run();
    });
    this.observer.observe(this.el);
  }

  private run() {
    const walker = document.createTreeWalker(this.el, NodeFilter.SHOW_TEXT, { acceptNode: n => /\d/.test(n.nodeValue ?? '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP });
    const node = walker.nextNode() as Text | null;
    if (!node) return;
    const final = node.data;
    const start = performance.now();
    let written = '';
    const step = (now: number) => {
      if (written && node.data !== written) return; // Angular updated the value: leave it alone
      const t = Math.min(1, (now - start) / 900);
      written = t < 1 ? countFrame(final, easeOut(t)) : final;
      node.data = written;
      if (t < 1) this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  ngOnDestroy() {
    this.observer?.disconnect();
    cancelAnimationFrame(this.frame);
  }
}
