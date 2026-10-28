import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, throwError } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { Login } from './login';

describe('Login', () => {
  const auth = { login: vi.fn() };

  function setup() {
    TestBed.configureTestingModule({
      imports: [Login],
      providers: [provideRouter([]), { provide: AuthService, useValue: auth }],
    });
    const fixture = TestBed.createComponent(Login);
    fixture.componentInstance.email = 'demo@myterra.app';
    fixture.componentInstance.password = 'wrong';
    return fixture;
  }

  it('shows an error for wrong credentials', async () => {
    auth.login.mockReturnValue(throwError(() => ({ status: 401, error: { detail: 'Invalid email or password' } })));
    const fixture = setup();
    fixture.componentInstance.submit();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Invalid email or password');
  });

  it('explains a pending application', async () => {
    auth.login.mockReturnValue(throwError(() => ({ status: 403, error: { detail: 'Your application is waiting for approval' } })));
    const fixture = setup();
    fixture.componentInstance.submit();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Your application is waiting for approval');
  });

  it('disables the button while signing in', async () => {
    auth.login.mockReset();
    auth.login.mockReturnValue(new Subject());
    const fixture = setup();
    fixture.componentInstance.submit();
    fixture.componentInstance.submit();
    await fixture.whenStable();
    expect(auth.login).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('button[type=submit]').disabled).toBe(true);
  });
});
