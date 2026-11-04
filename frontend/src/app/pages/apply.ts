import { CurrencyPipe, DatePipe } from '@angular/common';
import { LangSwitch } from '../shared/lang-switch';
import { TPipe, t } from '../core/i18n';
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
  imports: [TPipe, LangSwitch, DatePipe, FormsModule, RouterLink, CurrencyPipe, PayDialog],
  template: `
    <div class="apply">
      <header class="apply-head">
        <a class="wordmark" routerLink="/">myterra</a>
        <span class="head-right"><app-lang-switch /><a routerLink="/login">{{ 'Sign in' | t }}</a></span>
      </header>

      @if (sent()) {
        <section class="apply-done" role="status">
          <h1>{{ 'Application sent' | t }}</h1>
          <p>{{ 'We emailed a receipt to {email}. You’ll get another email when your application is approved, with a link to sign in using the password you chose.' | t: { email: form.email } }}</p>
          <a class="btn" routerLink="/login">{{ 'Go to sign in' | t }}</a>
        </section>
      } @else {
        <div class="apply-form">
          <h1>{{ 'Apply for home internet' | t }}</h1>
          <ol class="steps apply-steps" [attr.aria-label]="'Application steps' | t">
            @for (s of steps; track s.id; let i = $index) {
              <li [class.done]="i < index()" [attr.aria-current]="s.id === step() ? 'step' : null"><span>{{ s.label | t }}</span></li>
            }
          </ol>

          <form (ngSubmit)="next()" novalidate>
            @switch (step()) {
              @case ('plan') {
                <fieldset>
                  <legend>{{ 'Choose a plan' | t }}</legend>
                  @if (plansLoaded() && !plans().length) {
                    <p class="error" role="alert">{{ 'No plans are available right now, so applications are closed. Please try again later.' | t }}</p>
                  }
                  <div class="plans" role="radiogroup" [attr.aria-label]="'Plans' | t">
                    @for (p of plans(); track p.id) {
                      <label class="plan-option">
                        <input type="radio" name="plan" [value]="p.id" [(ngModel)]="form.plan_id" />
                        <span class="plan-text">
                          <strong>{{ p.name }}</strong>
                          <span class="muted">{{ '{speed} Mbps, {gb} GB a month' | t: { speed: p.speed_mbps, gb: p.data_gb } }}</span>
                        </span>
                        <span class="plan-price">{{ p.price | currency: 'USD' : 'symbol' : '1.0-2' }}<small>{{ '/month' | t }}</small></span>
                      </label>
                    }
                  </div>
                </fieldset>
              }
              @case ('details') {
                <fieldset>
                  <legend>{{ 'Your details' | t }}</legend>
                  <p class="hint">{{ 'Fields marked' | t }} <span class="req" aria-hidden="true">*</span> {{ 'are required.' | t }}</p>
                  <label><span>{{ 'Full name' | t }} <span class="req" aria-hidden="true">*</span></span>
                    <input name="name" autocomplete="name" maxlength="100" required [(ngModel)]="form.name" />
                  </label>
                  <label><span>{{ 'Email' | t }} <span class="req" aria-hidden="true">*</span></span>
                    <input name="email" type="email" autocomplete="email" [placeholder]="'you@example.com' | t" required [(ngModel)]="form.email" />
                    <span class="hint">{{ 'We’ll send a code to check it. Your sign-in and bills go here.' | t }}</span>
                  </label>
                  <label><span>{{ 'Mobile number' | t }} <span class="req" aria-hidden="true">*</span></span>
                    <span class="phone-input">
                      @if (!form.phone.trim().startsWith('+')) { <span class="prefix" aria-hidden="true">+961</span> }
                      <input name="phone" type="tel" autocomplete="tel-national" placeholder="70 123 456" required [(ngModel)]="form.phone" />
                    </span>
                    <span class="hint">{{ 'The technician calls this number on installation day. Not a Lebanese number? Start with + and the country code.' | t }}</span>
                  </label>
                  <label><span>{{ 'Password' | t }} <span class="req" aria-hidden="true">*</span></span>
                    <input name="password" type="password" autocomplete="new-password" required [(ngModel)]="form.password" />
                    <span class="hint">{{ 'At least 8 characters. You’ll use it to sign in once approved.' | t }}</span>
                  </label>
                  <div class="two">
                    <label><span>{{ 'Date of birth' | t }} <span class="req" aria-hidden="true">*</span></span>
                      <input name="birth" type="date" [max]="adultMax" required [(ngModel)]="form.birth_date" />
                      <span class="hint">{{ 'You must be 18 or older.' | t }}</span>
                    </label>
                    <label><span>{{ 'ID or passport number' | t }} <span class="req" aria-hidden="true">*</span></span>
                      <input name="idn" maxlength="30" required [(ngModel)]="form.id_number" />
                    </label>
                  </div>
                </fieldset>
              }
              @case ('home') {
                <fieldset>
                  <legend>{{ 'Where should we install?' | t }}</legend>
                  <p class="hint">{{ 'Fields marked' | t }} <span class="req" aria-hidden="true">*</span> {{ 'are required.' | t }}</p>
                  <div class="two">
                    <label><span>{{ 'City' | t }} <span class="req" aria-hidden="true">*</span></span>
                      <input name="city" autocomplete="address-level2" maxlength="60" required [(ngModel)]="form.city" />
                    </label>
                    <label><span>{{ 'Street and building' | t }} <span class="req" aria-hidden="true">*</span></span>
                      <input name="street" autocomplete="address-line1" maxlength="150" required [(ngModel)]="form.street" />
                    </label>
                  </div>
                  <div class="two">
                    <label><span>{{ 'Floor and apartment' | t }} <span class="optional">{{ '(optional)' | t }}</span></span>
                      <input name="apt" autocomplete="address-line2" maxlength="60" [(ngModel)]="form.apartment" />
                    </label>
                    <label><span>{{ 'Preferred installation date' | t }} <span class="req" aria-hidden="true">*</span></span>
                      <input name="install" type="date" [min]="installMin" [max]="installMax" required [(ngModel)]="form.install_date" />
                      <span class="hint">{{ 'Between tomorrow and 60 days from now.' | t }}</span>
                    </label>
                  </div>
                </fieldset>
              }
              @case ('verify') {
                <fieldset>
                  <legend>{{ 'Check your email' | t }}</legend>
                  @if (codeSent()) {
                    <p>{{ 'We sent a 6-digit code to' | t }} <strong>{{ form.email }}</strong>{{ '. It expires in 10 minutes.
                      Not there? Check your spam folder.' | t }}</p>
                    @if (demoCode()) {
                      <p class="demo-code" role="status">
                        <span>{{ 'Demo mode: no email service is connected, so here’s your code:' | t }} <strong>{{ demoCode() }}</strong></span>
                        <button type="button" class="btn btn-sm btn-ghost" (click)="code = demoCode()">{{ 'Use this code' | t }}</button>
                      </p>
                    }
                    <label>{{ 'Code' | t }}
                      <input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" [(ngModel)]="code" />
                    </label>
                  } @else if (!error()) {
                    <p class="muted">{{ 'Sending a code to {email}…' | t: { email: form.email } }}</p>
                  }
                  <div class="row-actions">
                    @if (codeSent()) {
                      <button type="button" class="link-btn" (click)="sendCode()" [disabled]="busy()">{{ 'Send a new code' | t }}</button>
                    }
                    <button type="button" class="link-btn" (click)="go('details')">{{ 'Change email' | t }}</button>
                  </div>
                </fieldset>
              }
              @case ('review') {
                <fieldset>
                  <legend>{{ 'Review and pay' | t }}</legend>
                  <dl class="review">
                    <div><dt>{{ 'Plan' | t }}</dt><dd>{{ plan()?.name }}, {{ plan()?.price | currency: 'USD' : 'symbol' : '1.0-2' }}{{ '/month' | t }}</dd>
                      <dd class="review-edit"><button type="button" class="link-btn" (click)="go('plan')">{{ 'Edit' | t }}</button></dd></div>
                    <div><dt>{{ 'You' | t }}</dt><dd>{{ form.name }}<br />{{ form.email }} <span class="verified">{{ 'Verified' | t }}</span><br />{{ phone() }}</dd>
                      <dd class="review-edit"><button type="button" class="link-btn" (click)="go('details')">{{ 'Edit' | t }}</button></dd></div>
                    <div><dt>{{ 'Installation' | t }}</dt>
                      <dd>{{ form.street }}{{ form.apartment ? ', ' + form.apartment : '' }}, {{ form.city }}<br />{{ 'on {date}' | t: { date: (form.install_date | date: 'fullDate') } }}</dd>
                      <dd class="review-edit"><button type="button" class="link-btn" (click)="go('home')">{{ 'Edit' | t }}</button></dd></div>
                  </dl>
                  <p class="hint">{{ 'You pay the first month now by card. Nothing is charged in this demo.' | t }}</p>
                  <label class="check">
                    <input type="checkbox" name="terms" [(ngModel)]="form.accept_terms" />
                    <span>{{ 'I agree to the MyTerra terms of service and confirm my details are correct.' | t }}</span>
                  </label>
                </fieldset>
              }
            }

            @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
            <div class="step-nav">
              @if (index() > 0) { <button type="button" class="btn btn-ghost" (click)="back()">{{ 'Back' | t }}</button> }
              <button class="btn" type="submit" [disabled]="busy()" [class.loading]="busy() && step() === 'verify'">{{ nextLabel() }}</button>
            </div>
          </form>
        </div>
      }
      <app-pay-dialog #payment [amount]="plan()?.price ?? 0" [description]="'{plan}, first month' | t: { plan: plan()?.name ?? '' }"
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
  /** Lebanese numbers by default: "70 123 456" or "03 123 456" become +961…; a number typed with + or 00 is kept as is. */
  phone() {
    const raw = this.form.phone.replace(/[\s\-()]/g, '');
    if (raw.startsWith('+')) return raw;
    if (raw.startsWith('00')) return '+' + raw.slice(2);
    return '+961' + raw.replace(/^0/, '');
  }
  verified() { return this.verification()?.email === this.email(); }
  nextLabel() {
    if (this.step() === 'verify') return t(this.busy() ? 'Verifying…' : 'Verify and continue');
    if (this.step() === 'review') return t('Pay {amount} and send application', { amount: this.plan() ? '$' + this.plan()!.price : '' });
    return t('Continue');
  }

  ngOnInit() {
    const chosen = new URLSearchParams(location.search).get('plan'); // from "Choose this plan" on the home page
    this.api.plans().subscribe({
      next: p => {
        this.plans.set(p);
        this.plansLoaded.set(true);
        if (chosen && p.some(x => x.id === chosen)) this.form.plan_id = chosen;
      },
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
        if (!f.name.trim()) return t('Enter your full name');
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) return t('Enter a valid email');
        // Lebanese numbers have 7 or 8 digits after +961 (03 123 456, 70 123 456)
        if (!/^\+[1-9]\d{7,14}$/.test(this.phone()) || /^\+961(?!\d{7,8}$)/.test(this.phone())) return t('Enter your mobile number, like 70 123 456');
        if (f.password.length < 8) return t('Choose a password with at least 8 characters');
        if (!f.birth_date) return t('Enter your date of birth');
        if (f.birth_date > this.adultMax) return t('You must be 18 or older to apply');
        if (f.id_number.trim().length < 5) return t('Enter your ID or passport number');
        return '';
      case 'home':
        if (!f.city.trim()) return t('Enter your city');
        if (!f.street.trim()) return t('Enter your street and building');
        if (!f.install_date) return t('Pick an installation date');
        if (f.install_date < this.installMin || f.install_date > this.installMax) return t('Pick an installation date between tomorrow and 60 days from now');
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
    phone: this.phone(),
    email_verification_id: this.verification()!.id,
    card,
  });

  onPaid() {
    this.sent.set(true);
    window.scrollTo({ top: 0 });
  }
}
