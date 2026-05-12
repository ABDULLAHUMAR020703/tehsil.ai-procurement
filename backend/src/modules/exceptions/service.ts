import { appEmailSubject } from '../../config/appMeta';
import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';
import { recordTrackedAction } from '../auditLogs/trackedAction';
import { startApprovalsForPurchaseRequest } from '../approvals/engine';
import { bypassesDepartmentScope, isDeptManagerRole, type UserRole } from '../auth/types';

/** no_po reference_id is project id */
async function assertPmMayDecideNoPo(params: { projectId: string; actorDepartment: string; companyId: string }) {
  const { data: project, error } = await supabaseAdmin
    .from('projects')
    .select('id, department_id')
    .eq('id', params.projectId)
    .eq('company_id', params.companyId)
    .single();
  if (error || !project) throw error ?? new AppError('Referenced project not found', 404);
  if (project.department_id !== params.actorDepartment) {
    throw new AppError('PM can only decide no-PO exceptions for projects in their department', 403);
  }
}

export async function listPendingExceptionsForActor(params: {
  actorRole: UserRole;
  actorDepartment: string | null;
  companyId?: string;
}) {
  const { actorRole, actorDepartment, companyId } = params;
  let q = supabaseAdmin
    .from('exceptions')
    .select('id, type, reference_id, status, approved_by, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(200);
  if (companyId) q = q.eq('company_id', companyId);
  const { data, error } = await q;
  if (error) throw error;
  const rows = data ?? [];

  if (bypassesDepartmentScope(actorRole)) return rows;

  if (!isDeptManagerRole(actorRole) || !actorDepartment) return [];

  const out: typeof rows = [];
  for (const ex of rows) {
    if (ex.type === 'over_budget') {
      if (actorDepartment === 'finance') out.push(ex);
      continue;
    }
    if (ex.type === 'no_po') {
      let pq = supabaseAdmin
        .from('projects')
        .select('department_id')
        .eq('id', ex.reference_id);
      if (companyId) pq = pq.eq('company_id', companyId);
      const { data: project } = await pq.maybeSingle();
      if (project && project.department_id === actorDepartment) out.push(ex);
    }
  }
  return out;
}

export async function decideException(params: {
  exceptionId: string;
  decision: 'approved' | 'rejected';
  actorUserId: string;
  actorRole: UserRole;
  actorDepartment: string | null;
  companyId?: string;
}) {
  const { exceptionId, decision, actorUserId, actorRole, actorDepartment, companyId } = params;

  let exq = supabaseAdmin
    .from('exceptions')
    .select('id, type, reference_id, status, company_id')
    .eq('id', exceptionId);
  if (companyId) exq = exq.eq('company_id', companyId);
  const { data: exception, error: exErr } = await exq.single();
  if (exErr || !exception) throw exErr ?? new AppError('Exception not found', 404);
  if (exception.status !== 'pending') throw new AppError('Exception already decided', 409);

  const tenantCompanyId = exception.company_id as string;

  if (bypassesDepartmentScope(actorRole)) {
    // allowed
  } else if (isDeptManagerRole(actorRole) && actorDepartment) {
    if (exception.type === 'over_budget') {
      if (actorDepartment !== 'finance') {
        throw new AppError('Only finance department managers (or admin) may decide over-budget exceptions', 403);
      }
    } else if (exception.type === 'no_po') {
      await assertPmMayDecideNoPo({
        projectId: exception.reference_id,
        actorDepartment,
        companyId: tenantCompanyId,
      });
    } else {
      throw new AppError('Unknown exception type', 400);
    }
  } else {
    throw new AppError('Not authorized to decide this exception', 403);
  }

  let upd = supabaseAdmin
    .from('exceptions')
    .update({
      status: decision,
      approved_by: actorUserId,
    })
    .eq('id', exceptionId)
    .eq('company_id', tenantCompanyId);
  const { error: updErr } = await upd;
  if (updErr) throw updErr;

  if (exception.type === 'no_po') {
    const { data: project, error: prjErr } = await supabaseAdmin
      .from('projects')
      .select('id, created_by, status, is_exception, department_id')
      .eq('id', exception.reference_id)
      .eq('company_id', tenantCompanyId)
      .single();
    if (prjErr || !project) throw prjErr ?? new AppError('Referenced project not found', 404);

    if (decision === 'approved') {
      const { error: prjUpErr } = await supabaseAdmin
        .from('projects')
        .update({
          status: 'active',
          updated_by: actorUserId,
        })
        .eq('id', project.id)
        .eq('company_id', tenantCompanyId);
      if (prjUpErr) throw prjUpErr;

      await recordTrackedAction({
        audit: {
          action: 'exception_no_po_approved',
          userId: actorUserId,
          entity: 'exception',
          entityType: 'exception',
          entityId: exception.id as string,
          departmentScope: project.department_id as string,
        },
        touch: { table: 'projects', id: project.id as string, companyId: tenantCompanyId },
        notify: [
          {
            userId: project.created_by as string,
            type: 'exception_no_po_approved',
            message: `No-PO exception approved for project ${project.id}. You can now submit purchase requests.`,
            emailSubject: appEmailSubject('No-PO Exception Approved'),
          },
        ],
      });
    } else {
      await supabaseAdmin
        .from('projects')
        .update({ status: 'rejected', updated_by: actorUserId })
        .eq('id', project.id)
        .eq('company_id', tenantCompanyId);
      await recordTrackedAction({
        audit: {
          action: 'exception_no_po_rejected',
          userId: actorUserId,
          entity: 'exception',
          entityType: 'exception',
          entityId: exception.id as string,
          departmentScope: project.department_id as string,
        },
        touch: { table: 'projects', id: project.id as string, companyId: tenantCompanyId },
        notify: [
          {
            userId: project.created_by as string,
            type: 'exception_no_po_rejected',
            message: `No-PO exception rejected for project ${project.id}.`,
            emailSubject: appEmailSubject('No-PO Exception Rejected'),
          },
        ],
      });
    }

    return { ok: true, exceptionId: exception.id };
  }

  if (exception.type === 'over_budget') {
    const { data: pr, error: prErr } = await supabaseAdmin
      .from('purchase_requests')
      .select('id, amount, project_id, created_by, status')
      .eq('id', exception.reference_id)
      .eq('company_id', tenantCompanyId)
      .single();
    if (prErr || !pr) throw prErr ?? new AppError('Referenced purchase request not found', 404);

    const { data: prScopeRow } = await supabaseAdmin
      .from('projects')
      .select('department_id')
      .eq('id', pr.project_id as string)
      .eq('company_id', tenantCompanyId)
      .maybeSingle();
    const prDeptScope = (prScopeRow?.department_id as string | null) ?? null;

    if (decision === 'approved') {
      const { error: prUpErr } = await supabaseAdmin
        .from('purchase_requests')
        .update({ status: 'pending', updated_by: actorUserId })
        .eq('id', pr.id)
        .eq('company_id', tenantCompanyId);
      if (prUpErr) throw prUpErr;

      await recordTrackedAction({
        audit: {
          action: 'exception_over_budget_approved',
          userId: actorUserId,
          entity: 'exception',
          entityType: 'exception',
          entityId: exception.id as string,
          departmentScope: prDeptScope,
        },
        touch: { table: 'purchase_requests', id: pr.id as string, companyId: tenantCompanyId },
        notify: [
          {
            userId: pr.created_by as string,
            type: 'exception_over_budget_approved',
            message: `Over-budget exception approved for PR ${pr.id}.`,
            emailSubject: appEmailSubject('Over-Budget Exception Approved'),
          },
        ],
      });

      await startApprovalsForPurchaseRequest(pr.id, actorUserId);
    } else {
      await supabaseAdmin
        .from('purchase_requests')
        .update({ status: 'rejected', updated_by: actorUserId })
        .eq('id', pr.id)
        .eq('company_id', tenantCompanyId);
      await supabaseAdmin
        .from('approvals')
        .update({
          status: 'rejected',
          comments: 'Auto-rejected due to over-budget exception rejection',
          updated_by: actorUserId,
        })
        .eq('request_id', pr.id)
        .eq('company_id', tenantCompanyId);
      await recordTrackedAction({
        audit: {
          action: 'exception_over_budget_rejected',
          userId: actorUserId,
          entity: 'exception',
          entityType: 'exception',
          entityId: exception.id as string,
          departmentScope: prDeptScope,
        },
        touch: { table: 'purchase_requests', id: pr.id as string, companyId: tenantCompanyId },
        notify: [
          {
            userId: pr.created_by as string,
            type: 'exception_over_budget_rejected',
            message: `Over-budget exception rejected for PR ${pr.id}.`,
            emailSubject: appEmailSubject('Over-Budget Exception Rejected'),
          },
        ],
      });
    }

    return { ok: true, exceptionId: exception.id };
  }

  throw new AppError('Unknown exception type', 400);
}
