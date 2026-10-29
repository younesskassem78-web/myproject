import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';
import { ThemeService } from './core/theme.service';
import { Icon } from './shared/icon';
import { NotificationBell } from './shared/notification-bell';

interface NavItem { path: string; label: string; icon: string; exact?: boolean; }

const CUSTOMER_NAV: NavItem[] = [
  { path: '/dashboard', label: 'Overview', icon: 'home' },
  { path: '/billing', label: 'Billing', icon: 'bill' },
  { path: '/speed-test', label: 'Speed test', icon: 'gauge' },
  { path: '/support', label: 'Support', icon: 'help' },
  { path: '/plan', label: 'Plan', icon: 'layers' },
  { path: '/settings', label: 'Settings', icon: 'settings' },
];
const ADMIN_NAV: NavItem[] = [
  { path: '/admin', label: 'Overview', icon: 'home', exact: true },
  { path: '/admin/applications', label: 'Applications', icon: 'inbox' },
  { path: '/admin/customers', label: 'Customers', icon: 'users' },
  { path: '/admin/plans', label: 'Plans', icon: 'layers' },
  { path: '/admin/billing', label: 'Billing', icon: 'bill' },
  { path: '/admin/outages', label: 'Outages', icon: 'alert' },
  { path: '/admin/tickets', label: 'Tickets', icon: 'help' },
  { path: '/admin/audit', label: 'Audit log', icon: 'list' },
];

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, NotificationBell],
  template: `
    <a class="skip" href="#main">Skip to content</a>
    @if (showShell()) {
      <div class="shell">
        <aside class="sidebar" aria-label="Main">
          <a class="wordmark" [routerLink]="nav()[0].path">myterra</a>
          <nav>
            @for (item of nav(); track item.path) {
              <a [routerLink]="item.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: !!item.exact }">
                <app-icon [name]="item.icon" /><span>{{ item.label }}</span>
              </a>
            }
          </nav>
          <a class="side-status" routerLink="/status"><app-icon name="wifi" [size]="18" /> Network status</a>
        </aside>
        <div class="shell-main">
          <header class="topbar">
            <a class="wordmark mobile-only" [routerLink]="nav()[0].path">myterra</a>
            <span class="topbar-hello">Hi, {{ firstName() }}</span>
            <div class="topbar-actions">
              @if (auth.role() === 'customer') { <app-notification-bell /> }
              <button type="button" class="icon-btn" (click)="theme.toggle()"
                      [attr.aria-label]="theme.theme() === 'dark' ? 'Use light mode' : 'Use dark mode'">
                <app-icon [name]="theme.theme() === 'dark' ? 'sun' : 'moon'" />
              </button>
              <button type="button" class="icon-btn" (click)="auth.logout()" aria-label="Sign out">
                <app-icon name="logout" />
              </button>
            </div>
          </header>
          <main id="main" class="page" tabindex="-1"><router-outlet /></main>
        </div>
        <nav class="bottom-nav" aria-label="Main">
          @for (item of nav().slice(0, 4); track item.path) {
            <a [routerLink]="item.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: !!item.exact }"
               (click)="more.set(false)">
              <app-icon [name]="item.icon" /><span>{{ item.label }}</span>
            </a>
          }
          <button type="button" [class.active]="more()" (click)="more.set(!more())" [attr.aria-expanded]="more()">
            <app-icon name="list" /><span>More</span>
          </button>
          @if (more()) {
            <div class="more-sheet">
              @for (item of nav().slice(4); track item.path) {
                <a [routerLink]="item.path" routerLinkActive="active" (click)="more.set(false)">
                  <app-icon [name]="item.icon" /> {{ item.label }}</a>
              }
              <a routerLink="/status" (click)="more.set(false)"><app-icon name="wifi" /> Network status</a>
            </div>
          }
        </nav>
      </div>
    } @else {
      <main id="main" tabindex="-1"><router-outlet /></main>
    }
  `,
})
export class App {
  auth = inject(AuthService);
  theme = inject(ThemeService);
  private router = inject(Router);
  more = signal(false);

  nav() { return this.auth.role() === 'admin' ? ADMIN_NAV : CUSTOMER_NAV; }
  firstName() { return (this.auth.name() ?? '').split(' ')[0]; }

  // Public pages (sign in, apply, password reset, status) use their own full-page layout.
  showShell() {
    return !!this.auth.name() && !/^\/(login|apply|forgot|status)/.test(this.router.url);
  }
}
