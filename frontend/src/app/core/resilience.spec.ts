import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { READ_TIMEOUT_MS, backoffMs, resilienceInterceptor } from './resilience';

describe('resilienceInterceptor', () => {
  let http: HttpClient;
  let ctl: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([resilienceInterceptor])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpClient);
    ctl = TestBed.inject(HttpTestingController);
  });
  afterEach(() => vi.useRealTimers());

  it('retries a read twice after a dropped connection, then succeeds', () => {
    let body: unknown;
    http.get('/api/x').subscribe(b => (body = b));
    ctl.expectOne('/api/x').flush(null, { status: 0, statusText: 'Unknown' });
    vi.advanceTimersByTime(1600);
    ctl.expectOne('/api/x').flush(null, { status: 503, statusText: 'Unavailable' });
    vi.advanceTimersByTime(3100);
    ctl.expectOne('/api/x').flush({ ok: true });
    expect(body).toEqual({ ok: true });
  });

  it('does not retry a read the server refused (404)', () => {
    let status = -1;
    http.get('/api/x').subscribe({ error: e => (status = e.status) });
    ctl.expectOne('/api/x').flush(null, { status: 404, statusText: 'Not Found' });
    vi.advanceTimersByTime(10_000);
    ctl.expectNone('/api/x');
    expect(status).toBe(404);
  });

  it('never retries a write, so a payment cannot be sent twice', () => {
    let status = -1;
    http.post('/api/pay', {}).subscribe({ error: e => (status = e.status) });
    ctl.expectOne('/api/pay').flush(null, { status: 503, statusText: 'Unavailable' });
    vi.advanceTimersByTime(10_000);
    ctl.expectNone('/api/pay');
    expect(status).toBe(503);
  });

  it('gives up on a hanging read and reports it as no connection', () => {
    let status = -1;
    http.get('/api/slow').subscribe({ error: e => (status = e.status) });
    for (let i = 0; i < 3; i++) {
      expect(ctl.match('/api/slow').length).toBe(1);
      vi.advanceTimersByTime(READ_TIMEOUT_MS + 3100);
    }
    expect(status).toBe(0);
  });

  it('backs off 1 s then 2 s, with jitter of ±50 %', () => {
    expect(backoffMs(1, () => 0)).toBe(500);
    expect(backoffMs(1, () => 0.999)).toBeCloseTo(1499, 0);
    expect(backoffMs(2, () => 0.5)).toBe(2000);
  });
});
