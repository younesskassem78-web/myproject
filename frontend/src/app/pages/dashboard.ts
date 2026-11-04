import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { TPipe, t } from '../core/i18n';
import { Component, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiService } from '../core/api.service';
import { errorText } from '../core/errors';
import { BillingSummary, DataPack, InstallStatus, Me, Usage } from '../core/models';
import { Icon } from '../shared/icon';
import { CardDetails, PayDialog } from './pay-dialog';
import { UsageChart } from './usage-chart';

/** yyyy-mm-dd for today + offset days (local time). */
const isoDay = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const INSTALL_STEPS: { key: InstallStatus; label: string }[] = [
  { key: 'scheduled', label: 'Booked' },
  { key: 'technician_assigned', label: 'Technician assigned' },
  { key: 'installed', label: 'Installed' },
];

@Component({
  selector: 'app-dashboard',
  imports: [TPipe, CurrencyPipe, DatePipe, DecimalPipe, FormsModule, RouterLink, UsageChart, Icon, PayDialog],
  template: `
    @if (loadError()) {
      <p class="error" role="alert">{{ loadError() }}</p>
    } @else if (me() && usage() && bill()) {
      @for (o of me()!.outages; track o.id) {
        <section class="banner banner-warn" role="status">
          <app-icon name="alert" />
          <div>
            <strong>{{ o.title }}</strong>
            <p>{{ o.message }} <span class="muted">{{ 'Updated {time}.' | t: { time: (o.updated_at | date: 'HH:mm') } }}</span></p>
          </div>
          <a routerLink="/status">{{ 'Network status' | t }}</a>
        </section>
      }

      @if (me()!.install_status && me()!.install_status !== 'installed') {
        <section class="card install">
          <h2>{{ 'Your installation' | t }}</h2>
          <ol class="steps">
            @for (s of steps; track s.key; let i = $index) {
              <li [class.done]="i <= installIndex()" [attr.aria-current]="i === installIndex() ? 'step' : null">{{ s.label | t }}</li>
            }
          </ol>
          @if (me()!.install_date) {
            <p>{{ 'Technician visit:' | t }} <strong>{{ me()!.install_date | date: 'EEEE d MMMM' }}</strong>{{ ', between 9:00 and 17:00.' | t }}</p>
            @if (!moving()) {
              @if (canMove()) {
                <button type="button" class="btn btn-ghost btn-sm" (click)="startMove()">{{ 'Change date' | t }}</button>
              } @else {
                <p class="hint">{{ (changesLeft() <= 0 ? 'You’ve changed this visit 3 times.' : 'The visit is less than 24 hours away.') | t }}
                  {{ 'To change it,' | t }} <a routerLink="/support">{{ 'open a support ticket' | t }}</a>.</p>
              }
            } @else {
              <form class="inline-form" (ngSubmit)="saveMove()">
                <label>{{ 'New date' | t }} <input type="date" name="newDate" [min]="minDate" [max]="maxDate" [(ngModel)]="newDate" /></label>
                <button class="btn btn-sm" type="submit" [disabled]="busy()">{{ (busy() ? 'Saving…' : 'Save') | t }}</button>
                <button class="link-btn" type="button" (click)="moving.set(false)">{{ 'Cancel' | t }}</button>
              </form>
              <p class="hint">{{ (changesLeft() === 1 ? 'You can change the date 1 more time.' : 'You can change the date {n} more times.') | t: { n: changesLeft() } }}</p>
            }
            @if (moveError()) { <p class="error" role="alert">{{ moveError() }}</p> }
            @if (moveNotice()) { <p class="notice" role="status">{{ moveNotice() }}</p> }
          }
        </section>
      }

      <section class="usage-hero">
        <p class="plan-line">{{ me()!.plan?.name }} &nbsp;/&nbsp; {{ '{n} Mbps' | t: { n: me()!.plan?.speed_mbps } }} &nbsp;/&nbsp;
          {{ me()!.plan?.price | currency: 'USD' : 'symbol' : '1.0-2' }}{{ '/month' | t }}</p>
        <h1>{{ '{used} GB of {limit} GB used' | t: { used: (usage()!.used_gb | number: '1.2-2'), limit: usage()!.limit_gb } }}</h1>
        <div class="fiber" role="progressbar" [attr.aria-label]="'Data used this month' | t"
             [attr.aria-valuenow]="percent()" aria-valuemin="0" aria-valuemax="100">
          <div class="fiber-light" [class.full]="percent() >= 100" [style.width.%]="percent()"></div>
        </div>
        <p class="muted">{{ '{left} GB left, resets on the 1st.' | t: { left: (left() | number: '1.2-2') } }}
          @if (usage()!.extra_gb) { {{ 'Includes {n} GB extra data bought this month.' | t: { n: usage()!.extra_gb } }} }</p>
        @if (!showPacks()) {
          <button type="button" class="btn btn-ghost btn-sm" [class.btn-amber]="percent() >= 80" (click)="openPacks()">{{ 'Add extra data' | t }}</button>
        } @else {
          <div class="packs" role="group" [attr.aria-label]="'Extra data packs' | t">
            <p class="muted">{{ 'Extra data for the rest of this month. Pay once, no change to your plan.' | t }}</p>
            <div class="pack-row">
              @for (p of packs(); track p.gb) {
                <button type="button" class="pack" (click)="choose(p)">
                  <strong>{{ '{n} GB' | t: { n: p.gb } }}</strong><span>{{ p.price | currency: 'USD' : 'symbol' : '1.0-2' }}</span>
                </button>
              } @empty { <span class="muted">{{ 'Loading…' | t }}</span> }
              <button type="button" class="link-btn" (click)="showPacks.set(false)">{{ 'Cancel' | t }}</button>
            </div>
          </div>
        }
        @if (packNotice()) { <p class="notice" role="status">{{ packNotice() }}</p> }
      </section>

      <div class="dash-grid">
        <section class="card">
          <h2>{{ 'Daily use' | t }}</h2>
          <app-usage-chart [days]="usage()!.days" />
        </section>

        <div class="side-cards">
          <section class="panel-dark">
            <h2>{{ 'Amount due' | t }}</h2>
            <p class="balance-amount">{{ bill()!.amount_due | currency }}</p>
            @if (bill()!.amount_due > 0 && bill()!.next_invoice; as inv) {
              <p [class.overdue-text]="inv.status === 'overdue'">
                {{ (inv.status === 'overdue' ? 'Overdue since {date}' : 'Due {date}') | t: { date: (inv.due_date | date: 'd MMMM') } }}
              </p>
              <a class="btn btn-amber" routerLink="/billing">{{ 'Pay now' | t }}</a>
            } @else {
              <p>{{ "You're all paid up." | t }}{{ bill()!.autopay ? ' ' + ('Autopay is on.' | t) : '' }}</p>
              <a class="btn btn-amber" routerLink="/billing">{{ 'View bills' | t }}</a>
            }
          </section>
          <nav class="quick card" [attr.aria-label]="'Quick actions' | t">
            <a routerLink="/speed-test"><app-icon name="gauge" /> {{ 'Test my speed' | t }}</a>
            <a routerLink="/support"><app-icon name="help" /> {{ 'Report a problem' | t }}</a>
            <a routerLink="/plan"><app-icon name="layers" /> {{ 'Change plan' | t }}</a>
          </nav>
        </div>
      </div>
    } @else {
      <div class="skeleton" aria-busy="true" [attr.aria-label]="'Loading your account' | t"></div>
    }
    <app-pay-dialog #packPay [amount]="chosen()?.price ?? 0" [description]="'{n} GB extra data, this month' | t: { n: chosen()?.gb ?? 0 }"
                    [title]="'Add extra data' | t" [doneLabel]="'Data added' | t" [pay]="payForPack" (paid)="afterPack()" />
  `,
})
export class Dashboard implements OnInit {
  private api = inject(ApiService);
  me = signal<Me | null>(null);
  usage = signal<Usage | null>(null);
  bill = signal<BillingSummary | null>(null);
  loadError = signal('');
  readonly steps = INSTALL_STEPS;

