import type { Request } from 'express';
import { z } from 'zod';
import { isPlatformAdminRole } from '../modules/auth/types';

/**
 * Tenant company for the current HTTP request. Platform admins may pass `?companyId=<uuid>` to
 * operate on a specific tenant from support tooling; everyone else uses `req.auth.companyId`.
 */
export function companyScopeForRequest(req: Request): string {
  const auth = req.auth!;
  const q = req.query.companyId;
  if (isPlatformAdminRole(auth.role) && typeof q === 'string' && z.string().uuid().safeParse(q.trim()).success) {
    return q.trim();
  }
  return auth.companyId;
}
