import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { StaffArea, canSee } from '../../core/permissions';
import { errorText } from '../../core/errors';
import { AdminOverview } from '../../core/models';
import { LoadError, Skeleton } from '../../shared/loading';
import { CountUp } from '../../shared/count-up';

@Component({
  selector: 'app-admin-overview',
  imports: [CurrencyPipe, DatePipe, RouterLink, LoadError, Skeleton, CountUp],
  template: `
    <h1>Overview</h1>
    @if (error()) { <app-load-error [message]="error()" (retry)="load()" /> }
    @if (twoFactorOff()) {
      <section class="banner banner-warn" role="status">
        <div><strong>Protect the console</strong>
          <p>Your account can see customer details and payments. Turn on two-step sign-in.</p></div>
        <a routerLink="/admin/account">Turn it on</a>
      </section>
    }
    @if (data(); as d) {
      <div class="kpis">
        <a class="kpi" routerLink="/admin/customers"><span>Active customers</span><strong countUp>{{ d.kpis.active_customers }}</strong></a>
        @if (d.kpis.mrr !== undefined) {
          <div class="kpi"><span>Monthly recurring revenue</span><strong countUp>{{ d.kpis.mrr | currency: 'USD' : 'symbol' : '1.0-0' }}</strong></div>
          <a class="kpi" routerLink="/admin/billing" [class.alert]="(d.kpis.overdue_invoices ?? 0) > 0">
            <span>Unpaid bills</span><strong countUp>{{ d.kpis.unpaid_total | currency: 'USD' : 'symbol' : '1.0-0' }}</strong>
            @if (d.kpis.overdue_invoices) { <em>{{ d.kpis.overdue_invoices }} overdue</em> }
          </a>
        }
        @if (can('applications')) {
          <a class="kpi" routerLink="/admin/applications" [class.alert]="d.kpis.pending_applications > 0">
            <span>Applications waiting</span><strong countUp>{{ d.kpis.pending_applications }}</strong></a>
        }
        @if (can('tickets')) {
          <a class="kpi" routerLink="/admin/tickets"><span>Open tickets</span><strong countUp>{{ d.kpis.open_tickets }}</strong></a>
          <a class="kpi" routerLink="/admin/outages" [class.alert]="d.kpis.active_outages > 0">
            <span>Active outages</span><strong countUp>{{ d.kpis.active_outages }}</strong></a>
        }
      </div>

      <div class="dash-grid">
        @if (d.revenue) {
        <section class="card">
          <h2>Payments received</h2>
          <div class="bars" role="img" [attr.aria-label]="revenueLabel()">
            @for (m of d.revenue; track m.month) {
              <div class="bar-col">
                <span class="bar-value">{{ m.amount | currency: 'USD' : 'symbol' : '1.0-0' }}</span>
                <div class="bar" [style.height.%]="barHeight(m.amount)"></div>
                <span class="bar-label">{{ m.month + '-01' | date: 'MMM' }}</span>
              </div>
            }
          </div>
        </section>
        }
        @if (d.audit) {
        <section class="card">
          <h2>Recent admin activity</h2>
          <ul class="activity">
            @for (a of d.audit; track a.id) {
              <li><strong>{{ a.admin_email }}</strong> {{ a.action }} <em>{{ a.target }}</em>
                <span class="muted">{{ a.created_at | date: 'd MMM, HH:mm' }}</span></li>
            } @empty { <li class="muted">Nothing yet.</li> }
          </ul>
          <a routerLink="/admin/audit">Full audit log</a>
        </section>
        }
      </div>
    } @else if (!error()) {
      <app-skeleton kind="cards" />
    }
  `,
})
export class AdminOverviewPage implements OnInit {
  private api = inject(ApiService);
  data = signal<AdminOverview | null>(null);
  error = signal('');
  private auth = inject(AuthService);
  can = (area: StaffArea) => canSee(this.auth.role(), area);
  private max = computed(() => Math.max(1, ...(this.data()?.revenue?.map(r => r.amount) ?? [1])));

  barHeight = (amount: number) => Math.max(2, (amount / this.max()) * 100);
  revenueLabel = () => 'Payments by month: ' + (this.data()?.revenue?.map(r => `${r.month} $${r.amount.toFixed(0)}`).join(', ') ?? '');

  twoFactorOff = signal(false);

  ngOnInit() {
    this.api.twoFactor().subscribe({ next: s => this.twoFactorOff.set(!s.enabled), error: () => {} }); // only a reminder; fine to skip
    this.load();
  }
  load() {
    this.error.set('');
    this.api.adminOverview().subscribe({ next: d => this.data.set(d), error: e => this.error.set(errorText(e)) });
  }
}
