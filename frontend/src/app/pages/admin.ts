import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable, forkJoin } from 'rxjs';
import { ApiService } from '../core/api.service';
import { errorText } from '../core/errors';
import { AdminPlan, AdminUser, Application, InstallStatus, Role } from '../core/models';

type Tab = 'applications' | 'users' | 'plans';
const TITLES: Record<Tab, string> = { applications: 'Applications', users: 'Customers', plans: 'Plans' };
const blankUser = () => ({ name: '', email: '', password: '', role: 'customer' as Role, plan_id: '', balance: 0, city: '' });
const blankPlan = () => ({ name: '', data_gb: null as number | null, speed_mbps: null as number | null, price: null as number | null });

/** Applications, customers and plans. Which one shows comes from the route. */
@Component({
  selector: 'app-admin',
  imports: [FormsModule, DatePipe, CurrencyPipe],
  template: `
    <div class="page-head">
      <h1>{{ title() }}</h1>
      @if (tab() === 'applications' && pendingCount()) { <span class="count">{{ pendingCount() }} waiting</span> }
      @if (tab() !== 'plans') {
        <input class="search" type="search" placeholder="Search name or email" aria-label="Search" [(ngModel)]="query" />
      }
    </div>

    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    @if (notice()) { <p class="notice" role="status">{{ notice() }}</p> }

    @switch (tab()) {
      @case ('applications') {
        <div class="table-wrap">
          <table>
            <thead><tr><th>Applicant</th><th>Home and installation</th><th>Plan and payment</th><th>Sent</th><th>Status</th><th></th></tr></thead>
            <tbody>
              @for (a of filteredApps(); track a.id) {
                <tr>
                  <td>
                    <strong>{{ a.name }}</strong><br />
                    <span class="muted">{{ a.email }}</span><br />
                    <span class="muted">{{ a.phone }}</span>
                    @if (a.birth_date) { <br /><span class="muted">Born {{ a.birth_date | date: 'd MMM y' }}, ID {{ a.id_number }}</span> }
                  </td>
                  <td>
                    @if (a.city) {
                      {{ a.street }}@if (a.apartment) {, {{ a.apartment }}}<br />{{ a.city }}<br />
                      <span class="muted">Install {{ a.install_date | date: 'EEE d MMM' }}</span>
                    }
                  </td>
                  <td>
                    {{ a.plan_name }}
                    @if (a.card_last4) { <br /><span class="muted">Paid {{ a.amount_paid | currency }}, {{ a.card_brand }} ending {{ a.card_last4 }}</span> }
                  </td>
                  <td>{{ a.created_at | date: 'd MMM, HH:mm' }}</td>
                  <td><span class="status status-{{ a.status }}">{{ appLabel(a.status) }}</span></td>
                  <td class="actions">
                    @if (a.status === 'pending') {
                      <button class="btn btn-sm" type="button" (click)="approve(a)">Approve</button>
                      <button class="btn btn-sm btn-ghost" type="button" (click)="reject(a)">Reject</button>
                    }
                  </td>
                </tr>
              } @empty { <tr><td colspan="6" class="muted">No applications{{ query ? ' match your search' : ' yet' }}.</td></tr> }
            </tbody>
          </table>
        </div>
      }

      @case ('users') {
        <details class="card add-form">
          <summary>Add a user</summary>
          <form class="inline-form" (ngSubmit)="createUser()">
            <label>Name <input name="name" [(ngModel)]="newUser.name" /></label>
            <label>Email <input name="email" type="email" [(ngModel)]="newUser.email" /></label>
            <label>Password <input name="password" type="password" autocomplete="new-password" [(ngModel)]="newUser.password" /></label>
            <label>Role
              <select name="role" [(ngModel)]="newUser.role"><option value="customer">Customer</option><option value="admin">Admin</option></select>
            </label>
            <label>Plan
              <select name="plan" [(ngModel)]="newUser.plan_id">
                <option value="">No plan</option>
                @for (p of plans(); track p.id) { <option [value]="p.id">{{ p.name }}</option> }
              </select>
            </label>
            <label>City <input name="city" [(ngModel)]="newUser.city" /></label>
            <label>Balance ($) <input name="balance" inputmode="decimal" [(ngModel)]="newUser.balance" /></label>
            <button class="btn btn-sm" type="submit">Add user</button>
          </form>
        </details>

        <div class="table-wrap">
          <table>
            <thead><tr><th>User</th><th>Role</th><th>Plan</th><th>Installation</th><th>Balance ($)</th><th>Owes</th><th>Status</th><th></th></tr></thead>
            <tbody>
              @for (u of filteredUsers(); track u.id) {
                <tr [class.inactive]="!u.active">
                  <td><strong>{{ u.name }}</strong><br /><span class="muted">{{ u.email }}</span>
                    @if (u.phone || u.city) { <br /><span class="muted">{{ u.phone }} {{ u.city }}</span> }</td>
                  <td>
                    <select [attr.aria-label]="'Role for ' + u.email" [ngModel]="u.role" (ngModelChange)="setRole(u, $event)" [disabled]="u.id === myId()">
                      <option value="customer">Customer</option><option value="admin">Admin</option>
                    </select>
                  </td>
                  <td>
                    <select [attr.aria-label]="'Plan for ' + u.email" [ngModel]="u.plan_id ?? ''" (ngModelChange)="setPlan(u, $event)">
                      @if (!u.plan_id) { <option value="">No plan</option> }
                      @for (p of plans(); track p.id) { <option [value]="p.id">{{ p.name }}</option> }
                    </select>
                  </td>
                  <td>
                    @if (u.role === 'customer') {
                      <select [attr.aria-label]="'Installation for ' + u.email" [ngModel]="u.install_status ?? ''" (ngModelChange)="setInstall(u, $event)">
                        @if (!u.install_status) { <option value="">Not booked</option> }
                        <option value="scheduled">Booked</option><option value="technician_assigned">Technician assigned</option><option value="installed">Installed</option>
                      </select>
                    }
                  </td>
                  <td><input class="num" inputmode="decimal" [attr.aria-label]="'Balance for ' + u.email" [(ngModel)]="u.balance" (change)="saveBalance(u)" /></td>
                  <td [class.overdue-text]="u.amount_due > 0">{{ u.amount_due ? (u.amount_due | currency) : '–' }}</td>
                  <td>{{ u.active ? 'Active' : 'Deactivated' }}</td>
                  <td class="actions">
                    @if (u.id !== myId()) {
                      <button class="btn btn-sm btn-ghost" type="button" (click)="toggleActive(u)">{{ u.active ? 'Deactivate' : 'Activate' }}</button>
                    }
                    <button class="btn btn-sm btn-ghost" type="button" (click)="resetPassword(u)">Reset password</button>
                    @if (u.id !== myId()) { <button class="btn btn-sm btn-danger" type="button" (click)="deleteUser(u)">Delete</button> }
                  </td>
                </tr>
              } @empty { <tr><td colspan="8" class="muted">No users match your search.</td></tr> }
            </tbody>
          </table>
        </div>
      }

      @case ('plans') {
        <form class="card inline-form" (ngSubmit)="createPlan()">
          <h2>Add a plan</h2>
          <label>Name <input name="pname" placeholder="Fiber 200 GB" [(ngModel)]="newPlan.name" /></label>
          <label>Data (GB) <input name="pgb" inputmode="numeric" [(ngModel)]="newPlan.data_gb" /></label>
          <label>Speed (Mbps) <input name="pspeed" inputmode="numeric" [(ngModel)]="newPlan.speed_mbps" /></label>
          <label>Price ($/month) <input name="pprice" inputmode="decimal" [(ngModel)]="newPlan.price" /></label>
          <button class="btn btn-sm" type="submit">Add plan</button>
        </form>

        <div class="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Data (GB)</th><th>Speed (Mbps)</th><th>Price ($)</th><th>Customers</th><th>Status</th><th></th></tr></thead>
            <tbody>
              @for (p of plans(); track p.id) {
                <tr [class.inactive]="!p.active">
                  <td><input [attr.aria-label]="'Name of ' + p.name" [(ngModel)]="p.name" /></td>
                  <td><input class="num" inputmode="numeric" [attr.aria-label]="'Data for ' + p.name" [(ngModel)]="p.data_gb" /></td>
                  <td><input class="num" inputmode="numeric" [attr.aria-label]="'Speed for ' + p.name" [(ngModel)]="p.speed_mbps" /></td>
                  <td><input class="num" inputmode="decimal" [attr.aria-label]="'Price for ' + p.name" [(ngModel)]="p.price" /></td>
                  <td>{{ p.users }}</td>
                  <td>{{ p.active ? 'On sale' : 'Hidden' }}</td>
                  <td class="actions">
                    <button class="btn btn-sm" type="button" (click)="savePlan(p)">Save</button>
                    <button class="btn btn-sm btn-ghost" type="button" (click)="togglePlan(p)">{{ p.active ? 'Hide' : 'Put on sale' }}</button>
                    <button class="btn btn-sm btn-danger" type="button" (click)="deletePlan(p)">Delete</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    }
  `,
})
export class Admin implements OnInit {
  private api = inject(ApiService);
  tab = input<Tab>('applications');
  title = computed(() => TITLES[this.tab()]);
  myId = signal('');
  applications = signal<Application[]>([]);
  users = signal<AdminUser[]>([]);
  plans = signal<AdminPlan[]>([]);
  error = signal('');
  notice = signal('');
  query = '';
  pendingCount = computed(() => this.applications().filter(a => a.status === 'pending').length);

