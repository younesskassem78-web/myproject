import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Subject, of } from 'rxjs';
import { ApiService } from '../core/api.service';
import { Ticket } from '../core/models';
import { Support } from './support';

const old: Ticket = { id: 't1', subject: 'Slow evenings', message: 'x', status: 'resolved', category: 'connection',
  created_at: '2026-10-03T19:42:00', updated_at: '2026-10-04T10:00:00' };
const fresh: Ticket = { ...old, id: 't2', subject: 'Router light is red', status: 'open' };
const test = { id: 's1', ping_ms: 20, download_mbps: 9.5, upload_mbps: 2, created_at: '2026-10-29T09:00:00' };

describe('Support', () => {
  let api: Record<string, any>;

  async function setup(list: Ticket[] = [old], outages: unknown[] = [], speed?: string) {
    api = {
      tickets: vi.fn(() => of(list)), createTicket: vi.fn(() => of(fresh)),
      me: vi.fn(() => of({ outages })), speedTests: vi.fn(() => of({ plan_speed_mbps: 100, results: [test] })),
    };
    TestBed.configureTestingModule({ imports: [Support], providers: [provideRouter([]), { provide: ApiService, useValue: api }] });
    const fixture = TestBed.createComponent(Support);
    if (speed) fixture.componentRef.setInput('speed', speed);
    await fixture.whenStable();
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    return fixture;
  }

  it('lists tickets with readable status', async () => {
    expect((await setup()).nativeElement.textContent).toContain('Resolved');
  });

  it('shows an empty state', async () => {
    expect((await setup([])).nativeElement.textContent).toContain('No tickets yet');
  });

  it('shows the troubleshooter and a known outage for connection problems', async () => {
    const text = (await setup([], [{ title: 'Slow speeds in Tripoli' }])).nativeElement.textContent;
    expect(text).toContain('Unplug your router');
    expect(text).toContain('Slow speeds in Tripoli');
  });

  it('attaches the speed test it was sent from', async () => {
    const fixture = await setup([], [], 's1');
    const c = fixture.componentInstance;
    expect(c.attachTest).toBe(true);
    c.message = 'Only 9 Mbps';
    c.send();
    expect(api['createTicket']).toHaveBeenCalledWith(expect.objectContaining({ category: 'connection', speed_test_id: 's1' }));
  });

  it('does not send whitespace', async () => {
    const c = (await setup()).componentInstance;
    c.subject = '   ';
    c.message = 'hello';
    c.send();
    expect(api['createTicket']).not.toHaveBeenCalled();
  });

  it('opens the new ticket after sending', async () => {
    const fixture = await setup();
    const c = fixture.componentInstance;
    c.category = 'billing';
    c.subject = 'Router light is red';
    c.message = 'y';
    c.send();
    await fixture.whenStable();
    expect(api['createTicket']).toHaveBeenCalledWith({ subject: 'Router light is red', message: 'y', category: 'billing', speed_test_id: null });
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(['/support', 't2']);
  });

  it('ignores a second click while sending', async () => {
    const c = (await setup()).componentInstance;
    api['createTicket'].mockReturnValue(new Subject());
    c.subject = 'a';
    c.message = 'b';
    c.send();
    c.send();
    expect(api['createTicket']).toHaveBeenCalledTimes(1);
  });
});
