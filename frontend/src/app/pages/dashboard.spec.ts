import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiService } from '../core/api.service';
import { Me, Usage } from '../core/models';
import { Dashboard } from './dashboard';

const me: Me = {
  id: 'u1', role: 'customer', name: 'Demo User', email: 'demo@myterra.app', balance: 5,
  plan: { id: 'p1', name: 'Fiber 50 GB', data_gb: 50, price: 20, active: true },
};
const usage: Usage = { month: '2026-10', limit_gb: 50, used_gb: 3.5, days: [{ day: 1, gb: 1.5 }, { day: 2, gb: 2 }] };

describe('Dashboard', () => {
  let api: { me: any; usage: any; topUp: any };

  async function setup() {
    api = { me: vi.fn(() => of(me)), usage: vi.fn(() => of(usage)), topUp: vi.fn(() => of({ balance: 15 })) };
    TestBed.configureTestingModule({ imports: [Dashboard], providers: [{ provide: ApiService, useValue: api }] });
    const fixture = TestBed.createComponent(Dashboard);
    await fixture.whenStable();
    return fixture;
  }

  it('shows plan, balance and usage', async () => {
    const text = (await setup()).nativeElement.textContent;
    expect(text).toContain('Fiber 50 GB');
    expect(text).toContain('$20/month');
    expect(text).toContain('$5.00');
    expect(text).toContain('3.50 GB of 50 GB used');
  });

  it('opens the card window, then shows the new balance', async () => {
    const fixture = await setup();
    const c = fixture.componentInstance;
    c.amount = '10';
    c.topUp();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('dialog').open).toBe(true);
    c.payTopUp().subscribe(r => c.onTopUpPaid(r));
    await fixture.whenStable();
    expect(api.topUp).toHaveBeenCalledWith(10);
    expect(fixture.nativeElement.textContent).toContain('$15.00');
  });

  for (const bad of ['', '0', '-5', '600', 'abc']) {
    it(`rejects top-up amount "${bad}"`, async () => {
      const fixture = await setup();
      fixture.componentInstance.amount = bad;
      fixture.componentInstance.topUp();
      await fixture.whenStable();
      expect(api.topUp).not.toHaveBeenCalled();
      expect(fixture.nativeElement.textContent).toContain('Enter an amount between 1 and 500');
    });
  }
});
