import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AdminReports } from './reports';

const report = {
  start: '2026-11-01', end: '2026-11-04', received: 59, new_customers: 2,
  by_kind: [{ kind: 'invoice', count: 2, total: 50 }, { kind: 'data', count: 3, total: 9 }],
  by_month: [{ month: '2026-11', total: 59 }],
  bills: { issued: 4, billed: 100, paid: 50, unpaid: 50 },
};

describe('AdminReports', () => {
  it('shows totals from the server for the chosen range and reloads on a preset', async () => {
    const api = { revenueReport: vi.fn(() => of(report)), exportCsv: vi.fn() };
    TestBed.configureTestingModule({ imports: [AdminReports], providers: [{ provide: ApiService, useValue: api }] });
    const fixture = TestBed.createComponent(AdminReports);
    await fixture.whenStable();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('$59.00');
    expect(text).toContain('Extra data');
    expect(text).toContain('2026-11');
    fixture.componentInstance.preset('last');
    const [start, end] = api.revenueReport.mock.calls.at(-1) as unknown as [string, string];
    expect(start.endsWith('-01')).toBe(true);
    expect(start < end).toBe(true);
  });
});
