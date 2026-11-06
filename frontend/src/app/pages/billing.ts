import { CurrencyPipe, DatePipe } from '@angular/common';
import { TPipe, t } from '../core/i18n';
import { Component, OnInit, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Observable, forkJoin } from 'rxjs';
import { ApiService } from '../core/api.service';
import { errorText } from '../core/errors';
import { BillingSummary, Invoice, Payment } from '../core/models';
import { LoadError, Skeleton } from '../shared/loading';
import { CountUp } from '../shared/count-up';
import { CardDetails, PayDialog } from './pay-dialog';

type Pending = { kind: 'invoice'; invoice: Invoice } | { kind: 'topup'; amount: number } | { kind: 'autopay' };

const STATUS: Record<string, string> = { unpaid: 'Unpaid', paid: 'Paid', overdue: 'Overdue', void: 'Void' };
const KIND: Record<string, string> = { invoice: 'Bill payment', topup: 'Top-up', signup: 'First month', data: 'Extra data' };

@Component({
  selector: 'app-billing',
  imports: [TPipe, CurrencyPipe, DatePipe, FormsModule, RouterLink, PayDialog, LoadError, Skeleton, CountUp],
  template: `
    <h1>{{ 'Billing' | t }}</h1>
    @if (notice()) { <p class="notice" role="status">{{ notice() }}</p> }
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }

    @if (loadError() && !summary()) {
      <app-load-error [message]="loadError()" (retry)="load()" />
    } @else {
    @if (summary(); as s) {
      <div class="bill-cards">
        <section class="panel-dark">
          <h2>{{ 'Amount due' | t }}</h2>
          <p class="balance-amount" countUp>{{ s.amount_due | currency }}</p>
          @if (s.amount_due > 0 && s.next_invoice; as inv) {
            <p [class.overdue-text]="inv.status === 'overdue'">{{ inv.number }}, {{ (inv.status === 'overdue' ? 'overdue since' : 'due') | t }}
              {{ inv.due_date | date: 'd MMMM' }}</p>
            <div class="row-actions">
              <button class="btn btn-amber" type="button" (click)="payByCard(inv)">{{ 'Pay by card' | t }}</button>
              @if (s.balance >= inv.amount) {
                <button class="btn btn-ghost-light" type="button" (click)="payFromBalance(inv)" [disabled]="busy()" [class.loading]="busy() === 'balance'">
                  {{ 'Use balance' | t }}
                </button>
              }
            </div>
          } @else {
            <p>{{ 'Nothing to pay right now.' | t }}</p>
          }
        </section>

        <section class="card">
          <h2>{{ 'Autopay' | t }}</h2>
          @if (s.autopay) {
            <p>{{ 'On. We charge your {brand} ending in {last4} when each bill is issued.' | t: { brand: s.card_brand, last4: s.card_last4 } }}</p>
            <button class="btn btn-ghost" type="button" (click)="setAutopay(false)" [disabled]="busy()" [class.loading]="busy() === 'autopay'">{{ 'Turn off' | t }}</button>
          } @else {
            <p>{{ 'Never miss a due date. Bills are paid automatically with your saved card.' | t }}</p>
            @if (s.card_last4) {
              <button class="btn" type="button" (click)="setAutopay(true)" [disabled]="busy()" [class.loading]="busy() === 'autopay'">
                {{ 'Turn on with {brand} {last4}' | t: { brand: s.card_brand, last4: s.card_last4 } }}
              </button>
            }
            <button class="btn" [class.btn-ghost]="!!s.card_last4" type="button" (click)="openAutopay()">
              {{ (s.card_last4 ? 'Use another card' : 'Add a card') | t }}
            </button>
          }
        </section>

        <section class="card">
          <h2>{{ 'Account balance' | t }}</h2>
          <p class="big-number" countUp>{{ s.balance | currency }}</p>
          <form class="topup" (ngSubmit)="topUp()">
            <label>{{ 'Top up amount ($)' | t }} <input name="amount" inputmode="decimal" placeholder="10" [(ngModel)]="amount" /></label>
            <button class="btn" type="submit">{{ 'Top up' | t }}</button>
          </form>
          @if (topUpError()) { <p class="error" role="alert">{{ topUpError() }}</p> }
        </section>
      </div>
    } @else {
      <app-skeleton kind="cards" />
    }

    <section class="card">
      <h2>{{ 'Bills' | t }}</h2>
      <div class="table-wrap flat" tabindex="0" role="region" [attr.aria-label]="'Scrollable table' | t">
        <table>
          <thead><tr><th>{{ 'Bill' | t }}</th><th>{{ 'Month' | t }}</th><th>{{ 'Amount' | t }}</th><th>{{ 'Due' | t }}</th><th>{{ 'Status' | t }}</th><th></th></tr></thead>
          <tbody>
            @for (i of invoices(); track i.id) {
              <tr>
                <td><a [routerLink]="['/billing', i.id]">{{ i.number }}</a></td>
                <td>{{ i.period | date: 'MMMM y' }}</td>
                <td>{{ i.amount | currency }}</td>
                <td>{{ i.due_date | date: 'd MMM' }}</td>
                <td><span class="status status-{{ i.status }}">{{ label(i.status) }}</span></td>
                <td class="actions">
                  @if (i.status === 'unpaid' || i.status === 'overdue') {
                    <button class="btn btn-sm" type="button" (click)="payByCard(i)">{{ 'Pay' | t }}</button>
                  }
                </td>
              </tr>
            } @empty { <tr><td colspan="6" class="muted">@if (summary()) { {{ 'No bills yet. Your first one arrives at the start of next month.' | t }} } @else { <app-skeleton kind="rows" /> }</td></tr> }
          </tbody>
        </table>
      </div>
    </section>

    <section class="card">
      <h2>{{ 'Payment history' | t }}</h2>
      <ul class="history">
        @for (p of payments(); track p.id) {
          <li>
            <span>{{ kind(p.kind) }}<br /><span class="muted">{{ p.created_at | date: 'd MMM y' }},
              {{ p.method === 'balance' ? 'from balance' : (p.card_brand + ' ' + p.card_last4) }}
              {{ p.method === 'autopay' ? '(autopay)' : '' }}</span></span>
            <strong>{{ p.amount | currency }}</strong>
          </li>
        } @empty { <li class="muted">@if (summary()) { {{ 'No payments yet.' | t }} } @else { <app-skeleton kind="rows" /> }</li> }
      </ul>
    </section>
    }

    <app-pay-dialog #payment [amount]="dialogAmount()" [description]="dialogText()" [title]="dialogTitle()"
                    [submitLabel]="dialogSubmit()" [doneLabel]="dialogDone()" [pay]="payWithCard" (paid)="afterPay()" />
  `,
})
export class Billing implements OnInit {
  private api = inject(ApiService);
  private payment = viewChild.required<PayDialog>('payment');
  summary = signal<BillingSummary | null>(null);
  invoices = signal<Invoice[]>([]);
  payments = signal<Payment[]>([]);
  error = signal('');
  loadError = signal('');
  notice = signal('');
  topUpError = signal('');
  busy = signal(''); // which action is running ('balance' or 'autopay'), so only that button spins
  amount: string | number = '';
  pending = signal<Pending | null>(null);

