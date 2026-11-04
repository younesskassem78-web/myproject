export type Role = 'customer' | 'admin' | 'billing' | 'support'; // admin = the owner
export interface Plan { id: string; name: string; data_gb: number; speed_mbps: number; price: number; active: boolean; }

export type OutageStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved';
export interface Outage {
  id: string; city: string; title: string; message: string; status: OutageStatus;
  started_at: string; updated_at: string; resolved_at: string | null;
}

export type InstallStatus = 'scheduled' | 'technician_assigned' | 'installed';
export interface Me {
  id: string; name: string; email: string; phone: string | null; address: string | null; city: string | null;
  role: Role; balance: number; plan: Plan | null; outages: Outage[];
  autopay: boolean; card_brand: string | null; card_last4: string | null;
  install_status: InstallStatus | null; install_date: string | null; install_reschedules?: number;
}
export interface UsageDay { day: number; gb: number; }
export interface Usage { month: string; limit_gb: number; plan_gb: number; extra_gb: number; used_gb: number; days: UsageDay[]; }
export interface DataPack { gb: number; price: number; }
export interface RevenueReport {
  start: string; end: string; received: number; new_customers: number;
  by_kind: { kind: string; count: number; total: number }[];
  by_month: { month: string; total: number }[];
  bills: { issued: number; billed: number; paid: number; unpaid: number };
}
export interface Automation {
  scheduler_on: boolean; billing_hour: number; last_billing_at: string | null; last_billing_result: string | null;
  emails: { waiting: number; failed: number; sent_today: number };
}
export type EmailTopic = 'billing' | 'outage' | 'ticket' | 'installation';
export type EmailPrefs = Record<EmailTopic, boolean>;
export interface Session { id: string; device: string; ip: string | null; created_at: string; last_used_at: string; current: boolean; }

export type TicketStatus = 'open' | 'in_progress' | 'resolved';
export type TicketCategory = 'connection' | 'billing' | 'installation' | 'other';
export interface Ticket {
  id: string; subject: string; message: string; status: TicketStatus; category: TicketCategory;
  created_at: string; updated_at: string;
}
export interface TicketMessage { id: string; author_name: string; from_staff: boolean; body: string; created_at: string; }
export interface SpeedResult { id: string; ping_ms: number; download_mbps: number; upload_mbps: number; created_at: string; server?: string | null; }
export interface TicketDetail extends Ticket {
  messages: TicketMessage[]; speed_test: SpeedResult | null; user_email?: string; user_name?: string;
}

export type InvoiceStatus = 'unpaid' | 'paid' | 'overdue' | 'void';
export interface Invoice {
  id: string; number: string; period: string; plan_name: string; amount: number; status: InvoiceStatus;
  issued_at: string; due_date: string; paid_at: string | null;
}
export interface Payment {
  id: string; invoice_id: string | null; kind: 'invoice' | 'topup' | 'signup' | 'data'; method: 'card' | 'balance' | 'autopay';
  amount: number; card_brand: string | null; card_last4: string | null; created_at: string;
}
export interface InvoiceDetail extends Invoice {
  customer: { name: string; email: string; phone: string | null; address: string | null };
  payments: Payment[];
}
export interface BillingSummary {
  amount_due: number; next_invoice: Invoice | null; balance: number; autopay: boolean;
  card_brand: string | null; card_last4: string | null;
}

export interface Notification {
  id: string; kind: string; title: string; body: string; link: string | null; created_at: string; read_at: string | null;
}

export interface Application {
  id: string; name: string; email: string; phone: string | null; plan_name: string;
  birth_date: string | null; id_number: string | null; city: string | null; street: string | null; apartment: string | null;
  install_date: string | null; card_brand: string | null; card_last4: string | null; amount_paid: number | null;
  status: 'pending' | 'approved' | 'rejected'; created_at: string;
}
export interface AdminUser {
  id: string; name: string; email: string; phone: string | null; address: string | null; city: string | null;
  role: Role; plan_id: string | null; plan_name: string | null; balance: number; active: boolean; created_at: string;
  install_status: InstallStatus | null; install_date: string | null; amount_due: number;
}
export interface AdminPlan extends Plan { users: number; }
export interface AdminTicket extends Ticket { user_email: string; user_name: string; replies: number; }
export interface AdminInvoice extends Invoice { user_email: string; user_name: string; }
export interface AuditEntry { id: string; admin_email: string; action: string; target: string; created_at: string; }
export interface AdminOverview {
  kpis: {
    active_customers: number; mrr?: number; unpaid_total?: number; overdue_invoices?: number; // money: owner and billing only
    open_tickets: number; pending_applications: number; active_outages: number;
  };
  revenue: { month: string; amount: number }[] | null;
  audit: AuditEntry[] | null;
}
