export type Role = 'customer' | 'admin';
export interface Plan { id: string; name: string; data_gb: number; price: number; active: boolean; }
export interface Me { id: string; name: string; email: string; role: Role; balance: number; plan: Plan | null; }
export interface UsageDay { day: number; gb: number; }
export interface Usage { month: string; limit_gb: number; used_gb: number; days: UsageDay[]; }
export type TicketStatus = 'open' | 'in_progress' | 'resolved';
export interface Ticket { id: string; subject: string; message: string; status: TicketStatus; created_at: string; }

export interface Application {
  id: string; name: string; email: string; plan_name: string;
  status: 'pending' | 'approved' | 'rejected'; created_at: string;
}
export interface AdminUser {
  id: string; name: string; email: string; role: Role; plan_id: string | null; plan_name: string | null;
  balance: number; active: boolean; created_at: string;
}
export interface AdminPlan extends Plan { users: number; }
export interface AdminTicket extends Ticket { user_email: string; user_name: string; }
