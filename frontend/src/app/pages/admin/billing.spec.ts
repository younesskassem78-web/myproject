import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AdminBilling } from './billing';

describe('AdminBilling automation panel', () => {
  it('shows the last automatic run and lets staff retry failed emails', async () => {
    const api = {
      adminInvoices: vi.fn(() => of({ items: [], total: 0 })),
      automation: vi.fn(() => of({ scheduler_on: true, billing_hour: 8, last_billing_at: '2026-11-04T08:00:00Z',
        last_billing_result: '12 bills, 3 autopaid, 4 reminders', emails: { waiting: 2, failed: 1, sent_today: 40 } })),
      retryEmails: vi.fn(() => of({ retried: 1 })),
    };
    TestBed.configureTestingModule({ imports: [AdminBilling], providers: [{ provide: ApiService, useValue: api }] });
    const fixture = TestBed.createComponent(AdminBilling);
    await fixture.whenStable();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('12 bills, 3 autopaid, 4 reminders');
    expect(text).toContain('1 failed');
    fixture.componentInstance.retryEmails();
    await fixture.whenStable();
    expect(api.retryEmails).toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Sending 1 email again.');
  });
});
