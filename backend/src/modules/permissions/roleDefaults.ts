import type { AppPermission } from './types';
import { APP_PERMISSIONS } from './types';

/** Normalize DB / payload role strings for map lookup (e.g. `PM` → `pm`). */
export function normalizeRoleKey(role: string): string {
  return String(role ?? '').trim().toLowerCase();
}

/**
 * Baseline permissions per role. Not stored in DB — only explicit extras/overrides are persisted.
 * Unknown roles fall back to `employee`.
 */
export const ROLE_DEFAULT_PERMISSIONS: Record<string, readonly AppPermission[]> = {
  admin: [...APP_PERMISSIONS],
  platform_admin: [...APP_PERMISSIONS],
  pm: ['view_projects', 'view_pos', 'view_approvals'],
  finance: ['view_pos', 'view_budget', 'manage_exceptions'],
  gm: ['view_projects', 'view_pos', 'view_approvals', 'approve_requests', 'view_budget'],
  employee: ['view_projects'],
  /** App role: department head — aligned with “gm” style defaults in product spec. */
  dept_head: ['view_projects', 'view_pos', 'view_approvals', 'approve_requests', 'view_budget'],
};

export function getRoleDefaultPermissions(role: string): AppPermission[] {
  const r = normalizeRoleKey(role);
  const row = ROLE_DEFAULT_PERMISSIONS[r];
  if (row) return [...row];
  return [...ROLE_DEFAULT_PERMISSIONS.employee];
}

/** Effective rights = role defaults ∪ rows in `user_permissions` (extras only). */
export function mergeEffectivePermissions(role: string, storedExtras: AppPermission[]): AppPermission[] {
  const r = normalizeRoleKey(role);
  if (r === 'admin' || r === 'platform_admin') return [...APP_PERMISSIONS];
  const defaults = getRoleDefaultPermissions(r);
  return [...new Set<AppPermission>([...defaults, ...storedExtras])];
}

/** Persist only permissions the user has beyond role defaults. */
export function extrasBeyondRoleDefaults(role: string, desiredEffective: AppPermission[]): AppPermission[] {
  const r = normalizeRoleKey(role);
  if (r === 'admin' || r === 'platform_admin') return [];
  const def = new Set(getRoleDefaultPermissions(r));
  return [...new Set(desiredEffective)].filter((p) => !def.has(p));
}
