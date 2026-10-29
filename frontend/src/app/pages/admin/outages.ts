import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { errorText } from '../../core/errors';
import { Outage, OutageStatus } from '../../core/models';
import { OUTAGE_LABEL } from '../status';

@Component({
  selector: 'app-admin-outages',
  imports: [DatePipe, FormsModule],
  template: `
    <h1>Outages</h1>
    <p class="muted lead">Customers in the city get a notification and an email when you open, update or resolve an outage. It also shows on the public status page.</p>
    @if (notice()) { <p class="notice" role="status">{{ notice() }}</p> }
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }

    <form class="card inline-form" (ngSubmit)="open()">
      <h2>Report an outage</h2>
      <label>City <input name="city" placeholder="Beirut" [(ngModel)]="form.city" /></label>
      <label class="wide">What's happening <input name="title" placeholder="No internet in Hamra" [(ngModel)]="form.title" /></label>
      <label class="full">Message for customers
        <textarea name="message" rows="2" placeholder="A power cut hit our street cabinet. Engineers are on the way." [(ngModel)]="form.message"></textarea>
      </label>
      <button class="btn btn-sm" type="submit" [disabled]="busy()">Notify customers</button>
    </form>

    @for (o of outages(); track o.id) {
      <article class="card outage" [class.resolved]="o.status === 'resolved'">
        <div class="ticket-head">
          <h2>{{ o.city }}: {{ o.title }}</h2>
          <span class="status status-outage-{{ o.status }}">{{ label(o.status) }}</span>
        </div>
        <p>{{ o.message }}</p>
        <p class="muted">Started {{ o.started_at | date: 'd MMM, HH:mm' }}{{ o.resolved_at
          ? ', resolved ' + (o.resolved_at | date: 'd MMM, HH:mm') : ', updated ' + (o.updated_at | date: 'HH:mm') }}</p>
        @if (o.status !== 'resolved') {
          <div class="inline-form outage-update">
            <label>New status
              <select [(ngModel)]="drafts[o.id].status" [name]="'s' + o.id">
                <option value="investigating">Investigating</option><option value="identified">Cause found, fixing</option>
                <option value="monitoring">Fixed, monitoring</option><option value="resolved">Resolved</option>
              </select>
            </label>
            <label class="wide">Update message <input [(ngModel)]="drafts[o.id].message" [name]="'m' + o.id" placeholder="Optional" /></label>
            <button class="btn btn-sm" type="button" (click)="update(o)" [disabled]="busy()">Send update</button>
          </div>
        }
      </article>
    } @empty { <p class="muted">No outages recorded.</p> }
  `,
})
export class AdminOutages implements OnInit {
  private api = inject(ApiService);
  outages = signal<Outage[]>([]);
  drafts: Record<string, { status: OutageStatus; message: string }> = {};
  form = { city: '', title: '', message: '' };
  busy = signal(false);
  notice = signal('');
  error = signal('');
  label = (s: OutageStatus) => OUTAGE_LABEL[s];

  ngOnInit() { this.load(); }

  load() {
    this.api.adminOutages().subscribe({
      next: list => {
        this.drafts = Object.fromEntries(list.map(o => [o.id, { status: o.status, message: '' }]));
        this.outages.set(list);
      },
      error: e => this.error.set(errorText(e)),
    });
  }

  private run(action: Observable<unknown>, done: string, after?: () => void) {
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    action.subscribe({
      next: () => { this.notice.set(done); after?.(); this.busy.set(false); this.load(); },
      error: e => { this.error.set(errorText(e, 'Fill in the city, what\'s happening and the message.')); this.busy.set(false); },
    });
  }

  open() {
    const f = { city: this.form.city.trim(), title: this.form.title.trim(), message: this.form.message.trim() };
    if (!f.city || !f.title || !f.message) { this.error.set('Fill in the city, what\'s happening and the message.'); return; }
    this.run(this.api.openOutage(f), `Customers in ${f.city} have been notified.`, () => (this.form = { city: '', title: '', message: '' }));
  }

  update(o: Outage) {
    const d = this.drafts[o.id];
    this.run(this.api.updateOutage(o.id, { status: d.status, message: d.message.trim() || undefined }),
      d.status === 'resolved' ? `Marked resolved. ${o.city} customers have been told.` : `Update sent to ${o.city} customers.`);
  }
}
