import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { errorText } from '../../core/errors';
import { AdminInvoice, Automation, InvoiceStatus } from '../../core/models';

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

    @if (auto(); as a) {
      <section class="card automation">
        <h2>Automatic</h2>
        <dl class="details">
          <div><dt>Monthly bills</dt>
            <dd>{{ a.scheduler_on ? 'Issued automatically every day after ' + a.billing_hour + ':00 for anyone not yet billed this month, with due-soon reminders.' : 'Off on this server: use the button above.' }}</dd></div>
          <div><dt>Last automatic run</dt>
            <dd>{{ a.last_billing_at ? (a.last_billing_at | date: 'd MMM, HH:mm') + ': ' + a.last_billing_result : 'Not yet' }}</dd></div>
          <div><dt>Emails</dt>
            <dd>{{ a.emails.sent_today }} sent in the last day, {{ a.emails.waiting }} waiting
              @if (a.emails.failed) {, <span class="warn-text">{{ a.emails.failed }} failed</span>
                <button class="btn btn-sm btn-ghost" type="button" (click)="retryEmails()">Try again</button> }
            </dd></div>
        </dl>
      </section>
    }

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

  auto = signal<Automation | null>(null);

  ngOnInit() { this.load(); this.loadAutomation(); }

  loadAutomation() { this.api.automation().subscribe({ next: a => this.auto.set(a), error: () => {} }); }
  retryEmails() {
    this.api.retryEmails().subscribe({
      next: r => { this.notice.set(`Sending ${r.retried} email${r.retried === 1 ? '' : 's'} again.`); this.loadAutomation(); },
      error: e => this.error.set(errorText(e)),
    });
  }

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
        this.loadAutomation();
      },
      error: e => { this.error.set(errorText(e)); this.busy.set(false); },
    });
  }
}
