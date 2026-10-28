import { Routes } from '@angular/router';
import { adminGuard, customerGuard } from './core/auth';
import { Login } from './pages/login';
import { Support } from './pages/support';

export const routes: Routes = [
  { path: 'login', component: Login, title: 'Sign in | MyTerra' },
  { path: 'apply', loadComponent: () => import('./pages/apply').then(m => m.Apply), title: 'Apply | MyTerra' },
  { path: 'dashboard', loadComponent: () => import('./pages/dashboard').then(m => m.Dashboard), canActivate: [customerGuard], title: 'Overview | MyTerra' },
  { path: 'support', component: Support, canActivate: [customerGuard], title: 'Support | MyTerra' },
  { path: 'admin', loadComponent: () => import('./pages/admin').then(m => m.Admin), canActivate: [adminGuard], title: 'Admin | MyTerra' },
  { path: '**', redirectTo: 'dashboard' },
];
