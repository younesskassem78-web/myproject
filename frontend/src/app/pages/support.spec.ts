import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { ApiService } from '../core/api.service';
import { Ticket } from '../core/models';
import { Support } from './support';

const old: Ticket = { id: 1, subject: 'Slow evenings', message: 'x', status: 'resolved', created_at: '2026-10-03T19:42:00' };
const fresh: Ticket = { id: 2, subject: 'Router light is red', message: 'y', status: 'open', created_at: '2026-10-29T10:00:00' };

describe('Support', () => {
  let api: { tickets: any; createTicket: any };

  async function setup(list: Ticket[] = [old]) {
    api = { tickets: vi.fn(() => of(list)), createTicket: vi.fn(() => of(fresh)) };
    TestBed.configureTestingModule({ imports: [Support], providers: [{ provide: ApiService, useValue: api }] });
    const fixture = TestBed.createComponent(Support);
    await fixture.whenStable();
    return fixture;
  }

  it('lists tickets with readable status', async () => {
    expect((await setup()).nativeElement.textContent).toContain('Resolved');
  });

  it('shows an empty state', async () => {
    expect((await setup([])).nativeElement.textContent).toContain('No tickets yet');
  });

  it('does not send whitespace', async () => {
    const fixture = await setup();
    fixture.componentInstance.subject = '   ';
    fixture.componentInstance.message = 'hello';
    fixture.componentInstance.send();
    expect(api.createTicket).not.toHaveBeenCalled();
  });

  it('adds the new ticket on top and clears the form', async () => {
    const fixture = await setup();
    const c = fixture.componentInstance;
    c.subject = 'Router light is red';
    c.message = 'y';
    c.send();
    await fixture.whenStable();
    expect(api.createTicket).toHaveBeenCalledWith('Router light is red', 'y');
    expect(c.tickets()[0].id).toBe(2);
    expect(c.subject).toBe('');
    expect(fixture.nativeElement.textContent).toContain('Open');
  });

  it('ignores a second click while sending', async () => {
    const fixture = await setup();
    api.createTicket.mockReturnValue(new Subject());
    const c = fixture.componentInstance;
    c.subject = 'a';
    c.message = 'b';
    c.send();
    c.send();
    expect(api.createTicket).toHaveBeenCalledTimes(1);
  });
});
