import { Router } from 'express';
import type { Request } from 'express';
import multer from 'multer';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { hasPermission, requirePermission } from '../../middleware/permissions';
import { z } from 'zod';
import {
  countPreviousPrsForSameItem,
  createPurchaseRequest,
  deletePurchaseRequest,
  normalizeItemCode,
} from './service';
import {
  buildPrPoLineSummary,
  enrichPurchaseRequestsWithPoLine,
  loadAnchorsForProjectIds,
} from './poLineContext';
import { loadEmployeeVisibleProjectIds } from '../projects/projectAccess';
import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';
import { bypassesDepartmentScope } from '../auth/types';
import { attachLastUpdatedFields } from '../auditLogs/lastUpdated';

export const purchaseRequestsRouter = Router();

async function withPoLineSummaries(rows: Record<string, unknown>[]) {
  if (!rows.length) return rows;
  const map = await enrichPurchaseRequestsWithPoLine(
    rows.map((r) => ({
      id: r.id as string,
      project_id: r.project_id as string,
      description: r.description as string,
      amount: r.amount as number | string,
      item_code: (r.item_code as string | null) ?? null,
      po_line_id: (r.po_line_id as string | null) ?? null,
      requested_quantity: (r.requested_quantity as number | string | null) ?? null,
      status: r.status as string,
    })),
  );
  return rows.map((r) => ({ ...r, po_line_summary: map.get(r.id as string) ?? null }));
}

purchaseRequestsRouter.use(requireAuth);
purchaseRequestsRouter.use(requirePermission('view_projects'));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

function redactPrListRow(req: Request, row: Record<string, unknown>): Record<string, unknown> {
  if (hasPermission(req, 'view_budget')) return row;
  return { ...row, amount: null, po_line_summary: null };
}

function stripPrDetailFinancials(req: Request, body: Record<string, unknown>): Record<string, unknown> {
  if (hasPermission(req, 'view_budget')) return body;
  const copy: Record<string, unknown> = { ...body };
  if (copy.purchaseRequest && typeof copy.purchaseRequest === 'object') {
    copy.purchaseRequest = {
      ...(copy.purchaseRequest as Record<string, unknown>),
      amount: null,
      poLineSummary: null,
    };
  }
  if (copy.project && typeof copy.project === 'object') {
    copy.project = { ...(copy.project as Record<string, unknown>), budget: null };
  }
  if (copy.purchaseOrder && typeof copy.purchaseOrder === 'object') {
    copy.purchaseOrder = {
      ...(copy.purchaseOrder as Record<string, unknown>),
      total_value: null,
      remaining_value: null,
    };
  }
  return copy;
}

purchaseRequestsRouter.post(
  '/',
  requirePermission('view_budget'),
  requireRole('admin', 'pm', 'dept_head', 'employee'),
  upload.single('document'),
  async (req, res, next) => {
    try {
      const Schema = z.object({
        project_id: z.string().uuid(),
        description: z.string().trim().min(10, 'Description must be at least 10 characters').max(5000),
        amount: z.coerce.number().positive(),
        item_code: z.string().max(256).optional(),
        po_line_sn: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.string().max(512).optional()),
        requested_quantity: z.preprocess(
          (v) => (v === '' || v == null ? undefined : v),
          z.coerce.number().positive().optional(),
        ),
      });
      const parsed = Schema.parse(req.body);

      const actorDepartment = req.auth!.department ?? null;

      const result = await createPurchaseRequest({
        projectId: parsed.project_id,
        description: parsed.description,
        amount: Number(parsed.amount),
        itemCode: parsed.item_code?.trim() ? parsed.item_code.trim() : null,
        poLineSn: parsed.po_line_sn?.trim() ? parsed.po_line_sn.trim() : null,
        requestedQuantity: parsed.requested_quantity != null ? Number(parsed.requested_quantity) : null,
        documentFile: req.file
          ? {
              buffer: req.file.buffer,
              originalName: req.file.originalname,
              mimeType: req.file.mimetype,
            }
          : null,
        createdBy: req.auth!.userId,
        actorRole: req.auth!.role,
        actorDepartment,
      });

      res.status(201).json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  },
);

