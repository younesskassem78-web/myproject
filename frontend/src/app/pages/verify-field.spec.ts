import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ApiService } from '../core/api.service';
import { VerifyField } from './verify-field';

describe('VerifyField', () => {
  let api: { sendCode: any; checkCode: any };

  async function setup() {
    api = { sendCode: vi.fn(() => of({ sent: true })), checkCode: vi.fn(() => of({ verification_id: 'v1' })) };
    TestBed.configureTestingModule({ imports: [VerifyField], providers: [{ provide: ApiService, useValue: api }] });
    const fixture = TestBed.createComponent(VerifyField);
    fixture.componentRef.setInput('channel', 'email');
    fixture.componentRef.setInput('label', 'Email');
    fixture.componentInstance.value.set('a@b.co');
    await fixture.whenStable();
    return fixture;
  }

  it('sends a code, checks it and reports the verification id', async () => {
    const fixture = await setup();
    const c = fixture.componentInstance;
    c.send();
    await fixture.whenStable();
    expect(api.sendCode).toHaveBeenCalledWith('email', 'a@b.co');
    c.code = '123456';
    c.check();
    await fixture.whenStable();
    expect(api.checkCode).toHaveBeenCalledWith('email', 'a@b.co', '123456');
    expect(c.verifiedId()).toBe('v1');
    expect(fixture.nativeElement.textContent).toContain('Verified');
  });

  it('shows a wrong code error', async () => {
    const fixture = await setup();
    api.checkCode.mockReturnValue(throwError(() => ({ status: 400, error: { detail: 'Wrong code' } })));
    fixture.componentInstance.send();
    fixture.componentInstance.code = '000000';
    fixture.componentInstance.check();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Wrong code');
  });

  it('shows and uses the code in demo mode', async () => {
    const fixture = await setup();
    api.sendCode.mockReturnValue(of({ sent: true, demo_code: '482913' }));
    fixture.componentInstance.send();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('482913');
    expect(fixture.nativeElement.textContent).not.toContain('We sent a code');
    fixture.componentInstance.useDemoCode();
    expect(api.checkCode).toHaveBeenCalledWith('email', 'a@b.co', '482913');
  });

  it('forgets the verification when the value changes', async () => {
    const fixture = await setup();
    fixture.componentInstance.verifiedId.set('v1');
    fixture.componentInstance.edit('other@b.co');
    expect(fixture.componentInstance.verifiedId()).toBe('');
  });
});
