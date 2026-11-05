import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { errorText } from '../../core/errors';
import { AuditEntry } from '../../core/models';
import { LoadError, Skeleton } from '../../shared/loading';

@Component({
  selector: 'app-admin-audit',
  imports: [DatePipe, FormsModule, LoadError, Skeleton],
  template: `
    <div class="page-head">
      <h1>Audit log</h1>
      <p class="muted lead">Every change an admin makes, newest first. Entries can't be edited or deleted.</p>
      <input class="search" type="search" placeholder="Search admin, action or target" aria-label="Search" [(ngModel)]="query" />
    </div>
    @if (error() && loaded()) { <p class="error" role="alert">{{ error() }}</p> }
    <div class="table-wrap" tabindex="0" role="region" aria-label="Scrollable table">
      <table>
        <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>On</th></tr></thead>
        <tbody>
          @for (a of filtered(); track a.id) {
            <tr><td>{{ a.created_at | date: 'd MMM y, HH:mm' }}</td><td>{{ a.admin_email }}</td><td>{{ a.action }}</td><td>{{ a.target }}</td></tr>
          } @empty { <tr><td colspan="4" class="muted">@if (loaded()) { Nothing logged yet. } @else if (error()) { <app-load-error [message]="error()" (retry)="error.set(''); load()" /> } @else { <app-skeleton kind="rows" /> }</td></tr> }
        </tbody>
      </table>
    </div>
  `,
})
export class AdminAudit implements OnInit {
  private api = inject(ApiService);
  entries = signal<AuditEntry[]>([]);
  loaded = signal(false); // lists say "Loading…", not "nothing here", until the data arrives
  error = signal('');
  query = '';

  filtered = () => {
    const q = this.query.trim().toLowerCase();
    return this.entries().filter(a => !q || [a.admin_email, a.action, a.target].some(f => f.toLowerCase().includes(q)));
  };

  ngOnInit() { this.load(); }
  load() { this.api.adminAudit().subscribe({ next: a => { this.entries.set(a); this.loaded.set(true); }, error: e => this.error.set(errorText(e)) }); }
}
