import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { map, tap } from 'rxjs';
import { ApiService } from './api.service';

const TOKEN = 'myterra_token';
const NAME = 'myterra_name';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private api = inject(ApiService);
  private router = inject(Router);
  readonly name = signal(localStorage.getItem(NAME));

  token() { return localStorage.getItem(TOKEN); }
  isLoggedIn() { return !!this.token(); }

  login(email: string, password: string) {
    return this.api.login(email, password).pipe(
      tap(r => {
        localStorage.setItem(TOKEN, r.token);
        localStorage.setItem(NAME, r.name);
        this.name.set(r.name);
      }),
      map(() => undefined),
    );
  }

  logout() {
    localStorage.removeItem(TOKEN);
    localStorage.removeItem(NAME);
    this.name.set(null);
    this.router.navigateByUrl('/login');
  }
}
