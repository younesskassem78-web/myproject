import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { Home, householdNeed, recommend } from './home';

const plans = [
  { id: 'p1', name: 'Fiber 50 GB', data_gb: 50, speed_mbps: 100, price: 20, active: true },
  { id: 'p2', name: 'Fiber 100 GB', data_gb: 100, speed_mbps: 300, price: 30, active: true },
];

describe('Home', () => {
  async function setup(loggedIn = false, active: unknown[] = []) {
    const api = { plans: vi.fn(() => of(plans)), status: vi.fn(() => of({ active, recent: [] })) };
    const auth = { isLoggedIn: () => loggedIn, isStaff: () => false };
    TestBed.configureTestingModule({ imports: [Home], providers: [provideRouter([]), { provide: ApiService, useValue: api }, { provide: AuthService, useValue: auth }] });
    const fixture = TestBed.createComponent(Home);
    await fixture.whenStable();
    return fixture;
  }

  it('shows the real plans and marks the lowest price per GB', async () => {
    const fixture = await setup();
    expect(fixture.componentInstance.bestValue()).toBe('p2'); // $0.30/GB beats $0.40/GB
    expect(fixture.nativeElement.textContent).toContain('Fiber 100 GB');
    expect(fixture.nativeElement.querySelector('.home-plan.best h3').textContent).toBe('Fiber 100 GB');
  });

  it('offers apply and sign in to visitors, and "My account" once signed in', async () => {
    expect((await setup()).nativeElement.textContent).toContain('Apply now');
    TestBed.resetTestingModule();
    const signedIn = await setup(true);
    expect(signedIn.nativeElement.querySelector('.home-head').textContent).toContain('My account');
  });

  it('shows live network status', async () => {
    const fixture = await setup(false, [{ id: 'o1' }]);
    expect(fixture.nativeElement.querySelector('.status-pill').textContent).toContain('One area has a known issue.');
  });

  it('plan finder: estimates the need and picks the cheapest plan that covers it', () => {
    expect(householdNeed(1.5, [])).toEqual({ gb: 18, mbps: 23 });
    const busy = householdNeed(3.5, ['stream4k', 'gaming']);
    expect(busy.gb).toBeGreaterThan(householdNeed(3.5, []).gb);
    expect(recommend(plans, { gb: 40, mbps: 90 })).toEqual({ plan: plans[0], fits: true });  // 50 GB / 100 Mbps is enough
    expect(recommend(plans, { gb: 80, mbps: 90 })?.plan.id).toBe('p2');                    // needs the 100 GB plan
    expect(recommend(plans, { gb: 500, mbps: 90 })).toEqual({ plan: plans[1], fits: false }); // nothing fits: biggest plan
    expect(recommend([], { gb: 1, mbps: 1 })).toBeNull();
  });

  it('plan finder updates when the household changes', async () => {
    const fixture = await setup();
    const c = fixture.componentInstance;
    c.household.set('small');
    c.chosen.set([]);
    expect(c.suggestion()?.plan.id).toBe('p1');
    c.household.set('large');
    c.toggle('downloads');
    expect(c.suggestion()?.plan.id).toBe('p2');
  });
});
