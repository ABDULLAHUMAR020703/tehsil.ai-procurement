import type { RequestHandler } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase';
import { AppError } from '../utils/errors';
import { bypassesDepartmentScope, isPlatformAdminRole, type UserRole } from '../modules/auth/types';
import type { AppPermission } from '../modules/permissions/types';
import { APP_PERMISSIONS, isAppPermission } from '../modules/permissions/types';
import { mergeEffectivePermissions } from '../modules/permissions/roleDefaults';

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.header('Authorization');
  if (!header || !header.startsWith('Bearer ')) {
    return next(new AppError('Missing Authorization bearer token', 401));
  }

  const token = header.slice('Bearer '.length);
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);

  if (userErr || !userData?.user) {
    return next(new AppError('Invalid or expired token', 401, userErr ?? undefined));
  }

  const userId = userData.user.id;
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('users')
    .select(
      'id, role, department, name, email, company_id, companies!inner(id, name, logo_url, is_active)',
    )
    .eq('id', userId)
    .single();

  if (profileErr || !profile) {
    return next(new AppError('User profile not found in `users` table', 401, profileErr ?? undefined));
  }

  const role = profile.role as UserRole;
  const companyId = profile.company_id as string;
  const companyRow = profile.companies as
    | { id: string; name: string; logo_url: string | null; is_active: boolean }
    | { id: string; name: string; logo_url: string | null; is_active: boolean }[]
    | null;
  const company = Array.isArray(companyRow) ? companyRow[0] : companyRow;
  if (!companyId || !company) {
    return next(new AppError('User profile missing company', 401));
  }
  if (!isPlatformAdminRole(role) && company.is_active === false) {
    return next(new AppError('Company is suspended', 403));
  }

  let scopedCompanyId = companyId;
  const qCompany = req.query.companyId;
  if (
    isPlatformAdminRole(role) &&
    typeof qCompany === 'string' &&
    z.string().uuid().safeParse(qCompany.trim()).success
  ) {
    scopedCompanyId = qCompany.trim();
  }

  let permissions: AppPermission[] = [];
  if (bypassesDepartmentScope(role)) {
    permissions = [...APP_PERMISSIONS];
  } else {
    const { data: permRows, error: permErr } = await supabaseAdmin
      .from('user_permissions')
      .select('permission')
      .eq('user_id', userId)
      .eq('company_id', scopedCompanyId);
    if (permErr) return next(new AppError('Failed to load permissions', 500, permErr));
    const fromDb = (permRows ?? [])
      .map((r) => r.permission as string)
      .filter(isAppPermission);
    permissions = mergeEffectivePermissions(role, fromDb);
  }

  req.auth = {
    userId,
    role,
    companyId,
    scopedCompanyId,
    companyName: company.name ?? null,
    companyLogoUrl: company.logo_url ?? null,
    companyIsActive: company.is_active,
    department: profile.department ?? null,
    name: profile.name ?? null,
    email: profile.email ?? null,
    orgWideAccess: bypassesDepartmentScope(role),
    permissions,
  };

  if (process.env.DEBUG_TENANT === '1') {
    // eslint-disable-next-line no-console
    console.log('[DEBUG_TENANT] AUTH USER', req.auth);
  }

  return next();
};

