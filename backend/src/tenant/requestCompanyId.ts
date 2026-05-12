import type { Request } from 'express';

/**
 * Tenant company for the current HTTP request. Resolved in `requireAuth` as `scopedCompanyId`
 * (platform admins may pass `?companyId=<uuid>` for support tooling).
 */
export function companyScopeForRequest(req: Request): string {
  const auth = req.auth!;
  return auth.scopedCompanyId ?? auth.companyId;
}
