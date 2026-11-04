import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { ApiService } from '../core/api.service';
import { Admin } from './admin';

const app = { id: 'a1', name: 'Ali', email: 'ali@x.com', status: 'pending', created_at: '2026-10-29T10:00:00Z', plan_name: 'Fiber 50 GB' };
const user = { id: 'u1', name: 'Demo', email: 'demo@x.com', role: 'customer', plan_id: 'p1', plan_name: 'Fiber 50 GB', balance: 5, active: true, created_at: '' };

describe('Admin', () => {
  let api: Record<string, any>;

  async function setup() {
    api = {
      me: vi.fn(() => of({ id: 'me' })),
      adminApplications: vi.fn(() => of([app])),
      adminUsers: vi.fn(() => of({ items: [user], total: 1 })),
      adminPlans: vi.fn(() => of([])),
      adminTickets: vi.fn(() => of([])),
      approve: vi.fn(() => of({ user_id: 'u2', email_sent: true })),
      deleteUser: vi.fn(() => of(null)),
      updateUser: vi.fn(() => of(user)),
    };
    TestBed.configureTestingModule({ imports: [Admin], providers: [{ provide: ApiService, useValue: api }] });
    const fixture = TestBed.createComponent(Admin);
    await fixture.whenStable();
    return fixture;
  }

  it('shows pending applications', async () => {
    const text = (await setup()).nativeElement.textContent;
    expect(text).toContain('ali@x.com');
    expect(text).toContain('Approve');
  });

  it('approves and reloads', async () => {
    const fixture = await setup();
    fixture.componentInstance.approve(app as any);
    await fixture.whenStable();
    expect(api['approve']).toHaveBeenCalledWith('a1');
    expect(api['adminApplications']).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.textContent).toContain('Approved Ali. We emailed them');
  });

  it('shows Approving… and locks the buttons while the approval email is sent', async () => {
    const fixture = await setup();
    const reply = new Subject<{ user_id: string; email_sent: boolean }>();
    api['approve'].mockReturnValue(reply);
    fixture.componentInstance.approve(app as any);
    await fixture.whenStable();
    const buttons = [...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[];
    expect(buttons.find(b => b.textContent!.includes('Approving…'))).toBeTruthy();
    expect(buttons.find(b => b.textContent!.trim() === 'Reject')!.disabled).toBe(true);
    reply.next({ user_id: 'u2', email_sent: true });
    reply.complete();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).not.toContain('Approving…');
  });

  it('asks before deleting a user', async () => {
    const fixture = await setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fixture.componentInstance.deleteUser(user as any);
    expect(api['deleteUser']).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fixture.componentInstance.deleteUser(user as any);
    expect(api['deleteUser']).toHaveBeenCalledWith('u1');
    confirm.mockRestore();
  });

  it('shows the server error', async () => {
    const fixture = await setup();
    api['updateUser'].mockReturnValue(throwError(() => ({ error: { detail: "You can't deactivate or demote your own account" } })));
    fixture.componentInstance.toggleActive(user as any);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain("You can't deactivate");
  });
});
