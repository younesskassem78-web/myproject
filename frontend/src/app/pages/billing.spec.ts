import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ApiService } from '../core/api.service';
import { BillingSummary, Invoice } from '../core/models';
import { Billing } from './billing';

const inv: Invoice = { id: 'i1', number: 'INV-202610-AB', period: '2026-10-01', plan_name: 'Fiber 50 GB', amount: 20,
  status: 'unpaid', issued_at: '', due_date: '2026-11-10', paid_at: null };
const card = { holder: 'A', number: '4242424242424242', expiry: '12/30', cvc: '123' };

describe('Billing', () => {
  let api: Record<string, any>;

  async function setup(summary: Partial<BillingSummary> = {}) {
    api = {
      billing: vi.fn(() => of({ amount_due: 20, next_invoice: inv, balance: 25, autopay: false, card_brand: null, card_last4: null, ...summary })),
      invoices: vi.fn(() => of([inv])), payments: vi.fn(() => of([])),
      payInvoice: vi.fn(() => of({ ...inv, status: 'paid' })), topUp: vi.fn(() => of({ balance: 35 })),
      setAutopay: vi.fn(() => of({ autopay: true, card_brand: 'Visa', card_last4: '4242' })),
    };
    TestBed.configureTestingModule({ imports: [Billing], providers: [provideRouter([]), { provide: ApiService, useValue: api }] });
    const fixture = TestBed.createComponent(Billing);
    await fixture.whenStable();
    return fixture;
  }

  it('shows what is due and the bill list', async () => {
    const text = (await setup()).nativeElement.textContent;
    expect(text).toContain('$20.00');
    expect(text).toContain('INV-202610-AB');
    expect(text).toContain('Use balance');
  });

  it('hides "use balance" when the balance is too low', async () => {
    expect((await setup({ balance: 5 })).nativeElement.textContent).not.toContain('Use balance');
  });

  it('pays from balance and reloads', async () => {
    const fixture = await setup();
    fixture.componentInstance.payFromBalance(inv);
    await fixture.whenStable();
    expect(api['payInvoice']).toHaveBeenCalledWith('i1', 'balance');
    expect(api['billing']).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.textContent).toContain('Paid INV-202610-AB');
  });

  it('shows why a payment failed', async () => {
    const fixture = await setup();
    api['payInvoice'].mockReturnValue(throwError(() => ({ status: 402, error: { detail: 'Not enough balance. Top up or pay by card.' } })));
    fixture.componentInstance.payFromBalance(inv);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Not enough balance');
  });

  it('routes the card window to the right action', async () => {
    const c = (await setup()).componentInstance;
    c.payByCard(inv);
    c.payWithCard(card).subscribe();
    expect(api['payInvoice']).toHaveBeenCalledWith('i1', 'card', card);
    c.openAutopay();
    c.payWithCard(card).subscribe();
    expect(api['setAutopay']).toHaveBeenCalledWith(true, card);
  });

  for (const bad of ['', '0', '600', 'abc']) {
    it(`rejects top-up amount "${bad}"`, async () => {
      const fixture = await setup();
      fixture.componentInstance.amount = bad;
      fixture.componentInstance.topUp();
      await fixture.whenStable();
      expect(fixture.nativeElement.textContent).toContain('Enter an amount between 1 and 500');
      expect(fixture.nativeElement.querySelector('dialog').open).toBe(false);
    });
  }

  it('opens the card window for a valid top-up', async () => {
    const fixture = await setup();
    const c = fixture.componentInstance;
    c.amount = '10';
    c.topUp();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('dialog').open).toBe(true);
    c.payWithCard(card).subscribe();
    expect(api['topUp']).toHaveBeenCalledWith(10, card);
  });
});
