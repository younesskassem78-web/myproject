import { CurrencyPipe } from '@angular/common';
import { TPipe, t } from '../core/i18n';
import { Component, OnInit, inject, signal } from '@angular/core';
import { forkJoin } from 'rxjs';
import { ApiService } from '../core/api.service';
import { errorText } from '../core/errors';
import { Plan } from '../core/models';
import { LoadError, Skeleton } from '../shared/loading';

@Component({
  selector: 'app-plan',
  imports: [TPipe, CurrencyPipe, LoadError, Skeleton],
  template: `
    <h1>{{ 'Your plan' | t }}</h1>
    <p class="muted lead">{{ 'Switch any time. The change starts today and your next bill uses the new price.' | t }}</p>
    @if (notice()) { <p class="notice" role="status">{{ notice() }}</p> }
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    <div class="plan-grid">
      @for (p of plans(); track p.id) {
        <section class="card plan-card" [class.current]="p.id === currentId()">
          @if (p.id === currentId()) { <span class="plan-badge">{{ (p.active ? 'Your plan' : 'Your plan, no longer sold') | t }}</span> }
          <h2>{{ p.name }}</h2>
          <p class="plan-price">{{ p.price | currency: 'USD' : 'symbol' : '1.0-2' }}<span>{{ '/month' | t }}</span></p>
          <ul>
            <li><strong>{{ p.speed_mbps >= 1000 ? (p.speed_mbps / 1000) + ' Gbps' : p.speed_mbps + ' Mbps' }}</strong> {{ 'download speed' | t }}</li>
            <li><strong>{{ p.data_gb >= 1000 ? 'Unlimited' : p.data_gb + ' GB' }}</strong> {{ 'data a month' | t }}</li>
            <li>{{ 'Free router and installation' | t }}</li>
          </ul>
          @if (p.id !== currentId()) {
            <button class="btn" [class.btn-ghost]="p.price < currentPrice()" type="button" (click)="choose(p)" [disabled]="busy()" [class.loading]="picked() === p.id">
              {{ (p.price > currentPrice() ? 'Upgrade' : 'Switch') | t }} ({{ diff(p) }})
            </button>
          }
        </section>
      } @empty {
        @if (loadError()) { <app-load-error [message]="loadError()" (retry)="load()" />
        } @else { @for (i of [1, 2, 3]; track i) { <app-skeleton kind="detail" /> } }
      }
    </div>
  `,
})
export class PlanPage implements OnInit {
  private api = inject(ApiService);
  plans = signal<Plan[]>([]);
  currentId = signal<string | null>(null);
  currentPrice = signal(0);
  notice = signal('');
  error = signal('');
  busy = signal(false);
  picked = signal('');
  loadError = signal('');

  ngOnInit() { this.load(); }
  load() {
    this.loadError.set('');
    forkJoin({ plans: this.api.plans(), me: this.api.me() }).subscribe({
      next: r => {
        // A plan that's no longer sold still belongs on this page for the people on it.
        const mine = r.me.plan;
        this.plans.set(mine && !r.plans.some(p => p.id === mine.id) ? [mine, ...r.plans] : r.plans);
        this.currentId.set(r.me.plan?.id ?? null);
        this.currentPrice.set(r.me.plan?.price ?? 0);
      },
      error: e => this.loadError.set(errorText(e, t('Can’t load the plans.'))),
    });
  }

  diff(p: Plan) {
    const d = p.price - this.currentPrice();
    return `${d > 0 ? '+' : '−'}$${Math.abs(d).toFixed(2)}/month`;
  }

  choose(p: Plan) {
    if (!confirm(`Switch to ${p.name} for $${p.price.toFixed(2)} a month?`)) return;
    this.busy.set(true);
    this.picked.set(p.id);
    this.error.set('');
    this.api.changePlan(p.id).subscribe({
      next: () => {
        this.currentId.set(p.id);
        this.currentPrice.set(p.price);
        this.notice.set(`You're now on ${p.name}.`);
        this.busy.set(false);
        this.picked.set('');
      },
      error: e => { this.error.set(errorText(e)); this.busy.set(false); this.picked.set(''); },
    });
  }
}
