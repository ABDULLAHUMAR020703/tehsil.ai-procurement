import type { UserRole } from '../modules/auth/types';
import type { AppPermission } from '../modules/permissions/types';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        role: UserRole;
        companyId: string;
        companyName?: string | null;
        companyLogoUrl?: string | null;
        companyIsActive?: boolean;
        department?: string | null;
        name?: string | null;
        email?: string | null;
        /** True for admin / platform_admin — omit department filters and skip department-only access checks. */
        orgWideAccess?: boolean;
        /** Effective for non-admin users; admins and platform_admin bypass permission checks in middleware. */
        permissions?: AppPermission[];
      };
    }
  }
}

export {};

