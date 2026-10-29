import { DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { Notification } from '../core/models';
import { Icon } from './icon';

const REFRESH_MS = 60_000;

/** Bell with unread count. Opening it marks everything read. */
@Component({
  selector: 'app-notification-bell',
  imports: [DatePipe, Icon],
  host: { '(document:keydown.escape)': 'open.set(false)' },
  template: `
    <div class="bell">
      <button type="button" class="icon-btn" (click)="toggle()" [attr.aria-expanded]="open()"
              [attr.aria-label]="unread() ? 'Notifications, ' + unread() + ' unread' : 'Notifications'">
        <app-icon name="bell" />
        @if (unread()) { <span class="bell-count" aria-hidden="true">{{ unread() > 9 ? '9+' : unread() }}</span> }
      </button>
      @if (open()) {
        <div class="bell-panel" role="dialog" aria-label="Notifications">
          <div class="bell-head"><strong>Notifications</strong></div>
          @for (n of items(); track n.id) {
            <button type="button" class="bell-item" [class.unseen]="unseen().has(n.id)" (click)="go(n)">
              <span class="bell-title">{{ n.title }}</span>
              <span class="bell-body">{{ n.body }}</span>
              <span class="bell-time">{{ n.created_at | date: 'd MMM, HH:mm' }}</span>
            </button>
          } @empty {
            <p class="bell-empty">You're all caught up.</p>
          }
        </div>
      }
    </div>
  `,
})
export class NotificationBell {
  private api = inject(ApiService);
  private router = inject(Router);
  items = signal<Notification[]>([]);
  unread = signal(0);
  open = signal(false);
  unseen = signal(new Set<string>());

  constructor() {
    this.load();
    const timer = setInterval(() => this.load(), REFRESH_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  load() {
    this.api.notifications().subscribe({
      next: r => { this.items.set(r.items); this.unread.set(r.unread); },
      error: () => {},  // the bell is optional; the page still works without it
    });
  }

  toggle() {
    const opening = !this.open();
    this.open.set(opening);
    if (!opening) return;
    // Fetch on open so something that just happened (a payment, a reply) shows straight away.
    this.api.notifications().subscribe({
      next: r => {
        this.items.set(r.items);
        // Keep the "new" highlight while the panel is open, but tell the server they've been seen.
        this.unseen.set(new Set(r.items.filter(n => !n.read_at).map(n => n.id)));
        this.unread.set(0);
        if (r.unread) this.api.readNotifications().subscribe({ error: () => {} });
      },
      error: () => {},
    });
  }

  go(n: Notification) {
    this.open.set(false);
    if (n.link) this.router.navigateByUrl(n.link);
  }
}
