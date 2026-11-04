import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiService } from '../core/api.service';
import { Settings } from './settings';

describe('Settings', () => {
  let api: Record<string, any>;

  async function setup() {
    api = {
      me: vi.fn(() => of({ name: 'Demo', email: 'demo@x.com', phone: null, address: null })),
      emailPrefs: vi.fn(() => of({ billing: true, outage: true, ticket: true, installation: true })),
      setEmailPrefs: vi.fn((p: object) => of(p)),
      sessions: vi.fn(() => of([
        { id: 's1', device: 'Edge on Windows', ip: '1.2.3.4', created_at: '', last_used_at: '2026-11-04T10:00:00Z', current: true },
        { id: 's2', device: 'Chrome on Android', ip: null, created_at: '', last_used_at: '2026-11-03T10:00:00Z', current: false },
      ])),
      endSession: vi.fn(() => of(null)),
      endOtherSessions: vi.fn(() => of({ signed_out: 1 })),
    };
    TestBed.configureTestingModule({ imports: [Settings], providers: [{ provide: ApiService, useValue: api }] });
    const fixture = TestBed.createComponent(Settings);
    await fixture.whenStable();
    return fixture;
  }

  it('saves an email choice straight away', async () => {
    const fixture = await setup();
    fixture.componentInstance.toggle('outage', false);
    await fixture.whenStable();
    expect(api['setEmailPrefs']).toHaveBeenCalledWith({ billing: true, outage: false, ticket: true, installation: true });
    expect(fixture.nativeElement.textContent).toContain('Saved.');
  });

  it('lists signed-in devices and marks this one', async () => {
    const text = (await setup()).nativeElement.textContent;
    expect(text).toContain('Edge on Windows');
    expect(text).toContain('This device');
    expect(text).toContain('Chrome on Android');
  });

  it('signs out another device', async () => {
    const fixture = await setup();
    fixture.componentInstance.endSession(fixture.componentInstance.sessions()[1]);
    await fixture.whenStable();
    expect(api['endSession']).toHaveBeenCalledWith('s2');
    expect(fixture.nativeElement.textContent).toContain('Signed out Chrome on Android.');
  });

  it("names each device's sign-out button so screen readers can tell them apart", async () => {
    const fixture = await setup();
    const labels = [...fixture.nativeElement.querySelectorAll('button[aria-label^="Sign out "]')].map((b: Element) => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Sign out Chrome on Android']);
  });
});