purchaseRequestsRouter.get(
  '/',
  requireRole('admin', 'pm', 'dept_head', 'employee'),
  async (req, res, next) => {
    try {
      const userId = req.auth!.userId;
      const role = req.auth!.role;

      const select =
        'id, project_id, description, amount, document_url, item_code, duplicate_count, po_line_id, requested_quantity, budget_deducted, status, created_by, created_at, updated_at, updated_by';

      if (bypassesDepartmentScope(role)) {
        const { data, error } = await supabaseAdmin
          .from('purchase_requests')
          .select(select)
          .order('created_at', { ascending: false })
          .limit(100);
        if (error) throw error;
        const withAudit = await attachLastUpdatedFields('purchase_request', data ?? []);
        const enriched = await withPoLineSummaries(withAudit as Record<string, unknown>[]);
        const visible = enriched.map((row) => redactPrListRow(req, row as Record<string, unknown>));
        return res.json({ purchaseRequests: visible });
      }

      const { data: created, error: createdErr } = await supabaseAdmin
        .from('purchase_requests')
        .select(select)
        .eq('created_by', userId);
      if (createdErr) throw createdErr;

      const { data: approvalReqIds, error: approvalsErr } = await supabaseAdmin
        .from('approvals')
        .select('request_id')
        .eq('approver_id', userId)
        .eq('status', 'pending');
      if (approvalsErr) throw approvalsErr;

      const ids = (approvalReqIds ?? []).map((r) => r.request_id as string);
      const { data: pendingApprovals, error: pendingErr } = ids.length
        ? await supabaseAdmin.from('purchase_requests').select(select).in('id', ids)
        : { data: [] as unknown[], error: null as unknown as any };
      if (pendingErr) throw pendingErr;

      let byProject: unknown[] = [];
      if (role === 'employee' && req.auth!.department) {
        const visible = await loadEmployeeVisibleProjectIds({
          userId,
          department: req.auth!.department,
        });
        if (visible.length > 0) {
          const { data: prProj, error: prProjErr } = await supabaseAdmin
            .from('purchase_requests')
            .select(select)
            .in('project_id', visible)
            .order('created_at', { ascending: false })
            .limit(100);
          if (prProjErr) throw prProjErr;
          byProject = prProj ?? [];
        }
      }

      const map = new Map<string, any>();
      for (const pr of (created ?? []) as any[]) map.set(pr.id as string, pr);
      for (const pr of (pendingApprovals ?? []) as any[]) map.set(pr.id as string, pr);
      for (const pr of byProject as any[]) map.set(pr.id as string, pr);

      const merged = [...map.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 100);
      const withAudit = await attachLastUpdatedFields('purchase_request', merged);
      const enriched = await withPoLineSummaries(withAudit as Record<string, unknown>[]);
      const visible = enriched.map((row) => redactPrListRow(req, row as Record<string, unknown>));
      res.json({ purchaseRequests: visible });
    } catch (err) {
      next(err);
    }
  },
);

purchaseRequestsRouter.get(
  '/item-duplicate-count',
  requireRole('admin', 'pm', 'dept_head', 'employee'),
  async (req, res, next) => {
    try {
      const q = z
        .object({
          item_code: z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().min(1).max(256)),
        })
        .safeParse(req.query);
      if (!q.success) throw new AppError('item_code query parameter is required', 400);
      const norm = normalizeItemCode(q.data.item_code);
      if (!norm) {
        return res.json({ previousCount: 0 });
      }
      const previousCount = await countPreviousPrsForSameItem(req.auth!.userId, norm);
      res.json({ previousCount });
    } catch (err) {
      next(err);
    }
  },
);

