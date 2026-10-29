import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { errorText } from '../../core/errors';
import { AuditEntry } from '../../core/models';

@Component({
  selector: 'app-admin-audit',
  imports: [DatePipe, FormsModule],
  template: `
    <div class="page-head">
      <h1>Audit log</h1>
      <input class="search" type="search" placeholder="Search admin, action or target" aria-label="Search" [(ngModel)]="query" />
    </div>
    <p class="muted lead">Every change an admin makes, newest first. Entries can't be edited or deleted.</p>
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    <div class="table-wrap">
      <table>
        <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>On</th></tr></thead>
        <tbody>
          @for (a of filtered(); track a.id) {
            <tr><td>{{ a.created_at | date: 'd MMM y, HH:mm' }}</td><td>{{ a.admin_email }}</td><td>{{ a.action }}</td><td>{{ a.target }}</td></tr>
          } @empty { <tr><td colspan="4" class="muted">Nothing logged yet.</td></tr> }
        </tbody>
      </table>
    </div>
  `,
})
export class AdminAudit implements OnInit {
  private api = inject(ApiService);
  entries = signal<AuditEntry[]>([]);
  error = signal('');
  query = '';

  filtered = () => {
    const q = this.query.trim().toLowerCase();
    return this.entries().filter(a => !q || [a.admin_email, a.action, a.target].some(f => f.toLowerCase().includes(q)));
  };

  ngOnInit() { this.api.adminAudit().subscribe({ next: a => this.entries.set(a), error: e => this.error.set(errorText(e)) }); }
}
