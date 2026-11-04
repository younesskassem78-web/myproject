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
    <p class="muted lead">Issues one bill per active customer for this month. Customers with autopay are charged right away. Running it again only bills customers who were missed. It also reminds customers whose bill is due within 3 days.</p>
    @if (notice()) { <p class="notice" role="status">{{ notice() }}</p> }
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }

    <div class="filters">
      <label class="inline-label">Status
        <select [(ngModel)]="status" name="status" (ngModelChange)="reload()">
          <option value="">All</option><option value="unpaid">Unpaid</option><option value="overdue">Overdue</option><option value="paid">Paid</option>
        </select>
      </label>
      <input class="search" type="search" placeholder="Search customer or bill number" aria-label="Search"
             [(ngModel)]="query" (ngModelChange)="searchSoon()" />
    </div>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Scrollable table">
      <table>
        <thead><tr><th>Bill</th><th>Customer</th><th>Month</th><th>Amount</th><th>Due</th><th>Status</th></tr></thead>
        <tbody>
          @for (i of invoices(); track i.id) {
            <tr>
              <td>{{ i.number }}</td>
              <td>{{ i.user_name }}<br /><span class="muted">{{ i.user_email }}</span></td>
              <td>{{ i.period | date: 'MMM y' }}</td>
              <td>{{ i.amount | currency }}</td>
              <td>{{ i.due_date | date: 'd MMM' }}</td>
              <td><span class="status status-{{ i.status }}">{{ label(i.status) }}</span></td>
            </tr>
          } @empty { <tr><td colspan="6" class="muted">{{ loaded() ? 'No bills match.' : 'Loading…' }}</td></tr> }
        </tbody>
      </table>
    </div>
    <div class="list-foot">
      <span class="muted">Showing {{ invoices().length }} of {{ total() }} bills</span>
      @if (invoices().length < total()) {
        <button class="btn btn-ghost btn-sm" type="button" (click)="showMore()">Show more</button>
      }
    </div>
  `,
})
export class AdminBilling implements OnInit {
  private api = inject(ApiService);
  invoices = signal<AdminInvoice[]>([]);
  loaded = signal(false); // lists say "Loading…", not "nothing here", until the data arrives
  busy = signal(false);
  notice = signal('');
  error = signal('');
  status: '' | InvoiceStatus = '';
  query = '';

  total = signal(0);
  private shown = 50;
  private searchTimer?: ReturnType<typeof setTimeout>;

  label = (s: string) => ({ unpaid: 'Unpaid', paid: 'Paid', overdue: 'Overdue', void: 'Void' } as Record<string, string>)[s];

  ngOnInit() { this.load(); }

  /** Searching and filtering happen on the server, so every bill is reachable, not just the first page. */
  load() {
    this.api.adminInvoices(this.query.trim(), this.status, this.shown).subscribe({
      next: r => { this.invoices.set(r.items); this.total.set(r.total); this.loaded.set(true); },
      error: e => this.error.set(errorText(e)),
    });
  }
  reload() { this.shown = 50; this.load(); }
  searchSoon() {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.reload(), 300);
  }
  showMore() { this.shown += 50; this.load(); }

  run() {
    if (!confirm('Issue this month’s bills now?')) return;
    this.busy.set(true);
    this.error.set('');
    this.api.runBilling().subscribe({
      next: r => {
        const issued = r.issued ? `Issued ${r.issued} bill${r.issued === 1 ? '' : 's'}${r.autopaid ? `, ${r.autopaid} paid by autopay` : ''}.`
          : 'Everyone already has a bill for this month.';
        this.notice.set(r.reminded ? `${issued} Reminded ${r.reminded} customer${r.reminded === 1 ? '' : 's'} about bills due soon.` : issued);
        this.busy.set(false);
        this.load();
      },
      error: e => { this.error.set(errorText(e)); this.busy.set(false); },
    });
  }
}