purchaseRequestsRouter.delete(
  '/:id',
  requireRole('admin', 'pm', 'dept_head'),
  async (req, res, next) => {
    try {
      const requestId = req.params.id as string;
      if (!requestId) throw new AppError('Missing purchase request id', 400);
      await deletePurchaseRequest({
        requestId,
        actorUserId: req.auth!.userId,
        actorRole: req.auth!.role,
        actorDepartment: req.auth!.department ?? null,
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

purchaseRequestsRouter.get(
  '/:id',
  requireRole('admin', 'pm'),
  async (req, res, next) => {
    try {
      const requestId = req.params.id as string;
      if (!requestId) throw new AppError('Missing purchase request id', 400);

      const { data: pr, error: prErr } = await supabaseAdmin
        .from('purchase_requests')
        .select(
          'id, project_id, description, amount, document_url, item_code, duplicate_count, po_line_id, requested_quantity, budget_deducted, status, created_by, created_at, updated_at, updated_by',
        )
        .eq('id', requestId)
        .maybeSingle();

      if (prErr) throw new AppError('Failed to fetch purchase request', 500);
      if (!pr) throw new AppError('Purchase request not found', 404);

      const prUpdatedBy = (pr as { updated_by?: string | null }).updated_by ?? null;

      // Fetch related rows safely (missing joins should not crash).
      const [creatorRes, updaterRes, projectRes, approvalsRes] = await Promise.all([
        supabaseAdmin.from('users').select('id, name, email, role, department').eq('id', pr.created_by).maybeSingle(),
        prUpdatedBy
          ? supabaseAdmin.from('users').select('id, name, email, role, department').eq('id', prUpdatedBy).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        pr.project_id
          ? supabaseAdmin
              .from('projects')
              .select(
                'id, name, po_id, budget, status, is_exception, created_by, created_at, department_id, team_lead_id, updated_at, updated_by',
              )
              .eq('id', pr.project_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        supabaseAdmin
          .from('approvals')
          .select(
            'id, request_id, approver_id, role, status, comments, created_at, updated_at, updated_by, is_admin_override',
          )
          .eq('request_id', pr.id)
          .order('created_at', { ascending: true }),
      ]);

      const creator = creatorRes.data ?? null;
      const updater = updaterRes.data ?? null;
      const project = projectRes.data ?? null;
      const approvals = approvalsRes.data ?? [];

      if (approvalsRes.error) throw approvalsRes.error;

      const actorRole = req.auth!.role;
      if (actorRole === 'pm') {
        const actorDept = req.auth!.department ?? null;
        const projectDept = (project?.department_id as string | null) ?? null;
        if (!projectDept || !actorDept || actorDept !== projectDept) {
          throw new AppError('You can only view purchase requests for projects in your department', 403);
        }
      }

      const poId = project?.po_id ?? null;
      let po: any = null;
      if (poId) {
        const { data, error } = await supabaseAdmin
          .from('purchase_orders')
          .select('id, po_number, vendor, total_value, remaining_value, updated_at, updated_by')
          .eq('id', poId)
          .maybeSingle();
        // If PO missing, keep null.
        if (error) po = null;
        po = data ?? null;
      }

      const projUpId = project ? (project as { updated_by?: string | null }).updated_by : null;
      const poUpId = po ? (po as { updated_by?: string | null }).updated_by : null;
      const touchIds = [...new Set([projUpId, poUpId].filter(Boolean))] as string[];
      let touchMap = new Map<string, { id: string; name: string; email: string; role: string }>();
      if (touchIds.length > 0) {
        const { data: tu, error: tuErr } = await supabaseAdmin
          .from('users')
          .select('id, name, email, role')
          .in('id', touchIds);
        if (tuErr) throw tuErr;
        touchMap = new Map((tu ?? []).map((u) => [u.id as string, u as { id: string; name: string; email: string; role: string }]));
      }

      let projectPayload: Record<string, unknown> | null = null;
      if (project) {
        const [projAudit] = await attachLastUpdatedFields('project', [project]);
        projectPayload = {
          ...project,
          updatedBy: projUpId ? touchMap.get(projUpId) ?? null : null,
          last_updated_at: projAudit.last_updated_at,
          last_updated_by: projAudit.last_updated_by,
        };
      }

      let poPayload: Record<string, unknown> | null = null;
      if (po) {
        const [poAudit] = await attachLastUpdatedFields('purchase_order', [po]);
        poPayload = {
          ...po,
          updatedBy: poUpId ? touchMap.get(poUpId) ?? null : null,
          last_updated_at: poAudit.last_updated_at,
          last_updated_by: poAudit.last_updated_by,
        };
      }

      const referenceIds: string[] = [pr.id];
      if (project?.id) referenceIds.push(project.id);
      const { data: exceptions, error: exErr } = await supabaseAdmin
        .from('exceptions')
        .select('id, type, reference_id, status, approved_by, created_at')
        .in('reference_id', referenceIds)
        .order('created_at', { ascending: true });
      if (exErr) {
        // Exceptions are optional for UI display; do not crash if they are missing/mislinked.
        // eslint-disable-next-line no-console
        console.error('[purchase-requests/:id] exceptions fetch failed', exErr);
      }

      // Audit logs: avoid .or string parsing issues; merge two queries.
      const auditSelect = 'id, action, user_id, entity, entity_type, entity_id, reason, changes, timestamp';
      const { data: auditForPr, error: auditPrErr } = await supabaseAdmin
        .from('audit_logs')
        .select(auditSelect)
        .eq('entity_id', pr.id)
        .order('timestamp', { ascending: false })
        .limit(200);
      if (auditPrErr) {
        // eslint-disable-next-line no-console
        console.error('[purchase-requests/:id] audit logs (PR) fetch failed', auditPrErr);
      }

      let auditForProject: any[] = [];
      if (project?.id) {
        const { data: auditTmp, error: auditProjectErr } = await supabaseAdmin
          .from('audit_logs')
          .select(auditSelect)
          .eq('entity_id', project.id)
          .eq('entity_type', 'project')
          .order('timestamp', { ascending: false })
          .limit(200);
        if (auditProjectErr) {
          // eslint-disable-next-line no-console
          console.error('[purchase-requests/:id] audit logs (Project) fetch failed', auditProjectErr);
        } else {
          auditForProject = (auditTmp as any[]) ?? [];
        }
      }

      const auditLogs = [...(auditForPr ?? []), ...auditForProject].sort(
        (a, b) => String(b.timestamp).localeCompare(String(a.timestamp)),
      );

      const approvalsWithAudit = await attachLastUpdatedFields('approval', approvals ?? []);

      const approverIds = [...new Set((approvalsWithAudit ?? []).map((a) => a.approver_id as string))];
      const { data: approverProfiles, error: approverErr } = approverIds.length
        ? await supabaseAdmin.from('users').select('id, name, email, role').in('id', approverIds)
        : { data: [], error: null };
      if (approverErr) throw approverErr;

      const approverMap = new Map((approverProfiles ?? []).map((u: any) => [u.id as string, u]));
      const enrichedApprovals = (approvalsWithAudit ?? []).map((a) => ({
        ...a,
        approver: approverMap.get(a.approver_id as string) ?? null,
      }));

      const currentStage =
        enrichedApprovals.find(
          (a) => a.status === 'pending' && (a.role === 'team_lead' || a.role === 'pm'),
        )?.role ?? null;

      const [prAudit] = await attachLastUpdatedFields('purchase_request', [pr]);

      const anchors = pr.project_id ? await loadAnchorsForProjectIds([pr.project_id as string]) : new Map();
      const anchor = pr.project_id ? anchors.get(pr.project_id as string) ?? null : null;
      const poLineSummary = await buildPrPoLineSummary(
        {
          id: pr.id as string,
          description: pr.description as string,
          amount: pr.amount as number,
          item_code: ((pr as { item_code?: string | null }).item_code ?? null) as string | null,
          po_line_id: ((pr as { po_line_id?: string | null }).po_line_id ?? null) as string | null,
          requested_quantity: (pr as { requested_quantity?: number | string | null }).requested_quantity ?? null,
          status: pr.status as string,
        },
        anchor,
      );

      const detailPayload = {
        purchaseRequest: pr
          ? {
              id: pr.id,
              title: pr.description,
              description: pr.description,
              amount: pr.amount,
              status: pr.status,
              createdAt: pr.created_at,
              updatedAt: (pr as { updated_at?: string }).updated_at ?? pr.created_at,
              updatedBy: updater ?? creator,
              last_updated_at: prAudit.last_updated_at,
              last_updated_by: prAudit.last_updated_by,
              documentUrl: pr.document_url,
              itemCode: (pr as { item_code?: string | null }).item_code ?? null,
              duplicateCount: Number((pr as { duplicate_count?: number | null }).duplicate_count ?? 1),
              poLineSummary,
              currentStage,
              createdBy: creator,
            }
          : null,
        project: projectPayload,
        purchaseOrder: poPayload,
        approvals: enrichedApprovals,
        exceptions: exceptions ?? [],
        auditLogs,
      };

      res.json(stripPrDetailFinancials(req, detailPayload as Record<string, unknown>));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[purchase-requests/:id] Failed to fetch', err);
      next(err);
    }
  },
);

