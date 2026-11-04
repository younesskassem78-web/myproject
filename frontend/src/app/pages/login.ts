import { Component, inject, signal } from '@angular/core';
import { TPipe } from '../core/i18n';
import { LangSwitch } from '../shared/lang-switch';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { errorText } from '../core/errors';

@Component({
  selector: 'app-login',
  imports: [TPipe, LangSwitch, FormsModule, RouterLink],
  template: `
    <div class="login">
      <section class="login-brand">
        <p class="wordmark">{{ 'myterra' | t }}</p>
        <h1>{{ 'Your home internet, in one place.' | t }}</h1>
        <p>{{ 'Check your plan, watch your data, top up and get help without calling anyone.' | t }}</p>
      </section>

      <form class="login-form" (ngSubmit)="submit()">
        <h2>{{ 'Sign in' | t }}</h2>
        <label>{{ 'Email' | t }}
          <input name="email" type="email" autocomplete="username" required [(ngModel)]="email" />
        </label>
        <label>{{ 'Password' | t }}
          <input name="password" type="password" autocomplete="current-password" required [(ngModel)]="password" />
        </label>
        @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        <button class="btn" type="submit" [disabled]="pending()">{{ (pending() ? 'Signing in…' : 'Sign in') | t }}</button>
        <p class="hint"><a routerLink="/forgot">{{ 'Forgot password?' | t }}</a></p>
        <p class="hint">{{ 'New here?' | t }} <a routerLink="/apply">{{ 'Apply for an account' | t }}</a>. {{ 'Internet down?' | t }} <a routerLink="/status">{{ 'Check network status' | t }}</a>.</p>
        <p class="hint">{{ 'Demo:' | t }} <strong>demo&#64;myterra.app</strong> / <strong>demo1234</strong>.
          {{ 'Admin:' | t }} <strong>admin&#64;myterra.app</strong> / <strong>admin1234</strong>.</p>
        <app-lang-switch />
      </form>
    </div>
  `,
})
export class Login {
  private auth = inject(AuthService);
  private router = inject(Router);
  email = '';
  password = '';
  error = signal('');
  pending = signal(false);

  submit() {
    if (this.pending()) return;
    this.pending.set(true);
    this.error.set('');
    this.auth.login(this.email.trim(), this.password).subscribe({
      next: role => this.router.navigateByUrl(role === 'customer' ? '/dashboard' : '/admin'),
      error: e => {
        this.pending.set(false);
        this.error.set(errorText(e));
      },
    });
  }
}
