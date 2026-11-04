import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';
import { StaffArea, canSee } from './permissions';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.token();
  if (token) req = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  return next(req).pipe(
    catchError(err => {
      // Tokens live in server memory, so a backend restart makes ours stale.
      if (err.status === 401 && token && !req.url.endsWith('/logout')) auth.logout();
      return throwError(() => err);
    }),
  );
};

export const authGuard: CanActivateFn = () =>
  inject(AuthService).isLoggedIn() || inject(Router).parseUrl('/login');

// UI only: the backend checks the staff role on every admin request.
export const adminGuard: CanActivateFn = route => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.isStaff()) return router.parseUrl(auth.isLoggedIn() ? '/dashboard' : '/login');
  const area = route.data?.['area'] as StaffArea | undefined;
  return !area || canSee(auth.role(), area) || router.parseUrl('/admin'); // a page outside their role: back to overview
};

export const customerGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  if (!auth.isLoggedIn()) return inject(Router).parseUrl('/login');
  return !auth.isStaff() || inject(Router).parseUrl('/admin');
};
