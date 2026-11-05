import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import qrcode from 'qrcode-generator';
import { ApiService } from '../core/api.service';
import { errorText } from '../core/errors';
import { TPipe, t } from '../core/i18n';
import { TwoFactorStatus } from '../core/models';
import { LoadError, Skeleton } from './loading';

/** Turn two-step sign-in on (scan, confirm a code, save recovery codes) or off (password + code). */
@Component({
  selector: 'app-two-factor',
  imports: [DatePipe, FormsModule, TPipe, LoadError, Skeleton],
  template: `
    <section class="card two-factor">
      <h2>{{ 'Two-step sign-in' | t }}</h2>
      @if (recovery().length) {
        <p>{{ 'Two-step sign-in is on. Save these recovery codes somewhere safe: each one signs you in once if you lose your phone.' | t }}</p>
        <ul class="recovery">@for (c of recovery(); track c) { <li><code>{{ c }}</code></li> }</ul>
        <div class="row-actions">
          <button class="btn btn-ghost btn-sm" type="button" (click)="download()">{{ 'Download codes' | t }}</button>
          <button class="btn btn-sm" type="button" (click)="recovery.set([]); load()">{{ 'I’ve saved them' | t }}</button>
        </div>
      } @else if (setup(); as s) {
        <ol class="setup-steps">
          <li>{{ 'Open an authenticator app (Google Authenticator, Microsoft Authenticator…) and scan this code.' | t }}
            <svg class="qr" [attr.viewBox]="'0 0 ' + qr().size + ' ' + qr().size" role="img" [attr.aria-label]="'QR code for your authenticator app' | t">
              <rect [attr.width]="qr().size" [attr.height]="qr().size" fill="#fff" /><path [attr.d]="qr().path" fill="#000" />
            </svg>
            <span class="hint">{{ 'Can’t scan? Enter this key in the app:' | t }} <code class="key">{{ grouped() }}</code>
              · <a [href]="s.uri">{{ 'Open in the app on this phone' | t }}</a></span>
          </li>
          <li>
            <form class="inline-form" (ngSubmit)="enable()">
              <label>{{ 'Code from the app' | t }}
                <input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" [(ngModel)]="code" />
              </label>
              <div class="row-actions">
                <button class="btn btn-sm" type="submit" [disabled]="busy()" [class.loading]="busy()">{{ 'Turn on' | t }}</button>
                <button class="link-btn" type="button" (click)="setup.set(null)">{{ 'Cancel' | t }}</button>
              </div>
            </form>
          </li>
        </ol>
      } @else if (status(); as st) {
        @if (st.enabled) {
          <p>{{ 'On since {date}. Signing in needs your password and a code from your phone.' | t: { date: (st.enabled_at | date: 'd MMM y') } }}
            {{ '{n} recovery codes left.' | t: { n: st.recovery_left } }}</p>
          @if (!turningOff()) {
            <button class="btn btn-ghost btn-sm" type="button" (click)="turningOff.set(true)">{{ 'Turn off' | t }}</button>
          } @else {
            <form class="inline-form" (ngSubmit)="disable()">
              <label>{{ 'Password' | t }} <input name="password" type="password" autocomplete="current-password" [(ngModel)]="password" /></label>
              <label>{{ 'Code' | t }} <input name="offcode" inputmode="numeric" autocomplete="one-time-code" maxlength="12" [(ngModel)]="code" /></label>
              <div class="row-actions">
                <button class="btn btn-danger btn-sm" type="submit" [disabled]="busy()" [class.loading]="busy()">{{ 'Turn off' | t }}</button>
                <button class="link-btn" type="button" (click)="turningOff.set(false)">{{ 'Cancel' | t }}</button>
              </div>
            </form>
          }
        } @else {
          <p>{{ 'Protect your account with a second step: after your password, enter a 6-digit code from an app on your phone.' | t }}</p>
          <button class="btn" type="button" (click)="start()" [disabled]="busy()" [class.loading]="busy()">{{ 'Turn on two-step sign-in' | t }}</button>
        }
      } @else if (error()) {
        <app-load-error [message]="error()" (retry)="error.set(''); load()" />
      } @else {
        <app-skeleton />
      }
      @if (error() && status()) { <p class="error" role="alert">{{ error() }}</p> }
    </section>
  `,
})
export class TwoFactorCard implements OnInit {
  private api = inject(ApiService);
  status = signal<TwoFactorStatus | null>(null);
  setup = signal<{ secret: string; uri: string } | null>(null);
  recovery = signal<string[]>([]);
  turningOff = signal(false);
  busy = signal(false);
  error = signal('');
  code = '';
  password = '';

  grouped = computed(() => this.setup()?.secret.match(/.{1,4}/g)?.join(' ') ?? '');
  /** The QR code as one SVG path (no HTML injection): a 1x1 square per dark module, plus a 2-module border. */
  qr = computed(() => {
    const qr = qrcode(0, 'M');
    qr.addData(this.setup()?.uri ?? '');
    qr.make();
    const n = qr.getModuleCount();
    let path = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c + 2} ${r + 2}h1v1h-1z`;
    return { size: n + 4, path };
  });

  ngOnInit() { this.load(); }
  load() { this.api.twoFactor().subscribe({ next: s => this.status.set(s), error: e => this.error.set(errorText(e)) }); }

  start() {
    this.run(this.api.twoFactorSetup(), s => { this.setup.set(s); this.code = ''; });
  }
  enable() {
    if (!/^\d{6}$/.test(this.code.trim())) { this.error.set(t('Enter the 6-digit code')); return; }
    this.run(this.api.twoFactorEnable(this.code.trim()), r => { this.setup.set(null); this.recovery.set(r.recovery_codes); });
  }
  disable() {
    this.run(this.api.twoFactorDisable(this.password, this.code.trim()), () => {
      this.turningOff.set(false); this.password = ''; this.code = ''; this.load();
    });
  }
  download() {
    const text = `MyTerra recovery codes (each works once)\n\n${this.recovery().join('\n')}\n`;
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: 'myterra-recovery-codes.txt' });
    a.click();
    URL.revokeObjectURL(a.href);
  }

  private run<T>(req: import('rxjs').Observable<T>, done: (r: T) => void) {
    this.busy.set(true);
    this.error.set('');
    req.subscribe({
      next: r => { this.busy.set(false); done(r); },
      error: e => { this.busy.set(false); this.error.set(errorText(e)); },
    });
  }
}
