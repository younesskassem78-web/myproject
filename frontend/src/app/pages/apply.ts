import { CurrencyPipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { errorText } from '../core/errors';
import { Plan } from '../core/models';

@Component({
  selector: 'app-apply',
  imports: [FormsModule, RouterLink, CurrencyPipe],
  template: `
    <div class="login">
      <section class="login-brand">
        <a class="wordmark" routerLink="/login">myterra</a>
        <h1>Get connected.</h1>
        <p>Pick a plan and send your application. Once we approve it, sign in with the email and password you chose here.</p>
      </section>

      @if (sent()) {
        <div class="login-form" role="status">
          <h2>Application sent</h2>
          <p>We’ll review it soon. Try signing in later. If it’s still waiting, the sign-in page will tell you.</p>
          <a class="btn" routerLink="/login">Go to sign in</a>
        </div>
      } @else {
        <form class="login-form" (ngSubmit)="submit()">
          <h2>Apply for an account</h2>
          <label>Full name
            <input name="name" autocomplete="name" required maxlength="100" [(ngModel)]="form.name" />
          </label>
          <label>Email
            <input name="email" type="email" autocomplete="email" required [(ngModel)]="form.email" />
          </label>
          <label>Password
            <input name="password" type="password" autocomplete="new-password" required [(ngModel)]="form.password" />
          </label>
          <fieldset class="plans">
            <legend>Plan</legend>
            @for (p of plans(); track p.id) {
              <label class="plan-option">
                <input type="radio" name="plan" [value]="p.id" [(ngModel)]="form.plan_id" />
                <span><strong>{{ p.name }}</strong> {{ p.price | currency: 'USD' : 'symbol' : '1.0-2' }}/month</span>
              </label>
            }
          </fieldset>
          @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
          <button class="btn" type="submit" [disabled]="pending()">{{ pending() ? 'Sending…' : 'Send application' }}</button>
          <p class="hint">Already have an account? <a routerLink="/login">Sign in</a>.</p>
        </form>
      }
    </div>
  `,
})
export class Apply implements OnInit {
  private api = inject(ApiService);
  plans = signal<Plan[]>([]);
  form = { name: '', email: '', password: '', plan_id: '' };
  pending = signal(false);
  error = signal('');
  sent = signal(false);

  ngOnInit() {
    this.api.plans().subscribe({
      next: p => this.plans.set(p),
      error: e => this.error.set(errorText(e)),
    });
  }

  submit() {
    if (this.pending()) return;
    const f = { ...this.form, name: this.form.name.trim(), email: this.form.email.trim() };
    const problem = !f.name ? 'Enter your name'
      : !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email) ? 'Enter a valid email'
      : f.password.length < 8 ? 'Choose a password with at least 8 characters'
      : !f.plan_id ? 'Choose a plan' : '';
    this.error.set(problem);
    if (problem) return;
    this.pending.set(true);
    this.api.apply(f).subscribe({
      next: () => this.sent.set(true),
      error: e => {
        this.error.set(errorText(e));
        this.pending.set(false);
      },
    });
  }
}
