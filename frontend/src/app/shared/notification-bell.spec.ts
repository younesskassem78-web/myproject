import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ApiService } from '../core/api.service';
import { NotificationBell } from './notification-bell';

const item = { id: 'n1', kind: 'payment', title: 'Payment received', body: 'Thanks', link: '/billing', created_at: '', read_at: null };

describe('NotificationBell', () => {
  let api: Record<string, any>;

  async function setup(unread = 1) {
    api = { notifications: vi.fn(() => of({ items: unread ? [item] : [], unread })), readNotifications: vi.fn(() => of(undefined)) };
    TestBed.configureTestingModule({ imports: [NotificationBell], providers: [provideRouter([]), { provide: ApiService, useValue: api }] });
    const fixture = TestBed.createComponent(NotificationBell);
    await fixture.whenStable();
    return fixture;
  }

  it('shows the unread count', async () => {
    const button = (await setup()).nativeElement.querySelector('button');
    expect(button.getAttribute('aria-label')).toBe('Notifications, 1 unread');
  });

  it('marks everything read when opened', async () => {
    const fixture = await setup();
    fixture.componentInstance.toggle();
    await fixture.whenStable();
    expect(api['readNotifications']).toHaveBeenCalled();
    expect(fixture.componentInstance.unread()).toBe(0);
    expect(fixture.nativeElement.textContent).toContain('Payment received');
  });

  it('follows the notification link', async () => {
    const fixture = await setup();
    const nav = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    fixture.componentInstance.go(item);
    expect(nav).toHaveBeenCalledWith('/billing');
  });

  it('fetches fresh notifications when opened', async () => {
    const fixture = await setup(0);
    api['notifications'].mockReturnValue(of({ items: [item], unread: 1 }));
    fixture.componentInstance.toggle();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Payment received');
    expect(api['readNotifications']).toHaveBeenCalled();
  });

  it('says when there is nothing new', async () => {
    const fixture = await setup(0);
    fixture.componentInstance.toggle();
    await fixture.whenStable();
    expect(api['readNotifications']).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('all caught up');
  });
});
