import { DatePipe } from '@angular/common';
import { TPipe, t } from '../core/i18n';
import { TwoFactorCard } from '../shared/two-factor';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { errorText } from '../core/errors';
import { EmailPrefs, EmailTopic, Me, Session } from '../core/models';
import { ThemeService } from '../core/theme.service';
import { LoadError, Skeleton } from '../shared/loading';
import { finalize } from 'rxjs';

@Component({
  selector: 'app-settings',
  imports: [TPipe, TwoFactorCard, FormsModule, DatePipe, LoadError, Skeleton],
  template: `
    <h1>{{ 'Settings' | t }}</h1>
    <div class="settings-grid">
      <section class="card">
        <h2>{{ 'Your details' | t }}</h2>
        @if (me(); as m) {
          <dl class="details">
            <div><dt>{{ 'Name' | t }}</dt><dd>{{ m.name }}</dd></div>
            <div><dt>{{ 'Email' | t }}</dt><dd>{{ m.email }}</dd></div>
            <div><dt>{{ 'Mobile' | t }}</dt><dd>{{ m.phone || 'Not set' }}</dd></div>
            <div><dt>{{ 'Address' | t }}</dt><dd>{{ m.address || 'Not set' }}</dd></div>
          </dl>
          <p class="hint">{{ "Moving or changed number? Open a support ticket and we'll update it." | t }}</p>
        } @else if (meError()) { <app-load-error [message]="meError()" (retry)="loadMe()" />
        } @else { <app-skeleton /> }
      </section>

      <form class="card" (ngSubmit)="changePassword()">
        <h2>{{ 'Change password' | t }}</h2>
        <label>{{ 'Current password' | t }} <input name="current" type="password" autocomplete="current-password" [(ngModel)]="current" /></label>
        <label>{{ 'New password' | t }} <input name="password" type="password" autocomplete="new-password" [(ngModel)]="password" />
          <span class="hint">{{ 'At least 8 characters. Other devices will be signed out.' | t }}</span></label>
        @if (pwError()) { <p class="error" role="alert">{{ pwError() }}</p> }
        @if (pwDone()) { <p class="notice" role="status">{{ 'Password changed.' | t }}</p> }
        <button class="btn" type="submit" [disabled]="busy()" [class.loading]="busy()">{{ 'Change password' | t }}</button>
      </form>

      <section class="card">
        <h2>{{ 'Email me about' | t }}</h2>
        <p class="hint">{{ 'You always see these in the app. Sign-in codes, password resets and account emails are always sent.' | t }}</p>
        @if (prefs(); as p) {
          <div class="checks">
            @for (t of topics; track t.key) {
              <label class="check">
                <input type="checkbox" [name]="t.key" [checked]="p[t.key]" (change)="toggle(t.key, $any($event.target).checked)" />
                <span>{{ t.label }}</span>
              </label>
            }
          </div>
        } @else if (prefsError()) { <app-load-error [message]="prefsError()" (retry)="loadPrefs()" />
        } @else { <app-skeleton /> }
        @if (prefsNotice()) { <p class="notice" role="status">{{ prefsNotice() }}</p> }
        @if (prefsError() && prefs()) { <p class="error" role="alert">{{ prefsError() }}</p> }
      </section>

      <section class="card">
        <h2>{{ 'Signed-in devices' | t }}</h2>
        <ul class="history">
          @for (s of sessions(); track s.id) {
            <li>
              <span>{{ s.device }} @if (s.current) { <span class="status status-paid">{{ 'This device' | t }}</span> }
                <br /><span class="muted">{{ 'Last active {date}' | t: { date: (s.last_used_at | date: 'd MMM, HH:mm') } }}{{ s.ip ? ', ' + s.ip : '' }}</span></span>
              @if (!s.current) {
                <button class="btn btn-sm btn-ghost" type="button" (click)="endSession(s)" [disabled]="!!ending()" [class.loading]="ending() === s.id" [attr.aria-label]="'Sign out {device}' | t: { device: s.device }">{{ 'Sign out' | t }}</button>
              }
            </li>
          } @empty { <li>@if (sessionsError()) { <app-load-error [message]="sessionsError()" (retry)="loadSessions()" /> } @else { <app-skeleton kind="rows" /> }</li> }
        </ul>
        @if (sessions().length > 1) {
          <button class="btn btn-ghost" type="button" (click)="endOthers()" [disabled]="!!ending()" [class.loading]="ending() === 'others'">{{ 'Sign out all other devices' | t }}</button>
        }
        @if (sessionNotice()) { <p class="notice" role="status">{{ sessionNotice() }}</p> }
        @if (endError()) { <p class="error" role="alert">{{ endError() }}</p> }
      </section>

      <app-two-factor />

      <section class="card">
        <h2>{{ 'Appearance' | t }}</h2>
        <p>{{ (theme.theme() === 'dark' ? 'Dark mode is on.' : 'Light mode is on.') | t }}</p>
        <button class="btn btn-ghost" type="button" (click)="theme.toggle($event)">
          {{ (theme.theme() === 'dark' ? 'Use light mode' : 'Use dark mode') | t }}
        </button>
      </section>
    </div>
  `,
})
export class Settings implements OnInit {
  private api = inject(ApiService);
  theme = inject(ThemeService);
  me = signal<Me | null>(null);
  current = '';
  password = '';
  busy = signal(false);
  pwError = signal('');
  pwDone = signal(false);

