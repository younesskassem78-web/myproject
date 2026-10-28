export interface Plan { id: string; name: string; data_gb: number; price: number; }
export interface Me { name: string; email: string; balance: number; plan: Plan; }
export interface UsageDay { day: number; gb: number; }
export interface Usage { month: string; limit_gb: number; used_gb: number; days: UsageDay[]; }
export type TicketStatus = 'open' | 'in_progress' | 'resolved';
export interface Ticket { id: number; subject: string; message: string; status: TicketStatus; created_at: string; }
