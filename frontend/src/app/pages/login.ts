import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
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
        <p class="hint">Try it with <strong>demo&#64;myterra.app</strong> and password <strong>demo1234</strong>.</p>
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
      next: () => this.router.navigateByUrl('/dashboard'),
      error: e => {
        this.pending.set(false);
        this.error.set(e.status === 401 ? 'Invalid email or password'
          : 'Can’t reach the MyTerra server. Make sure the backend is running.');
      },
    });
  }
}
