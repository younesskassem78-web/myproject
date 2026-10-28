import { Component, inject, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { errorText } from '../core/errors';

/** An email or phone field that proves the person owns it with a 6-digit code. */
@Component({
  selector: 'app-verify-field',
  imports: [FormsModule],
  template: `
    <div class="verify">
      <label>{{ label() }}
        <span class="verify-row">
          <input [type]="channel() === 'email' ? 'email' : 'tel'" [attr.autocomplete]="channel() === 'email' ? 'email' : 'tel'"
                 [placeholder]="placeholder()" [ngModel]="value()" (ngModelChange)="edit($event)"
                 [ngModelOptions]="{ standalone: true }" [readonly]="!!verifiedId()" />
          @if (verifiedId()) {
            <span class="verified">Verified</span>
          } @else {
            <button type="button" class="btn btn-sm btn-ghost" (click)="send()" [disabled]="pending() || !value().trim()">
              {{ sent() ? 'Send again' : 'Send code' }}
            </button>
          }
        </span>
      </label>
      @if (sent() && !verifiedId()) {
        <span class="verify-row">
          <input [attr.aria-label]="'Code sent to ' + value()" inputmode="numeric" autocomplete="one-time-code"
                 maxlength="6" placeholder="6-digit code" [(ngModel)]="code" [ngModelOptions]="{ standalone: true }"
                 (keydown.enter)="$event.preventDefault(); check()" />
          <button type="button" class="btn btn-sm" (click)="check()" [disabled]="pending()">Verify</button>
        </span>
        <p class="hint">We sent a code to {{ value() }}. It expires in 10 minutes.</p>
      }
      @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    </div>
  `,
})
export class VerifyField {
  private api = inject(ApiService);
  channel = input.required<'email' | 'sms'>();
  label = input.required<string>();
  placeholder = input('');
  value = model('');
  verifiedId = model('');
  code = '';
  sent = signal(false);
  pending = signal(false);
  error = signal('');

  edit(v: string) {
    this.value.set(v);
    this.verifiedId.set('');
    this.sent.set(false);
  }

  send() {
    this.pending.set(true);
    this.error.set('');
    this.api.sendCode(this.channel(), this.value().trim()).subscribe({
      next: () => { this.sent.set(true); this.code = ''; this.pending.set(false); },
      error: e => { this.error.set(errorText(e)); this.pending.set(false); },
    });
  }

  check() {
    if (!/^\d{6}$/.test(this.code.trim())) {
      this.error.set('Enter the 6-digit code');
      return;
    }
    this.pending.set(true);
    this.error.set('');
    this.api.checkCode(this.channel(), this.value().trim(), this.code.trim()).subscribe({
      next: r => { this.verifiedId.set(r.verification_id); this.pending.set(false); },
      error: e => { this.error.set(errorText(e)); this.pending.set(false); },
    });
  }
}
