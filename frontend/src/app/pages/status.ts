import { DatePipe } from '@angular/common';
import { LangSwitch } from '../shared/lang-switch';
import { TPipe, t } from '../core/i18n';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { errorText } from '../core/errors';
import { Outage, OutageStatus } from '../core/models';

export const OUTAGE_LABEL: Record<OutageStatus, string> = {
  investigating: 'Investigating', identified: 'Cause found, fixing', monitoring: 'Fixed, monitoring', resolved: 'Resolved',
};

/** Public page: is the network OK in my area? */
@Component({
  selector: 'app-status',
  imports: [TPipe, LangSwitch, DatePipe, RouterLink],
  template: `
    <div class="public-page">
      <header class="apply-head">
        <a class="wordmark" routerLink="/">myterra</a>
        <span class="head-right"><app-lang-switch />
        <a [routerLink]="auth.isLoggedIn() ? (auth.isStaff() ? '/admin' : '/dashboard') : '/login'">
          {{ (auth.isLoggedIn() ? 'Back to my account' : 'Sign in') | t }}</a></span>
      </header>
      <section class="status-body">
        <h1>{{ 'Network status' | t }}</h1>
        @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        @if (loaded()) {
          @if (active().length) {
            <p class="status-summary warn">{{ (active().length === 1 ? 'One area has a known issue.' : '{n} areas have a known issue.') | t: { n: active().length } }}</p>
          } @else {
            <p class="status-summary ok">{{ 'All services are running normally.' | t }}</p>
          }
          @for (o of active(); track o.id) {
            <article class="card outage">
              <div class="ticket-head"><h2>{{ o.city }}: {{ o.title }}</h2><span class="status status-outage-{{ o.status }}">{{ label(o.status) }}</span></div>
              <p>{{ o.message }}</p>
              <p class="muted">{{ 'Started {start}, last update {update}' | t: { start: (o.started_at | date: 'd MMM, HH:mm'), update: (o.updated_at | date: 'HH:mm') } }}</p>
            </article>
          }
          @if (recent().length) {
            <h2 class="section-title">{{ 'Resolved in the last 7 days' | t }}</h2>
            @for (o of recent(); track o.id) {
              <article class="card outage resolved">
                <h3>{{ o.city }}: {{ o.title }}</h3>
                <p class="muted">{{ '{start} to {end}' | t: { start: (o.started_at | date: 'd MMM, HH:mm'), end: (o.resolved_at | date: 'd MMM, HH:mm') } }}</p>
              </article>
            }
          }
          <p class="muted small">{{ 'Updates every minute. Last checked {time}.' | t: { time: (checked() | date: 'HH:mm:ss') } }}</p>
        }
      </section>
    </div>
  `,
})
export class Status {
  private api = inject(ApiService);
  auth = inject(AuthService);
  active = signal<Outage[]>([]);
  recent = signal<Outage[]>([]);
  loaded = signal(false);
  checked = signal(new Date());
  error = signal('');
  label = (s: OutageStatus) => t(OUTAGE_LABEL[s]);

  constructor() {
    this.load();
    const timer = setInterval(() => this.load(), 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  load() {
    this.api.status().subscribe({
      next: r => {
        this.active.set(r.active);
        this.recent.set(r.recent);
        this.loaded.set(true);
        this.checked.set(new Date());
        this.error.set('');
      },
      error: e => this.error.set(errorText(e)),
    });
  }
}
