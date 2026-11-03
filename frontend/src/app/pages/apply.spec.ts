import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ApiService } from '../core/api.service';
import { Apply } from './apply';

const card = { holder: 'Ali', number: '4242424242424242', expiry: '12/30', cvc: '123' };
const details = {
  name: 'Ali', email: 'Ali@X.com', phone: '+961 70 123 456', password: 'secret123', birth_date: '1995-04-12',
  id_number: 'LB12345', city: 'Beirut', street: 'Hamra St', install_date: '', plan_id: 'p1',
};

describe('Apply (step by step)', () => {
  let api: { plans: any; apply: any; sendCode: any; checkCode: any };

  async function setup() {
    api = {
      plans: vi.fn(() => of([{ id: 'p1', name: 'Fiber 50 GB', data_gb: 50, speed_mbps: 100, price: 20, active: true }])),
      apply: vi.fn(() => of({ id: 'a1', status: 'pending' })),
      sendCode: vi.fn(() => of({ sent: true, demo_code: '123456' })),
      checkCode: vi.fn(() => of({ verification_id: 've' })),
    };
    TestBed.configureTestingModule({ imports: [Apply], providers: [provideRouter([]), { provide: ApiService, useValue: api }] });
    const fixture = TestBed.createComponent(Apply);
    await fixture.whenStable();
    const c = fixture.componentInstance;
    c.verifyDelayMs = 0;
    Object.assign(c.form, details, { install_date: c.installMin });
    return { fixture, c };
  }

  /** Fills everything and walks to the review step. */
  async function toReview() {
    const s = await setup();
    s.c.next(); // plan -> details
    s.c.next(); // details -> home
    s.c.next(); // home -> verify (sends the code)
    s.c.code = '123456';
    s.c.next(); // verify -> review
    await s.fixture.whenStable();
    return s;
  }

  it('starts with the plans', async () => {
    const { fixture, c } = await setup();
    expect(c.step()).toBe('plan');
    expect(fixture.nativeElement.textContent).toContain('Fiber 50 GB');
  });

  it('marks required fields and optional ones', async () => {
    const { fixture, c } = await setup();
    c.go('home');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('.req').length).toBeGreaterThan(3);
    expect(fixture.nativeElement.textContent).toContain('(optional)');
  });

  it('stays on a step until it is complete', async () => {
    const { fixture, c } = await setup();
    c.go('details');
    c.form.phone = '70123';
    c.next();
    await fixture.whenStable();
    expect(c.step()).toBe('details');
    expect(fixture.nativeElement.textContent).toContain('country code');
  });

  it('verifies only the email, on its own step, then shows the review', async () => {
    const { c } = await toReview();
    expect(api.sendCode).toHaveBeenCalledWith('email', 'ali@x.com');
    expect(api.sendCode).toHaveBeenCalledTimes(1);
    expect(api.checkCode).toHaveBeenCalledWith('email', 'ali@x.com', '123456');
    expect(c.step()).toBe('review');
  });

  it('asks for a new code if the email changes after verifying', async () => {
    const { c } = await toReview();
    c.go('details');
    c.form.email = 'other@x.com';
    c.next();
    c.next();
    expect(c.step()).toBe('verify');
  });

  it('shows why the code could not be sent', async () => {
    const { fixture, c } = await setup();
    api.sendCode.mockReturnValue(throwError(() => ({ status: 409, error: { detail: 'An account with this email already exists.' } })));
    c.go('verify');
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('already exists');
  });

  it('needs the terms before opening the card window', async () => {
    const { fixture, c } = await toReview();
    c.next();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('dialog').open).toBe(false);
    c.form.accept_terms = true;
    c.next();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('dialog').open).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Fiber 50 GB, first month');
  });

  it('sends the application with the card and the email verification', async () => {
    const { c } = await toReview();
    c.payWith(card).subscribe();
    expect(api.apply).toHaveBeenCalledWith(expect.objectContaining({
      email: 'ali@x.com', email_verification_id: 've', plan_id: 'p1', card,
    }));
    expect(api.apply.mock.calls[0][0]).not.toHaveProperty('phone_verification_id');
  });

  it('shows the confirmation after paying', async () => {
    const { fixture, c } = await setup();
    c.onPaid();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Application sent');
  });
});
