import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ApiService } from '../core/api.service';
import { SpeedTest, mbps, measure, median, networkTime } from './speed-test';

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

describe('networkTime', () => {
  it("takes request-to-first-byte minus the server's own processing time", () => {
    const serverTiming = [{ name: 'cfSpeedWorker', duration: 24, description: '' }] as unknown as PerformanceServerTiming[];
    expect(networkTime({ requestStart: 100, responseStart: 140, serverTiming })).toBe(16);
    expect(networkTime({ requestStart: 100, responseStart: 110, serverTiming })).toBe(0); // never negative
    expect(networkTime({ requestStart: 0, responseStart: 30, serverTiming: [] as unknown as PerformanceServerTiming[] })).toBe(30);
  });
});

describe('measure (multi-stream, after warm-up)', () => {
  it('reports the steady speed, ignoring the slow first second', async () => {
    // Each of 2 streams moves 62,500 bytes every 100 ms = 5 Mbps each, 10 Mbps together.
    const job = async (add: (n: number) => void, signal: AbortSignal) => {
      while (!signal.aborted) { await new Promise(r => setTimeout(r, 100)); add(62_500); }
    };
    const live: number[] = [];
    const result = await measure(1800, 2, job, v => live.push(v));
    expect(result).toBeGreaterThan(8);
    expect(result).toBeLessThan(12);
    expect(live.length).toBeGreaterThan(0);
  });

  it('turns a failure (not the deadline) into an error', async () => {
    await expect(measure(1000, 1, async () => { throw new Error('network down'); })).rejects.toThrow('network down');
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
