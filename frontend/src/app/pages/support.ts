import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { Ticket, TicketStatus } from '../core/models';

const STATUS: Record<TicketStatus, string> = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' };

@Component({
  selector: 'app-support',
  imports: [FormsModule, DatePipe],
  template: `
    <h1>Support</h1>
    <div class="support-grid">
      <form class="ticket-form" (ngSubmit)="send()">
        <h2>Report a problem</h2>
        <label>What’s wrong?
          <input name="subject" maxlength="100" placeholder="My internet is slow" [(ngModel)]="subject" />
        </label>
        <label>Tell us more
          <textarea name="message" rows="5" maxlength="1000"
                    placeholder="When did it start? Which devices?" [(ngModel)]="message"></textarea>
        </label>
        <p class="counter muted">{{ message.length }}/1000</p>
        @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        <button class="btn" type="submit" [disabled]="!canSend()">{{ pending() ? 'Sending…' : 'Send ticket' }}</button>
      </form>

      <section>
        <h2>Your tickets</h2>
        @for (t of tickets(); track t.id) {
          <article class="ticket">
            <div class="ticket-head">
              <h3>{{ t.subject }}</h3>
              <span class="status status-{{ t.status }}">{{ statusLabel(t.status) }}</span>
            </div>
            <p>{{ t.message }}</p>
            <p class="muted">Sent {{ t.created_at | date: 'd MMM y, HH:mm' }}</p>
          </article>
        } @empty {
          <p class="muted">No tickets yet. If something isn’t working, tell us here.</p>
        }
      </section>
    </div>
  `,
})
export class Support implements OnInit {
  private api = inject(ApiService);
  tickets = signal<Ticket[]>([]);
  subject = '';
  message = '';
  pending = signal(false);
  error = signal('');

  statusLabel = (s: TicketStatus) => STATUS[s];
  canSend = () => !!this.subject.trim() && !!this.message.trim() && !this.pending();

  ngOnInit() {
    this.api.tickets().subscribe({
      next: t => this.tickets.set(t),
      error: () => this.error.set('Can’t load your tickets. Make sure the backend is running.'),
    });
  }

  send() {
    if (!this.canSend()) return;
    this.pending.set(true);
    this.error.set('');
    this.api.createTicket(this.subject.trim(), this.message.trim()).subscribe({
      next: t => {
        this.tickets.update(list => [t, ...list]);
        this.subject = '';
        this.message = '';
        this.pending.set(false);
      },
      error: () => {
        this.error.set('Your ticket wasn’t sent. Try again.');
        this.pending.set(false);
      },
    });
  }
}