  label = (s: string) => t(STATUS[s] ?? s);
  kind = (k: string) => t(KIND[k] ?? k);

  dialogAmount = () => { const p = this.pending(); return p?.kind === 'invoice' ? p.invoice.amount : p?.kind === 'topup' ? p.amount : 0; };
  dialogText = () => { const p = this.pending(); return p?.kind === 'invoice' ? p.invoice.number : p?.kind === 'topup' ? 'Top up your balance' : 'Saved for automatic monthly payments'; };
  dialogTitle = () => this.pending()?.kind === 'autopay' ? 'Turn on autopay' : '';
  dialogSubmit = () => this.pending()?.kind === 'autopay' ? 'Save card and turn on' : '';
  dialogDone = () => this.pending()?.kind === 'autopay' ? 'Card saved' : 'Payment approved';

  ngOnInit() { this.load(); }

  load() {
    this.loadError.set('');
    forkJoin({ s: this.api.billing(), i: this.api.invoices(), p: this.api.payments() }).subscribe({
      next: r => { this.summary.set(r.s); this.invoices.set(r.i); this.payments.set(r.p); },
      error: e => this.loadError.set(errorText(e, t('Can’t load your bills.'))),
    });
  }

  private open(p: Pending) {
    this.notice.set('');
    this.error.set('');
    this.pending.set(p);
    this.payment().open();
  }

  payByCard(invoice: Invoice) { this.open({ kind: 'invoice', invoice }); }
  openAutopay() { this.open({ kind: 'autopay' }); }

  topUp() {
    const raw = String(this.amount ?? '').trim();
    const n = Number(raw);
    if (!raw || !(n >= 1 && n <= 500)) { this.topUpError.set(t('Enter an amount between 1 and 500')); return; }
    this.topUpError.set('');
    this.open({ kind: 'topup', amount: n });
  }

  /** What "paying" means depends on why the card window was opened. */
  payWithCard = (card: CardDetails): Observable<unknown> => {
    const p = this.pending()!;
    if (p.kind === 'invoice') return this.api.payInvoice(p.invoice.id, 'card', card);
    if (p.kind === 'topup') return this.api.topUp(p.amount, card);
    return this.api.setAutopay(true, card);
  };

  afterPay() {
    const p = this.pending();
    this.notice.set(p?.kind === 'invoice' ? `Paid ${p.invoice.number}. Thank you!`
      : p?.kind === 'topup' ? `Added $${p.amount.toFixed(2)} to your balance.` : 'Autopay is on.');
    this.amount = '';
    this.pending.set(null);
    this.load();
  }

  private run(action: Observable<unknown>, done: string, what: 'balance' | 'autopay') {
    this.busy.set(what);
    this.error.set('');
    this.notice.set('');
    action.subscribe({
      next: () => { this.notice.set(done); this.busy.set(''); this.load(); },
      error: e => { this.error.set(errorText(e)); this.busy.set(''); },
    });
  }

  payFromBalance(inv: Invoice) { this.run(this.api.payInvoice(inv.id, 'balance'), `Paid ${inv.number} from your balance.`, 'balance'); }
  setAutopay(on: boolean) { this.run(this.api.setAutopay(on), on ? 'Autopay is on.' : 'Autopay is off.', 'autopay'); }
}
