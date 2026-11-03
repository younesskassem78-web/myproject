import { CurrencyPipe } from '@angular/common';
import { Component, OnInit, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { of, switchMap, timer } from 'rxjs';
import { ApiService } from '../core/api.service';
import { errorText } from '../core/errors';
import { Plan } from '../core/models';
import { CardDetails, PayDialog } from './pay-dialog';

const day = (offset: number, years = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
};

export type Step = 'plan' | 'details' | 'home' | 'verify' | 'review';
export const STEPS: { id: Step; label: string }[] = [
  { id: 'plan', label: 'Plan' },
  { id: 'details', label: 'Your details' },
  { id: 'home', label: 'Address' },
  { id: 'verify', label: 'Verify email' },
  { id: 'review', label: 'Review and pay' },
];

@Component({
  selector: 'app-apply',
  imports: [FormsModule, RouterLink, CurrencyPipe, PayDialog],
  template: `
    <div class="apply">
      <header class="apply-head">
        <a class="wordmark" routerLink="/login">myterra</a>
        <a routerLink="/login">Sign in</a>
      </header>

      @if (sent()) {
        <section class="apply-done" role="status">
          <h1>Application sent</h1>
          <p>We emailed a receipt to {{ form.email }}. You’ll get another email when your application is approved,
            with a link to sign in using the password you chose.</p>
          <a class="btn" routerLink="/login">Go to sign in</a>
        </section>
      } @else {
        <div class="apply-form">
          <h1>Apply for home internet</h1>
          <ol class="steps apply-steps" aria-label="Application steps">
            @for (s of steps; track s.id; let i = $index) {
              <li [class.done]="i < index()" [attr.aria-current]="s.id === step() ? 'step' : null"><span>{{ s.label }}</span></li>
            }
          </ol>

          <form (ngSubmit)="next()" novalidate>
            @switch (step()) {
              @case ('plan') {
                <fieldset>
                  <legend>Choose a plan</legend>
                  @if (plansLoaded() && !plans().length) {
                    <p class="error" role="alert">No plans are available right now, so applications are closed. Please try again later.</p>
                  }
                  <div class="plans" role="radiogroup" aria-label="Plans">
                    @for (p of plans(); track p.id) {
                      <label class="plan-option">
                        <input type="radio" name="plan" [value]="p.id" [(ngModel)]="form.plan_id" />
                        <span class="plan-text">
                          <strong>{{ p.name }}</strong>
                          <span class="muted">{{ p.speed_mbps }} Mbps, {{ p.data_gb }} GB a month</span>
                        </span>
                        <span class="plan-price">{{ p.price | currency: 'USD' : 'symbol' : '1.0-2' }}<small>/month</small></span>
                      </label>
                    }
                  </div>
                </fieldset>
              }
              @case ('details') {
                <fieldset>
                  <legend>Your details</legend>
                  <p class="hint">Fields marked <span class="req" aria-hidden="true">*</span> are required.</p>
                  <label><span>Full name <span class="req" aria-hidden="true">*</span></span>
                    <input name="name" autocomplete="name" maxlength="100" required [(ngModel)]="form.name" />
                  </label>
                  <label><span>Email <span class="req" aria-hidden="true">*</span></span>
                    <input name="email" type="email" autocomplete="email" placeholder="you@example.com" required [(ngModel)]="form.email" />
                    <span class="hint">We’ll send a code to check it. Your sign-in and bills go here.</span>
                  </label>
                  <label><span>Mobile number <span class="req" aria-hidden="true">*</span></span>
                    <input name="phone" type="tel" autocomplete="tel" placeholder="+961 70 123 456" required [(ngModel)]="form.phone" />
                    <span class="hint">With country code. The technician calls this number on installation day.</span>
                  </label>
                  <label><span>Password <span class="req" aria-hidden="true">*</span></span>
                    <input name="password" type="password" autocomplete="new-password" required [(ngModel)]="form.password" />
                    <span class="hint">At least 8 characters. You’ll use it to sign in once approved.</span>
                  </label>
                  <div class="two">
                    <label><span>Date of birth <span class="req" aria-hidden="true">*</span></span>
                      <input name="birth" type="date" [max]="adultMax" required [(ngModel)]="form.birth_date" />
                      <span class="hint">You must be 18 or older.</span>
                    </label>
                    <label><span>ID or passport number <span class="req" aria-hidden="true">*</span></span>
                      <input name="idn" maxlength="30" required [(ngModel)]="form.id_number" />
                    </label>
                  </div>
                </fieldset>
              }
              @case ('home') {
                <fieldset>
                  <legend>Where should we install?</legend>
                  <p class="hint">Fields marked <span class="req" aria-hidden="true">*</span> are required.</p>
                  <div class="two">
                    <label><span>City <span class="req" aria-hidden="true">*</span></span>
                      <input name="city" autocomplete="address-level2" maxlength="60" required [(ngModel)]="form.city" />
                    </label>
                    <label><span>Street and building <span class="req" aria-hidden="true">*</span></span>
                      <input name="street" autocomplete="address-line1" maxlength="150" required [(ngModel)]="form.street" />
                    </label>
                  </div>
                  <div class="two">
                    <label><span>Floor and apartment <span class="optional">(optional)</span></span>
                      <input name="apt" autocomplete="address-line2" maxlength="60" [(ngModel)]="form.apartment" />
                    </label>
                    <label><span>Preferred installation date <span class="req" aria-hidden="true">*</span></span>
                      <input name="install" type="date" [min]="installMin" [max]="installMax" required [(ngModel)]="form.install_date" />
                      <span class="hint">Between tomorrow and 60 days from now.</span>
                    </label>
                  </div>
                </fieldset>
              }
              @case ('verify') {
                <fieldset>
                  <legend>Check your email</legend>
                  @if (codeSent()) {
                    <p>We sent a 6-digit code to <strong>{{ form.email }}</strong>. It expires in 10 minutes.
                      Not there? Check your spam folder.</p>
                    @if (demoCode()) {
                      <p class="demo-code" role="status">
                        <span>Demo mode: no email service is connected, so here’s your code: <strong>{{ demoCode() }}</strong></span>
                        <button type="button" class="btn btn-sm btn-ghost" (click)="code = demoCode()">Use this code</button>
                      </p>
                    }
                    <label>Code
                      <input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" [(ngModel)]="code" />
                    </label>
                  } @else if (!error()) {
                    <p class="muted">Sending a code to {{ form.email }}…</p>
                  }
                  <div class="row-actions">
                    @if (codeSent()) {
                      <button type="button" class="link-btn" (click)="sendCode()" [disabled]="busy()">Send a new code</button>
                    }
                    <button type="button" class="link-btn" (click)="go('details')">Change email</button>
                  </div>
                </fieldset>
              }
              @case ('review') {
                <fieldset>
                  <legend>Review and pay</legend>
                  <dl class="review">
                    <div><dt>Plan</dt><dd>{{ plan()?.name }}, {{ plan()?.price | currency: 'USD' : 'symbol' : '1.0-2' }}/month</dd>
                      <button type="button" class="link-btn" (click)="go('plan')">Edit</button></div>
                    <div><dt>You</dt><dd>{{ form.name }}<br />{{ form.email }} <span class="verified">Verified</span><br />{{ form.phone }}</dd>
                      <button type="button" class="link-btn" (click)="go('details')">Edit</button></div>
                    <div><dt>Installation</dt>
                      <dd>{{ form.street }}{{ form.apartment ? ', ' + form.apartment : '' }}, {{ form.city }}<br />on {{ form.install_date }}</dd>
                      <button type="button" class="link-btn" (click)="go('home')">Edit</button></div>
                  </dl>
                  <p class="hint">You pay the first month now by card. Nothing is charged in this demo.</p>
                  <label class="check">
                    <input type="checkbox" name="terms" [(ngModel)]="form.accept_terms" />
                    <span>I agree to the MyTerra terms of service and confirm my details are correct.</span>
                  </label>
                </fieldset>
              }
            }

            @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
            <div class="step-nav">
              @if (index() > 0) { <button type="button" class="btn btn-ghost" (click)="back()">Back</button> }
              <button class="btn" type="submit" [disabled]="busy()" [class.loading]="busy() && step() === 'verify'">{{ nextLabel() }}</button>
            </div>
          </form>
        </div>
      }
      <app-pay-dialog #payment [amount]="plan()?.price ?? 0" [description]="(plan()?.name ?? '') + ', first month'"
                      [pay]="payWith" (paid)="onPaid()" />
    </div>
  `,
})
export class Apply implements OnInit {
  private api = inject(ApiService);
  readonly steps = STEPS;
  plans = signal<Plan[]>([]);
  plansLoaded = signal(false);
  step = signal<Step>('plan');
  form = {
    name: '', email: '', phone: '', password: '', birth_date: '', id_number: '', city: '', street: '', apartment: '',
    install_date: '', plan_id: '', accept_terms: false,
  };
  code = '';
  codeSent = signal(false);
  demoCode = signal('');
  /** The verification is tied to the email it was made for; changing the email needs a new code. */
  verification = signal<{ id: string; email: string } | null>(null);
  busy = signal(false);
  error = signal('');
  sent = signal(false);
  verifyDelayMs = 900; // a short "Verifying…" so the check doesn't look like nothing happened
  readonly adultMax = day(0, -18);
  readonly installMin = day(1);
  readonly installMax = day(60);
  private payment = viewChild.required<PayDialog>('payment');

  index() { return STEPS.findIndex(s => s.id === this.step()); }
  plan() { return this.plans().find(p => p.id === this.form.plan_id); }
  email() { return this.form.email.trim().toLowerCase(); }
  verified() { return this.verification()?.email === this.email(); }
  nextLabel() {
    if (this.step() === 'verify') return this.busy() ? 'Verifying…' : 'Verify and continue';
    if (this.step() === 'review') return `Pay ${this.plan() ? '$' + this.plan()!.price : ''} and send application`;
    return 'Continue';
  }

  ngOnInit() {
    this.api.plans().subscribe({
      next: p => { this.plans.set(p); this.plansLoaded.set(true); },
      error: e => this.error.set(errorText(e)),
    });
  }

  /** What's missing on the current step, or '' when it's complete. */
  problem(): string {
    const f = this.form;
    switch (this.step()) {
      case 'plan':
        return f.plan_id ? '' : 'Choose a plan';
      case 'details':
        if (!f.name.trim()) return 'Enter your full name';
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) return 'Enter a valid email';
        if (!/^\+[1-9]\d{7,14}$/.test(f.phone.replace(/[\s\-()]/g, ''))) return 'Enter your mobile number with the country code, like +961 70 123 456';
        if (f.password.length < 8) return 'Choose a password with at least 8 characters';
        if (!f.birth_date) return 'Enter your date of birth';
        if (f.birth_date > this.adultMax) return 'You must be 18 or older to apply';
        if (f.id_number.trim().length < 5) return 'Enter your ID or passport number';
        return '';
      case 'home':
        if (!f.city.trim()) return 'Enter your city';
        if (!f.street.trim()) return 'Enter your street and building';
        if (!f.install_date) return 'Pick an installation date';
        if (f.install_date < this.installMin || f.install_date > this.installMax) return 'Pick an installation date between tomorrow and 60 days from now';
        return '';
      case 'verify':
        return /^\d{6}$/.test(this.code.trim()) ? '' : 'Enter the 6-digit code';
      case 'review':
        return f.accept_terms ? '' : 'Accept the terms to continue';
    }
  }

  go(step: Step) {
    this.error.set('');
    this.step.set(step);
    if (step === 'verify' && !this.verified()) this.sendCode();
    window.scrollTo({ top: 0 });
  }

  back() { this.go(STEPS[this.index() - 1].id === 'verify' && this.verified() ? 'home' : STEPS[this.index() - 1].id); }

  next() {
    const problem = this.problem();
    this.error.set(problem);
    if (problem) return;
    switch (this.step()) {
      case 'home': return this.go(this.verified() ? 'review' : 'verify');
      case 'verify': return this.checkCode();
      case 'review': return this.payment().open();
      default: return this.go(STEPS[this.index() + 1].id);
    }
  }

  sendCode() {
    this.busy.set(true);
    this.error.set('');
    this.code = '';
    this.codeSent.set(false);
    this.api.sendCode('email', this.email()).subscribe({
      next: r => { this.codeSent.set(true); this.demoCode.set(r.demo_code ?? ''); this.busy.set(false); },
      error: e => { this.error.set(errorText(e)); this.busy.set(false); },
    });
  }

  private checkCode() {
    const email = this.email();
    this.busy.set(true);
    this.error.set('');
    const wait = this.verifyDelayMs ? timer(this.verifyDelayMs) : of(0);
    wait.pipe(switchMap(() => this.api.checkCode('email', email, this.code.trim()))).subscribe({
      next: r => { this.verification.set({ id: r.verification_id, email }); this.busy.set(false); this.go('review'); },
      error: e => { this.error.set(errorText(e)); this.busy.set(false); },
    });
  }

  /** Called by the card window: the application is sent together with the card. */
  payWith = (card: CardDetails) => this.api.apply({
    ...this.form,
    email: this.email(),
    phone: this.form.phone.trim(),
    email_verification_id: this.verification()!.id,
    card,
  });

  onPaid() {
    this.sent.set(true);
    window.scrollTo({ top: 0 });
  }
}
