import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { Home } from './home';

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
});
