import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { errorText } from '../../core/errors';
import { AdminInvoice, InvoiceStatus } from '../../core/models';

@Component({
  selector: 'app-admin-billing',
  imports: [CurrencyPipe, DatePipe, FormsModule],
  template: `
    <div class="page-head">
      <h1>Billing</h1>
      <button class="btn" type="button" (click)="run()" [disabled]="busy()">{{ busy() ? 'Running…' : 'Issue this month\\'s bills' }}</button>
    </div>
    <p class="muted lead">Issues one bill per active customer for this month. Customers with autopay are charged right away. Running it again only bills customers who were missed.</p>
    @if (notice()) { <p class="notice" role="status">{{ notice() }}</p> }
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }

    <div class="filters">
      <label class="inline-label">Status
        <select [(ngModel)]="status" name="status">
          <option value="">All</option><option value="unpaid">Unpaid</option><option value="overdue">Overdue</option><option value="paid">Paid</option>
        </select>
      </label>
      <input class="search" type="search" placeholder="Search customer or bill number" aria-label="Search" [(ngModel)]="query" />
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Bill</th><th>Customer</th><th>Month</th><th>Amount</th><th>Due</th><th>Status</th></tr></thead>
        <tbody>
          @for (i of filtered(); track i.id) {
            <tr>
              <td>{{ i.number }}</td>
              <td>{{ i.user_name }}<br /><span class="muted">{{ i.user_email }}</span></td>
              <td>{{ i.period | date: 'MMM y' }}</td>
              <td>{{ i.amount | currency }}</td>
              <td>{{ i.due_date | date: 'd MMM' }}</td>
              <td><span class="status status-{{ i.status }}">{{ label(i.status) }}</span></td>
            </tr>
          } @empty { <tr><td colspan="6" class="muted">No bills match.</td></tr> }
        </tbody>
      </table>
    </div>
    <p class="muted small">Showing {{ filtered().length }} of {{ invoices().length }} bills.</p>
  `,
})
export class AdminBilling implements OnInit {
  private api = inject(ApiService);
  invoices = signal<AdminInvoice[]>([]);
  busy = signal(false);
  notice = signal('');
  error = signal('');
  status: '' | InvoiceStatus = '';
  query = '';

  label = (s: string) => ({ unpaid: 'Unpaid', paid: 'Paid', overdue: 'Overdue', void: 'Void' } as Record<string, string>)[s];
  filtered = () => {
    const q = this.query.trim().toLowerCase();
    return this.invoices().filter(i => (!this.status || i.status === this.status)
      && (!q || [i.number, i.user_email, i.user_name].some(f => f.toLowerCase().includes(q))));
  };

  ngOnInit() { this.load(); }

  load() { this.api.adminInvoices().subscribe({ next: i => this.invoices.set(i), error: e => this.error.set(errorText(e)) }); }

  run() {
    if (!confirm('Issue this month’s bills now?')) return;
    this.busy.set(true);
    this.error.set('');
    this.api.runBilling().subscribe({
      next: r => {
        this.notice.set(r.issued ? `Issued ${r.issued} bill${r.issued === 1 ? '' : 's'}${r.autopaid ? `, ${r.autopaid} paid by autopay` : ''}.`
          : 'Everyone already has a bill for this month.');
        this.busy.set(false);
        this.load();
      },
      error: e => { this.error.set(errorText(e)); this.busy.set(false); },
    });
  }
}
