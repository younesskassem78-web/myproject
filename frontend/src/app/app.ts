import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    @if (auth.name()) {
      <header class="topbar">
        <a class="wordmark" routerLink="/dashboard">myterra</a>
        <nav>
          <a routerLink="/dashboard" routerLinkActive="active">Overview</a>
          <a routerLink="/support" routerLinkActive="active">Support</a>
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
}
