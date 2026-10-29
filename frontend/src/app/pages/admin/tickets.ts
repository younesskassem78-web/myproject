import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { errorText } from '../../core/errors';
import { AdminTicket, TicketStatus } from '../../core/models';
import { CATEGORY_LABEL, STATUS_LABEL } from '../support';

@Component({
  selector: 'app-admin-tickets',
  imports: [DatePipe, FormsModule, RouterLink],
  template: `
    <div class="page-head">
      <h1>Tickets</h1>
      <input class="search" type="search" placeholder="Search subject or customer" aria-label="Search" [(ngModel)]="query" />
    </div>
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    <div class="chips" role="group" aria-label="Filter by status">
      @for (f of filters; track f.value) {
        <button type="button" class="chip" [attr.aria-pressed]="status() === f.value" (click)="status.set(f.value)">
          {{ f.label }} <span>{{ count(f.value) }}</span>
        </button>
      }
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Ticket</th><th>Customer</th><th>Topic</th><th>Updated</th><th>Status</th></tr></thead>
        <tbody>
          @for (t of filtered(); track t.id) {
            <tr>
              <td><a [routerLink]="['/admin/tickets', t.id]"><strong>{{ t.subject }}</strong></a><br />
                <span class="muted">{{ t.replies }} {{ t.replies === 1 ? 'reply' : 'replies' }}</span></td>
              <td>{{ t.user_name }}<br /><span class="muted">{{ t.user_email }}</span></td>
              <td>{{ category(t) }}</td>
              <td>{{ t.updated_at | date: 'd MMM, HH:mm' }}</td>
              <td><span class="status status-{{ t.status }}">{{ statusLabel(t.status) }}</span></td>
            </tr>
          } @empty { <tr><td colspan="5" class="muted">No tickets here.</td></tr> }
        </tbody>
      </table>
    </div>
  `,
})
export class AdminTickets implements OnInit {
  private api = inject(ApiService);
  tickets = signal<AdminTicket[]>([]);
  status = signal<'' | 'active' | TicketStatus>('active');
  error = signal('');
  query = '';
  readonly filters: { value: '' | 'active' | TicketStatus; label: string }[] = [
    { value: 'active', label: 'Needs attention' }, { value: 'open', label: 'Open' },
    { value: 'in_progress', label: 'In progress' }, { value: 'resolved', label: 'Resolved' }, { value: '', label: 'All' },
  ];

  statusLabel = (s: TicketStatus) => STATUS_LABEL[s];
  category = (t: AdminTicket) => CATEGORY_LABEL[t.category];
  private byStatus = (t: AdminTicket, s: string) => !s || (s === 'active' ? t.status !== 'resolved' : t.status === s);
  count = (s: string) => this.tickets().filter(t => this.byStatus(t, s)).length;
  filtered = () => {
    const q = this.query.trim().toLowerCase();
    return this.tickets().filter(t => this.byStatus(t, this.status())
      && (!q || [t.subject, t.user_email, t.user_name].some(f => f.toLowerCase().includes(q))));
  };

  ngOnInit() {
    this.api.adminTickets().subscribe({ next: t => this.tickets.set(t), error: e => this.error.set(errorText(e)) });
  }
}
