import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { z } from 'zod';
import { adminOverridePurchaseRequest, decideApproval } from './engine';
import { supabaseAdmin } from '../../config/supabase';
import { enrichPurchaseRequestsWithPoLine } from '../purchaseRequests/poLineContext';
import { attachLastUpdatedFields } from '../auditLogs/lastUpdated';
import { bypassesDepartmentScope } from '../auth/types';
import { requirePermission } from '../../middleware/permissions';
import { companyScopeForRequest } from '../../tenant/requestCompanyId';

export const approvalsRouter = Router();

approvalsRouter.use(requireAuth);

const DecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  comments: z.string().min(1).max(2000).optional(),
});
const OverrideSchema = z.object({
  requestId: z.string().uuid(),
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().min(1).max(2000),
});

approvalsRouter.get('/', requirePermission('view_approvals'), requireRole('admin', 'platform_admin', 'pm', 'dept_head', 'employee'), async (req, res, next) => {
  try {
    const userId = req.auth!.userId;
    const role = req.auth!.role;
    const cid = companyScopeForRequest(req);
    let q = supabaseAdmin
      .from('approvals')
      .select('id, request_id, approver_id, role, status, comments, created_at, updated_at, updated_by, is_admin_override')
      .eq('company_id', cid)
      .order('created_at', { ascending: false })
      .limit(200);
    if (!bypassesDepartmentScope(role)) q = q.eq('approver_id', userId);
    const { data, error } = await q;
    if (error) throw error;
    const rows = data ?? [];
    const requestIds = [...new Set(rows.map((a) => a.request_id as string))];
    const prMap = new Map<
      string,
      {
        id: string;
        status: string;
        item_code: string | null;
        duplicate_count: number;
        po_line_summary: unknown | null;
      }
    >();
    if (requestIds.length > 0) {
      const { data: prs, error: prErr } = await supabaseAdmin
        .from('purchase_requests')
        .select(
          'id, company_id, project_id, description, amount, item_code, duplicate_count, po_line_id, requested_quantity, status',
        )
        .eq('company_id', cid)
        .in('id', requestIds);
      if (prErr) throw prErr;
      const summaries = await enrichPurchaseRequestsWithPoLine(
        (prs ?? []).map((p) => ({
          id: p.id as string,
          company_id: p.company_id as string,
          project_id: p.project_id as string,
          description: p.description as string,
          amount: p.amount as number | string,
          item_code: (p.item_code as string | null) ?? null,
          po_line_id: (p.po_line_id as string | null) ?? null,
          requested_quantity: (p.requested_quantity as number | string | null) ?? null,
          status: p.status as string,
        })),
        cid,
      );
      for (const p of prs ?? []) {
        const id = p.id as string;
        prMap.set(id, {
          id,
          status: (p.status as string) ?? 'pending',
          item_code: (p.item_code as string | null) ?? null,
          duplicate_count: Number(p.duplicate_count ?? 1),
          po_line_summary: summaries.get(id) ?? null,
        });
      }
    }
    const withAudit = await attachLastUpdatedFields('approval', rows, cid);
    const enriched = withAudit.map((a) => ({
      ...a,
      purchase_request: prMap.get(a.request_id as string) ?? null,
    }));
    res.json({ approvals: enriched });
  } catch (err) {
    next(err);
  }
});

approvalsRouter.get('/by-requests', requirePermission('view_approvals'), requireRole('admin', 'platform_admin', 'pm', 'dept_head', 'employee'), async (req, res, next) => {
  try {
    const idsRaw = req.query.ids as string;
    if (!idsRaw) return res.json({ approvals: [] });
    
    const ids = idsRaw.split(',').filter(id => z.string().uuid().safeParse(id).success);
    if (ids.length === 0) return res.json({ approvals: [] });
    
    const cid = companyScopeForRequest(req);
    
    const { data: rows, error } = await supabaseAdmin
      .from('approvals')
      .select('id, request_id, approver_id, role, status, comments, created_at, is_admin_override')
      .eq('company_id', cid)
      .in('request_id', ids);
      
    if (error) throw error;
    res.json({ approvals: rows ?? [] });
  } catch (err) {
    next(err);
  }
});

approvalsRouter.post(
  '/override',
  requireRole('admin', 'platform_admin'),
  async (req, res, next) => {
    try {
      const parsed = OverrideSchema.parse(req.body);
      const result = await adminOverridePurchaseRequest({
        requestId: parsed.requestId,
        decision: parsed.decision,
        reason: parsed.reason,
        actorUserId: req.auth!.userId,
        companyId: companyScopeForRequest(req),
      });
      res.json({ ok: true, result });
    } catch (err) {
      next(err);
    }
  },
);

approvalsRouter.post(
  '/:id/decision',
  requirePermission('approve_requests'),
  requireRole('admin', 'platform_admin', 'pm', 'dept_head', 'employee'),
  async (req, res, next) => {
    try {
      const approvalId = req.params.id as string;
      const parsed = DecisionSchema.parse(req.body);

      const result = await decideApproval({
        approvalId,
        decision: parsed.decision,
        comments: parsed.comments ?? null,
        actorUserId: req.auth!.userId,
        actorRole: req.auth!.role,
        companyId: companyScopeForRequest(req),
      });

      res.json({ ok: true, result });
    } catch (err) {
      next(err);
    }
  },
);

