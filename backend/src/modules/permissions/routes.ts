import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { AppError } from '../../utils/errors';
import { isAppPermission } from './types';
import { listUsersWithPermissions, replaceUserPermissions } from './service';
import { companyScopeForRequest } from '../../tenant/requestCompanyId';

export const permissionsRouter = Router();

permissionsRouter.use(requireAuth);
permissionsRouter.use(requireRole('admin', 'platform_admin'));

permissionsRouter.get('/', async (req, res, next) => {
  try {
    const cid = companyScopeForRequest(req);
    const users = await listUsersWithPermissions(cid);
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

permissionsRouter.patch('/:userId', async (req, res, next) => {
  try {
    const userId = z.string().uuid().parse(req.params.userId);
    const cid = companyScopeForRequest(req);
    const Body = z.object({
      permissions: z.array(z.string()),
    });
    const parsed = Body.parse(req.body ?? {});
    const permissions = parsed.permissions.filter(isAppPermission);
    if (permissions.length !== parsed.permissions.length) {
      throw new AppError('One or more permission values are invalid', 400);
    }

    const result = await replaceUserPermissions({
      actorRole: req.auth!.role,
      targetUserId: userId,
      permissions,
      companyId: cid,
    });

    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return next(new AppError(err.issues.map((i) => i.message).join('; ') || 'Invalid body', 400));
    }
    next(err);
  }
});
