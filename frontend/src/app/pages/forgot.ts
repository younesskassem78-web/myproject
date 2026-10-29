import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { errorText } from '../core/errors';

@Component({
  selector: 'app-forgot',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="public-page">
      <header class="apply-head"><a class="wordmark" routerLink="/login">myterra</a><a routerLink="/login">Sign in</a></header>
      <section class="narrow card">
        @switch (step()) {
          @case ('email') {
            <form (ngSubmit)="send()">
              <h1>Reset your password</h1>
              <p class="muted">Enter your account email. We'll send you a 6-digit code.</p>
              <label>Email <input name="email" type="email" autocomplete="email" [(ngModel)]="email" /></label>
              @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
              <button class="btn" type="submit" [disabled]="busy()">{{ busy() ? 'Sending…' : 'Send code' }}</button>
            </form>
          }
          @case ('code') {
            <form (ngSubmit)="reset()">
              <h1>Check your email</h1>
              <p class="muted">If {{ email }} has a MyTerra account, a code is on its way. It expires in 10 minutes.</p>
              <label>Code <input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" [(ngModel)]="code" /></label>
              <label>New password <input name="password" type="password" autocomplete="new-password" [(ngModel)]="password" />
                <span class="hint">At least 8 characters.</span></label>
              @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
              <button class="btn" type="submit" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Set new password' }}</button>
              <button class="link-btn" type="button" (click)="step.set('email')">Use a different email</button>
            </form>
          }
          @case ('done') {
            <div role="status">
              <h1>Password changed</h1>
              <p>You can sign in with your new password now. Any other devices have been signed out.</p>
              <a class="btn" routerLink="/login">Sign in</a>
            </div>
          }
        }
      </section>
    </div>
  `,
})
export class Forgot {
  private api = inject(ApiService);
  step = signal<'email' | 'code' | 'done'>('email');
  email = '';
  code = '';
  password = '';
  busy = signal(false);
  error = signal('');

  send() {
    const email = this.email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { this.error.set('Enter a valid email'); return; }
    this.busy.set(true);
    this.error.set('');
    this.api.forgotPassword(email).subscribe({
      next: () => { this.step.set('code'); this.busy.set(false); },
      error: e => { this.error.set(errorText(e)); this.busy.set(false); },
    });
  }

  reset() {
    if (!/^\d{6}$/.test(this.code.trim())) { this.error.set('Enter the 6-digit code'); return; }
    if (this.password.length < 8) { this.error.set('Choose a password with at least 8 characters'); return; }
    this.busy.set(true);
    this.error.set('');
    this.api.resetPassword(this.email.trim(), this.code.trim(), this.password).subscribe({
      next: () => { this.step.set('done'); this.busy.set(false); },
      error: e => { this.error.set(errorText(e)); this.busy.set(false); },
    });
  }
}
