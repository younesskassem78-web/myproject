import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    @if (showShell()) {
      <header class="topbar">
        <a class="wordmark" [routerLink]="auth.role() === 'admin' ? '/admin' : '/dashboard'">myterra</a>
        <nav>
          @if (auth.role() === 'admin') {
            <a routerLink="/admin" routerLinkActive="active">Admin</a>
          } @else {
            <a routerLink="/dashboard" routerLinkActive="active">Overview</a>
            <a routerLink="/support" routerLinkActive="active">Support</a>
          }
        </nav>
        <button class="link-btn" type="button" (click)="auth.logout()">Sign out</button>
      </header>
      <main class="page"><router-outlet /></main>
    } @else {
      <router-outlet />
    }
  `,
})
export class App {
  auth = inject(AuthService);
  private router = inject(Router);

  // Sign-in and apply pages always use their own full-page layout.
  showShell() { return !!this.auth.name() && !/^\/(login|apply)/.test(this.router.url); }
}
