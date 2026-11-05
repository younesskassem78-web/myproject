import { CurrencyPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { saveFile } from '../../core/download';
import { errorText } from '../../core/errors';
import { RevenueReport } from '../../core/models';

const KIND: Record<string, string> = {
  invoice: 'Bill payments', signup: 'First months', topup: 'Balance top-ups', data: 'Extra data',
};
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Money in, bills and new customers for any date range, straight from the database, with CSV downloads. */
@Component({
  selector: 'app-admin-reports',
  imports: [CurrencyPipe, FormsModule],
  template: `
    <div class="page-head"><h1>Reports</h1></div>
    <form class="filters" (ngSubmit)="load()">
      <label class="inline-label">From <input type="date" name="start" [(ngModel)]="start" [max]="end" /></label>
      <label class="inline-label">To <input type="date" name="end" [(ngModel)]="end" [min]="start" /></label>
      <button class="btn btn-sm" type="submit">Show</button>
      <span class="range-links">
        <button class="link-btn" type="button" (click)="preset('month')">This month</button>
        <button class="link-btn" type="button" (click)="preset('last')">Last month</button>
        <button class="link-btn" type="button" (click)="preset('year')">This year</button>
      </span>
    </form>
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }

    @if (report(); as r) {
      <div class="kpis">
        <div class="kpi"><span>Money received</span><strong>{{ r.received | currency }}</strong></div>
        <div class="kpi"><span>Bills issued</span><strong>{{ r.bills.issued }}</strong><small>{{ r.bills.billed | currency }} billed</small></div>
        <div class="kpi"><span>Still unpaid</span><strong>{{ r.bills.unpaid | currency }}</strong><small>of bills issued in this range</small></div>
        <div class="kpi"><span>New customers</span><strong>{{ r.new_customers }}</strong></div>
      </div>

      <div class="report-grid">
        <section class="card">
          <h2>Money received by type</h2>
          <table>
            <thead><tr><th>Type</th><th>Payments</th><th>Total</th></tr></thead>
            <tbody>
              @for (k of r.by_kind; track k.kind) {
                <tr><td>{{ kind(k.kind) }}</td><td>{{ k.count }}</td><td>{{ k.total | currency }}</td></tr>
              } @empty { <tr><td colspan="3" class="muted">No payments in this range.</td></tr> }
            </tbody>
          </table>
        </section>
        <section class="card">
          <h2>By month</h2>
          @if (r.by_month.length) {
            <ul class="hbars" aria-label="Money received by month">
              @for (m of r.by_month; track m.month) {
                <li><span>{{ m.month }}</span>
                  <span class="bar" [style.width.%]="(m.total / maxMonth()) * 100"></span>
                  <strong>{{ m.total | currency }}</strong></li>
              }
            </ul>
          } @else { <p class="muted">No payments in this range.</p> }
        </section>
      </div>

      <section class="card">
        <h2>Download for Excel</h2>
        <p class="hint">Bills and payments use the dates above. Customers is the full current list.</p>
        <div class="row-actions">
          <button class="btn btn-ghost btn-sm" type="button" (click)="download('payments')">Payments (CSV)</button>
          <button class="btn btn-ghost btn-sm" type="button" (click)="download('invoices')">Bills (CSV)</button>
          <button class="btn btn-ghost btn-sm" type="button" (click)="download('customers')">Customers (CSV)</button>
        </div>
      </section>
    } @else if (!error()) {
      <div class="skeleton" aria-busy="true" aria-label="Loading"></div>
    }
  `,
})
export class AdminReports implements OnInit {
  private api = inject(ApiService);
  start = iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  end = iso(new Date());
  report = signal<RevenueReport | null>(null);
  error = signal('');
  maxMonth = computed(() => Math.max(1, ...(this.report()?.by_month.map(m => m.total) ?? [])));
  kind = (k: string) => KIND[k] ?? k;

  ngOnInit() { this.load(); }

  load() {
    this.error.set('');
    this.api.revenueReport(this.start, this.end).subscribe({ next: r => this.report.set(r), error: e => this.error.set(errorText(e)) });
  }

  preset(which: 'month' | 'last' | 'year') {
    const now = new Date();
    if (which === 'month') { this.start = iso(new Date(now.getFullYear(), now.getMonth(), 1)); this.end = iso(now); }
    if (which === 'last') {
      this.start = iso(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      this.end = iso(new Date(now.getFullYear(), now.getMonth(), 0));
    }
    if (which === 'year') { this.start = iso(new Date(now.getFullYear(), 0, 1)); this.end = iso(now); }
    this.load();
  }

  download(kind: 'payments' | 'invoices' | 'customers') {
    this.api.exportCsv(kind, this.start, this.end).subscribe({ next: r => saveFile(r), error: e => this.error.set(errorText(e)) });
  }
}
