import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { z } from 'zod';
import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';
import {
  archiveProject,
  createProjectWithExceptionFlow,
  updateProjectMemberAssignments,
  updateProjectTeamLead,
} from './service';
import {
  assertActorMayViewProject,
  fetchProjectForAccess,
  loadEmployeeVisibleProjectIds,
} from './projectAccess';
import { budgetPairFromRow, type PurchaseOrderDbRow } from '../po/groupByPo';
import { attachLastUpdatedFields } from '../auditLogs/lastUpdated';
import { bypassesDepartmentScope, isDeptManagerRole } from '../auth/types';
import { hasPermission, requirePermission } from '../../middleware/permissions';
import { companyScopeForRequest } from '../../tenant/requestCompanyId';
import type { TenantAuth } from '../../tenant/tenantScope';

export const projectsRouter = Router();

projectsRouter.use(requireAuth);
projectsRouter.use(requirePermission('view_projects'));

const DepartmentIdSchema = z.string().min(1).max(64).regex(/^[a-z0-9_]+$/);

projectsRouter.post('/', requirePermission('view_budget'), requireRole('admin', 'pm', 'dept_head'), async (req, res, next) => {
  try {
    const Schema = z.object({
      name: z.string().min(1).max(200),
      po_id: z.string().uuid().optional().nullable(),
      budget: z.coerce.number().positive().optional(),
      department_id: DepartmentIdSchema,
      pm_id: z.string().uuid(),
      team_lead_id: z.string().uuid(),
      assigned_employee_ids: z.array(z.string().uuid()).optional().default([]),
    });
    const parsed = Schema.parse(req.body);

    const actorUserId = req.auth!.userId;
    const actorDepartment = req.auth!.department ?? null;
    const actorRole = req.auth!.role;

    const noPo = !parsed.po_id;
    const budget = noPo ? parsed.budget : parsed.budget;
    if (noPo && (!budget || Number(budget) <= 0)) throw new AppError('Budget is required when creating a project without a PO', 400);

    const result = await createProjectWithExceptionFlow({
      name: parsed.name,
      poId: parsed.po_id ?? null,
      budget: Number(budget ?? 0),
      createdBy: actorUserId,
      actorRole,
      actorDepartment,
      companyId: companyScopeForRequest(req),
      departmentId: parsed.department_id,
      pmId: parsed.pm_id,
      teamLeadId: parsed.team_lead_id,
      assignedEmployeeIds: parsed.assigned_employee_ids ?? [],
    });

    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

projectsRouter.get('/', requireRole('admin', 'pm', 'dept_head', 'employee'), async (req, res, next) => {
  try {
    const role = req.auth!.role;
    const dept = req.auth!.department ?? null;
    const userId = req.auth!.userId;
    const cid = companyScopeForRequest(req);

    let q = supabaseAdmin
      .from('projects')
      .select(
        'id, name, po_id, budget, status, is_exception, created_by, created_at, department_id, team_lead_id, pm_id, updated_at, updated_by',
      )
      .eq('company_id', cid)
      .neq('status', 'archived')
      .order('created_at', { ascending: false })
      .limit(100);

    if (role === 'employee') {
      if (!dept) throw new AppError('User profile must include a department', 400);
      const visible = await loadEmployeeVisibleProjectIds({ userId, department: dept, companyId: cid });
      if (visible.length === 0) return res.json({ projects: [] });
      q = q.in('id', visible);
    } else if (!bypassesDepartmentScope(role) && isDeptManagerRole(role)) {
      if (!dept) throw new AppError('User profile must include a department', 400);
      q = q.eq('department_id', dept);
    }

    const { data: projects, error } = await q;
    if (error) throw error;

    const list = projects ?? [];
    const userIds = [...new Set(list.flatMap((p) => [p.pm_id, p.team_lead_id].filter(Boolean) as string[]))];
    let userMap = new Map<string, { id: string; name: string | null; email: string | null; role: string }>();
    if (userIds.length > 0) {
      const { data: users, error: uErr } = await supabaseAdmin
        .from('users')
        .select('id, name, email, role')
        .eq('company_id', cid)
        .in('id', userIds);
      if (uErr) throw uErr;
      userMap = new Map((users ?? []).map((u) => [u.id as string, u as { id: string; name: string | null; email: string | null; role: string }]));
    }

    const poIds = [...new Set(list.map((p) => p.po_id).filter((pid): pid is string => !!pid))];
    let poMap = new Map<string, { total_value: number; remaining_value: number }>();
    if (poIds.length > 0) {
      const { data: anchors, error: anchorErr } = await supabaseAdmin
        .from('purchase_orders')
        .select('id, po, po_amount, remaining_amount, total_value, remaining_value')
        .eq('company_id', cid)
        .in('id', poIds);
      if (anchorErr) throw anchorErr;

      const poTexts = new Set<string>();
      for (const row of anchors ?? []) {
        const poText = String((row as { po?: string | null }).po ?? '').trim();
        if (poText) poTexts.add(poText);
      }

      const sumsByPoText = new Map<string, { total_value: number; remaining_value: number }>();
      if (poTexts.size > 0) {
        const { data: siblings, error: sibErr } = await supabaseAdmin
          .from('purchase_orders')
          .select('po, po_amount, remaining_amount, total_value, remaining_value')
          .eq('company_id', cid)
          .in('po', [...poTexts]);
        if (sibErr) throw sibErr;
        for (const r of siblings ?? []) {
          const key = String((r as { po?: string | null }).po ?? '').trim();
          if (!key) continue;
          const { amount, remaining } = budgetPairFromRow(r as PurchaseOrderDbRow);
          const prev = sumsByPoText.get(key) ?? { total_value: 0, remaining_value: 0 };
          sumsByPoText.set(key, {
            total_value: prev.total_value + amount,
            remaining_value: prev.remaining_value + remaining,
          });
        }
      }

      for (const row of anchors ?? []) {
        const id = row.id as string;
        const poText = String((row as { po?: string | null }).po ?? '').trim();
        if (poText && sumsByPoText.has(poText)) {
          const agg = sumsByPoText.get(poText)!;
          poMap.set(id, agg);
        } else {
          const { amount, remaining } = budgetPairFromRow(row as PurchaseOrderDbRow);
          poMap.set(id, { total_value: amount, remaining_value: remaining });
        }
      }
    }

    const deptCodes = [...new Set(list.map((p) => p.department_id as string).filter(Boolean))];
    let deptLabelMap = new Map<string, string>();
    if (deptCodes.length > 0) {
      const { data: deptRows, error: dErr } = await supabaseAdmin
        .from('departments')
        .select('code, display_name')
        .eq('company_id', cid)
        .in('code', deptCodes);
      if (dErr) throw dErr;
      deptLabelMap = new Map((deptRows ?? []).map((r) => [r.code as string, r.display_name as string]));
    }

    const withAudit = await attachLastUpdatedFields('project', list, cid);
    const enriched = withAudit.map((p) => {
      const did = p.department_id as string;
      return {
        ...p,
        department_label: deptLabelMap.get(did) ?? did,
        purchase_order: p.po_id ? poMap.get(p.po_id) ?? null : null,
        pm: p.pm_id ? userMap.get(p.pm_id as string) ?? null : null,
        team_lead: p.team_lead_id ? userMap.get(p.team_lead_id as string) ?? null : null,
      };
    });

    const canBudget = hasPermission(req, 'view_budget');
    const visible = canBudget
      ? enriched
      : enriched.map((row) => {
          const po = row.purchase_order as { total_value?: unknown; remaining_value?: unknown } | null;
          return {
            ...row,
            budget: null,
            purchase_order: po
              ? { ...po, total_value: null, remaining_value: null }
              : po,
          };
        });

    res.json({ projects: visible });
  } catch (err) {
    next(err);
  }
});

projectsRouter.get('/:id', requireRole('admin', 'pm', 'dept_head', 'employee'), async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const role = req.auth!.role;
    const dept = req.auth!.department ?? null;
    const actorUserId = req.auth!.userId;

    const projectAccess = await fetchProjectForAccess(id, req.auth as TenantAuth);
    await assertActorMayViewProject({
      project: projectAccess,
      actorUserId,
      actorRole: role,
      actorDepartment: dept,
    });

    const { data: project, error } = await supabaseAdmin
      .from('projects')
      .select(
        'id, name, po_id, budget, status, is_exception, created_by, created_at, department_id, team_lead_id, pm_id, updated_at, updated_by, company_id',
      )
      .eq('id', id)
      .eq('company_id', projectAccess.company_id)
      .maybeSingle();
    if (error) throw error;
    if (!project) throw new AppError('Project not found', 404);

    const { data: deptRow } = await supabaseAdmin
      .from('departments')
      .select('code, display_name')
      .eq('company_id', projectAccess.company_id)
      .eq('code', project.department_id as string)
      .maybeSingle();

    const { data: assignRows } = await supabaseAdmin
      .from('project_assignments')
      .select('employee_id')
      .eq('company_id', projectAccess.company_id)
      .eq('project_id', id);
    const assignIds = [...new Set((assignRows ?? []).map((r) => r.employee_id as string))];

    const profileIds = [
      project.pm_id as string,
      project.team_lead_id as string | null,
      ...assignIds,
    ].filter(Boolean) as string[];
    const { data: profiles } = await supabaseAdmin
      .from('users')
      .select('id, name, email, role, job_title')
      .eq('company_id', projectAccess.company_id)
      .in('id', [...new Set(profileIds)]);

    const profileMap = new Map(
      (profiles ?? []).map((u) => [
        u.id as string,
        u as { id: string; name: string | null; email: string | null; role: string; job_title: string | null },
      ]),
    );

    const ub = project.updated_by as string | null;
    const { data: updater } = ub
      ? await supabaseAdmin
          .from('users')
          .select('id, name, email, role')
          .eq('company_id', projectAccess.company_id)
          .eq('id', ub)
          .maybeSingle()
      : { data: null };

    const [projectAudit] = await attachLastUpdatedFields('project', [project], projectAccess.company_id as string);

    let purchaseOrder: Record<string, unknown> | null = null;
    if (project.po_id) {
      const { data: po } = await supabaseAdmin
        .from('purchase_orders')
        .select('id, po_number, vendor, po, total_value, remaining_value, updated_at, updated_by')
        .eq('company_id', projectAccess.company_id)
        .eq('id', project.po_id)
        .maybeSingle();
      if (po) {
        const pob = (po as { updated_by?: string | null }).updated_by;
        const { data: poUpdater } = pob
          ? await supabaseAdmin
              .from('users')
              .select('id, name, email, role')
              .eq('company_id', projectAccess.company_id)
              .eq('id', pob)
              .maybeSingle()
          : { data: null };
        const [poAudit] = await attachLastUpdatedFields('purchase_order', [po], projectAccess.company_id as string);
        purchaseOrder = {
          ...po,
          updatedBy: poUpdater ?? null,
          last_updated_at: poAudit.last_updated_at,
          last_updated_by: poAudit.last_updated_by,
        };
      }
    }

    const pmProfile = project.pm_id ? profileMap.get(project.pm_id as string) ?? null : null;
    const teamLeadProfile = project.team_lead_id ? profileMap.get(project.team_lead_id as string) ?? null : null;
    const assignedEmployees = assignIds
      .map((eid) => profileMap.get(eid))
      .filter(Boolean) as Array<{
      id: string;
      name: string | null;
      email: string | null;
      role: string;
      job_title: string | null;
    }>;

    const includeRelatedPrs = req.query.include === 'related_prs';
    let relatedPurchaseRequests: Array<{
      id: string;
      description: string;
      amount: number;
      status: string;
      created_at: string;
    }> = [];
    if (includeRelatedPrs) {
      const { data: prRows, error: prErr } = await supabaseAdmin
        .from('purchase_requests')
        .select('id, description, amount, status, created_at')
        .eq('company_id', projectAccess.company_id)
        .eq('project_id', id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (prErr) throw prErr;
      relatedPurchaseRequests = (prRows ?? []) as typeof relatedPurchaseRequests;
    }

    const canBudget = hasPermission(req, 'view_budget');
    const projectOut = {
      ...project,
      budget: canBudget ? project.budget : null,
      department_label: deptRow?.display_name ?? project.department_id,
      updatedBy: updater ?? null,
      last_updated_at: projectAudit.last_updated_at,
      last_updated_by: projectAudit.last_updated_by,
      pm: pmProfile,
      team_lead: teamLeadProfile,
      assigned_employees: assignedEmployees,
    };
    let purchaseOrderOut: typeof purchaseOrder = purchaseOrder;
    if (!canBudget && purchaseOrder && typeof purchaseOrder === 'object') {
      purchaseOrderOut = {
        ...purchaseOrder,
        total_value: null,
        remaining_value: null,
      };
    }
    const relatedOut =
      includeRelatedPrs && !canBudget
        ? relatedPurchaseRequests.map((r) => ({ ...r, amount: null as unknown as number }))
        : relatedPurchaseRequests;

    res.json({
      project: projectOut,
      purchaseOrder: purchaseOrderOut,
      ...(includeRelatedPrs ? { relatedPurchaseRequests: relatedOut } : {}),
    });
  } catch (err) {
    next(err);
  }
});

projectsRouter.patch(
  '/:id/team-lead',
  requireRole('admin', 'pm', 'dept_head'),
  async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const Body = z.object({
        team_lead_id: z.string().uuid().nullable(),
      });
      const parsed = Body.parse(req.body);
      const result = await updateProjectTeamLead({
        projectId: id,
        teamLeadId: parsed.team_lead_id,
        actorUserId: req.auth!.userId,
        actorRole: req.auth!.role,
        actorDepartment: req.auth!.department ?? null,
        tenantAuth: req.auth as TenantAuth,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

projectsRouter.patch('/:id/members', requireRole('admin', 'pm', 'dept_head'), async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const Body = z.object({
      assigned_employee_ids: z.array(z.string().uuid()),
    });
    const parsed = Body.parse(req.body);
    const result = await updateProjectMemberAssignments({
      projectId: id,
      assignedEmployeeIds: parsed.assigned_employee_ids,
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      actorDepartment: req.auth!.department ?? null,
      tenantAuth: req.auth as TenantAuth,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

projectsRouter.delete('/:id', requireRole('admin', 'pm', 'dept_head'), async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const result = await archiveProject({
      projectId: id,
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      actorDepartment: req.auth!.department ?? null,
      tenantAuth: req.auth as TenantAuth,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});
