import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { AdminPlan, AdminTicket, AdminUser, Application, Me, Plan, Role, Ticket, TicketStatus, Usage } from './models';

const API = 'http://localhost:8001/api';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  login(email: string, password: string) {
    return this.http.post<{ token: string; name: string; role: Role }>(`${API}/login`, { email, password });
  }
  plans() { return this.http.get<Plan[]>(`${API}/plans`); }
  apply(body: object) { return this.http.post<{ id: string; status: string }>(`${API}/apply`, body); }
  sendCode(channel: 'email' | 'sms', target: string) {
    return this.http.post<{ sent: boolean }>(`${API}/verify/send`, { channel, target });
  }
  checkCode(channel: 'email' | 'sms', target: string, code: string) {
    return this.http.post<{ verification_id: string }>(`${API}/verify/check`, { channel, target, code });
  }

  me() { return this.http.get<Me>(`${API}/me`); }
  usage() { return this.http.get<Usage>(`${API}/usage`); }
  topUp(amount: number) { return this.http.post<{ balance: number }>(`${API}/topup`, { amount }); }
  tickets() { return this.http.get<Ticket[]>(`${API}/tickets`); }
  createTicket(subject: string, message: string) {
    return this.http.post<Ticket>(`${API}/tickets`, { subject, message });
  }

  adminApplications() { return this.http.get<Application[]>(`${API}/admin/applications`); }
  approve(id: string) { return this.http.post<{ user_id: string; email_sent: boolean }>(`${API}/admin/applications/${id}/approve`, {}); }
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
  setTicketStatus(id: string, status: TicketStatus) { return this.http.patch(`${API}/admin/tickets/${id}`, { status }); }
}
