import { CurrencyPipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { errorText } from '../core/errors';
import { Plan } from '../core/models';
import { VerifyField } from './verify-field';

const day = (offset: number, years = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
};

@Component({
  selector: 'app-apply',
  imports: [FormsModule, RouterLink, CurrencyPipe, VerifyField],
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
              @for (p of plans(); track p.id) {
                <label class="plan-option">
                  <input type="radio" name="plan" [value]="p.id" [(ngModel)]="form.plan_id" />
                  <span><strong>{{ p.name }}</strong> {{ p.price | currency: 'USD' : 'symbol' : '1.0-2' }}/month</span>
                </label>
              }
            </div>
            <div class="card-box">
              <label>Name on card <input name="holder" autocomplete="cc-name" [(ngModel)]="form.card.holder" /></label>
              <label>Card number
                <input name="ccnum" inputmode="numeric" autocomplete="cc-number" maxlength="23" placeholder="1234 5678 9012 3456"
                       [ngModel]="form.card.number" (ngModelChange)="form.card.number = groupCard($event)" />
              </label>
              <div class="two">
                <label>Expiry (MM/YY)
                  <input name="exp" inputmode="numeric" autocomplete="cc-exp" maxlength="5" placeholder="08/29"
                         [ngModel]="form.card.expiry" (ngModelChange)="form.card.expiry = slashExpiry($event)" />
                </label>
                <label>CVC <input name="cvc" inputmode="numeric" autocomplete="cc-csc" maxlength="4" [(ngModel)]="form.card.cvc" /></label>
              </div>
              <p class="hint">Demo payment, nothing is charged. Use 4242 4242 4242 4242 with any future date.
                4000 0000 0000 0002 shows a declined card.</p>
            </div>
            <label class="check">
              <input type="checkbox" name="terms" [(ngModel)]="form.accept_terms" />
              <span>I agree to the MyTerra terms of service and confirm my details are correct.</span>
            </label>
          </fieldset>

          @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
          <button class="btn" type="submit" [disabled]="pending()">
            {{ pending() ? 'Paying…' : 'Pay ' + (price() | currency: 'USD' : 'symbol' : '1.0-2') + ' and apply' }}
          </button>
        </form>
      }
    </div>
  `,
})
export class Apply implements OnInit {
  private api = inject(ApiService);
  plans = signal<Plan[]>([]);
  email = signal('');
  phone = signal('');
  emailVerification = signal('');
  phoneVerification = signal('');
  form = {
    name: '', password: '', birth_date: '', id_number: '', city: '', street: '', apartment: '',
    install_date: '', plan_id: '', accept_terms: false,
    card: { holder: '', number: '', expiry: '', cvc: '' },
  };
  pending = signal(false);
  error = signal('');
  sent = signal(false);
  readonly adultMax = day(0, -18);
  readonly installMin = day(1);
  readonly installMax = day(60);
  price() { return this.plans().find(p => p.id === this.form.plan_id)?.price ?? 0; }

  ngOnInit() {
    this.api.plans().subscribe({
      next: p => this.plans.set(p),
      error: e => this.error.set(errorText(e)),
    });
  }

  groupCard(v: string) {
    return v.replace(/\D/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ');
  }

  slashExpiry(v: string) {
    const d = v.replace(/\D/g, '').slice(0, 4);
    return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
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
    if (!f.card.holder.trim() || f.card.number.replace(/\D/g, '').length < 13) return 'Enter your card details';
    if (!/^\d{2}\/\d{2}$/.test(f.card.expiry)) return 'Enter the card expiry as MM/YY';
    if (!/^\d{3,4}$/.test(f.card.cvc)) return 'Enter the 3 or 4 digit CVC';
    if (!f.accept_terms) return 'Accept the terms to continue';
    return '';
  }

  submit() {
    if (this.pending()) return;
    const problem = this.problem();
    this.error.set(problem);
    if (problem) return;
    this.pending.set(true);
    this.api.apply({
      ...this.form,
      email: this.email().trim(),
      phone: this.phone().trim(),
      email_verification_id: this.emailVerification(),
      phone_verification_id: this.phoneVerification(),
      card: { ...this.form.card, number: this.form.card.number.replace(/\D/g, '') },
    }).subscribe({
      next: () => this.sent.set(true),
      error: e => {
        this.error.set(errorText(e));
        this.pending.set(false);
      },
    });
  }
}
