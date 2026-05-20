import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { supabaseAdmin } from '../../config/supabase';
import { companyScopeForRequest } from '../../tenant/requestCompanyId';
import { assertActorCanViewEntityAudit, normalizeAuditEntityTypeParam } from './access';

export const auditLogsRouter = Router();

auditLogsRouter.use(requireAuth);

/**
 * Full audit timeline for one entity (RBAC: admin, or stakeholder for that record).
 * entityType: purchase_request | project | purchase_order | approval (kebab-case allowed)
 */
auditLogsRouter.get('/:entityType/:entityId', async (req, res, next) => {
  try {
    const entityType = normalizeAuditEntityTypeParam(req.params.entityType ?? '');
    const entityId = z.string().uuid().parse(req.params.entityId);

    const cid = companyScopeForRequest(req);
    await assertActorCanViewEntityAudit({
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      actorDepartment: req.auth!.department ?? null,
      companyId: cid,
      entityType,
      entityId,
    });

    const { data: rows, error } = await supabaseAdmin
      .from('audit_logs')
      .select('id, action, user_id, entity, entity_type, entity_id, reason, changes, timestamp')
      .eq('entity_id', entityId)
      .eq('entity_type', entityType)
      .eq('company_id', cid)
      .order('timestamp', { ascending: false })
      .limit(300);
    if (error) throw error;

    const list = rows ?? [];
    const userIds = [...new Set(list.map((r) => r.user_id as string | null).filter(Boolean))] as string[];
    let userMap = new Map<string, { id: string; name: string; email: string; role: string }>();
    if (userIds.length > 0) {
      const { data: users, error: uErr } = await supabaseAdmin
        .from('users')
        .select('id, name, email, role')
        .eq('company_id', cid)
        .in('id', userIds);
      if (uErr) throw uErr;
      userMap = new Map((users ?? []).map((u) => [u.id as string, u as { id: string; name: string; email: string; role: string }]));
    }

    const auditLogs = list.map((r) => {
      const u = r.user_id ? userMap.get(r.user_id as string) : undefined;
      return {
        id: r.id,
        action: r.action,
        entityType: r.entity_type ?? r.entity,
        entityId: r.entity_id,
        performedBy: u
          ? { id: u.id, name: u.name, email: u.email, role: u.role }
          : r.user_id
            ? { id: r.user_id as string, name: null, email: null, role: null }
            : null,
        reason: r.reason,
        changes: r.changes,
        timestamp: r.timestamp,
      };
    });

    res.json({ auditLogs });
  } catch (err) {
    next(err);
  }
});

auditLogsRouter.get('/', requireRole('admin', 'platform_admin'), async (req, res, next) => {
  try {
    const cid = companyScopeForRequest(req);
    const { action, entity } = req.query;
    let q = supabaseAdmin
      .from('audit_logs')
      .select('id, action, user_id, entity, entity_type, entity_id, reason, changes, timestamp')
      .eq('company_id', cid)
      .order('timestamp', { ascending: false });
    if (typeof action === 'string') q = q.eq('action', action);
    if (typeof entity === 'string') q = q.eq('entity', entity);

    const { data, error } = await q;
    if (error) throw error;
    res.json({ auditLogs: data ?? [] });
  } catch (err) {
    next(err);
  }
});
