import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';
import { bypassesDepartmentScope } from '../auth/types';
import { fetchDashboardDepartmentsBreakdown } from './departmentsBreakdown';
import { fetchActivityFeed } from './service';
import { hasPermission, requireAnyPermission } from '../../middleware/permissions';
import type { AppPermission } from '../permissions/types';
import { companyScopeForRequest } from '../../tenant/requestCompanyId';

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);
dashboardRouter.use(requireAnyPermission());

const SectionSchema = z.enum(['projects', 'approvals', 'exceptions', 'po']);

const SECTION_PERMISSION: Record<z.infer<typeof SectionSchema>, AppPermission> = {
  projects: 'view_projects',
  approvals: 'view_approvals',
  exceptions: 'manage_exceptions',
  po: 'view_pos',
};

dashboardRouter.get('/departments', async (req, res, next) => {
  try {
    const q = SectionSchema.safeParse(req.query.section);
    if (!q.success) {
      return res.status(400).json({ message: 'Query "section" must be one of: projects, approvals, exceptions, po' });
    }
    if (!hasPermission(req, SECTION_PERMISSION[q.data])) {
      throw new AppError('Missing required permission for this section', 403);
    }
    const role = req.auth!.role;
    const actorDepartment = req.auth!.department ?? null;
    if (!bypassesDepartmentScope(role) && !actorDepartment) {
      throw new AppError('Department is required for your role to load this view', 403);
    }
    const payload = await fetchDashboardDepartmentsBreakdown({
      section: q.data,
      actorRole: role,
      actorDepartment,
      companyId: companyScopeForRequest(req),
    });
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

dashboardRouter.get('/', async (req, res, next) => {
  try {
    const cid = companyScopeForRequest(req);
    const [
      { count: projectsCount, error: projectsErr },
      { count: pendingApprovalsCount, error: approvalsErr },
      { count: pendingExceptionsCount, error: exceptionsErr },
      { count: poRecordsCount, error: poErr },
    ] = await Promise.all([
      supabaseAdmin.from('projects').select('*', { count: 'exact', head: true }).eq('company_id', cid),
      supabaseAdmin
        .from('approvals')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', cid)
        .eq('status', 'pending'),
      supabaseAdmin
        .from('exceptions')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', cid)
        .eq('status', 'pending'),
      supabaseAdmin.from('purchase_orders').select('*', { count: 'exact', head: true }).eq('company_id', cid),
    ]);

    if (projectsErr) throw projectsErr;
    if (approvalsErr) throw approvalsErr;
    if (exceptionsErr) throw exceptionsErr;
    if (poErr) throw poErr;

    const role = req.auth!.role;
    const actorDepartment = req.auth!.department ?? null;
    const filterDeptRaw = typeof req.query.department === 'string' ? req.query.department.trim() : '';
    const filterDepartment = bypassesDepartmentScope(role) && filterDeptRaw ? filterDeptRaw : null;

    const activityFeed = await fetchActivityFeed({
      limit: 50,
      actorRole: role,
      actorDepartment,
      filterDepartment,
      companyId: cid,
    });

    const head = activityFeed[0] ?? null;
    const lastSystemUpdate = head
      ? {
          last_updated_at: head.timestamp,
          last_updated_by: head.actor,
          action: head.action,
          entity_type: head.entity_type,
          entity_id: head.entity_id,
        }
      : null;

    res.json({
      projects: projectsCount ?? 0,
      pendingApprovals: pendingApprovalsCount ?? 0,
      pendingExceptions: pendingExceptionsCount ?? 0,
      poRecords: poRecordsCount ?? 0,
      lastSystemUpdate,
      activityFeed,
    });
  } catch (err) {
    next(err);
  }
});
