import { Routes } from '@angular/router';
import { adminGuard, customerGuard } from './core/auth';
import { Login } from './pages/login';

const page = (title: string) => `${title} | MyTerra`;

export const routes: Routes = [
  { path: 'login', component: Login, title: page('Sign in') },
  { path: 'apply', loadComponent: () => import('./pages/apply').then(m => m.Apply), title: page('Apply') },
  { path: 'forgot', loadComponent: () => import('./pages/forgot').then(m => m.Forgot), title: page('Reset password') },
  { path: 'status', loadComponent: () => import('./pages/status').then(m => m.Status), title: page('Network status') },
  {
    path: '', canActivateChild: [customerGuard], children: [
      { path: 'dashboard', loadComponent: () => import('./pages/dashboard').then(m => m.Dashboard), title: page('Overview') },
      { path: 'billing', loadComponent: () => import('./pages/billing').then(m => m.Billing), title: page('Billing') },
      { path: 'billing/:id', loadComponent: () => import('./pages/invoice').then(m => m.InvoicePage), title: page('Invoice') },
      { path: 'speed-test', loadComponent: () => import('./pages/speed-test').then(m => m.SpeedTest), title: page('Speed test') },
      { path: 'support', loadComponent: () => import('./pages/support').then(m => m.Support), title: page('Support') },
      { path: 'support/:id', loadComponent: () => import('./pages/ticket').then(m => m.TicketPage), title: page('Ticket') },
      { path: 'plan', loadComponent: () => import('./pages/plan').then(m => m.PlanPage), title: page('Plan') },
      { path: 'settings', loadComponent: () => import('./pages/settings').then(m => m.Settings), title: page('Settings') },
    ],
  },
  {
    path: 'admin', canActivateChild: [adminGuard], children: [
      { path: '', loadComponent: () => import('./pages/admin/overview').then(m => m.AdminOverviewPage), title: page('Admin') },
      { path: 'applications', loadComponent: () => import('./pages/admin').then(m => m.Admin), data: { tab: 'applications' }, title: page('Applications') },
      { path: 'customers', loadComponent: () => import('./pages/admin').then(m => m.Admin), data: { tab: 'users' }, title: page('Customers') },
      { path: 'plans', loadComponent: () => import('./pages/admin').then(m => m.Admin), data: { tab: 'plans' }, title: page('Plans') },
      { path: 'billing', loadComponent: () => import('./pages/admin/billing').then(m => m.AdminBilling), title: page('Billing') },
      { path: 'outages', loadComponent: () => import('./pages/admin/outages').then(m => m.AdminOutages), title: page('Outages') },
      { path: 'tickets', loadComponent: () => import('./pages/admin/tickets').then(m => m.AdminTickets), title: page('Tickets') },
      { path: 'tickets/:id', loadComponent: () => import('./pages/ticket').then(m => m.TicketPage), data: { staff: true }, title: page('Ticket') },
      { path: 'audit', loadComponent: () => import('./pages/admin/audit').then(m => m.AdminAudit), title: page('Audit log') },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
