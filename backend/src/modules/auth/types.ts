export type UserRole = 'admin' | 'pm' | 'dept_head' | 'employee' | 'platform_admin';

export function isPlatformAdminRole(role: UserRole | string): boolean {
  return String(role ?? '').trim().toLowerCase() === 'platform_admin';
}

/** PM or department head — same department-scoped project and PO privileges. */
export function isDeptManagerRole(role: UserRole): boolean {
  return role === 'pm' || role === 'dept_head';
}

/** Admins and platform admins are not limited to one department for reads, list filters, or scope checks. */
export function bypassesDepartmentScope(role: UserRole): boolean {
  return role === 'admin' || isPlatformAdminRole(role);
}

/** Departments; admin users use `management` only. */
export type Department =
  | 'sales'
  | 'hr'
  | 'technical'
  | 'finance'
  | 'engineering'
  | 'management'
  | 'ibs'
  | 'power'
  | 'civil_works'
  | 'bss_wireless'
  | 'fixed_network'
  | 'warehouse';

/**
 * Values stored in `approvals.role` — workflow stages, not application UserRole.
 * (Team lead approval is tied to `projects.team_lead_id`, not a global role.)
 */
export type ApprovalStageRole = 'team_lead' | 'pm' | 'admin';

/** Stages that must be satisfied before budget finalization (PM is final). */
export type RequiredApprovalStageRole = 'team_lead' | 'pm';

export const REQUIRED_APPROVAL_STAGE_ORDER: readonly RequiredApprovalStageRole[] = ['team_lead', 'pm'];

/** Sort order when displaying rows that may include legacy `admin` records. */
export const APPROVAL_STAGE_SORT_ORDER: ApprovalStageRole[] = ['team_lead', 'pm', 'admin'];

export const DEPARTMENTS: Department[] = [
  'sales',
  'hr',
  'technical',
  'finance',
  'engineering',
  'management',
  'ibs',
  'power',
  'civil_works',
  'bss_wireless',
  'fixed_network',
  'warehouse',
];
