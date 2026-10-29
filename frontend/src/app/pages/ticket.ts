import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { ApiService } from '../core/api.service';
import { errorText } from '../core/errors';
import { TicketDetail, TicketStatus } from '../core/models';
import { CATEGORY_LABEL, STATUS_LABEL } from './support';

/** One ticket's conversation. Used by customers (/support/:id) and staff (/admin/tickets/:id). */
@Component({
  selector: 'app-ticket',
  imports: [DatePipe, DecimalPipe, FormsModule, RouterLink],
  template: `
    <a class="back" [routerLink]="staff() ? '/admin/tickets' : '/support'">Back to tickets</a>
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    @if (t(); as t) {
      <div class="ticket-page">
        <header class="ticket-title">
          <div>
            <h1>{{ t.subject }}</h1>
            <p class="muted">{{ category(t) }}, opened {{ t.created_at | date: 'd MMM y, HH:mm' }}
              @if (staff()) { by {{ t.user_name }} ({{ t.user_email }}) }</p>
          </div>
          @if (staff()) {
            <label class="inline-label">Status
              <select [ngModel]="t.status" (ngModelChange)="setStatus($event)">
                <option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option>
              </select>
            </label>
          } @else {
            <span class="status status-{{ t.status }}">{{ statusLabel(t.status) }}</span>
          }
        </header>

        @if (t.speed_test; as s) {
          <p class="attached">Speed test attached: {{ s.download_mbps | number: '1.0-1' }} Mbps down,
            {{ s.upload_mbps | number: '1.0-1' }} Mbps up, {{ s.ping_ms | number: '1.0-0' }} ms ping
            ({{ s.created_at | date: 'd MMM HH:mm' }})</p>
        }

        <ol class="thread">
          <li class="msg mine-{{ !staff() }}">
            <p class="msg-who">{{ staff() ? t.user_name : 'You' }} <span class="muted">{{ t.created_at | date: 'd MMM, HH:mm' }}</span></p>
            <p class="msg-body">{{ t.message }}</p>
          </li>
          @for (m of t.messages; track m.id) {
            <li class="msg" [class.staff]="m.from_staff" [class.mine-true]="m.from_staff === staff()">
              <p class="msg-who">{{ m.from_staff ? (staff() ? 'Support (you)' : 'MyTerra Support') : (staff() ? m.author_name : 'You') }}
                <span class="muted">{{ m.created_at | date: 'd MMM, HH:mm' }}</span></p>
              <p class="msg-body">{{ m.body }}</p>
            </li>
          }
        </ol>

        <form class="card reply" (ngSubmit)="send()">
          <label>{{ staff() ? 'Reply to the customer' : (t.status === 'resolved' ? 'Still having the problem? Reply to reopen' : 'Add a reply') }}
            <textarea name="reply" rows="4" maxlength="2000" [(ngModel)]="reply"></textarea>
          </label>
          @if (sendError()) { <p class="error" role="alert">{{ sendError() }}</p> }
          <button class="btn" type="submit" [disabled]="!reply.trim() || pending()">{{ pending() ? 'Sending…' : 'Send reply' }}</button>
        </form>
      </div>
    }
  `,
})
export class TicketPage implements OnInit {
  private api = inject(ApiService);
  id = input.required<string>();
  staff = input(false);
  t = signal<TicketDetail | null>(null);
  error = signal('');
  sendError = signal('');
  pending = signal(false);
  reply = '';

  statusLabel = (s: TicketStatus) => STATUS_LABEL[s];
  category = (t: TicketDetail) => CATEGORY_LABEL[t.category];

  ngOnInit() { this.load(); }

  load() {
    const req = this.staff() ? this.api.adminTicket(this.id()) : this.api.ticket(this.id());
    req.subscribe({ next: t => this.t.set(t), error: e => this.error.set(errorText(e, 'We couldn’t find this ticket.')) });
  }

  send() {
    const body = this.reply.trim();
    if (!body || this.pending()) return;
    this.pending.set(true);
    this.sendError.set('');
    const req: Observable<unknown> = this.staff() ? this.api.staffReply(this.id(), body) : this.api.replyTicket(this.id(), body);
    req.subscribe({
      next: () => { this.reply = ''; this.pending.set(false); this.load(); },
      error: e => { this.sendError.set(errorText(e, 'Your reply wasn’t sent. Try again.')); this.pending.set(false); },
    });
  }

  setStatus(status: TicketStatus) {
    this.api.setTicketStatus(this.id(), status).subscribe({
      next: () => this.load(),
      error: e => this.sendError.set(errorText(e)),
    });
  }
}
