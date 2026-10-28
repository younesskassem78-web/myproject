import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ApiService } from '../core/api.service';
import { Apply } from './apply';

const card = { holder: 'Ali', number: '4242424242424242', expiry: '12/30', cvc: '123' };

describe('Apply', () => {
  let api: { plans: any; apply: any; sendCode: any; checkCode: any };

  async function setup(verified = true) {
    api = {
      plans: vi.fn(() => of([{ id: 'p1', name: 'Fiber 50 GB', data_gb: 50, price: 20, active: true }])),
      apply: vi.fn(() => of({ id: 'a1', status: 'pending' })),
      sendCode: vi.fn(), checkCode: vi.fn(),
    };
    TestBed.configureTestingModule({ imports: [Apply], providers: [provideRouter([]), { provide: ApiService, useValue: api }] });
    const fixture = TestBed.createComponent(Apply);
    await fixture.whenStable();
    const c = fixture.componentInstance;
    Object.assign(c.form, {
      name: 'Ali', password: 'secret123', birth_date: '1995-04-12', id_number: 'LB12345',
      city: 'Beirut', street: 'Hamra St', install_date: '2030-01-01', plan_id: 'p1', accept_terms: true,
    });
    c.email.set('ali@x.com');
    c.phone.set('+96170123456');
    if (verified) {
      c.emailVerification.set('ve');
      c.phoneVerification.set('vp');
    }
    return fixture;
  }

  it('lists plans to choose from', async () => {
    expect((await setup()).nativeElement.textContent).toContain('Fiber 50 GB');
  });

  it('asks to verify email and phone before the payment step', async () => {
    const fixture = await setup(false);
    fixture.componentInstance.submit();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('dialog').open).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Verify your email');
  });

  it('opens the card window when the form is complete', async () => {
    const fixture = await setup();
    fixture.componentInstance.submit();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('dialog').open).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Fiber 50 GB, first month');
  });

  it('sends the application together with the card', async () => {
    const fixture = await setup();
    fixture.componentInstance.payWith(card).subscribe();
    expect(api.apply).toHaveBeenCalledWith(expect.objectContaining({
      email: 'ali@x.com', phone: '+96170123456', email_verification_id: 've', phone_verification_id: 'vp',
      plan_id: 'p1', card,
    }));
  });

  it('shows the confirmation after paying', async () => {
    const fixture = await setup();
    fixture.componentInstance.onPaid();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Application sent');
  });

  it('asks for a password of 8+ characters', async () => {
    const fixture = await setup();
    fixture.componentInstance.form.password = 'short';
    fixture.componentInstance.submit();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('at least 8 characters');
  });
});
