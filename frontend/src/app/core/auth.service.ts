import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { map, tap } from 'rxjs';
import { ApiService } from './api.service';
import { Role } from './models';

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
  isAdmin() { return this.isLoggedIn() && this.role() === 'admin'; }

  /** Signs in and returns the user's role. */
  login(email: string, password: string) {
    return this.api.login(email, password).pipe(
      tap(r => {
        localStorage.setItem(TOKEN, r.token);
        localStorage.setItem(NAME, r.name);
        localStorage.setItem(ROLE, r.role);
        this.name.set(r.name);
        this.role.set(r.role);
      }),
      map(r => r.role),
    );
  }

  logout() {
    for (const key of [TOKEN, NAME, ROLE]) localStorage.removeItem(key);
    this.name.set(null);
    this.role.set(null);
    this.router.navigateByUrl('/login');
  }
}
