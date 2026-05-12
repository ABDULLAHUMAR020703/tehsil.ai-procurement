import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';
import type { TenantAuth } from '../../tenant/tenantScope';
import { bypassesDepartmentScope, type UserRole } from '../auth/types';
import { assertActorMayViewProject, fetchProjectForAccess } from '../projects/projectAccess';

/** Normalize URL segment to stored audit / entity_type values. */
export function normalizeAuditEntityTypeParam(raw: string): string {
  const k = raw.trim().toLowerCase().replace(/-/g, '_');
  const allowed = new Set(['purchase_request', 'project', 'purchase_order', 'approval']);
  if (allowed.has(k)) return k;
  throw new AppError(`Unknown entity type: ${raw}`, 400);
}

function tenantAuthForAudit(params: {
  actorUserId: string;
  actorRole: UserRole;
  companyId: string;
}): TenantAuth {
  const { actorUserId, actorRole, companyId } = params;
  return { userId: actorUserId, role: actorRole, companyId, scopedCompanyId: companyId };
}

export async function assertActorCanViewEntityAudit(params: {
  actorUserId: string;
  actorRole: string;
  actorDepartment: string | null;
  companyId: string;
  entityType: string;
  entityId: string;
}): Promise<void> {
  const { actorUserId, actorRole, actorDepartment, companyId, entityType, entityId } = params;
  const role = actorRole as UserRole;
  const tenantAuth = tenantAuthForAudit({ actorUserId, actorRole: role, companyId });

  if (entityType === 'purchase_request') {
    const { data: pr, error: prErr } = await supabaseAdmin
      .from('purchase_requests')
      .select('id, created_by, project_id')
      .eq('id', entityId)
      .eq('company_id', companyId)
      .maybeSingle();
    if (prErr) throw prErr;
    if (!pr) throw new AppError('Not found', 404);
    if (bypassesDepartmentScope(role)) return;

    if (pr.created_by === actorUserId) return;
    const { data: appr, error: apErr } = await supabaseAdmin
      .from('approvals')
      .select('id')
      .eq('request_id', entityId)
      .eq('company_id', companyId)
      .eq('approver_id', actorUserId)
      .limit(1);
    if (apErr) throw apErr;
    if (appr && appr.length > 0) return;

    const project = await fetchProjectForAccess(pr.project_id as string, tenantAuth);
    await assertActorMayViewProject({
      project,
      actorUserId,
      actorRole: role,
      actorDepartment,
    });
    return;
  }

  if (entityType === 'project') {
    const project = await fetchProjectForAccess(entityId, tenantAuth);
    if (bypassesDepartmentScope(role)) return;
    await assertActorMayViewProject({
      project,
      actorUserId,
      actorRole: role,
      actorDepartment,
    });
    return;
  }

  if (entityType === 'purchase_order') {
    const { data: po, error } = await supabaseAdmin
      .from('purchase_orders')
      .select('id, department, uploaded_by, po')
      .eq('id', entityId)
      .eq('company_id', companyId)
      .maybeSingle();
    if (error) throw error;
    if (!po) throw new AppError('Not found', 404);
    if (bypassesDepartmentScope(role)) return;

    if (po.uploaded_by === actorUserId) return;
    const dept = po.department as string | null;
    if (actorDepartment && dept && dept === actorDepartment) return;

    const { data: byPoId, error: pErr } = await supabaseAdmin
      .from('projects')
      .select('id, department_id')
      .eq('po_id', entityId)
      .eq('company_id', companyId)
      .limit(25);
    if (pErr) throw pErr;
    if (byPoId?.some((p) => actorDepartment && p.department_id === actorDepartment)) return;

    const poText = String((po as { po?: string | null }).po ?? '').trim();
    if (poText && actorDepartment) {
      const { data: lines, error: lErr } = await supabaseAdmin
        .from('purchase_orders')
        .select('department')
        .eq('po', poText)
        .eq('company_id', companyId);
      if (lErr) throw lErr;
      if (lines?.some((row) => row.department === actorDepartment)) return;
    }

    throw new AppError('Forbidden', 403);
  }

  if (entityType === 'approval') {
    const { data: row, error } = await supabaseAdmin
      .from('approvals')
      .select('request_id, approver_id')
      .eq('id', entityId)
      .eq('company_id', companyId)
      .maybeSingle();
    if (error) throw error;
    if (!row) throw new AppError('Not found', 404);
    if (bypassesDepartmentScope(role)) return;
    if (row.approver_id === actorUserId) return;
    await assertActorCanViewEntityAudit({
      actorUserId,
      actorRole,
      actorDepartment,
      companyId,
      entityType: 'purchase_request',
      entityId: row.request_id as string,
    });
    return;
  }

  throw new AppError('Unsupported entity type', 400);
}
