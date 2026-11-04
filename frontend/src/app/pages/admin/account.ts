import { Component } from '@angular/core';
import { TwoFactorCard } from '../../shared/two-factor';

/** A staff member's own sign-in security. */
@Component({
  selector: 'app-admin-account',
  imports: [TwoFactorCard],
  template: `
    <div class="page-head"><h1>My account</h1></div>
    <p class="muted lead">Staff accounts can see customer details and payments, so protect yours with two-step sign-in.</p>
    <app-two-factor />
  `,
})
export class AdminAccount {}
