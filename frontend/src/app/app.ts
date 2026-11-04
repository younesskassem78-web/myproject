import { Component, inject, signal } from '@angular/core';
import { LangSwitch } from './shared/lang-switch';
import { TPipe } from './core/i18n';
import { Meta } from '@angular/platform-browser';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from './core/auth.service';
import { StaffArea, canSee } from './core/permissions';
import { ThemeService } from './core/theme.service';
import { Icon } from './shared/icon';
import { NotificationBell } from './shared/notification-bell';

interface NavItem { path: string; label: string; icon: string; exact?: boolean; area?: StaffArea; }

const CUSTOMER_NAV: NavItem[] = [
  { path: '/dashboard', label: 'Overview', icon: 'home' },
  { path: '/billing', label: 'Billing', icon: 'bill' },
  { path: '/speed-test', label: 'Speed test', icon: 'gauge' },
  { path: '/support', label: 'Support', icon: 'help' },
  { path: '/plan', label: 'Plan', icon: 'layers' },
  { path: '/settings', label: 'Settings', icon: 'settings' },
];
const PUBLIC_PAGE = /^\/(login|apply|status)?([?#]|$)/;

const ADMIN_NAV: NavItem[] = [
  { path: '/admin', label: 'Overview', icon: 'home', exact: true, area: 'overview' },
  { path: '/admin/applications', label: 'Applications', icon: 'inbox', area: 'applications' },
  { path: '/admin/customers', label: 'Customers', icon: 'users', area: 'customers' },
  { path: '/admin/plans', label: 'Plans', icon: 'layers', area: 'plans' },
  { path: '/admin/billing', label: 'Billing', icon: 'bill', area: 'billing' },
  { path: '/admin/outages', label: 'Outages', icon: 'alert', area: 'outages' },
  { path: '/admin/tickets', label: 'Tickets', icon: 'help', area: 'tickets' },
  { path: '/admin/reports', label: 'Reports', icon: 'chart', area: 'reports' },
  { path: '/admin/audit', label: 'Audit log', icon: 'list', area: 'audit' },
  { path: '/admin/account', label: 'My account', icon: 'settings', area: 'overview' },
];

@Component({
  selector: 'app-root',
  imports: [TPipe, LangSwitch, RouterOutlet, RouterLink, RouterLinkActive, Icon, NotificationBell],
  template: `
    <a class="skip" href="#main">{{ 'Skip to content' | t }}</a>
    @if (showShell()) {
      <div class="shell">
        <aside class="sidebar" [attr.aria-label]="'Main' | t">
          <a class="wordmark" [routerLink]="nav()[0].path">{{ 'myterra' | t }}</a>
          <nav>
            @for (item of nav(); track item.path) {
              <a [routerLink]="item.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: !!item.exact }">
                <app-icon [name]="item.icon" /><span>{{ item.label | t }}</span>
              </a>
            }
          </nav>
          <a class="side-status" routerLink="/status"><app-icon name="wifi" [size]="18" /> {{ 'Network status' | t }}</a>
        </aside>
        <div class="shell-main">
          <header class="topbar">
            <a class="wordmark mobile-only" [routerLink]="nav()[0].path">{{ 'myterra' | t }}</a>
            <span class="topbar-hello">{{ 'Hi, {name}' | t: { name: firstName() } }}</span>
            <div class="topbar-actions">
              <app-lang-switch />
              @if (auth.role() === 'customer') { <app-notification-bell /> }
              <button type="button" class="icon-btn" (click)="theme.toggle()"
                      [attr.aria-label]="(theme.theme() === 'dark' ? 'Use light mode' : 'Use dark mode') | t">
                <app-icon [name]="theme.theme() === 'dark' ? 'sun' : 'moon'" />
              </button>
              <button type="button" class="icon-btn" (click)="auth.logout()" [attr.aria-label]="'Sign out' | t">
                <app-icon name="logout" />
              </button>
            </div>
          </header>
          <main id="main" class="page" tabindex="-1"><router-outlet /></main>
        </div>
        <nav class="bottom-nav" [attr.aria-label]="'Main' | t">
          @for (item of nav().slice(0, 4); track item.path) {
            <a [routerLink]="item.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: !!item.exact }"
               (click)="more.set(false)">
              <app-icon [name]="item.icon" /><span>{{ item.label | t }}</span>
            </a>
          }
          <button type="button" [class.active]="more()" (click)="more.set(!more())" [attr.aria-expanded]="more()">
            <app-icon name="list" /><span>{{ 'More' | t }}</span>
          </button>
          @if (more()) {
            <div class="more-sheet">
              @for (item of nav().slice(4); track item.path) {
                <a [routerLink]="item.path" routerLinkActive="active" (click)="more.set(false)">
                  <app-icon [name]="item.icon" /> {{ item.label | t }}</a>
              }
              <a routerLink="/status" (click)="more.set(false)"><app-icon name="wifi" /> {{ 'Network status' | t }}</a>
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
  private meta = inject(Meta);
  more = signal(false);

  constructor() {
    // Belt and braces with robots.txt: only the public pages may appear in search results.
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => {
      const isPublic = PUBLIC_PAGE.test(this.router.url);
      this.meta.updateTag({ name: 'robots', content: isPublic ? 'index, follow' : 'noindex, nofollow' });
    });
  }

  nav() { return this.auth.isStaff() ? ADMIN_NAV.filter(i => canSee(this.auth.role(), i.area!)) : CUSTOMER_NAV; }
  firstName() { return (this.auth.name() ?? '').split(' ')[0]; }

  // Public pages (sign in, apply, password reset, status) use their own full-page layout.
  showShell() {
    return !!this.auth.name() && !/^\/(login|apply|forgot|status|[?#]|$)/.test(this.router.url);
  }
}
