import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable, finalize, forkJoin } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { errorText } from '../core/errors';
import { ROLE_LABEL } from '../core/permissions';
import { saveFile } from '../core/download';
import { AdminPlan, AdminUser, Application, InstallStatus, Role } from '../core/models';

type Tab = 'applications' | 'users' | 'plans';
const TITLES: Record<Tab, string> = { applications: 'Applications', users: 'Customers', plans: 'Plans' };
const blankUser = () => ({ name: '', email: '', password: '', role: 'customer' as Role, plan_id: '', balance: 0, city: '' });
/** A number typed by an admin, or null if the box is blank or not a number. Blank must never become 0. */
export function num(v: unknown): number | null {
  const s = String(v ?? '').trim();
  const n = Number(s);
  return s && Number.isFinite(n) ? n : null;
}

const blankPlan = () => ({ name: '', data_gb: null as number | null, speed_mbps: null as number | null, price: null as number | null });

const PAGE = 50;

/** Applications, customers and plans. Which one shows comes from the route. */
@Component({
  selector: 'app-admin',
  imports: [FormsModule, DatePipe, CurrencyPipe],
  template: `
    <div class="page-head">
      <h1>{{ title() }}</h1>
      @if (tab() === 'applications' && pendingCount()) { <span class="count">{{ pendingCount() }} waiting</span> }
      @if (tab() !== 'plans') {
        <input class="search" type="search" placeholder="Search name, email, phone or city" aria-label="Search"
               [(ngModel)]="query" (ngModelChange)="searchSoon()" />
      }
    </div>

    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    @if (notice()) { <p class="notice" role="status">{{ notice() }}</p> }

    @switch (tab()) {
      @case ('applications') {
        <div class="table-wrap" tabindex="0" role="region" aria-label="Scrollable table">
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
                      <button class="btn btn-sm" type="button" (click)="approve(a)" [disabled]="!!working()"
                              [class.loading]="working() === 'approve:' + a.id">{{ working() === 'approve:' + a.id ? 'Approving…' : 'Approve' }}</button>
                      <button class="btn btn-sm btn-ghost" type="button" (click)="reject(a)" [disabled]="!!working()"
                              [class.loading]="working() === 'reject:' + a.id">{{ working() === 'reject:' + a.id ? 'Rejecting…' : 'Reject' }}</button>
                    }
                  </td>
                </tr>
              } @empty { <tr><td colspan="6" class="muted">{{ !loaded() ? 'Loading…' : 'No applications' + (query ? ' match your search' : ' yet') + '.' }}</td></tr> }
            </tbody>
          </table>
        </div>
      }

      @case ('users') {
        @if (owner()) {
        <details class="card add-form">
          <summary>Add a user</summary>
          <form class="inline-form" (ngSubmit)="createUser()">
            <label>Name <input name="name" [(ngModel)]="newUser.name" /></label>
            <label>Email <input name="email" type="email" [(ngModel)]="newUser.email" /></label>
            <label>Password <input name="password" type="password" autocomplete="new-password" [(ngModel)]="newUser.password" /></label>
            <label>Role
              <select name="role" [(ngModel)]="newUser.role">
                @for (r of roles; track r) { <option [value]="r">{{ roleLabel[r] }}</option> }
              </select>
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
        } @else {
          <p class="muted">{{ auth.role() === 'support' ? 'You can look up customers. Changes are made by billing staff or the owner.'
            : 'You can change customers’ plan, installation and balance. Staff accounts, roles, passwords and access are managed by the owner.' }}</p>
        }

        <div class="table-wrap" tabindex="0" role="region" aria-label="Scrollable table">
          <table>
            <thead><tr><th>User</th><th>Role</th><th>Plan</th><th>Installation</th><th>Balance ($)</th><th>Owes</th><th>Status</th><th></th></tr></thead>
            <tbody>
              @for (u of users(); track u.id) {
                <tr [class.inactive]="!u.active">
                  <td><strong>{{ u.name }}</strong><br /><span class="muted">{{ u.email }}</span>
                    @if (u.phone || u.city) { <br /><span class="muted">{{ u.phone }} {{ u.city }}</span> }</td>
                  <td>
                    @if (owner() && u.id !== myId()) {
                      <select [attr.aria-label]="'Role for ' + u.email" [ngModel]="u.role" (ngModelChange)="setRole(u, $event)">
                        @for (r of roles; track r) { <option [value]="r">{{ roleLabel[r] }}</option> }
                      </select>
                    } @else { {{ roleLabel[u.role] }} }
                  </td>
                  <td>
                    <select [attr.aria-label]="'Plan for ' + u.email" [ngModel]="u.plan_id ?? ''" (ngModelChange)="setPlan(u, $event)" [disabled]="!canEdit(u)">
                      @if (!u.plan_id) { <option value="">No plan</option> }
                      @for (p of plans(); track p.id) { <option [value]="p.id">{{ p.name }}</option> }
                    </select>
                  </td>
                  <td>
                    @if (u.role === 'customer') {
                      <select [attr.aria-label]="'Installation for ' + u.email" [ngModel]="u.install_status ?? ''" (ngModelChange)="setInstall(u, $event)" [disabled]="!canEdit(u)">
                        @if (!u.install_status) { <option value="">Not booked</option> }
                        <option value="scheduled">Booked</option><option value="technician_assigned">Technician assigned</option><option value="installed">Installed</option>
                      </select>
                    }
                  </td>
                  <td><input class="num" inputmode="decimal" [attr.aria-label]="'Balance for ' + u.email" [(ngModel)]="u.balance" (change)="saveBalance(u)" [disabled]="!canEdit(u)" /></td>
                  <td [class.overdue-text]="u.amount_due > 0">{{ u.amount_due ? (u.amount_due | currency) : '–' }}</td>
                  <td>{{ u.active ? 'Active' : 'Deactivated' }}</td>
                  <td class="actions">
                    @if (owner()) {
                      @if (u.id !== myId()) {
                        <button class="btn btn-sm btn-ghost" type="button" (click)="toggleActive(u)">{{ u.active ? 'Deactivate' : 'Activate' }}</button>
                      }
                      <button class="btn btn-sm btn-ghost" type="button" (click)="resetPassword(u)">Reset password</button>
                      @if (u.two_factor) { <button class="btn btn-sm btn-ghost" type="button" (click)="resetTwoFactor(u)">Reset two-step</button> }
                      @if (u.id !== myId()) { <button class="btn btn-sm btn-danger" type="button" (click)="deleteUser(u)">Delete</button> }
                    }
                  </td>
                </tr>
              } @empty { <tr><td colspan="8" class="muted">{{ loaded() ? 'No users match your search.' : 'Loading…' }}</td></tr> }
            </tbody>
          </table>
        </div>
        <div class="list-foot">
          <span class="muted">Showing {{ users().length }} of {{ usersTotal() }}</span>
          @if (users().length < usersTotal()) {
            <button class="btn btn-ghost btn-sm" type="button" (click)="showMore()">Show more</button>
          }
          <button class="btn btn-ghost btn-sm" type="button" (click)="download('customers')">Download CSV</button>
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

        <div class="table-wrap" tabindex="0" role="region" aria-label="Scrollable table">
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
  working = signal(''); // "approve:<id>" while that approval (and its ~5 s email) is in progress
  loaded = signal(false); // lists say "Loading…", not "nothing here", until the data arrives
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
  auth = inject(AuthService);
  readonly roles: Role[] = ['customer', 'admin', 'billing', 'support'];
  readonly roleLabel = ROLE_LABEL;
  owner = () => this.auth.isOwner();
  /** Billing staff may change customers (not staff); support staff only look. The server checks the same. */
  canEdit = (u: AdminUser) => this.owner() || (this.auth.role() === 'billing' && u.role === 'customer');
  usersTotal = signal(0);
  private shown = PAGE; // how many customers are on screen ("Show more" adds a page)
  private searchTimer?: ReturnType<typeof setTimeout>;

  /** Customers are searched on the server (there can be thousands); wait for typing to pause. */
  searchSoon() {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => { this.shown = PAGE; this.loadUsers(); }, 300);
  }
  showMore() {
    this.shown += PAGE;
    this.loadUsers();
  }
  loadUsers() {
    this.api.adminUsers(this.query.trim(), this.shown).subscribe({
      next: r => { this.users.set(r.items); this.usersTotal.set(r.total); },
      error: e => this.error.set(errorText(e)),
    });
  }
  download(kind: 'customers') {
    this.api.exportCsv(kind).subscribe({ next: r => saveFile(r), error: e => this.error.set(errorText(e)) });
  }

  ngOnInit() {
    this.api.me().subscribe({ next: m => this.myId.set(m.id), error: () => {} });
    this.load();
  }

  load() {
    forkJoin({ applications: this.api.adminApplications(), users: this.api.adminUsers(this.query.trim(), this.shown),
               plans: this.api.adminPlans() })
      .subscribe({
        next: r => {
          this.applications.set(r.applications);
          this.users.set(r.users.items);
          this.usersTotal.set(r.users.total);
          this.plans.set(r.plans);
          this.loaded.set(true);
        },
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
    this.working.set('approve:' + a.id);
    this.api.approve(a.id).subscribe({
      next: r => {
        this.working.set('');
        this.notice.set(r.email_sent ? `Approved ${a.name}. We emailed them a sign-in link.`
          : `Approved ${a.name}, but the email didn't send. Let them know they can sign in.`);
        this.load();
      },
      error: e => { this.working.set(''); this.error.set(errorText(e)); this.load(); },
    });
  }
  reject(a: Application) {
    if (confirm(`Reject ${a.name}'s application? Their first payment is refunded.`)) {
      this.working.set('reject:' + a.id);
      this.run(this.api.reject(a.id).pipe(finalize(() => this.working.set(''))), `Rejected ${a.name}'s application.`);
    }
  }

  createUser() {
    const u = this.newUser;
    const balance = String(u.balance ?? '').trim() === '' ? 0 : num(u.balance);
    if (balance === null || balance < 0) return this.fail('Enter a balance of 0 or more');
    this.run(this.api.createUser({ ...u, plan_id: u.plan_id || null, city: u.city.trim() || null, balance }),
      `Added ${u.email}.`, () => (this.newUser = blankUser()));
  }
  resetTwoFactor(u: AdminUser) {
    if (confirm(`Turn off two-step sign-in for ${u.email}? Do this only if they lost their phone and recovery codes. They'll be signed out.`)) {
      this.run(this.api.resetTwoFactor(u.id), `Two-step sign-in is off for ${u.email}. They can sign in with their password and turn it on again.`);
    }
  }
  setRole(u: AdminUser, role: Role) { this.run(this.api.updateUser(u.id, { role }), `${u.email} is now: ${ROLE_LABEL[role]}.`); }
  setPlan(u: AdminUser, planId: string) { if (planId) this.run(this.api.updateUser(u.id, { plan_id: planId }), `Changed ${u.email}'s plan.`); }
  setInstall(u: AdminUser, status: InstallStatus) {
    if (status) this.run(this.api.updateUser(u.id, { install_status: status }), `Updated ${u.email}'s installation. They've been notified.`);
  }
  saveBalance(u: AdminUser) {
    const balance = num(u.balance);
    if (balance === null || balance < 0) { this.fail(`Enter a balance of 0 or more for ${u.email}. Nothing was saved.`); this.load(); return; }
    this.run(this.api.updateUser(u.id, { balance }), `Saved ${u.email}'s balance.`);
  }
  toggleActive(u: AdminUser) {
    this.run(this.api.updateUser(u.id, { active: !u.active }), `${u.active ? 'Deactivated' : 'Activated'} ${u.email}.`);
  }
  resetPassword(u: AdminUser) {
    const password = prompt(`New password for ${u.email} (at least 8 characters)`);
    if (password) this.run(this.api.updateUser(u.id, { password }), `Changed ${u.email}'s password and signed them out.`);
  }
  deleteUser(u: AdminUser) {
    if (confirm(`Delete ${u.email}? Their tickets are deleted too. This can't be undone.

Customers with bills or payments can't be deleted; deactivate them instead.`)) {
      this.run(this.api.deleteUser(u.id), `Deleted ${u.email}.`);
    }
  }

  /** Name, data, speed and price exactly as typed, or an error message. */
  private planFields(p: { name: string; data_gb: unknown; speed_mbps: unknown; price: unknown }) {
    const fields = { name: p.name.trim(), data_gb: num(p.data_gb), speed_mbps: num(p.speed_mbps), price: num(p.price) };
    if (!fields.name) return 'Enter a plan name';
    if (!fields.data_gb || fields.data_gb <= 0) return 'Enter the data allowance in GB (more than 0)';
    if (!fields.speed_mbps || fields.speed_mbps <= 0) return 'Enter the speed in Mbps (more than 0)';
    if (fields.price === null || fields.price < 0) return 'Enter a price of 0 or more';
    return fields;
  }

  private fail(message: string) {
    this.notice.set('');
    this.error.set(message);
  }

  createPlan() {
    const p = this.newPlan;
    const fields = this.planFields(p);
    if (typeof fields === 'string') return this.fail(fields);
    this.run(this.api.createPlan(fields),
      `Added ${p.name}.`, () => (this.newPlan = blankPlan()));
  }
  savePlan(p: AdminPlan) {
    const fields = this.planFields(p);
    if (typeof fields === 'string') { this.fail(`${fields}. Nothing was saved.`); this.load(); return; }
    this.run(this.api.updatePlan(p.id, fields), `Saved ${fields.name}.`);
  }
  togglePlan(p: AdminPlan) { this.run(this.api.updatePlan(p.id, { active: !p.active }), `${p.active ? 'Hid' : 'Put on sale'} ${p.name}.`); }
  deletePlan(p: AdminPlan) {
    if (confirm(`Delete the plan ${p.name}?`)) this.run(this.api.deletePlan(p.id), `Deleted ${p.name}.`);
  }
}
