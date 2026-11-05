import { Component, DestroyRef, inject, input, output, signal } from '@angular/core';
import { TPipe } from '../core/i18n';
import { Icon } from './icon';

/**
 * Grey placeholder in the shape of the page that's on its way, built from the real layout classes so
 * nothing jumps when the data lands. Kinds: dashboard (customer overview), cards (stat cards + a panel),
 * detail (a bill or ticket), rows (inside a table cell or list), lines (inside a card).
 */
@Component({
  selector: 'app-skeleton',
  imports: [TPipe],
  host: { role: 'status', 'aria-busy': 'true', class: 'sk-host' },
  template: `
    <span class="visually-hidden">{{ label() | t }}</span>
    @switch (kind()) {
      @case ('dashboard') {
        <div class="usage-hero" aria-hidden="true">
          <span class="sk" style="width: 14rem"></span>
          <span class="sk sk-title" style="width: min(24rem, 80%)"></span>
          <span class="sk sk-bar"></span>
          <span class="sk" style="width: 12rem"></span>
        </div>
        <div class="dash-grid" aria-hidden="true">
          <div class="card"><span class="sk" style="width: 7rem"></span><span class="sk sk-block"></span></div>
          <div class="side-cards"><span class="sk sk-panel"></span><span class="sk sk-panel short"></span></div>
        </div>
      }
      @case ('cards') {
        <div class="kpis" aria-hidden="true">
          @for (i of four; track i) { <div class="kpi"><span class="sk" style="width: 60%"></span><span class="sk sk-num"></span></div> }
        </div>
        <div class="card" aria-hidden="true"><span class="sk" style="width: 10rem"></span><span class="sk sk-block"></span></div>
      }
      @case ('detail') {
        <div class="card sk-detail" aria-hidden="true">
          <span class="sk sk-title" style="width: 40%"></span>
          @for (i of four; track i) { <span class="sk" [style.width.%]="90 - i * 12"></span> }
        </div>
      }
      @case ('rows') {
        <div class="sk-rows" aria-hidden="true">@for (i of three; track i) { <span class="sk" [style.width.%]="95 - i * 15"></span> }</div>
      }
      @default {
        <div class="sk-rows" aria-hidden="true"><span class="sk" style="width: 70%"></span><span class="sk" style="width: 45%"></span></div>
      }
    }
  `,
})
export class Skeleton {
  kind = input<'dashboard' | 'cards' | 'detail' | 'rows' | 'lines'>('lines');
  label = input('Loading…');
  readonly three = [0, 1, 2];
  readonly four = [0, 1, 2, 3];
}

/** What a section shows when its data couldn't be loaded: the reason, and a way to try again. */
@Component({
  selector: 'app-load-error',
  imports: [TPipe, Icon],
  template: `
    <div class="load-error" role="alert">
      <app-icon name="alert" />
      <p>{{ message() }}</p>
      <button class="btn btn-sm btn-ghost" type="button" (click)="retry.emit()">{{ 'Try again' | t }}</button>
    </div>
  `,
})
export class LoadError {
  message = input.required<string>();
  retry = output<void>();
}

/** Tells people when their connection drops, and when it's back. Pages keep what they already showed. */
@Component({
  selector: 'app-offline-banner',
  imports: [TPipe, Icon],
  template: `
    <div role="status" aria-live="polite">
      @if (state() !== 'online') {
        <p class="offline-banner" [class.back]="state() === 'back'">
          <app-icon [name]="state() === 'back' ? 'check' : 'wifi'" [size]="18" />
          {{ (state() === 'back' ? 'You’re back online.' : 'You’re offline. We’ll reconnect when your internet is back.') | t }}
        </p>
      }
    </div>
  `,
})
export class OfflineBanner {
  state = signal<'online' | 'offline' | 'back'>(navigator.onLine ? 'online' : 'offline');

  constructor() {
    let hide: ReturnType<typeof setTimeout> | undefined;
    const offline = () => { clearTimeout(hide); this.state.set('offline'); };
    const online = () => {
      if (this.state() !== 'offline') return;
      this.state.set('back');
      hide = setTimeout(() => this.state.set('online'), 4000);
    };
    addEventListener('offline', offline);
    addEventListener('online', online);
    inject(DestroyRef).onDestroy(() => { removeEventListener('offline', offline); removeEventListener('online', online); clearTimeout(hide); });
  }
}
