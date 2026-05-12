import { supabaseAdmin } from '../config/supabase';
import { AppError } from '../utils/errors';
import { isPlatformAdminRole, type UserRole } from '../modules/auth/types';

/** When set, all `.eq('company_id', …)` filters must use this column name (default `company_id`). */
export const TENANT_COLUMN = 'company_id' as const;

export type TenantAuth = {
  userId: string;
  role: UserRole;
  companyId: string;
};

type EqBuilder = { eq: (column: string, value: string) => EqBuilder };

/**
 * Returns the company UUID to enforce for this request, or `undefined` if the caller is a platform admin
 * (cross-tenant reads/writes must still validate resource ownership separately where needed).
 */
export function tenantFilterCompanyId(auth: TenantAuth | undefined): string | undefined {
  if (!auth) return undefined;
  if (isPlatformAdminRole(auth.role)) return undefined;
  return auth.companyId;
}

export function requireTenantCompanyId(auth: TenantAuth | undefined): string {
  const id = tenantFilterCompanyId(auth);
  if (!id) {
    throw new AppError('Missing tenant company scope', 500);
  }
  return id;
}

/**
 * Centralized PostgREST tenant filter. Platform admins omit the predicate for global visibility.
 */
export function applyTenantEq<T extends EqBuilder>(qb: T, auth: TenantAuth | undefined, column: string = TENANT_COLUMN): T {
  const cid = tenantFilterCompanyId(auth);
  if (cid === undefined) return qb;
  return qb.eq(column, cid) as T;
}

/** Assert a single row belongs to the tenant (or platform admin). */
export async function assertRowCompany(
  table: string,
  id: string,
  auth: TenantAuth,
  opts?: { idColumn?: string },
): Promise<void> {
  if (isPlatformAdminRole(auth.role)) return;
  const idColumn = opts?.idColumn ?? 'id';
  let q = supabaseAdmin.from(table).select(TENANT_COLUMN).eq(idColumn, id);
  if (!isPlatformAdminRole(auth.role)) {
    q = q.eq(TENANT_COLUMN, auth.companyId);
  }
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  const rowCid = data?.[TENANT_COLUMN] as string | undefined;
  if (!rowCid || rowCid !== auth.companyId) {
    throw new AppError('Not found', 404);
  }
}
