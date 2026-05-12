import type { Request } from 'express';
import { AppError } from '../utils/errors';
import { tenantFilterCompanyId, type TenantAuth } from './tenantScope';

/**
 * Effective tenant for the HTTP request (`scopedCompanyId ?? companyId` from `requireAuth`).
 * Throws if the caller has no resolvable tenant UUID (prevents accidental unfiltered queries).
 */
export function companyScopeForRequest(req: Request): string {
  if (!req.auth) {
    throw new AppError('Unauthorized', 401);
  }
  const cid = tenantFilterCompanyId(req.auth as TenantAuth);
  if (!cid) {
    throw new AppError('User profile missing company_id', 500);
  }
  return cid;
}
