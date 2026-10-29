import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ApiService } from '../core/api.service';
import { TicketDetail } from '../core/models';
import { TicketPage } from './ticket';

const detail: TicketDetail = {
  id: 't1', subject: 'Slow evenings', message: 'Speed drops after 8 pm.', status: 'resolved', category: 'connection',
  created_at: '2026-10-03T19:42:00Z', updated_at: '', user_name: 'Demo', user_email: 'demo@x.com',
  speed_test: { id: 's1', ping_ms: 20, download_mbps: 9.5, upload_mbps: 2, created_at: '2026-10-03T19:00:00Z' },
  messages: [{ id: 'm1', author_name: 'MyTerra Support', from_staff: true, body: 'We upgraded your cabinet.', created_at: '2026-10-04T10:00:00Z' }],
};

describe('TicketPage', () => {
  let api: Record<string, any>;

  async function setup(staff = false) {
    api = {
      ticket: vi.fn(() => of(detail)), adminTicket: vi.fn(() => of(detail)),
      replyTicket: vi.fn(() => of({})), staffReply: vi.fn(() => of({})), setTicketStatus: vi.fn(() => of({})),
    };
    TestBed.configureTestingModule({ imports: [TicketPage], providers: [provideRouter([]), { provide: ApiService, useValue: api }] });
    const fixture = TestBed.createComponent(TicketPage);
    fixture.componentRef.setInput('id', 't1');
    fixture.componentRef.setInput('staff', staff);
    await fixture.whenStable();
    return fixture;
  }

  it('shows the conversation and the attached speed test', async () => {
    const text = (await setup()).nativeElement.textContent;
    expect(text).toContain('We upgraded your cabinet.');
    expect(text).toContain('9.5 Mbps down');
    expect(text).toContain('Reply to reopen');
  });

  it('sends a customer reply and reloads', async () => {
    const fixture = await setup();
    fixture.componentInstance.reply = '  It is back  ';
    fixture.componentInstance.send();
    expect(api['replyTicket']).toHaveBeenCalledWith('t1', 'It is back');
    expect(api['ticket']).toHaveBeenCalledTimes(2);
  });

  it('lets staff reply and change status', async () => {
    const fixture = await setup(true);
    expect(api['adminTicket']).toHaveBeenCalled();
    fixture.componentInstance.reply = 'Checking';
    fixture.componentInstance.send();
    fixture.componentInstance.setStatus('in_progress');
    expect(api['staffReply']).toHaveBeenCalledWith('t1', 'Checking');
    expect(api['setTicketStatus']).toHaveBeenCalledWith('t1', 'in_progress');
  });
});
