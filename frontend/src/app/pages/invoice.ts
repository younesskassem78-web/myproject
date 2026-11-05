import { CurrencyPipe, DatePipe } from '@angular/common';
import { TPipe, t } from '../core/i18n';
import { Component, OnInit, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { errorText } from '../core/errors';
import { InvoiceDetail } from '../core/models';
import { Icon } from '../shared/icon';
import { LoadError, Skeleton } from '../shared/loading';

/** A printable bill. */
@Component({
  selector: 'app-invoice',
  imports: [TPipe, CurrencyPipe, DatePipe, RouterLink, Icon, LoadError, Skeleton],
  template: `
    <div class="no-print row-actions page-actions">
      <a routerLink="/billing" class="back">{{ 'Back to billing' | t }}</a>
      <button class="btn btn-ghost" type="button" (click)="print()"><app-icon name="print" [size]="18" /> {{ 'Print or save as PDF' | t }}</button>
    </div>
    @if (error()) { <app-load-error [message]="error()" (retry)="load()" /> }
    @if (inv(); as i) {
      <article class="invoice card">
        <header>
          <div>
            <p class="wordmark">{{ 'myterra' | t }}</p>
            <p class="muted">{{ 'MyTerra Internet' | t }}<br />{{ 'support&#64;myterra.app' | t }}</p>
          </div>
          <div class="invoice-meta">
            <h1>{{ 'Invoice' | t }}</h1>
            <p>{{ i.number }}</p>
            <span class="status status-{{ i.status }}">{{ (i.status === 'paid' ? 'Paid' : i.status === 'overdue' ? 'Overdue' : 'Unpaid') | t }}</span>
          </div>
        </header>
        <div class="invoice-parties">
          <div><h2>{{ 'Billed to' | t }}</h2>
            <p>{{ i.customer.name }}<br />{{ i.customer.email }}
              @if (i.customer.phone) { <br />{{ i.customer.phone }} }
              @if (i.customer.address) { <br />{{ i.customer.address }} }</p></div>
          <div><h2>{{ 'Dates' | t }}</h2>
            <p>{{ 'Issued {date}' | t: { date: (i.issued_at | date: 'd MMMM y') } }}<br />{{ 'Due {date}' | t: { date: (i.due_date | date: 'd MMMM y') } }}
              @if (i.paid_at) { <br />{{ 'Paid {date}' | t: { date: (i.paid_at | date: 'd MMMM y') } }} }</p></div>
        </div>
        <table>
          <thead><tr><th>{{ 'Description' | t }}</th><th class="num">{{ 'Amount' | t }}</th></tr></thead>
          <tbody><tr><td>{{ i.plan_name }}, {{ i.period | date: 'MMMM y' }}</td><td class="num">{{ i.amount | currency }}</td></tr></tbody>
          <tfoot><tr><th>{{ 'Total' | t }}</th><th class="num">{{ i.amount | currency }}</th></tr></tfoot>
        </table>
        @for (p of i.payments; track p.id) {
          <p class="muted">{{ 'Payment of {amount} on {date}, {how}.' | t: { amount: (p.amount | currency), date: (p.created_at | date: 'd MMM y'),
            how: p.method === 'balance' ? ('from account balance' | t) : ('{brand} ending {last4}' | t: { brand: p.card_brand, last4: p.card_last4 }) } }}</p>
        }
      </article>
    } @else if (!error()) {
      <app-skeleton kind="detail" />
    }
  `,
})
export class InvoicePage implements OnInit {
  private api = inject(ApiService);
  id = input.required<string>();
  inv = signal<InvoiceDetail | null>(null);
  error = signal('');

  ngOnInit() { this.load(); }
  load() {
    this.error.set('');
    this.api.invoice(this.id()).subscribe({
      next: i => this.inv.set(i),
      error: e => this.error.set(errorText(e, t('We couldn’t find this bill.'))),
    });
  }

  print() { window.print(); }
}
