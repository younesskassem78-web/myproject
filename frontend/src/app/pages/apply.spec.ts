import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { ApiService } from '../core/api.service';
import { Apply } from './apply';

describe('Apply', () => {
  let api: { plans: any; apply: any };

  async function setup() {
    api = {
      plans: vi.fn(() => of([{ id: 'p1', name: 'Fiber 50 GB', data_gb: 50, price: 20, active: true }])),
      apply: vi.fn(() => of({ id: 'a1', status: 'pending' })),
    };
    TestBed.configureTestingModule({ imports: [Apply], providers: [provideRouter([]), { provide: ApiService, useValue: api }] });
    const fixture = TestBed.createComponent(Apply);
    await fixture.whenStable();
    Object.assign(fixture.componentInstance.form, { name: 'Ali', email: 'ali@x.com', password: 'secret123', plan_id: 'p1' });
    return fixture;
  }

  it('lists plans to choose from', async () => {
    expect((await setup()).nativeElement.textContent).toContain('Fiber 50 GB');
  });

  it('confirms after sending', async () => {
    const fixture = await setup();
    fixture.componentInstance.submit();
    await fixture.whenStable();
    expect(api.apply).toHaveBeenCalledWith({ name: 'Ali', email: 'ali@x.com', password: 'secret123', plan_id: 'p1' });
    expect(fixture.nativeElement.textContent).toContain('Application sent');
  });

  it('shows the server reason when refused', async () => {
    const fixture = await setup();
    api.apply.mockReturnValue(throwError(() => ({ status: 409, error: { detail: 'An account with this email already exists' } })));
    fixture.componentInstance.submit();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('An account with this email already exists');
  });

  it('asks for a password of 8+ characters before sending', async () => {
    const fixture = await setup();
    fixture.componentInstance.form.password = 'short';
    fixture.componentInstance.submit();
    await fixture.whenStable();
    expect(api.apply).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('at least 8 characters');
  });

  it('ignores a second click while sending', async () => {
    const fixture = await setup();
    api.apply.mockReturnValue(new Subject());
    fixture.componentInstance.submit();
    fixture.componentInstance.submit();
    expect(api.apply).toHaveBeenCalledTimes(1);
  });
});
