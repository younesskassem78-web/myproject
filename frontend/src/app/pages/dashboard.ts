import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiService } from '../core/api.service';
import { errorText } from '../core/errors';
import { BillingSummary, InstallStatus, Me, Usage } from '../core/models';
import { Icon } from '../shared/icon';
import { UsageChart } from './usage-chart';

const INSTALL_STEPS: { key: InstallStatus; label: string }[] = [
  { key: 'scheduled', label: 'Booked' },
  { key: 'technician_assigned', label: 'Technician assigned' },
  { key: 'installed', label: 'Installed' },
];

@Component({
  selector: 'app-dashboard',
  imports: [CurrencyPipe, DatePipe, DecimalPipe, RouterLink, UsageChart, Icon],
  template: `
    @if (loadError()) {
      <p class="error" role="alert">{{ loadError() }}</p>
    } @else if (me() && usage() && bill()) {
      @for (o of me()!.outages; track o.id) {
        <section class="banner banner-warn" role="status">
          <app-icon name="alert" />
          <div>
            <strong>{{ o.title }}</strong>
            <p>{{ o.message }} <span class="muted">Updated {{ o.updated_at | date: 'HH:mm' }}.</span></p>
          </div>
          <a routerLink="/status">Network status</a>
        </section>
      }

      @if (me()!.install_status && me()!.install_status !== 'installed') {
        <section class="card install">
          <h2>Your installation</h2>
          <ol class="steps">
            @for (s of steps; track s.key; let i = $index) {
              <li [class.done]="i <= installIndex()" [attr.aria-current]="i === installIndex() ? 'step' : null">{{ s.label }}</li>
            }
          </ol>
          @if (me()!.install_date) {
            <p>Technician visit: <strong>{{ me()!.install_date | date: 'EEEE d MMMM' }}</strong>, between 9:00 and 17:00.</p>
          }
        </section>
      }

      <section class="usage-hero">
        <p class="plan-line">{{ me()!.plan?.name }} &nbsp;/&nbsp; {{ me()!.plan?.speed_mbps }} Mbps &nbsp;/&nbsp;
          {{ me()!.plan?.price | currency: 'USD' : 'symbol' : '1.0-2' }}/month</p>
        <h1>{{ usage()!.used_gb | number: '1.2-2' }} GB of {{ usage()!.limit_gb }} GB used</h1>
        <div class="fiber" role="progressbar" aria-label="Data used this month"
             [attr.aria-valuenow]="percent()" aria-valuemin="0" aria-valuemax="100">
          <div class="fiber-light" [class.full]="percent() >= 100" [style.width.%]="percent()"></div>
        </div>
        <p class="muted">{{ left() | number: '1.2-2' }} GB left, resets on the 1st.</p>
      </section>

      <div class="dash-grid">
        <section class="card">
          <h2>Daily use</h2>
          <app-usage-chart [days]="usage()!.days" />
        </section>

        <div class="side-cards">
          <section class="panel-dark">
            <h2>Amount due</h2>
            <p class="balance-amount">{{ bill()!.amount_due | currency }}</p>
            @if (bill()!.amount_due > 0 && bill()!.next_invoice; as inv) {
              <p [class.overdue-text]="inv.status === 'overdue'">
                {{ inv.status === 'overdue' ? 'Overdue since' : 'Due' }} {{ inv.due_date | date: 'd MMMM' }}
              </p>
              <a class="btn btn-amber" routerLink="/billing">Pay now</a>
            } @else {
              <p>You're all paid up.{{ bill()!.autopay ? ' Autopay is on.' : '' }}</p>
              <a class="btn btn-amber" routerLink="/billing">View bills</a>
            }
          </section>
          <nav class="quick card" aria-label="Quick actions">
            <a routerLink="/speed-test"><app-icon name="gauge" /> Test my speed</a>
            <a routerLink="/support"><app-icon name="help" /> Report a problem</a>
            <a routerLink="/plan"><app-icon name="layers" /> Change plan</a>
          </nav>
        </div>
      </div>
    } @else {
      <div class="skeleton" aria-busy="true" aria-label="Loading your account"></div>
    }
  `,
})
export class Dashboard implements OnInit {
  private api = inject(ApiService);
  me = signal<Me | null>(null);
  usage = signal<Usage | null>(null);
  bill = signal<BillingSummary | null>(null);
  loadError = signal('');
  readonly steps = INSTALL_STEPS;

  percent = computed(() => {
    const u = this.usage();
    return u ? Math.min(100, Math.round((u.used_gb / u.limit_gb) * 100)) : 0;
  });
  left = computed(() => {
    const u = this.usage();
    return u ? Math.max(0, u.limit_gb - u.used_gb) : 0;
  });
  installIndex = computed(() => INSTALL_STEPS.findIndex(s => s.key === this.me()?.install_status));

  ngOnInit() {
    forkJoin({ me: this.api.me(), usage: this.api.usage(), bill: this.api.billing() }).subscribe({
      next: r => { this.me.set(r.me); this.usage.set(r.usage); this.bill.set(r.bill); },
      error: e => this.loadError.set(errorText(e, 'Can’t load your account. Refresh to try again.')),
    });
  }
}
