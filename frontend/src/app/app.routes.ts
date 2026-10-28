import { Routes } from '@angular/router';
import { authGuard } from './core/auth';
import { Dashboard } from './pages/dashboard';
import { Login } from './pages/login';
import { Support } from './pages/support';

export const routes: Routes = [
  { path: 'login', component: Login, title: 'Sign in | MyTerra' },
  { path: 'dashboard', component: Dashboard, canActivate: [authGuard], title: 'Overview | MyTerra' },
  { path: 'support', component: Support, canActivate: [authGuard], title: 'Support | MyTerra' },
  { path: '**', redirectTo: 'dashboard' },
];
