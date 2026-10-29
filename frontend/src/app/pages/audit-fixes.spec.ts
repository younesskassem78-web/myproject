// Regression tests for frontend defects found in the QA audit (docs/qa/AUDIT.md).
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AdminUser } from '../core/models';
import { adminGuard } from '../core/auth';
import { AuthService } from '../core/auth.service';
import { Admin, num } from './admin';
import { Apply } from './apply';
import { PlanPage } from './plan';

const user: AdminUser = { id: 'u1', name: 'Demo', email: 'demo@x.com', role: 'customer', plan_id: 'p1', plan_name: 'Fiber 50 GB',
  balance: 5, active: true, created_at: '', phone: null, address: null, city: null, install_status: null,
  install_date: null, amount_due: 0 };
const plan = { id: 'p1', name: 'Fiber 50 GB', data_gb: 50, speed_mbps: 100, price: 20, active: true, users: 1 };

describe('D4: admin number boxes never save a blank as 0', () => {
  let api: Record<string, any>;

  async function setup() {
    api = {
      me: vi.fn(() => of({ id: 'me' })), adminApplications: vi.fn(() => of([])), adminUsers: vi.fn(() => of([user])),
      adminPlans: vi.fn(() => of([plan])), updateUser: vi.fn(() => of(user)), updatePlan: vi.fn(() => of(plan)),
      createPlan: vi.fn(() => of(plan)),
    };
    TestBed.configureTestingModule({ imports: [Admin], providers: [{ provide: ApiService, useValue: api }] });
    const fixture = TestBed.createComponent(Admin);
    await fixture.whenStable();
    return fixture;
  }

  it('reads numbers strictly', () => {
    expect(num('')).toBeNull();
    expect(num('  ')).toBeNull();
    expect(num('abc')).toBeNull();
    expect(num('0')).toBe(0);
    expect(num(' 12.5 ')).toBe(12.5);
  });

  it('does not save a cleared balance', async () => {
    const fixture = await setup();
    fixture.componentInstance.saveBalance({ ...user, balance: '' as any });
    await fixture.whenStable();
    expect(api['updateUser']).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Nothing was saved');
  });

  it('saves a real balance, including 0', async () => {
    const fixture = await setup();
    fixture.componentInstance.saveBalance({ ...user, balance: '0' as any });
    expect(api['updateUser']).toHaveBeenCalledWith('u1', { balance: 0 });
  });

  it('does not save a plan with a cleared price', async () => {
    const fixture = await setup();
    fixture.componentInstance.savePlan({ ...plan, price: '' as any });
    expect(api['updatePlan']).not.toHaveBeenCalled();
  });

  it('does not create a plan with missing numbers', async () => {
    const fixture = await setup();
    fixture.componentInstance.newPlan = { name: 'Fiber 200', data_gb: 200, speed_mbps: null, price: 40 };
    fixture.componentInstance.createPlan();
    await fixture.whenStable();
    expect(api['createPlan']).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('speed in Mbps');
  });
});

describe('D6: customers who open an admin address', () => {
  function run(loggedIn: boolean, admin: boolean) {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: { isLoggedIn: () => loggedIn, isAdmin: () => admin } }],
    });
    const r = TestBed.runInInjectionContext(() => adminGuard({} as any, {} as any));
    return r === true ? true : TestBed.inject(Router).serializeUrl(r as UrlTree);
  }

  it('go to their overview', () => expect(run(true, false)).toBe('/dashboard'));
  it('signed-out visitors go to sign in', () => expect(run(false, false)).toBe('/login'));
  it('admins get in', () => expect(run(true, true)).toBe(true));
});

describe('D10: a customer on a plan that is no longer sold', () => {
  it('still sees their plan', async () => {
    const hidden = { ...plan, id: 'old', name: 'Legacy 10 GB', active: false };
    const api = { plans: vi.fn(() => of([plan])), me: vi.fn(() => of({ plan: hidden })) };
    TestBed.configureTestingModule({ imports: [PlanPage], providers: [{ provide: ApiService, useValue: api }] });
    const fixture = TestBed.createComponent(PlanPage);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Legacy 10 GB');
    expect(fixture.nativeElement.textContent).toContain('no longer sold');
  });
});

describe('D11: applying when no plans are for sale', () => {
  it('says applications are closed', async () => {
    const api = { plans: vi.fn(() => of([])) };
    TestBed.configureTestingModule({ imports: [Apply], providers: [provideRouter([]), { provide: ApiService, useValue: api }] });
    const fixture = TestBed.createComponent(Apply);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('No plans are available right now');
  });
});
