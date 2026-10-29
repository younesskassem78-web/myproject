import { CurrencyPipe } from '@angular/common';
import { Component, OnInit, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { errorText } from '../core/errors';
import { Plan } from '../core/models';
import { CardDetails, PayDialog } from './pay-dialog';
import { VerifyField } from './verify-field';

const day = (offset: number, years = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
};

@Component({
  selector: 'app-apply',
  imports: [FormsModule, RouterLink, CurrencyPipe, VerifyField, PayDialog],
  template: `
    <div class="apply">
      <header class="apply-head">
        <a class="wordmark" routerLink="/login">myterra</a>
        <a routerLink="/login">Sign in</a>
      </header>

      @if (sent()) {
        <section class="apply-done" role="status">
          <h1>Application sent</h1>
          <p>We emailed a receipt to {{ email() }}. You’ll get another email when your application is approved,
            with a link to sign in using the password you chose.</p>
          <a class="btn" routerLink="/login">Go to sign in</a>
        </section>
      } @else {
        <form class="apply-form" (ngSubmit)="submit()" novalidate>
          <h1>Apply for home internet</h1>
          <p class="muted">Takes about 3 minutes. Keep your phone nearby for a verification code.</p>

          <fieldset>
            <legend><span class="step">1</span> Your account</legend>
            <label>Full name <input name="name" autocomplete="name" maxlength="100" [(ngModel)]="form.name" /></label>
            <app-verify-field channel="email" label="Email" placeholder="you@example.com"
                              [(value)]="email" [(verifiedId)]="emailVerification" />
            <app-verify-field channel="sms" label="Mobile number" placeholder="+961 70 123 456"
                              [(value)]="phone" [(verifiedId)]="phoneVerification" />
            <label>Password
              <input name="password" type="password" autocomplete="new-password" [(ngModel)]="form.password" />
              <span class="hint">At least 8 characters. You’ll use it to sign in once approved.</span>
            </label>
          </fieldset>

          <fieldset>
            <legend><span class="step">2</span> About you and your home</legend>
            <div class="two">
              <label>Date of birth <input name="birth" type="date" [max]="adultMax" [(ngModel)]="form.birth_date" /></label>
              <label>ID or passport number <input name="idn" maxlength="30" [(ngModel)]="form.id_number" /></label>
            </div>
            <div class="two">
              <label>City <input name="city" autocomplete="address-level2" maxlength="60" [(ngModel)]="form.city" /></label>
              <label>Street and building <input name="street" autocomplete="address-line1" maxlength="150" [(ngModel)]="form.street" /></label>
            </div>
            <div class="two">
              <label><span>Floor and apartment <span class="optional">(optional)</span></span>
                <input name="apt" autocomplete="address-line2" maxlength="60" [(ngModel)]="form.apartment" />
              </label>
              <label>Preferred installation date
                <input name="install" type="date" [min]="installMin" [max]="installMax" [(ngModel)]="form.install_date" />
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend><span class="step">3</span> Plan and first payment</legend>
            <div class="plans">
              @if (plansLoaded() && !plans().length) {
                <p class="error" role="alert">No plans are available right now, so applications are closed. Please try again later.</p>
              }
              @for (p of plans(); track p.id) {
                <label class="plan-option">
                  <input type="radio" name="plan" [value]="p.id" [(ngModel)]="form.plan_id" />
                  <span><strong>{{ p.name }}</strong> {{ p.price | currency: 'USD' : 'symbol' : '1.0-2' }}/month</span>
                </label>
              }
            </div>
            <p class="hint">You pay the first month by card in the next step. Nothing is charged in this demo.</p>
            <label class="check">
              <input type="checkbox" name="terms" [(ngModel)]="form.accept_terms" />
              <span>I agree to the MyTerra terms of service and confirm my details are correct.</span>
            </label>
          </fieldset>

          @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
          <button class="btn" type="submit">Continue to payment</button>
        </form>
      }
      <app-pay-dialog #payment [amount]="price()" [description]="planName() + ', first month'"
                      [pay]="payWith" (paid)="onPaid()" />
    </div>
  `,
})
export class Apply implements OnInit {
  private api = inject(ApiService);
  plans = signal<Plan[]>([]);
  plansLoaded = signal(false);
  email = signal('');
  phone = signal('');
  emailVerification = signal('');
  phoneVerification = signal('');
  form = {
    name: '', password: '', birth_date: '', id_number: '', city: '', street: '', apartment: '',
    install_date: '', plan_id: '', accept_terms: false,
  };
  error = signal('');
  sent = signal(false);
  readonly adultMax = day(0, -18);
  readonly installMin = day(1);
  readonly installMax = day(60);
  private payment = viewChild.required<PayDialog>('payment');

  price() { return this.plans().find(p => p.id === this.form.plan_id)?.price ?? 0; }
  planName() { return this.plans().find(p => p.id === this.form.plan_id)?.name ?? ''; }

  ngOnInit() {
    this.api.plans().subscribe({
      next: p => { this.plans.set(p); this.plansLoaded.set(true); },
      error: e => this.error.set(errorText(e)),
    });
  }

  private problem(): string {
    const f = this.form;
    if (!f.name.trim()) return 'Enter your full name';
    if (!this.emailVerification()) return 'Verify your email with the code we send you';
    if (!this.phoneVerification()) return 'Verify your mobile number with the code we send you';
    if (f.password.length < 8) return 'Choose a password with at least 8 characters';
    if (!f.birth_date) return 'Enter your date of birth';
    if (f.id_number.trim().length < 5) return 'Enter your ID or passport number';
    if (!f.city.trim() || !f.street.trim()) return 'Enter your address';
    if (!f.install_date) return 'Pick an installation date';
    if (!f.plan_id) return 'Choose a plan';
    if (!f.accept_terms) return 'Accept the terms to continue';
    return '';
  }

  /** Checks the form, then opens the card window. */
  submit() {
    const problem = this.problem();
    this.error.set(problem);
    if (!problem) this.payment().open();
  }

  /** Called by the card window: the application is sent together with the card. */
  payWith = (card: CardDetails) => this.api.apply({
    ...this.form,
    email: this.email().trim(),
    phone: this.phone().trim(),
    email_verification_id: this.emailVerification(),
    phone_verification_id: this.phoneVerification(),
    card,
  });

  onPaid() {
    this.sent.set(true);
    window.scrollTo({ top: 0 });
  }
}
