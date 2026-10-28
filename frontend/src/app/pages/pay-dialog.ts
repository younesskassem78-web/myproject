import { CurrencyPipe } from '@angular/common';
import { Component, ElementRef, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable, of, switchMap, timer } from 'rxjs';
import { errorText } from '../core/errors';

export interface CardDetails { holder: string; number: string; expiry: string; cvc: string; }

const blankCard = (): CardDetails => ({ holder: '', number: '', expiry: '', cvc: '' });

function luhnOk(n: string) {
  let sum = 0;
  [...n].reverse().forEach((ch, i) => {
    let d = +ch;
    if (i % 2) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  });
  return sum % 10 === 0;
}

/** Fake card checkout in a modal. Nothing is charged; `pay` decides what "paying" does. */
@Component({
  selector: 'app-pay-dialog',
  imports: [FormsModule, CurrencyPipe],
  template: `
    <dialog #dlg class="pay" aria-labelledby="pay-title" (cancel)="onCancel($event)" (close)="reset()">
      <form (ngSubmit)="submit()" novalidate>
        <div class="pay-head">
          <div>
            <h2 id="pay-title">Pay {{ amount() | currency }}</h2>
            @if (description()) { <p class="muted">{{ description() }}</p> }
          </div>
          <button type="button" class="pay-close" aria-label="Close" (click)="close()" [disabled]="state() !== 'idle'">✕</button>
        </div>

        <div class="card-preview" aria-hidden="true">
          <span class="card-chip"></span>
          <span class="card-brand">{{ brand() }}</span>
          <p class="card-pan">{{ card.number || '•••• •••• •••• ••••' }}</p>
          <div class="card-foot"><span>{{ card.holder || 'Your name' }}</span><span>{{ card.expiry || 'MM/YY' }}</span></div>
        </div>

        @if (state() === 'done') {
          <p class="pay-done" role="status">Payment approved</p>
        } @else {
          <label>Name on card <input name="holder" autocomplete="cc-name" [(ngModel)]="card.holder" /></label>
          <label>Card number
            <input name="number" inputmode="numeric" autocomplete="cc-number" maxlength="23" placeholder="1234 5678 9012 3456"
                   [ngModel]="card.number" (ngModelChange)="card.number = groupCard($event)" />
          </label>
          <div class="two">
            <label>Expiry
              <input name="expiry" inputmode="numeric" autocomplete="cc-exp" maxlength="5" placeholder="MM/YY"
                     [ngModel]="card.expiry" (ngModelChange)="card.expiry = slashExpiry($event)" />
            </label>
            <label>CVC <input name="cvc" inputmode="numeric" autocomplete="cc-csc" maxlength="4" placeholder="123" [(ngModel)]="card.cvc" /></label>
          </div>
          @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
          <button class="btn pay-btn" type="submit" [disabled]="state() !== 'idle'">
            {{ state() === 'processing' ? 'Processing…' : 'Pay ' + (amount() | currency) }}
          </button>
          <p class="hint">Demo checkout, nothing is charged. Test card 4242 4242 4242 4242, any future date.
            4000 0000 0000 0002 is declined.</p>
        }
      </form>
    </dialog>
  `,
})
export class PayDialog {
  amount = input.required<number>();
  description = input('');
  pay = input.required<(card: CardDetails) => Observable<unknown>>();
  delayMs = input(900); // a short wait so the fake payment feels like a real one
  paid = output<unknown>();

  private dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  card = blankCard();
  state = signal<'idle' | 'processing' | 'done'>('idle');
  error = signal('');

  open() {
    this.reset();
    const d = this.dlg().nativeElement;
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  }

  close() {
    const d = this.dlg().nativeElement;
    if (d.close) d.close(); else d.removeAttribute('open');
    this.reset();
  }

  reset() {
    this.card = blankCard();
    this.state.set('idle');
    this.error.set('');
  }

  onCancel(e: Event) {
    if (this.state() !== 'idle') e.preventDefault(); // no Esc while paying
  }

  brand() {
    const n = this.card.number.replace(/\D/g, '');
    if (n.startsWith('4')) return 'Visa';
    if (/^(5[1-5]|2[2-7])/.test(n)) return 'Mastercard';
    if (/^3[47]/.test(n)) return 'Amex';
    return '';
  }

  groupCard(v: string) { return v.replace(/\D/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 '); }

  slashExpiry(v: string) {
    const d = v.replace(/\D/g, '').slice(0, 4);
    return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
  }

  private problem(c: CardDetails): string {
    if (!c.holder.trim()) return 'Enter the name on the card';
    if (!/^\d{13,19}$/.test(c.number) || !luhnOk(c.number)) return 'Check the card number';
    const m = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(c.expiry);
    if (!m) return 'Enter the expiry as MM/YY';
    const now = new Date();
    if (2000 + +m[2] < now.getFullYear() || (2000 + +m[2] === now.getFullYear() && +m[1] < now.getMonth() + 1)) {
      return 'This card has expired';
    }
    if (!/^\d{3,4}$/.test(c.cvc)) return 'Enter the 3 or 4 digit CVC';
    return '';
  }

  submit() {
    if (this.state() !== 'idle') return;
    const card = { ...this.card, holder: this.card.holder.trim(), number: this.card.number.replace(/\D/g, '') };
    const problem = this.problem(card);
    this.error.set(problem);
    if (problem) return;
    this.state.set('processing');
    const wait = this.delayMs() ? timer(this.delayMs()) : of(0);
    wait.pipe(switchMap(() => this.pay()(card))).subscribe({
      next: result => {
        this.state.set('done');
        const finish = () => { this.close(); this.paid.emit(result); };
        if (this.delayMs()) setTimeout(finish, this.delayMs()); else finish();
      },
      error: e => {
        this.state.set('idle');
        this.error.set(errorText(e, 'The payment didn’t go through. Try again.'));
      },
    });
  }
}
