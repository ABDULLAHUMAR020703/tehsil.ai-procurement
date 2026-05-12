import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';
import type { UserRole } from '../auth/types';
import { bypassesDepartmentScope } from '../auth/types';
import type { AppPermission } from './types';
import { APP_PERMISSIONS, isAppPermission } from './types';
import {
  extrasBeyondRoleDefaults,
  mergeEffectivePermissions,
  normalizeRoleKey,
} from './roleDefaults';

export type UserPermissionRow = {
  user_id: string;
  name: string;
  department: string;
  role: string;
  permissions: AppPermission[];
  is_admin: boolean;
};

export async function listUsersWithPermissions(companyId: string): Promise<UserPermissionRow[]> {
  const { data: users, error: uErr } = await supabaseAdmin
    .from('users')
    .select('id, name, department, role')
    .eq('company_id', companyId)
    .order('name', { ascending: true });
  if (uErr) throw uErr;

  const { data: permRows, error: pErr } = await supabaseAdmin
    .from('user_permissions')
    .select('user_id, permission')
    .eq('company_id', companyId);
  if (pErr) throw pErr;

  const byUser = new Map<string, Set<AppPermission>>();
  for (const row of permRows ?? []) {
    const uid = row.user_id as string;
    const perm = row.permission as string;
    if (!isAppPermission(perm)) continue;
    const set = byUser.get(uid) ?? new Set();
    set.add(perm);
    byUser.set(uid, set);
  }

  return (users ?? []).map((u) => {
    const storedSet = byUser.get(u.id as string);
    const storedExtras = storedSet ? [...storedSet] : [];
    const role = normalizeRoleKey(u.role as string);
    const finalPermissions = mergeEffectivePermissions(role, storedExtras);

    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.log('[permissions:list]', {
        name: (u.name as string) ?? '',
        role,
        storedExtras,
        finalPermissions,
      });
    }

    return {
      user_id: u.id as string,
      name: (u.name as string) ?? '',
      department: (u.department as string) ?? '',
      role,
      permissions: finalPermissions,
      is_admin: role === 'admin',
    };
  });
}

export async function replaceUserPermissions(params: {
  actorRole: UserRole;
  targetUserId: string;
  permissions: AppPermission[];
  companyId: string;
}): Promise<{ user_id: string; permissions: AppPermission[] }> {
  const { actorRole, targetUserId, permissions, companyId } = params;
  if (!bypassesDepartmentScope(actorRole)) throw new AppError('Forbidden', 403);

  const unique = [...new Set(permissions)];
  for (const p of unique) {
    if (!APP_PERMISSIONS.includes(p)) throw new AppError(`Invalid permission: ${p}`, 400);
  }

  const { data: target, error: tErr } = await supabaseAdmin
    .from('users')
    .select('id, role, company_id')
    .eq('id', targetUserId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (tErr) throw tErr;
  if (!target) throw new AppError('User not found', 404);
  if ((target.company_id as string) !== companyId) {
    throw new AppError('User not found', 404);
  }
  if ((target.role as string) === 'admin') {
    throw new AppError('Admin users always have full access; permissions are not stored for them.', 400);
  }

  const targetRole = normalizeRoleKey(target.role as string);
  const toStore = extrasBeyondRoleDefaults(targetRole, unique);

  const { error: delErr } = await supabaseAdmin
    .from('user_permissions')
    .delete()
    .eq('user_id', targetUserId)
    .eq('company_id', companyId);
  if (delErr) throw delErr;

  if (toStore.length > 0) {
    const { error: insErr } = await supabaseAdmin.from('user_permissions').insert(
      toStore.map((permission) => ({ user_id: targetUserId, permission, company_id: companyId })),
    );
    if (insErr) throw insErr;
  }

  const effective = mergeEffectivePermissions(targetRole, toStore);
  return { user_id: targetUserId, permissions: effective };
}
