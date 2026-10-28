import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Me, Ticket, Usage } from './models';

const API = 'http://localhost:8000/api';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  login(email: string, password: string) {
    return this.http.post<{ token: string; name: string }>(`${API}/login`, { email, password });
  }
  me() { return this.http.get<Me>(`${API}/me`); }
  usage() { return this.http.get<Usage>(`${API}/usage`); }
  topUp(amount: number) { return this.http.post<{ balance: number }>(`${API}/topup`, { amount }); }
  tickets() { return this.http.get<Ticket[]>(`${API}/tickets`); }
  createTicket(subject: string, message: string) {
    return this.http.post<Ticket>(`${API}/tickets`, { subject, message });
  }
}
