import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { errorText } from '../core/errors';
import { Me } from '../core/models';
import { ThemeService } from '../core/theme.service';

@Component({
  selector: 'app-settings',
  imports: [FormsModule],
  template: `
    <h1>Settings</h1>
    <div class="settings-grid">
      <section class="card">
        <h2>Your details</h2>
        @if (me(); as m) {
          <dl class="details">
            <div><dt>Name</dt><dd>{{ m.name }}</dd></div>
            <div><dt>Email</dt><dd>{{ m.email }}</dd></div>
            <div><dt>Mobile</dt><dd>{{ m.phone || 'Not set' }}</dd></div>
            <div><dt>Address</dt><dd>{{ m.address || 'Not set' }}</dd></div>
          </dl>
          <p class="hint">Moving or changed number? Open a support ticket and we'll update it.</p>
        }
      </section>

      <form class="card" (ngSubmit)="changePassword()">
        <h2>Change password</h2>
        <label>Current password <input name="current" type="password" autocomplete="current-password" [(ngModel)]="current" /></label>
        <label>New password <input name="password" type="password" autocomplete="new-password" [(ngModel)]="password" />
          <span class="hint">At least 8 characters. Other devices will be signed out.</span></label>
        @if (pwError()) { <p class="error" role="alert">{{ pwError() }}</p> }
        @if (pwDone()) { <p class="notice" role="status">Password changed.</p> }
        <button class="btn" type="submit" [disabled]="busy()">Change password</button>
      </form>

      <section class="card">
        <h2>Appearance</h2>
        <p>{{ theme.theme() === 'dark' ? 'Dark mode is on.' : 'Light mode is on.' }}</p>
        <button class="btn btn-ghost" type="button" (click)="theme.toggle()">
          Use {{ theme.theme() === 'dark' ? 'light' : 'dark' }} mode
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

  ngOnInit() { this.api.me().subscribe({ next: m => this.me.set(m), error: () => {} }); }

  changePassword() {
    this.pwDone.set(false);
    if (!this.current) { this.pwError.set('Enter your current password'); return; }
    if (this.password.length < 8) { this.pwError.set('Choose a new password with at least 8 characters'); return; }
    this.busy.set(true);
    this.pwError.set('');
    this.api.changePassword(this.current, this.password).subscribe({
      next: () => { this.pwDone.set(true); this.current = ''; this.password = ''; this.busy.set(false); },
      error: e => { this.pwError.set(errorText(e)); this.busy.set(false); },
    });
  }
}
