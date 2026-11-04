import { Role } from './models';

export type StaffArea = 'overview' | 'applications' | 'customers' | 'plans' | 'billing' | 'reports' | 'outages' | 'tickets' | 'audit';

/** Which staff roles see which part of the console. The server enforces the same rules on every request. */
export const AREA_ROLES: Record<StaffArea, Role[]> = {
  overview: ['admin', 'billing', 'support'],
  applications: ['admin', 'billing'],
  customers: ['admin', 'billing', 'support'],
  plans: ['admin'],
  billing: ['admin', 'billing'],
  reports: ['admin', 'billing'],
  outages: ['admin', 'support'],
  tickets: ['admin', 'support'],
  audit: ['admin'],
};

export const STAFF_ROLES: Role[] = ['admin', 'billing', 'support'];
export const ROLE_LABEL: Record<Role, string> = {
  customer: 'Customer', admin: 'Owner', billing: 'Billing staff', support: 'Support staff',
};

export const canSee = (role: Role | null, area: StaffArea) => !!role && AREA_ROLES[area].includes(role);
