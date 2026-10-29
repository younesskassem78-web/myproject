import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, OnInit, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { errorText } from '../core/errors';
import { InvoiceDetail } from '../core/models';
import { Icon } from '../shared/icon';

/** A printable bill. */
@Component({
  selector: 'app-invoice',
  imports: [CurrencyPipe, DatePipe, RouterLink, Icon],
  template: `
    <div class="no-print row-actions page-actions">
      <a routerLink="/billing" class="back">Back to billing</a>
      <button class="btn btn-ghost" type="button" (click)="print()"><app-icon name="print" [size]="18" /> Print or save as PDF</button>
    </div>
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    @if (inv(); as i) {
      <article class="invoice card">
        <header>
          <div>
            <p class="wordmark">myterra</p>
            <p class="muted">MyTerra Internet<br />support&#64;myterra.app</p>
          </div>
          <div class="invoice-meta">
            <h1>Invoice</h1>
            <p>{{ i.number }}</p>
            <span class="status status-{{ i.status }}">{{ i.status === 'paid' ? 'Paid' : i.status === 'overdue' ? 'Overdue' : 'Unpaid' }}</span>
          </div>
        </header>
        <div class="invoice-parties">
          <div><h2>Billed to</h2>
            <p>{{ i.customer.name }}<br />{{ i.customer.email }}
              @if (i.customer.phone) { <br />{{ i.customer.phone }} }
              @if (i.customer.address) { <br />{{ i.customer.address }} }</p></div>
          <div><h2>Dates</h2>
            <p>Issued {{ i.issued_at | date: 'd MMMM y' }}<br />Due {{ i.due_date | date: 'd MMMM y' }}
              @if (i.paid_at) { <br />Paid {{ i.paid_at | date: 'd MMMM y' }} }</p></div>
        </div>
        <table>
          <thead><tr><th>Description</th><th class="num">Amount</th></tr></thead>
          <tbody><tr><td>{{ i.plan_name }}, {{ i.period | date: 'MMMM y' }}</td><td class="num">{{ i.amount | currency }}</td></tr></tbody>
          <tfoot><tr><th>Total</th><th class="num">{{ i.amount | currency }}</th></tr></tfoot>
        </table>
        @for (p of i.payments; track p.id) {
          <p class="muted">Payment of {{ p.amount | currency }} on {{ p.created_at | date: 'd MMM y' }},
            {{ p.method === 'balance' ? 'from account balance' : p.card_brand + ' ending ' + p.card_last4 }}.</p>
        }
      </article>
    }
  `,
})
export class InvoicePage implements OnInit {
  private api = inject(ApiService);
  id = input.required<string>();
  inv = signal<InvoiceDetail | null>(null);
  error = signal('');

  ngOnInit() {
    this.api.invoice(this.id()).subscribe({
      next: i => this.inv.set(i),
      error: e => this.error.set(errorText(e, 'We couldn’t find this bill.')),
    });
  }

  print() { window.print(); }
}
