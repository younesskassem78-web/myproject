import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { errorText } from '../core/errors';

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="login">
      <section class="login-brand">
        <p class="wordmark">myterra</p>
        <h1>Your home internet, in one place.</h1>
        <p>Check your plan, watch your data, top up and get help without calling anyone.</p>
      </section>

      <form class="login-form" (ngSubmit)="submit()">
        <h2>Sign in</h2>
        <label>Email
          <input name="email" type="email" autocomplete="username" required [(ngModel)]="email" />
        </label>
        <label>Password
          <input name="password" type="password" autocomplete="current-password" required [(ngModel)]="password" />
        </label>
        @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        <button class="btn" type="submit" [disabled]="pending()">{{ pending() ? 'Signing in…' : 'Sign in' }}</button>
        <p class="hint"><a routerLink="/forgot">Forgot password?</a></p>
        <p class="hint">New here? <a routerLink="/apply">Apply for an account</a>. Internet down? <a routerLink="/status">Check network status</a>.</p>
        <p class="hint">Demo: <strong>demo&#64;myterra.app</strong> / <strong>demo1234</strong>.
          Admin: <strong>admin&#64;myterra.app</strong> / <strong>admin1234</strong>.</p>
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
      next: role => this.router.navigateByUrl(role === 'admin' ? '/admin' : '/dashboard'),
      error: e => {
        this.pending.set(false);
        this.error.set(errorText(e));
      },
    });
  }
}
