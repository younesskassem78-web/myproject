import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { authGuard, authInterceptor } from './auth';
import { AuthService } from './auth.service';

describe('authInterceptor', () => {
  const auth = { token: () => 't1' as string | null, logout: vi.fn() };

  beforeEach(() => {
    auth.logout.mockReset();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: auth },
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
  });

  it('adds the bearer token', () => {
    TestBed.inject(HttpClient).get('/x').subscribe();
    const req = TestBed.inject(HttpTestingController).expectOne('/x');
    expect(req.request.headers.get('Authorization')).toBe('Bearer t1');
  });

  it('logs out on 401', () => {
    TestBed.inject(HttpClient).get('/x').subscribe({ error: () => {} });
    TestBed.inject(HttpTestingController).expectOne('/x').flush(null, { status: 401, statusText: 'Unauthorized' });
    expect(auth.logout).toHaveBeenCalled();
  });
});

describe('authGuard', () => {
  function run(loggedIn: boolean) {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: { isLoggedIn: () => loggedIn } }],
    });
    return TestBed.runInInjectionContext(() => authGuard({} as any, {} as any));
  }

  it('sends logged-out users to /login', () => {
    const result = run(false) as UrlTree;
    expect(TestBed.inject(Router).serializeUrl(result)).toBe('/login');
  });

  it('lets logged-in users through', () => {
    expect(run(true)).toBe(true);
  });
});
