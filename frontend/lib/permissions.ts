export const APP_PERMISSION_IDS = [
  'view_projects',
  'view_pos',
  'view_approvals',
  'approve_requests',
  'view_budget',
  'manage_exceptions',
] as const;

export type AppPermissionId = (typeof APP_PERMISSION_IDS)[number];

export const PERMISSION_COLUMNS: { id: AppPermissionId; label: string }[] = [
  { id: 'view_projects', label: 'View Projects' },
  { id: 'view_pos', label: 'View POs' },
  { id: 'view_approvals', label: 'View Approvals' },
  { id: 'approve_requests', label: 'Approve Requests' },
  { id: 'view_budget', label: 'View Budget' },
  { id: 'manage_exceptions', label: 'Manage Exceptions' },
];

export function hasAppPermission(
  profile: { role: string; permissions?: AppPermissionId[] | null } | null | undefined,
  perm: AppPermissionId,
): boolean {
  if (!profile) return false;
  if (profile.role === 'admin' || profile.role === 'platform_admin') return true;
  return (profile.permissions ?? []).includes(perm);
}

/** Dashboard API allows users with any configured permission. */
export function hasAnyDashboardPermission(
  profile: { role: string; permissions?: AppPermissionId[] | null } | null | undefined,
): boolean {
  if (!profile) return false;
  if (profile.role === 'admin' || profile.role === 'platform_admin') return true;
  const p = profile.permissions ?? [];
  return APP_PERMISSION_IDS.some((id) => p.includes(id));
}
