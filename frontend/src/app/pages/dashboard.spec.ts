import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ApiService } from '../core/api.service';
import { BillingSummary, Me, Usage } from '../core/models';
import { Dashboard } from './dashboard';

const base: Me = {
  id: 'u1', role: 'customer', name: 'Demo User', email: 'demo@myterra.app', balance: 5, phone: null, address: null,
  city: 'Beirut', autopay: false, card_brand: null, card_last4: null, install_status: 'installed', install_date: null,
  plan: { id: 'p1', name: 'Fiber 50 GB', data_gb: 50, speed_mbps: 100, price: 20, active: true }, outages: [],
};
const usage: Usage = { month: '2026-10', limit_gb: 50, used_gb: 3.5, days: [{ day: 1, gb: 1.5 }, { day: 2, gb: 2 }] };
const bill: BillingSummary = {
  amount_due: 20, balance: 5, autopay: false, card_brand: null, card_last4: null,
  next_invoice: { id: 'i1', number: 'INV-1', period: '2026-10-01', plan_name: 'Fiber 50 GB', amount: 20, status: 'unpaid',
    issued_at: '', due_date: '2026-11-10', paid_at: null },
};

describe('Dashboard', () => {
  async function setup(me: Partial<Me> = {}) {
    const api = { me: vi.fn(() => of({ ...base, ...me })), usage: vi.fn(() => of(usage)), billing: vi.fn(() => of(bill)) };
    TestBed.configureTestingModule({ imports: [Dashboard], providers: [provideRouter([]), { provide: ApiService, useValue: api }] });
    const fixture = TestBed.createComponent(Dashboard);
    await fixture.whenStable();
    return fixture.nativeElement.textContent as string;
  }

  it('shows plan, usage and what is due', async () => {
    const text = await setup();
    expect(text).toContain('Fiber 50 GB');
    expect(text).toContain('100 Mbps');
    expect(text).toContain('3.50 GB of 50 GB used');
    expect(text).toContain('$20.00');
    expect(text).toContain('Pay now');
  });

  it('warns about an outage in the customer city', async () => {
    const text = await setup({ outages: [{ id: 'o1', city: 'Beirut', title: 'No internet in Hamra', message: 'Power cut.',
      status: 'identified', started_at: '', updated_at: '2026-10-29T10:00:00Z', resolved_at: null }] });
    expect(text).toContain('No internet in Hamra');
  });

  it('tracks an installation that is not finished', async () => {
    const text = await setup({ install_status: 'technician_assigned', install_date: '2026-11-03' });
    expect(text).toContain('Your installation');
    expect(text).toContain('Technician assigned');
  });

  it('hides the installation tracker once installed', async () => {
    expect(await setup()).not.toContain('Your installation');
  });
});
