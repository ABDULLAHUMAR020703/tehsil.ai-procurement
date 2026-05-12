import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { z } from 'zod';
import { decideException, listPendingExceptionsForActor } from './service';
import { isPlatformAdminRole } from '../auth/types';
import { requirePermission } from '../../middleware/permissions';

export const exceptionsRouter = Router();

exceptionsRouter.use(requireAuth);
exceptionsRouter.use(requirePermission('manage_exceptions'));

exceptionsRouter.get('/', requireRole('admin', 'pm', 'dept_head', 'platform_admin'), async (req, res, next) => {
  try {
    const exceptions = await listPendingExceptionsForActor({
      actorRole: req.auth!.role,
      actorDepartment: req.auth!.department ?? null,
      companyId: isPlatformAdminRole(req.auth!.role) ? undefined : req.auth!.companyId,
    });
    res.json({ exceptions });
  } catch (err) {
    next(err);
  }
});

const ExceptionActionSchema = z.object({
  reason: z.string().max(2000).optional(),
});

exceptionsRouter.post('/:id/approve', requireRole('admin', 'pm', 'dept_head', 'platform_admin'), async (req, res, next) => {
  try {
    const exceptionId = req.params.id as string;
    ExceptionActionSchema.parse(req.body ?? {});
    const result = await decideException({
      exceptionId,
      decision: 'approved',
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      actorDepartment: req.auth!.department ?? null,
      companyId: isPlatformAdminRole(req.auth!.role) ? undefined : req.auth!.companyId,
    });
    res.json({ ok: true, result });
  } catch (err) {
    next(err);
  }
});

exceptionsRouter.post('/:id/reject', requireRole('admin', 'pm', 'dept_head', 'platform_admin'), async (req, res, next) => {
  try {
    const exceptionId = req.params.id as string;
    ExceptionActionSchema.parse(req.body ?? {});
    const result = await decideException({
      exceptionId,
      decision: 'rejected',
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      actorDepartment: req.auth!.department ?? null,
      companyId: isPlatformAdminRole(req.auth!.role) ? undefined : req.auth!.companyId,
    });
    res.json({ ok: true, result });
  } catch (err) {
    next(err);
  }
});