  newUser = blankUser();
  newPlan = blankPlan();

  appLabel = (s: string) => ({ pending: 'Waiting', approved: 'Approved', rejected: 'Rejected' } as Record<string, string>)[s];

  private matches(...fields: (string | null)[]) {
    const q = this.query.trim().toLowerCase();
    return !q || fields.some(f => f?.toLowerCase().includes(q));
  }
  filteredApps = () => this.applications().filter(a => this.matches(a.name, a.email, a.phone));
  filteredUsers = () => this.users().filter(u => this.matches(u.name, u.email, u.phone, u.city));

  ngOnInit() {
    this.api.me().subscribe({ next: m => this.myId.set(m.id), error: () => {} });
    this.load();
  }

  load() {
    forkJoin({ applications: this.api.adminApplications(), users: this.api.adminUsers(), plans: this.api.adminPlans() })
      .subscribe({
        next: r => { this.applications.set(r.applications); this.users.set(r.users); this.plans.set(r.plans); },
        error: e => this.error.set(errorText(e)),
      });
  }

  /** Runs an admin action, shows the outcome, and reloads so every count stays right. */
  private run(action: Observable<unknown>, done: string, after?: () => void) {
    this.error.set('');
    this.notice.set('');
    action.subscribe({
      next: () => { this.notice.set(done); after?.(); this.load(); },
      error: e => { this.error.set(errorText(e, 'That didn’t work. Check the fields and try again.')); this.load(); },
    });
  }

