import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ApiService } from '../core/api.service';
import { SpeedTest, mbps, median } from './speed-test';

describe('speed maths', () => {
  it('converts bytes and milliseconds to Mbps', () => {
    expect(mbps(1_250_000, 1000)).toBeCloseTo(10);  // 10 megabits in 1 s
    expect(mbps(8 * 1024 * 1024, 500)).toBeCloseTo(134.2, 1);
    expect(mbps(100, 0)).toBe(0);
  });

  it('takes the median ping', () => {
    expect(median([30, 10, 20])).toBe(20);
    expect(median([10, 40, 20, 30])).toBe(25);
  });
});

describe('SpeedTest', () => {
  async function setup() {
    const api = { speedTests: vi.fn(() => of({ plan_speed_mbps: 100, results: [] })), saveSpeedTest: vi.fn() };
    TestBed.configureTestingModule({ imports: [SpeedTest], providers: [provideRouter([]), { provide: ApiService, useValue: api }] });
    const fixture = TestBed.createComponent(SpeedTest);
    await fixture.whenStable();
    return fixture;
  }

  it('compares the result with the plan speed', async () => {
    const c = (await setup()).componentInstance;
    c.down.set(95);
    expect(c.verdict()?.bad).toBe(false);
    c.down.set(30);
    expect(c.verdict()?.bad).toBe(true);
    expect(c.verdict()?.text).toContain('30%');
  });

  it('shows an empty history', async () => {
    expect((await setup()).nativeElement.textContent).toContain('No tests yet');
  });
});
