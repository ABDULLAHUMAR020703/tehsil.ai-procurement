import { supabaseAdmin } from '../config/supabase';
import { AppError } from '../utils/errors';
import { isPlatformAdminRole, type UserRole } from '../modules/auth/types';

/** When set, all `.eq('company_id', …)` filters must use this column name (default `company_id`). */
export const TENANT_COLUMN = 'company_id' as const;

export type TenantAuth = {
  userId: string;
  role: UserRole;
  companyId: string;
  /** When set (e.g. from HTTP auth), overrides `companyId` for tenant-scoped queries. */
  scopedCompanyId?: string;
};

/** Company UUID for tenant filters; uses `scopedCompanyId` when present (see `requireAuth`). */
export function tenantFilterCompanyId(auth: TenantAuth | undefined): string | undefined {
  if (!auth) return undefined;
  return auth.scopedCompanyId ?? auth.companyId;
}

export function requireTenantCompanyId(auth: TenantAuth | undefined): string {
  const id = tenantFilterCompanyId(auth);
  if (!id) {
    throw new AppError('Missing tenant company scope', 500);
  }
  return id;
}

/**
 * Centralized PostgREST tenant filter. Omits the predicate only when `auth` is missing.
 * Parameters/return are intentionally loose so chaining does not hit TS2589 (Supabase generics).
 */
export function applyTenantEq(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  qb: any,
  auth: TenantAuth | undefined,
  column: string = TENANT_COLUMN,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const cid = tenantFilterCompanyId(auth);
  if (cid === undefined) return qb;
  return qb.eq(column, cid);
}

/**
 * Tenant filter for generic queries: **skips** `company_id` for `platform_admin` (global operator).
 * For user/employee listings and most APIs, use {@link applyTenantEq} instead so `scopedCompanyId`
 * and `?companyId=` still isolate tenants.
 */
export function applyTenantScope(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  qb: any,
  auth: TenantAuth | undefined,
  column: string = TENANT_COLUMN,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  if (!auth) return qb;
  if (isPlatformAdminRole(auth.role)) return qb;
  return qb.eq(column, auth.companyId);
}

/** Assert a single row belongs to the effective tenant (`scopedCompanyId` or `companyId`). */
export async function assertRowCompany(
  table: string,
  id: string,
  auth: TenantAuth,
  opts?: { idColumn?: string },
): Promise<void> {
  const cid = requireTenantCompanyId(auth);
  const idColumn = opts?.idColumn ?? 'id';
  const q = supabaseAdmin.from(table).select(TENANT_COLUMN).eq(idColumn, id).eq(TENANT_COLUMN, cid);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  const rowCid = data?.[TENANT_COLUMN] as string | undefined;
  if (!rowCid || rowCid !== cid) {
    throw new AppError('Not found', 404);
  }
}
