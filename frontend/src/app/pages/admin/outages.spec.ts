import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { Outage } from '../../core/models';
import { AdminOutages } from './outages';

const outage: Outage = { id: 'o1', city: 'Tripoli', title: 'Cable cut', message: 'Fixing it', status: 'identified',
  started_at: '', updated_at: '', resolved_at: null };

describe('AdminOutages', () => {
  let api: Record<string, any>;

  async function setup() {
    api = { adminOutages: vi.fn(() => of([outage])), openOutage: vi.fn(() => of(outage)), updateOutage: vi.fn(() => of(outage)) };
    TestBed.configureTestingModule({ imports: [AdminOutages], providers: [{ provide: ApiService, useValue: api }] });
    const fixture = TestBed.createComponent(AdminOutages);
    await fixture.whenStable();
    return fixture;
  }

  it('needs city, title and message', async () => {
    const fixture = await setup();
    fixture.componentInstance.form = { city: 'Beirut', title: '', message: 'x' };
    fixture.componentInstance.open();
    await fixture.whenStable();
    expect(api['openOutage']).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Fill in the city');
  });

  it('opens an outage and tells the admin who was notified', async () => {
    const fixture = await setup();
    fixture.componentInstance.form = { city: ' Beirut ', title: 'No internet', message: 'Power cut' };
    fixture.componentInstance.open();
    await fixture.whenStable();
    expect(api['openOutage']).toHaveBeenCalledWith({ city: 'Beirut', title: 'No internet', message: 'Power cut' });
    expect(fixture.nativeElement.textContent).toContain('Customers in Beirut have been notified');
  });

  it('resolves an outage', async () => {
    const fixture = await setup();
    fixture.componentInstance.drafts['o1'].status = 'resolved';
    fixture.componentInstance.update(outage);
    expect(api['updateOutage']).toHaveBeenCalledWith('o1', { status: 'resolved', message: undefined });
  });
});
