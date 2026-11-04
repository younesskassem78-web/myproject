import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, map } from 'rxjs';
import { ApiService, Signed } from './api.service';
import { Role } from './models';
import { STAFF_ROLES } from './permissions';

const TOKEN = 'myterra_token';
const NAME = 'myterra_name';
const ROLE = 'myterra_role';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private api = inject(ApiService);
  private router = inject(Router);
  readonly name = signal(localStorage.getItem(NAME));
  readonly role = signal(localStorage.getItem(ROLE) as Role | null);

  token() { return localStorage.getItem(TOKEN); }
  isLoggedIn() { return !!this.token(); }
  /** Any staff member (owner, billing or support). */
  isStaff() { return this.isLoggedIn() && STAFF_ROLES.includes(this.role()!); }
  isOwner() { return this.isLoggedIn() && this.role() === 'admin'; }

  /** Signs in and returns the role, or `{ challenge }` when an authenticator code is needed next. */
  login(email: string, password: string): Observable<Role | { challenge: string }> {
    return this.api.login(email, password).pipe(
      map(r => 'two_factor_required' in r ? { challenge: r.challenge } : this.keep(r)),
    );
  }

  /** Second step of signing in: the code from the authenticator app (or a recovery code). */
  completeTwoFactor(challenge: string, code: string): Observable<Role> {
    return this.api.login2fa(challenge, code).pipe(map(r => this.keep(r)));
  }

  private keep(r: Signed): Role {
    localStorage.setItem(TOKEN, r.token);
    localStorage.setItem(NAME, r.name);
    localStorage.setItem(ROLE, r.role);
    this.name.set(r.name);
    this.role.set(r.role);
    return r.role;
  }

  logout() {
    // End the session on the server too; the interceptor attaches the token before we clear it.
    if (this.token()) this.api.logout().subscribe({ error: () => {} });
    for (const key of [TOKEN, NAME, ROLE]) localStorage.removeItem(key);
    this.name.set(null);
    this.role.set(null);
    this.router.navigateByUrl('/login');
  }
}