  readonly topics: { key: EmailTopic; label: string }[] = [
    { key: 'billing', label: 'Bills and payments' },
    { key: 'outage', label: 'Outages in my area' },
    { key: 'ticket', label: 'Replies to my support tickets' },
    { key: 'installation', label: 'My installation' },
  ];
  prefs = signal<EmailPrefs | null>(null);
  prefsNotice = signal('');
  prefsError = signal('');
  sessions = signal<Session[]>([]);
  sessionNotice = signal('');
  meError = signal('');
  sessionsError = signal('');
  endError = signal('');
  ending = signal(''); // the session being signed out ("others" for all of them), so it can't be clicked twice

  ngOnInit() {
    this.loadMe();
    this.loadPrefs();
    this.loadSessions();
  }

  loadMe() {
    this.meError.set('');
    this.api.me().subscribe({ next: m => this.me.set(m), error: e => this.meError.set(errorText(e)) });
  }
  loadPrefs() {
    this.prefsError.set('');
    this.api.emailPrefs().subscribe({ next: p => this.prefs.set(p), error: e => this.prefsError.set(errorText(e)) });
  }

  /** Saved straight away, like most settings screens. */
  toggle(topic: EmailTopic, on: boolean) {
    const next = { ...this.prefs()!, [topic]: on };
    this.prefs.set(next);
    this.prefsError.set('');
    this.api.setEmailPrefs(next).subscribe({
      next: p => { this.prefs.set(p); this.prefsNotice.set('Saved.'); },
      error: e => { this.prefsError.set(errorText(e)); this.api.emailPrefs().subscribe(p => this.prefs.set(p)); },
    });
  }

  loadSessions() {
    this.sessionsError.set('');
    this.api.sessions().subscribe({ next: s => this.sessions.set(s), error: e => this.sessionsError.set(errorText(e)) });
  }
  endSession(s: Session) {
    this.endError.set('');
    this.ending.set(s.id);
    this.api.endSession(s.id).pipe(finalize(() => this.ending.set(''))).subscribe({
      next: () => { this.sessionNotice.set(`Signed out ${s.device}.`); this.loadSessions(); },
      error: e => this.endError.set(errorText(e)),
    });
  }
  endOthers() {
    if (!confirm('Sign out every other device? You stay signed in here.')) return;
    this.endError.set('');
    this.ending.set('others');
    this.api.endOtherSessions().pipe(finalize(() => this.ending.set(''))).subscribe({
      next: r => { this.sessionNotice.set(`Signed out ${r.signed_out} other ${r.signed_out === 1 ? 'device' : 'devices'}.`); this.loadSessions(); },
      error: e => this.endError.set(errorText(e)),
    });
  }

  changePassword() {
    this.pwDone.set(false);
    if (!this.current) { this.pwError.set(t('Enter your current password')); return; }
    if (this.password.length < 8) { this.pwError.set(t('Choose a new password with at least 8 characters')); return; }
    this.busy.set(true);
    this.pwError.set('');
    this.api.changePassword(this.current, this.password).subscribe({
      next: () => { this.pwDone.set(true); this.current = ''; this.password = ''; this.busy.set(false); },
      error: e => { this.pwError.set(errorText(e)); this.busy.set(false); },
    });
  }
}