  percent = computed(() => {
    const u = this.usage();
    return u ? Math.min(100, Math.round((u.used_gb / u.limit_gb) * 100)) : 0;
  });
  left = computed(() => {
    const u = this.usage();
    return u ? Math.max(0, u.limit_gb - u.used_gb) : 0;
  });
  installIndex = computed(() => INSTALL_STEPS.findIndex(s => s.key === this.me()?.install_status));
  // installation visit: customers may move it while it's more than 24 h away, up to 3 times
  moving = signal(false);
  busy = signal(false);
  moveError = signal('');
  moveNotice = signal('');
  newDate = '';
  readonly minDate = isoDay(1);
  readonly maxDate = isoDay(60);
  changesLeft = computed(() => 3 - (this.me()?.install_reschedules ?? 0));
  canMove = computed(() => {
    const d = this.me()?.install_date;
    return !!d && d >= isoDay(2) && this.changesLeft() > 0;
  });
  startMove() {
    this.newDate = this.me()!.install_date!;
    this.moveError.set('');
    this.moveNotice.set('');
    this.moving.set(true);
  }
  saveMove() {
    if (!this.newDate) { this.moveError.set(t('Pick a date')); return; }
    this.busy.set(true);
    this.moveError.set('');
    this.api.rescheduleInstall(this.newDate).subscribe({
      next: r => {
        this.me.update(m => m && { ...m, install_date: r.install_date, install_reschedules: 3 - r.changes_left });
        this.moving.set(false);
        this.busy.set(false);
        this.moveNotice.set(t('Visit moved. We’ve sent you a confirmation.'));
      },
      error: e => { this.moveError.set(errorText(e)); this.busy.set(false); },
    });
  }

  packs = signal<DataPack[]>([]);
  showPacks = signal(false);
  chosen = signal<DataPack | null>(null);
  packNotice = signal('');
  private packPay = viewChild.required<PayDialog>('packPay');

  openPacks() {
    this.showPacks.set(true);
    this.packNotice.set('');
    if (!this.packs().length) this.api.dataPacks().subscribe({ next: p => this.packs.set(p), error: e => this.packNotice.set(errorText(e)) });
  }
  choose(p: DataPack) {
    this.chosen.set(p);
    this.packPay().open();
  }
  payForPack = (card: CardDetails) => this.api.buyDataPack(this.chosen()!.gb, card);
  afterPack() {
    this.showPacks.set(false);
    this.packNotice.set(t('{n} GB added. It lasts until the end of the month.', { n: this.chosen()!.gb }));
    this.api.usage().subscribe({ next: u => this.usage.set(u) });
  }

  ngOnInit() {
    forkJoin({ me: this.api.me(), usage: this.api.usage(), bill: this.api.billing() }).subscribe({
      next: r => { this.me.set(r.me); this.usage.set(r.usage); this.bill.set(r.bill); },
      error: e => this.loadError.set(errorText(e, t('Can’t load your account. Refresh to try again.'))),
    });
  }
}
