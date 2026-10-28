import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ApiService } from '../core/api.service';
import { Me, Usage } from '../core/models';
import { PayDialog } from './pay-dialog';
import { UsageChart } from './usage-chart';

@Component({
  selector: 'app-dashboard',
  imports: [FormsModule, CurrencyPipe, DecimalPipe, UsageChart, PayDialog],
  template: `
    @if (loadError()) {
      <p class="error" role="alert">{{ loadError() }}</p>
    } @else if (me() && usage()) {
      <section class="usage-hero">
        <p class="plan-line">{{ me()!.plan?.name }} &nbsp;/&nbsp; {{ me()!.plan?.price | currency: 'USD' : 'symbol' : '1.0-2' }}/month</p>
        <h1>{{ usage()!.used_gb | number: '1.2-2' }} GB of {{ usage()!.limit_gb }} GB used</h1>
        <div class="fiber" role="progressbar" aria-label="Data used this month"
             [attr.aria-valuenow]="percent()" aria-valuemin="0" aria-valuemax="100">
          <div class="fiber-light" [style.width.%]="percent()"></div>
        </div>
        <p class="muted">{{ left() | number: '1.2-2' }} GB left this month</p>
      </section>

      <div class="dash-grid">
        <section>
          <h2>Daily use</h2>
          <app-usage-chart [days]="usage()!.days" />
        </section>

        <section class="balance">
          <h2>Balance</h2>
          <p class="balance-amount">{{ me()!.balance | currency }}</p>
          <form (ngSubmit)="topUp()">
            <label>Top up amount ($)
              <input name="amount" inputmode="decimal" placeholder="10" [(ngModel)]="amount" />
            </label>
            @if (topUpError()) { <p class="error on-dark" role="alert">{{ topUpError() }}</p> }
            @if (topUpDone()) { <p class="ok" role="status">{{ topUpDone() }}</p> }
            <button class="btn btn-amber" type="submit">Top up</button>
          </form>
          <p class="fine">You pay by card in the next step. Demo only, nothing is charged.</p>
        </section>
      </div>
    } @else {
      <p class="muted">Loading your account…</p>
    }
    <app-pay-dialog #payment [amount]="topUpAmount()" description="Top up your MyTerra balance"
                    [pay]="payTopUp" (paid)="onTopUpPaid($any($event))" />
  `,
})
export class Dashboard implements OnInit {
  private api = inject(ApiService);
  me = signal<Me | null>(null);
  usage = signal<Usage | null>(null);
  loadError = signal('');
  amount: string | number = '';
  topUpAmount = signal(0);
  topUpError = signal('');
  topUpDone = signal('');
  private payment = viewChild.required<PayDialog>('payment');

  percent = computed(() => {
    const u = this.usage();
    return u ? Math.min(100, Math.round((u.used_gb / u.limit_gb) * 100)) : 0;
  });
  left = computed(() => {
    const u = this.usage();
    return u ? Math.max(0, u.limit_gb - u.used_gb) : 0;
  });

  ngOnInit() {
    forkJoin({ me: this.api.me(), usage: this.api.usage() }).subscribe({
      next: r => { this.me.set(r.me); this.usage.set(r.usage); },
      error: () => this.loadError.set('Can’t load your account. Make sure the backend is running, then refresh.'),
    });
  }

  /** Checks the amount, then opens the card window. */
  topUp() {
    this.topUpDone.set('');
    const raw = String(this.amount ?? '').trim();
    const n = Number(raw);
    if (!raw || !(n >= 1 && n <= 500)) {
      this.topUpError.set('Enter an amount between 1 and 500');
      return;
    }
    this.topUpError.set('');
    this.topUpAmount.set(n);
    this.payment().open();
  }

  payTopUp = () => this.api.topUp(this.topUpAmount());

  onTopUpPaid(r: { balance: number }) {
    this.me.update(m => m && { ...m, balance: r.balance });
    this.topUpDone.set(`Added $${this.topUpAmount().toFixed(2)}`);
    this.amount = '';
  }
}
