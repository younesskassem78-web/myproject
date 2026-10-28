import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { PayDialog } from './pay-dialog';

describe('PayDialog', () => {
  let pay: any;

  async function setup() {
    pay = vi.fn(() => of({ ok: true }));
    TestBed.configureTestingModule({ imports: [PayDialog] });
    const fixture = TestBed.createComponent(PayDialog);
    fixture.componentRef.setInput('amount', 30);
    fixture.componentRef.setInput('pay', pay);
    fixture.componentRef.setInput('delayMs', 0);
    const c = fixture.componentInstance;
    c.open();
    Object.assign(c.card, { holder: 'Ali', number: '4242 4242 4242 4242', expiry: '12/30', cvc: '123' });
    await fixture.whenStable();
    return fixture;
  }

  it('shows the amount', async () => {
    expect((await setup()).nativeElement.textContent).toContain('$30.00');
  });

  it('pays with a clean card number and reports the result', async () => {
    const fixture = await setup();
    const paid = vi.fn();
    fixture.componentInstance.paid.subscribe(paid);
    fixture.componentInstance.submit();
    await fixture.whenStable();
    expect(pay).toHaveBeenCalledWith({ holder: 'Ali', number: '4242424242424242', expiry: '12/30', cvc: '123' });
    expect(paid).toHaveBeenCalledWith({ ok: true });
  });

  for (const [field, value, message] of [
    ['number', '4242 4242 4242 4241', 'card number'],
    ['expiry', '01/20', 'expired'],
    ['cvc', '1', 'CVC'],
    ['holder', ' ', 'name'],
  ]) {
    it(`rejects a bad ${field} without paying`, async () => {
      const fixture = await setup();
      (fixture.componentInstance.card as any)[field] = value;
      fixture.componentInstance.submit();
      await fixture.whenStable();
      expect(pay).not.toHaveBeenCalled();
      expect(fixture.nativeElement.textContent).toContain(message);
    });
  }

  it('shows a decline and stays open', async () => {
    const fixture = await setup();
    pay.mockReturnValue(throwError(() => ({ status: 402, error: { detail: 'Your card was declined. Try another card.' } })));
    fixture.componentInstance.submit();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Your card was declined');
    expect(fixture.componentInstance.state()).toBe('idle');
  });

  it('ignores a second click while paying', async () => {
    const fixture = await setup();
    pay.mockReturnValue(new Subject());
    fixture.componentInstance.submit();
    fixture.componentInstance.submit();
    expect(pay).toHaveBeenCalledTimes(1);
  });

  it('forgets the card when closed', async () => {
    const fixture = await setup();
    fixture.componentInstance.close();
    expect(fixture.componentInstance.card.number).toBe('');
    expect(fixture.componentInstance.card.cvc).toBe('');
  });
});
