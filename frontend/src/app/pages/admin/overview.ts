import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { errorText } from '../../core/errors';
import { AdminOverview } from '../../core/models';

@Component({
  selector: 'app-admin-overview',
  imports: [CurrencyPipe, DatePipe, RouterLink],
  template: `
    <h1>Overview</h1>
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    @if (data(); as d) {
      <div class="kpis">
        <a class="kpi" routerLink="/admin/customers"><span>Active customers</span><strong>{{ d.kpis.active_customers }}</strong></a>
        <div class="kpi"><span>Monthly recurring revenue</span><strong>{{ d.kpis.mrr | currency: 'USD' : 'symbol' : '1.0-0' }}</strong></div>
        <a class="kpi" routerLink="/admin/billing" [class.alert]="d.kpis.overdue_invoices > 0">
          <span>Unpaid bills</span><strong>{{ d.kpis.unpaid_total | currency: 'USD' : 'symbol' : '1.0-0' }}</strong>
          @if (d.kpis.overdue_invoices) { <em>{{ d.kpis.overdue_invoices }} overdue</em> }
        </a>
        <a class="kpi" routerLink="/admin/applications" [class.alert]="d.kpis.pending_applications > 0">
          <span>Applications waiting</span><strong>{{ d.kpis.pending_applications }}</strong></a>
        <a class="kpi" routerLink="/admin/tickets"><span>Open tickets</span><strong>{{ d.kpis.open_tickets }}</strong></a>
        <a class="kpi" routerLink="/admin/outages" [class.alert]="d.kpis.active_outages > 0">
          <span>Active outages</span><strong>{{ d.kpis.active_outages }}</strong></a>
      </div>

      <div class="dash-grid">
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
      </div>
    } @else if (!error()) {
      <div class="skeleton" aria-busy="true" aria-label="Loading"></div>
    }
  `,
})
export class AdminOverviewPage implements OnInit {
  private api = inject(ApiService);
  data = signal<AdminOverview | null>(null);
  error = signal('');
  private max = computed(() => Math.max(1, ...(this.data()?.revenue.map(r => r.amount) ?? [1])));

  barHeight = (amount: number) => Math.max(2, (amount / this.max()) * 100);
  revenueLabel = () => 'Payments by month: ' + (this.data()?.revenue.map(r => `${r.month} $${r.amount.toFixed(0)}`).join(', ') ?? '');

  ngOnInit() {
    this.api.adminOverview().subscribe({ next: d => this.data.set(d), error: e => this.error.set(errorText(e)) });
  }
}