  approve(a: Application) {
    this.error.set('');
    this.notice.set('');
    this.api.approve(a.id).subscribe({
      next: r => {
        this.notice.set(r.email_sent ? `Approved ${a.name}. We emailed them a sign-in link.`
          : `Approved ${a.name}, but the email didn't send. Let them know they can sign in.`);
        this.load();
      },
      error: e => { this.error.set(errorText(e)); this.load(); },
    });
  }
  reject(a: Application) {
    if (confirm(`Reject ${a.name}'s application? Their first payment is refunded.`)) {
      this.run(this.api.reject(a.id), `Rejected ${a.name}'s application.`);
    }
  }

  createUser() {
    const u = this.newUser;
    this.run(this.api.createUser({ ...u, plan_id: u.plan_id || null, city: u.city.trim() || null, balance: Number(u.balance) || 0 }),
      `Added ${u.email}.`, () => (this.newUser = blankUser()));
  }
  setRole(u: AdminUser, role: Role) { this.run(this.api.updateUser(u.id, { role }), `${u.email} is now ${role === 'admin' ? 'an admin' : 'a customer'}.`); }
  setPlan(u: AdminUser, planId: string) { if (planId) this.run(this.api.updateUser(u.id, { plan_id: planId }), `Changed ${u.email}'s plan.`); }
  setInstall(u: AdminUser, status: InstallStatus) {
    if (status) this.run(this.api.updateUser(u.id, { install_status: status }), `Updated ${u.email}'s installation. They've been notified.`);
  }
  saveBalance(u: AdminUser) { this.run(this.api.updateUser(u.id, { balance: Number(u.balance) }), `Saved ${u.email}'s balance.`); }
  toggleActive(u: AdminUser) {
    this.run(this.api.updateUser(u.id, { active: !u.active }), `${u.active ? 'Deactivated' : 'Activated'} ${u.email}.`);
  }
  resetPassword(u: AdminUser) {
    const password = prompt(`New password for ${u.email} (at least 8 characters)`);
    if (password) this.run(this.api.updateUser(u.id, { password }), `Changed ${u.email}'s password and signed them out.`);
  }
  deleteUser(u: AdminUser) {
    if (confirm(`Delete ${u.email}? Their bills and tickets are deleted too. This can't be undone.`)) {
      this.run(this.api.deleteUser(u.id), `Deleted ${u.email}.`);
    }
  }

  createPlan() {
    const p = this.newPlan;
    this.run(this.api.createPlan({ name: p.name, data_gb: Number(p.data_gb), speed_mbps: Number(p.speed_mbps) || 100, price: Number(p.price) }),
      `Added ${p.name}.`, () => (this.newPlan = blankPlan()));
  }
  savePlan(p: AdminPlan) {
    this.run(this.api.updatePlan(p.id, { name: p.name, data_gb: Number(p.data_gb), speed_mbps: Number(p.speed_mbps), price: Number(p.price) }),
      `Saved ${p.name}.`);
  }
  togglePlan(p: AdminPlan) { this.run(this.api.updatePlan(p.id, { active: !p.active }), `${p.active ? 'Hid' : 'Put on sale'} ${p.name}.`); }
  deletePlan(p: AdminPlan) {
    if (confirm(`Delete the plan ${p.name}?`)) this.run(this.api.deletePlan(p.id), `Deleted ${p.name}.`);
  }
}
