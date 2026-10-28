import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ApiService } from '../core/api.service';
import { Me, Usage } from '../core/models';
import { UsageChart } from './usage-chart';

@Component({
  selector: 'app-dashboard',
  imports: [FormsModule, CurrencyPipe, DecimalPipe, UsageChart],
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
            <button class="btn btn-amber" type="submit" [disabled]="pending()">
              {{ pending() ? 'Topping up…' : 'Top up' }}
            </button>
          </form>
          <p class="fine">Demo only. No real payment is made.</p>
        </section>
      </div>
    } @else {
      <p class="muted">Loading your account…</p>
    }
  `,
})
export class Dashboard implements OnInit {
  private api = inject(ApiService);
  me = signal<Me | null>(null);
  usage = signal<Usage | null>(null);
  loadError = signal('');
  amount: string | number = '';
  pending = signal(false);
  topUpError = signal('');
  topUpDone = signal('');

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

  topUp() {
    if (this.pending()) return;
    this.topUpDone.set('');
    const raw = String(this.amount ?? '').trim();
    const n = Number(raw);
    if (!raw || !(n >= 1 && n <= 500)) {
      this.topUpError.set('Enter an amount between 1 and 500');
      return;
    }
    this.topUpError.set('');
    this.pending.set(true);
    this.api.topUp(n).subscribe({
      next: r => {
        this.me.update(m => m && { ...m, balance: r.balance });
        this.topUpDone.set(`Added $${n.toFixed(2)}`);
        this.amount = '';
        this.pending.set(false);
      },
      error: () => {
        this.topUpError.set('Top-up failed. Try again.');
        this.pending.set(false);
      },
    });
  }
}
