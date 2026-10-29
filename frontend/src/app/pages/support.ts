import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiService } from '../core/api.service';
import { errorText } from '../core/errors';
import { Outage, SpeedResult, Ticket, TicketCategory, TicketStatus } from '../core/models';

export const STATUS_LABEL: Record<TicketStatus, string> = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' };
export const CATEGORY_LABEL: Record<TicketCategory, string> = {
  connection: 'Internet is slow or down', billing: 'Bills and payments', installation: 'Installation', other: 'Something else',
};

@Component({
  selector: 'app-support',
  imports: [FormsModule, DatePipe, DecimalPipe, RouterLink],
  template: `
    <h1>Support</h1>
    <div class="support-grid">
      <form class="card ticket-form" (ngSubmit)="send()">
        <h2>Report a problem</h2>
        <label>What's it about?
          <select name="category" [(ngModel)]="category">
            @for (c of categories; track c) { <option [value]="c">{{ categoryLabel(c) }}</option> }
          </select>
        </label>

        @if (category === 'connection') {
          <div class="troubleshoot">
            <p><strong>Before you send it, try these. They fix most problems:</strong></p>
            <ol>
              <li>
                @if (outages().length) {
                  <span class="warn-text">There's a known issue in your area: {{ outages()[0].title }}.</span>
                  We're on it, so you don't need to report it.
                } @else {
                  No known issues in your area right now.
                }
              </li>
              <li>Unplug your router, wait 30 seconds, plug it back in, then wait 2 minutes.</li>
              <li><a routerLink="/speed-test">Run a speed test</a> so we can see what you're getting.</li>
            </ol>
            @if (latestTest(); as t) {
              <label class="check">
                <input type="checkbox" name="attach" [(ngModel)]="attachTest" />
                <span>Attach my latest speed test ({{ t.download_mbps | number: '1.0-1' }} Mbps down,
                  {{ t.created_at | date: 'd MMM HH:mm' }})</span>
              </label>
            }
          </div>
        }

        <label>Short summary
          <input name="subject" maxlength="100" placeholder="My internet is slow in the evening" [(ngModel)]="subject" />
        </label>
        <label>Details
          <textarea name="message" rows="5" maxlength="1000" placeholder="When did it start? Which devices? Anything you've tried?"
                    [(ngModel)]="message"></textarea>
        </label>
        <p class="counter muted">{{ message.length }}/1000</p>
        @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        <button class="btn" type="submit" [disabled]="!canSend()">{{ pending() ? 'Sending…' : 'Send ticket' }}</button>
      </form>

      <section>
        <h2>Your tickets</h2>
        @for (t of tickets(); track t.id) {
          <a class="ticket" [routerLink]="['/support', t.id]">
            <div class="ticket-head">
              <h3>{{ t.subject }}</h3>
              <span class="status status-{{ t.status }}">{{ statusLabel(t.status) }}</span>
            </div>
            <p class="clamp">{{ t.message }}</p>
            <p class="muted">{{ categoryLabel(t.category) }}, updated {{ t.updated_at | date: 'd MMM y, HH:mm' }}</p>
          </a>
        } @empty {
          <p class="muted">No tickets yet. If something isn't working, tell us here.</p>
        }
      </section>
    </div>
  `,
})
export class Support implements OnInit {
  private api = inject(ApiService);
  private router = inject(Router);
  /** Speed test id passed from the speed test page ("Report slow speed"). */
  speed = input<string>();
  tickets = signal<Ticket[]>([]);
  outages = signal<Outage[]>([]);
  latestTest = signal<SpeedResult | null>(null);
  readonly categories = Object.keys(CATEGORY_LABEL) as TicketCategory[];
  category: TicketCategory = 'connection';
  subject = '';
  message = '';
  attachTest = false;
  pending = signal(false);
  error = signal('');

  statusLabel = (s: TicketStatus) => STATUS_LABEL[s];
  categoryLabel = (c: TicketCategory) => CATEGORY_LABEL[c];
  canSend = () => !!this.subject.trim() && !!this.message.trim() && !this.pending();

  ngOnInit() {
    forkJoin({ t: this.api.tickets(), me: this.api.me(), s: this.api.speedTests() }).subscribe({
      next: r => {
        this.tickets.set(r.t);
        this.outages.set(r.me.outages);
        const fromLink = r.s.results.find(x => x.id === this.speed());
        this.latestTest.set(fromLink ?? r.s.results[0] ?? null);
        if (fromLink) {
          this.attachTest = true;
          this.subject = 'My internet is slower than my plan';
        }
      },
      error: e => this.error.set(errorText(e, 'Can’t load your tickets. Refresh to try again.')),
    });
  }

  send() {
    if (!this.canSend()) return;
    this.pending.set(true);
    this.error.set('');
    const attach = this.category === 'connection' && this.attachTest ? this.latestTest()?.id : null;
    this.api.createTicket({ subject: this.subject.trim(), message: this.message.trim(), category: this.category,
      speed_test_id: attach }).subscribe({
      next: t => {
        this.tickets.update(list => [t, ...list]);
        this.subject = '';
        this.message = '';
        this.pending.set(false);
        this.router.navigate(['/support', t.id]);
      },
      error: e => {
        this.error.set(errorText(e, 'Your ticket wasn’t sent. Try again.'));
        this.pending.set(false);
      },
    });
  }
}
