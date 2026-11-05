import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { TPipe } from '../core/i18n';
import { LangSwitch } from './lang-switch';

/** Top bar of the public pages (apply, password reset, status): wordmark, language, and sign in or back to the account. */
@Component({
  selector: 'app-public-header',
  imports: [TPipe, LangSwitch, RouterLink],
  template: `
    <header class="apply-head">
      <a class="wordmark" routerLink="/">myterra</a>
      <span class="head-right"><app-lang-switch />
        <a [routerLink]="auth.isLoggedIn() ? (auth.isStaff() ? '/admin' : '/dashboard') : '/login'">
          {{ (auth.isLoggedIn() ? 'Back to my account' : 'Sign in') | t }}</a></span>
    </header>
  `,
})
export class PublicHeader {
  auth = inject(AuthService);
}
