import { Component, inject, signal } from '@angular/core';
import { LangSwitch } from '../shared/lang-switch';
import { TPipe, t } from '../core/i18n';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { errorText } from '../core/errors';

@Component({
  selector: 'app-forgot',
  imports: [TPipe, LangSwitch, FormsModule, RouterLink],
  template: `
    <div class="public-page">
      <header class="apply-head"><a class="wordmark" routerLink="/login">{{ 'myterra' | t }}</a><span class="head-right"><app-lang-switch /><a routerLink="/login">{{ 'Sign in' | t }}</a></span></header>
      <section class="narrow card">
        @switch (step()) {
          @case ('email') {
            <form (ngSubmit)="send()">
              <h1>{{ 'Reset your password' | t }}</h1>
              <p class="muted">{{ "Enter your account email. We'll send you a 6-digit code." | t }}</p>
              <label>{{ 'Email' | t }} <input name="email" type="email" autocomplete="email" [(ngModel)]="email" /></label>
              @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
              <button class="btn" type="submit" [disabled]="busy()">{{ (busy() ? 'Sending…' : 'Send code') | t }}</button>
            </form>
          }
          @case ('code') {
            <form (ngSubmit)="check()">
              <h1>{{ 'Check your email' | t }}</h1>
              <p class="muted">{{ 'We sent a 6-digit code to {email}. It expires in 10 minutes. Not there? Check your spam folder.' | t: { email: email } }}</p>
              <label>{{ 'Code' | t }} <input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" [(ngModel)]="code" /></label>
              @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
              <button class="btn" type="submit" [disabled]="busy()">{{ (busy() ? 'Checking…' : 'Continue') | t }}</button>
              <button class="link-btn" type="button" (click)="back()">{{ 'Use a different email' | t }}</button>
            </form>
          }
          @case ('password') {
            <form (ngSubmit)="reset()">
              <h1>{{ 'Choose a new password' | t }}</h1>
              <p class="muted">{{ 'For {email}.' | t: { email: email } }}</p>
              <label>{{ 'New password' | t }} <input name="password" type="password" autocomplete="new-password" [(ngModel)]="password" />
                <span class="hint">{{ 'At least 8 characters.' | t }}</span></label>
              @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
              <button class="btn" type="submit" [disabled]="busy()">{{ (busy() ? 'Saving…' : 'Set new password') | t }}</button>
              <button class="link-btn" type="button" (click)="back()">{{ 'Start again' | t }}</button>
            </form>
          }
          @case ('done') {
            <div role="status">
              <h1>{{ 'Password changed' | t }}</h1>
              <p>{{ 'You can sign in with your new password now. Any other devices have been signed out.' | t }}</p>
              <a class="btn" routerLink="/login">{{ 'Sign in' | t }}</a>
            </div>
          }
        }
      </section>
    </div>
  `,
})
export class Forgot {
  private api = inject(ApiService);
  step = signal<'email' | 'code' | 'password' | 'done'>('email');
  email = '';
  code = '';
  password = '';
  busy = signal(false);
  error = signal('');

  send() {
    const email = this.email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { this.error.set(t('Enter a valid email')); return; }
    this.busy.set(true);
    this.error.set('');
    this.api.forgotPassword(email).subscribe({
      next: () => { this.step.set('code'); this.busy.set(false); },
      error: e => { this.error.set(errorText(e)); this.busy.set(false); },
    });
  }

  check() {
    if (!/^\d{6}$/.test(this.code.trim())) { this.error.set(t('Enter the 6-digit code')); return; }
    this.busy.set(true);
    this.error.set('');
    this.api.checkResetCode(this.email.trim(), this.code.trim()).subscribe({
      next: () => { this.step.set('password'); this.busy.set(false); },
      error: e => { this.error.set(errorText(e)); this.busy.set(false); },
    });
  }

  back() {
    this.code = '';
    this.password = '';
    this.error.set('');
    this.step.set('email');
  }

  reset() {
    if (this.password.length < 8) { this.error.set(t('Choose a password with at least 8 characters')); return; }
    this.busy.set(true);
    this.error.set('');
    this.api.resetPassword(this.email.trim(), this.code.trim(), this.password).subscribe({
      next: () => { this.step.set('done'); this.busy.set(false); },
      error: e => { this.error.set(errorText(e)); this.busy.set(false); },
    });
  }
}
