import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';

export type AuditLogInsert = {
  action: string;
  userId: string;
  entity: string;
  entityId: string;
  /** Defaults to `entity` when omitted (normalized type key, e.g. purchase_request). */
  entityType?: string;
  reason?: string;
  /** Optional before/after or field-level JSON. */
  changes?: Record<string, unknown> | null;
  /** Denormalized for department-scoped activity feeds (dashboard). */
  departmentScope?: string | null;
  /** Tenant scope; resolved from user profile when omitted. */
  companyId?: string | null;
};

export async function writeAuditLog(params: AuditLogInsert) {
  const entityType = params.entityType ?? params.entity;
  let companyId = params.companyId ?? null;
  if (!companyId) {
    const { data: u, error: uErr } = await supabaseAdmin
      .from('users')
      .select('company_id')
      .eq('id', params.userId)
      .maybeSingle();
    if (uErr) throw uErr;
    companyId = (u?.company_id as string | undefined) ?? null;
  }
  if (!companyId) {
    throw new AppError('Audit log missing company_id', 500, { userId: params.userId, entityId: params.entityId });
  }
  const { error } = await supabaseAdmin.from('audit_logs').insert({
    action: params.action,
    user_id: params.userId,
    entity: params.entity,
    entity_type: entityType,
    entity_id: params.entityId,
    reason: params.reason ?? null,
    changes: params.changes ?? null,
    department_scope: params.departmentScope ?? null,
    company_id: companyId,
    timestamp: new Date().toISOString(),
  });
  if (error) throw error;
}

/** One audit row per approval id (e.g. after bulk approve/reject). */
export async function writeApprovalAuditLogs(params: {
  approvalIds: string[];
  action: 'approved' | 'rejected' | 'updated';
  userId: string;
  reason?: string | null;
  departmentScope?: string | null;
}) {
  const ids = [...new Set(params.approvalIds.filter(Boolean))];
  if (ids.length === 0) return;
  await Promise.all(
    ids.map((entityId) =>
      writeAuditLog({
        action: params.action,
        userId: params.userId,
        entity: 'approval',
        entityType: 'approval',
        entityId,
        reason: params.reason ?? undefined,
        departmentScope: params.departmentScope ?? null,
      }),
    ),
  );
}
