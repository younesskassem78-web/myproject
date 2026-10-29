import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { CardDetails } from '../pages/pay-dialog';
import {
  AdminInvoice, AdminOverview, AdminPlan, AdminTicket, AdminUser, Application, AuditEntry, BillingSummary, Invoice,
  InvoiceDetail, Me, Notification, Outage, OutageStatus, Payment, Plan, Role, SpeedResult, Ticket, TicketCategory,
  TicketDetail, TicketMessage, TicketStatus, Usage,
} from './models';

// Same-origin: the dev server (proxy.conf.json) and nginx in production forward /api to the backend.
export const API = '/api';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  // public
  login(email: string, password: string) {
    return this.http.post<{ token: string; name: string; role: Role }>(`${API}/login`, { email, password });
  }
  logout() { return this.http.post<void>(`${API}/logout`, {}); }
  plans() { return this.http.get<Plan[]>(`${API}/plans`); }
  status() { return this.http.get<{ active: Outage[]; recent: Outage[] }>(`${API}/status`); }
  apply(body: object) { return this.http.post<{ id: string; status: string }>(`${API}/apply`, body); }
  sendCode(channel: 'email' | 'sms', target: string) {
    return this.http.post<{ sent: boolean; demo_code?: string }>(`${API}/verify/send`, { channel, target });
  }
  checkCode(channel: 'email' | 'sms', target: string, code: string) {
    return this.http.post<{ verification_id: string }>(`${API}/verify/check`, { channel, target, code });
  }
  forgotPassword(email: string) { return this.http.post(`${API}/password/forgot`, { email }); }
  resetPassword(email: string, code: string, password: string) {
    return this.http.post(`${API}/password/reset`, { email, code, password });
  }

  // customer
  me() { return this.http.get<Me>(`${API}/me`); }
  usage() { return this.http.get<Usage>(`${API}/usage`); }
  topUp(amount: number, card: CardDetails) { return this.http.post<{ balance: number }>(`${API}/topup`, { amount, card }); }
  changePlan(planId: string) { return this.http.post<Plan>(`${API}/plan`, { plan_id: planId }); }
  changePassword(current: string, password: string) {
    return this.http.post(`${API}/account/password`, { current, password });
  }
  notifications() { return this.http.get<{ items: Notification[]; unread: number }>(`${API}/notifications`); }
  readNotifications() { return this.http.post<void>(`${API}/notifications/read`, {}); }

  billing() { return this.http.get<BillingSummary>(`${API}/billing`); }
  invoices() { return this.http.get<Invoice[]>(`${API}/invoices`); }
  invoice(id: string) { return this.http.get<InvoiceDetail>(`${API}/invoices/${id}`); }
  payments() { return this.http.get<Payment[]>(`${API}/payments`); }
  payInvoice(id: string, method: 'card' | 'balance', card?: CardDetails) {
    return this.http.post<Invoice>(`${API}/invoices/${id}/pay`, { method, card });
  }
  setAutopay(enabled: boolean, card?: CardDetails) {
    return this.http.post<{ autopay: boolean; card_brand: string | null; card_last4: string | null }>(
      `${API}/billing/autopay`, { enabled, card });
  }

  tickets() { return this.http.get<Ticket[]>(`${API}/tickets`); }
  ticket(id: string) { return this.http.get<TicketDetail>(`${API}/tickets/${id}`); }
  createTicket(body: { subject: string; message: string; category: TicketCategory; speed_test_id?: string | null }) {
    return this.http.post<Ticket>(`${API}/tickets`, body);
  }
  replyTicket(id: string, body: string) { return this.http.post<TicketMessage>(`${API}/tickets/${id}/messages`, { body }); }

  speedTests() { return this.http.get<{ plan_speed_mbps: number | null; results: SpeedResult[] }>(`${API}/speedtests`); }
  saveSpeedTest(r: { ping_ms: number; download_mbps: number; upload_mbps: number }) {
    return this.http.post<SpeedResult>(`${API}/speedtests`, r);
  }

  // admin
  adminOverview() { return this.http.get<AdminOverview>(`${API}/admin/overview`); }
  adminAudit() { return this.http.get<AuditEntry[]>(`${API}/admin/audit`); }
  adminApplications() { return this.http.get<Application[]>(`${API}/admin/applications`); }
  approve(id: string) {
    return this.http.post<{ user_id: string; email_sent: boolean }>(`${API}/admin/applications/${id}/approve`, {});
  }
  reject(id: string) { return this.http.post(`${API}/admin/applications/${id}/reject`, {}); }
  adminUsers() { return this.http.get<AdminUser[]>(`${API}/admin/users`); }
  createUser(body: object) { return this.http.post(`${API}/admin/users`, body); }
  updateUser(id: string, changes: object) { return this.http.patch<AdminUser>(`${API}/admin/users/${id}`, changes); }
  deleteUser(id: string) { return this.http.delete(`${API}/admin/users/${id}`); }
  adminPlans() { return this.http.get<AdminPlan[]>(`${API}/admin/plans`); }
  createPlan(body: object) { return this.http.post(`${API}/admin/plans`, body); }
  updatePlan(id: string, changes: object) { return this.http.patch(`${API}/admin/plans/${id}`, changes); }
  deletePlan(id: string) { return this.http.delete(`${API}/admin/plans/${id}`); }
  adminTickets() { return this.http.get<AdminTicket[]>(`${API}/admin/tickets`); }
  adminTicket(id: string) { return this.http.get<TicketDetail>(`${API}/admin/tickets/${id}`); }
  staffReply(id: string, body: string) { return this.http.post<TicketMessage>(`${API}/admin/tickets/${id}/messages`, { body }); }
  setTicketStatus(id: string, status: TicketStatus) { return this.http.patch(`${API}/admin/tickets/${id}`, { status }); }
  adminInvoices() { return this.http.get<AdminInvoice[]>(`${API}/admin/invoices`); }
  runBilling() { return this.http.post<{ period: string; issued: number; autopaid: number }>(`${API}/admin/billing/run`, {}); }
  adminOutages() { return this.http.get<Outage[]>(`${API}/admin/outages`); }
  openOutage(body: { city: string; title: string; message: string }) { return this.http.post<Outage>(`${API}/admin/outages`, body); }
  updateOutage(id: string, changes: { status?: OutageStatus; message?: string }) {
    return this.http.patch<Outage>(`${API}/admin/outages/${id}`, changes);
  }
}
