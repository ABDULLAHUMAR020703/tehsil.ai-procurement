import { appEmailSubject } from '../../config/appMeta';
import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';
import { writeApprovalAuditLogs, writeAuditLog } from '../auditLogs/service';
import { deliverTrackedNotifications, recordTrackedAction, touchEntityRow } from '../auditLogs/trackedAction';
import type { ApprovalStageRole, RequiredApprovalStageRole, UserRole } from '../auth/types';
import { bypassesDepartmentScope, REQUIRED_APPROVAL_STAGE_ORDER } from '../auth/types';
import { buildApprovalStagesForProject } from '../org/approvers';
import { fetchProjectOrThrow } from '../org/projectGuards';
import type { TenantAuth } from '../../tenant/tenantScope';

type ApprovalDecision = 'approved' | 'rejected';

export function getApprovalStageOrder(): readonly RequiredApprovalStageRole[] {
  return REQUIRED_APPROVAL_STAGE_ORDER;
}

async function departmentScopeForProjectId(projectId: string, companyId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('projects')
    .select('department_id')
    .eq('id', projectId)
    .eq('company_id', companyId)
    .maybeSingle();
  return (data?.department_id as string | null) ?? null;
}

export async function startApprovalsForPurchaseRequest(prId: string, triggeredBy: string) {
  const { data: pr, error: prErr } = await supabaseAdmin
    .from('purchase_requests')
    .select('id, company_id, amount, project_id, created_by, status, duplicate_count')
    .eq('id', prId)
    .single();
  if (prErr || !pr) throw prErr ?? new AppError('Purchase request not found', 404);

  const companyId = pr.company_id as string;
  const tenantForProject: TenantAuth = { userId: triggeredBy, role: 'admin', companyId };

  if (pr.status !== 'pending' && pr.status !== 'pending_exception') {
    throw new AppError(`PR cannot start approval workflow from status=${pr.status}`, 409);
  }

  const project = await fetchProjectOrThrow(pr.project_id as string, tenantForProject);
  const stageList = await buildApprovalStagesForProject(project);

  const dupCount = Number(pr.duplicate_count ?? 1);
  const duplicateNote =
    dupCount > 1 ? `This item has been requested ${dupCount} times by the same user.` : null;

  const approvalsToInsert = stageList.map((s) => ({
    request_id: pr.id,
    approver_id: s.approver_id,
    role: s.role,
    status: 'pending',
    comments: duplicateNote,
    company_id: companyId,
  }));

  const { error: insErr } = await supabaseAdmin.from('approvals').upsert(approvalsToInsert, {
    onConflict: 'request_id,role',
  });
  if (insErr) throw insErr;

  const firstRole = stageList[0].role;
  const { data: firstApproval, error: firstErr } = await supabaseAdmin
    .from('approvals')
    .select('id, approver_id, role')
    .eq('request_id', pr.id)
    .eq('company_id', companyId)
    .eq('role', firstRole)
    .single();
  if (firstErr || !firstApproval) throw firstErr ?? new AppError('First approval stage missing', 500);

  const label = humanizeStageLabel(firstRole);
  const message = `Purchase Request ${pr.id} is ready for your ${label}.`;
  await recordTrackedAction({
    audit: {
      action: 'approvals_started',
      userId: triggeredBy,
      entity: 'purchase_request',
      entityType: 'purchase_request',
      entityId: pr.id as string,
      departmentScope: project.department_id,
    },
    touch: { table: 'purchase_requests', id: pr.id as string, companyId },
    notify: [
      {
        userId: firstApproval.approver_id as string,
        type: 'pr_approval_pending',
        message,
        emailSubject: appEmailSubject('PR Approval Pending'),
      },
    ],
  });
}

function humanizeStageLabel(role: ApprovalStageRole): string {
  if (role === 'team_lead') return 'team lead approval';
  if (role === 'pm') return 'PM approval';
  return 'admin action';
}

/** Required TL/PM rows that exist for this PR, in workflow order (skips missing TL when not created). */
async function fetchRequiredRolesForRequest(requestId: string, companyId: string): Promise<RequiredApprovalStageRole[]> {
  const { data, error } = await supabaseAdmin
    .from('approvals')
    .select('role')
    .eq('request_id', requestId)
    .eq('company_id', companyId);
  if (error) throw error;
  const present = new Set((data ?? []).map((r) => r.role as string));
  const out: RequiredApprovalStageRole[] = [];
  for (const role of REQUIRED_APPROVAL_STAGE_ORDER) {
    if (present.has(role)) out.push(role);
  }
  return out;
}

function rolesRequiredAreFullyApproved(params: {
  requestId: string;
  roles: readonly RequiredApprovalStageRole[];
  companyId: string;
}) {
  return supabaseAdmin
    .from('approvals')
    .select('role, status')
    .eq('request_id', params.requestId)
    .eq('company_id', params.companyId)
    .in('role', [...params.roles])
    .then(({ data, error }) => {
      if (error) throw error;
      const byRole = new Map((data ?? []).map((r) => [r.role as RequiredApprovalStageRole, r.status]));
      return params.roles.every((r) => byRole.get(r) === 'approved');
    });
}

function mapFinalizePrRpcError(err: unknown): AppError {
  const raw = err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : String(err);
  const msg = raw.toLowerCase();
  if (msg.includes('insufficient_po_line_balance')) {
    return new AppError('Insufficient remaining balance on PO line for approval', 409);
  }
  if (msg.includes('insufficient_po_remaining_value') || msg.includes('insufficient_po_remaining_amount')) {
    return new AppError('Insufficient PO remaining balance for approval', 409);
  }
  if (msg.includes('insufficient_project_budget')) {
    return new AppError('Insufficient project budget for approval', 409);
  }
  if (msg.includes('pr_approvals_still_pending')) {
    return new AppError('Cannot apply budget while Team Lead or PM approvals are still pending', 409);
  }
  if (msg.includes('pr_not_pending')) {
    return new AppError('Purchase request is not in a state that allows budget finalization', 409);
  }
  if (msg.includes('pr_budget_already_deducted')) {
    return new AppError('Budget was already applied for this purchase request', 409);
  }
  return new AppError(raw || 'Failed to finalize purchase request and deduct budget', 500);
}

/**
 * Atomically (single DB transaction): validate all stages approved, deduct PO line / PO / project budget,
 * set PR to approved and budget_deducted. Idempotent if already approved with budget_deducted.
 */
async function finalizePrBudgetAfterApprovalRpc(prId: string, actorUserId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseAdmin.rpc('finalize_pr_budget_after_approval', {
    p_pr_id: prId,
    p_updated_by: actorUserId,
  });
  if (error) throw mapFinalizePrRpcError(error);
  return (data as Record<string, unknown>) ?? {};
}

function auditPayloadPreview(payload: Record<string, unknown>, maxLen = 2000): string {
  try {
    const s = JSON.stringify(payload);
    return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
  } catch {
    return '';
  }
}

async function performAdminForceApprove(params: {
  pr: { id: string; created_by: string; duplicate_count: number | null; status: string; company_id: string };
  actorUserId: string;
  comments: string | null;
  touchedApprovalId: string;
  departmentScope: string | null;
}): Promise<{ prId: string; status: 'approved'; approval: Record<string, unknown> }> {
  const { pr, actorUserId, comments, touchedApprovalId, departmentScope } = params;
  const companyId = pr.company_id;
  if (pr.status !== 'pending' && pr.status !== 'pending_exception') {
    throw new AppError(`PR is not in a state that allows force approval (status=${pr.status})`, 409);
  }

  const { data: pendingRows, error: pendErr } = await supabaseAdmin
    .from('approvals')
    .select('id')
    .eq('request_id', pr.id)
    .eq('company_id', companyId)
    .eq('status', 'pending');
  if (pendErr) throw pendErr;
  const pendingIds = (pendingRows ?? []).map((r) => r.id as string);

  const dupCount = Number(pr.duplicate_count ?? 1);
  const duplicatePrefix =
    dupCount > 1 ? `This item has been requested ${dupCount} times by the same user.` : null;
  const userPart = comments?.trim() ?? '';
  const mergedComments =
    [duplicatePrefix, userPart, 'Administrator force-approved pending stages.'].filter(Boolean).join('\n\n') || null;

  if (pendingIds.length > 0) {
    const { error: upErr } = await supabaseAdmin
      .from('approvals')
      .update({
        status: 'approved',
        comments: mergedComments,
        updated_by: actorUserId,
        is_admin_override: true,
      })
      .eq('company_id', companyId)
      .in('id', pendingIds);
    if (upErr) throw upErr;
    await writeApprovalAuditLogs({
      approvalIds: pendingIds,
      action: 'approved',
      userId: actorUserId,
      reason: 'admin_force_approve',
      departmentScope,
    });
  }

  let rpcResult: Record<string, unknown> = {};
  try {
    rpcResult = await finalizePrBudgetAfterApprovalRpc(pr.id, actorUserId);
  } catch (e) {
    if (pendingIds.length > 0) {
      await supabaseAdmin
        .from('approvals')
        .update({ status: 'pending', is_admin_override: false, updated_by: actorUserId })
        .eq('company_id', companyId)
        .in('id', pendingIds);
    }
    throw e;
  }

  const { data: updatedApproval, error: selErr } = await supabaseAdmin
    .from('approvals')
    .select('id, request_id, approver_id, role, status, comments, created_at, is_admin_override')
    .eq('id', touchedApprovalId)
    .eq('company_id', companyId)
    .single();
  if (selErr || !updatedApproval) throw selErr ?? new AppError('Approval row not found after force approve', 500);

  await writeAuditLog({
    action: 'admin_force_approve',
    userId: actorUserId,
    entity: 'purchase_request',
    entityType: 'purchase_request',
    entityId: pr.id,
    reason: auditPayloadPreview({ finalize: rpcResult }),
    changes: { via: 'admin_force_approve', finalize: rpcResult },
    departmentScope,
  });

  await writeAuditLog({
    action: 'budget_deducted_after_pr_approval',
    userId: actorUserId,
    entity: 'purchase_request',
    entityType: 'purchase_request',
    entityId: pr.id,
    reason: auditPayloadPreview({ ...rpcResult, via: 'admin_force_approve' }),
    changes: { finalize: rpcResult },
    departmentScope,
  });

  await writeAuditLog({
    action: 'pr_approved',
    userId: actorUserId,
    entity: 'purchase_request',
    entityType: 'purchase_request',
    entityId: pr.id,
    changes: { status: { after: 'approved' }, via: 'admin_force_approve' },
    departmentScope,
  });

  await touchEntityRow('purchase_requests', pr.id, actorUserId, companyId);
  await deliverTrackedNotifications([
    {
      userId: pr.created_by,
      type: 'pr_approved',
      message: `Purchase Request ${pr.id} was fully approved (administrator force approve).`,
      emailSubject: appEmailSubject('PR Approved'),
    },
  ]);

  return { prId: pr.id, status: 'approved', approval: updatedApproval as Record<string, unknown> };
}

async function performAdminRejectEntirePr(params: {
  pr: { id: string; created_by: string; status: string; company_id: string };
  actorUserId: string;
  reason: string;
  departmentScope: string | null;
}): Promise<{ prId: string; status: 'rejected'; approval: null }> {
  const { pr, actorUserId, reason, departmentScope } = params;
  const companyId = pr.company_id;
  if (pr.status !== 'pending' && pr.status !== 'pending_exception') {
    throw new AppError(`PR is not rejectable (status=${pr.status})`, 409);
  }

  const { data: pendingRows, error } = await supabaseAdmin
    .from('approvals')
    .select('id')
    .eq('request_id', pr.id)
    .eq('company_id', companyId)
    .eq('status', 'pending');
  if (error) throw error;
  const pendingIds = (pendingRows ?? []).map((r) => r.id as string);
  const comment = `Administrator rejected entire request. ${reason}`.trim();

  const { error: prRej } = await supabaseAdmin
    .from('purchase_requests')
    .update({ status: 'rejected', updated_by: actorUserId })
    .eq('id', pr.id)
    .eq('company_id', companyId);
  if (prRej) throw prRej;

  if (pendingIds.length > 0) {
    const { error: apRej } = await supabaseAdmin
      .from('approvals')
      .update({
        status: 'rejected',
        comments: comment,
        updated_by: actorUserId,
        is_admin_override: true,
      })
      .eq('company_id', companyId)
      .in('id', pendingIds);
    if (apRej) throw apRej;
    await writeApprovalAuditLogs({
      approvalIds: pendingIds,
      action: 'rejected',
      userId: actorUserId,
      reason: 'admin_reject_entire_pr',
      departmentScope,
    });
  }

  await recordTrackedAction({
    audit: {
      action: 'pr_rejected',
      userId: actorUserId,
      entity: 'purchase_request',
      entityType: 'purchase_request',
      entityId: pr.id,
      changes: { status: { after: 'rejected' }, via: 'admin_reject_entire_pr' },
      departmentScope,
    },
    notify: [
      {
        userId: pr.created_by,
        type: 'pr_rejected',
        message: `Purchase Request ${pr.id} was rejected by an administrator.`,
        emailSubject: appEmailSubject('PR Rejected'),
      },
    ],
  });

  return { prId: pr.id, status: 'rejected', approval: null };
}

export async function decideApproval(params: {
  approvalId: string;
  decision: ApprovalDecision;
  comments?: string | null;
  actorUserId: string;
  actorRole: UserRole;
  companyId: string;
}) {
  const { approvalId, decision, comments, actorUserId, actorRole, companyId } = params;
  const decisionNormalized = decision === 'approved' ? 'approved' : 'rejected';

  const { data: approval, error: apprErr } = await supabaseAdmin
    .from('approvals')
    .select('id, request_id, approver_id, role, status')
    .eq('id', approvalId)
    .eq('company_id', companyId)
    .single();
  if (apprErr || !approval) throw apprErr ?? new AppError('Approval not found', 404);

  if (approval.status !== 'pending') throw new AppError(`Approval already decided (status=${approval.status})`, 409);

  const { data: pr, error: prErr } = await supabaseAdmin
    .from('purchase_requests')
    .select(
      'id, company_id, amount, project_id, created_by, status, duplicate_count, po_line_id, budget_deducted',
    )
    .eq('id', approval.request_id)
    .eq('company_id', companyId)
    .single();
  if (prErr || !pr) throw prErr ?? new AppError('Purchase request not found', 404);

  if (pr.status !== 'pending' && pr.status !== 'pending_exception') {
    throw new AppError(`PR is not in a deciable state (status=${pr.status})`, 409);
  }

  const departmentScope = await departmentScopeForProjectId(pr.project_id as string, companyId);

  if (bypassesDepartmentScope(actorRole) && decisionNormalized === 'rejected') {
    return performAdminRejectEntirePr({
      pr: {
        id: pr.id as string,
        created_by: pr.created_by as string,
        status: pr.status as string,
        company_id: companyId,
      },
      actorUserId,
      reason: comments?.trim() || 'No reason provided.',
      departmentScope,
    });
  }

  if (bypassesDepartmentScope(actorRole) && decisionNormalized === 'approved') {
    const isAssignee = approval.approver_id === actorUserId;
    const useForcePath = !isAssignee || approval.role === 'admin';
    if (useForcePath) {
      return performAdminForceApprove({
        pr: {
          id: pr.id as string,
          created_by: pr.created_by as string,
          duplicate_count: pr.duplicate_count as number | null,
          status: pr.status as string,
          company_id: companyId,
        },
        actorUserId,
        comments: comments ?? null,
        touchedApprovalId: approval.id as string,
        departmentScope,
      });
    }
  }

  if (approval.approver_id !== actorUserId) throw new AppError('Not authorized for this approval record', 403);

  if (approval.role === 'admin') {
    throw new AppError(
      'This approval record is a legacy admin stage and is not part of the required chain. Use Override approval or Force approve.',
      400,
    );
  }

  const requiredRoles = await fetchRequiredRolesForRequest(pr.id as string, companyId);
  const stageRole = approval.role as RequiredApprovalStageRole;
  if (!requiredRoles.includes(stageRole)) {
    throw new AppError('Approval role not part of required sequence for this request', 400);
  }

  const currentIndex = requiredRoles.indexOf(stageRole);
  const previousRoles = requiredRoles.slice(0, currentIndex);
  if (previousRoles.length > 0) {
    const { data: prevApprovals, error: prevErr } = await supabaseAdmin
      .from('approvals')
      .select('role, status')
      .eq('request_id', pr.id)
      .eq('company_id', companyId)
      .in('role', previousRoles);
    if (prevErr) throw prevErr;
    const prevMap = new Map((prevApprovals ?? []).map((r) => [r.role as RequiredApprovalStageRole, r.status]));
    const allApproved = previousRoles.every((r) => prevMap.get(r) === 'approved');
    if (!allApproved) throw new AppError('Cannot decide before previous stages are approved', 409);
  }

  const dupCount = Number(pr.duplicate_count ?? 1);
  const duplicatePrefix =
    dupCount > 1 ? `This item has been requested ${dupCount} times by the same user.` : null;
  const userPart = comments?.trim() ?? '';
  const mergedComments = [duplicatePrefix, userPart].filter(Boolean).join('\n\n') || null;

  const { data: updatedApprovals, error: updErr } = await supabaseAdmin
    .from('approvals')
    .update({
      status: decisionNormalized,
      comments: mergedComments,
      updated_by: actorUserId,
      is_admin_override: false,
    })
    .eq('id', approval.id)
    .eq('company_id', companyId)
    .eq('status', 'pending')
    .select('id, request_id, approver_id, role, status, comments, created_at, is_admin_override');
  if (updErr) throw updErr;
  const rowsAffected = updatedApprovals?.length ?? 0;
  if (rowsAffected === 0) throw new AppError('No matching approval found for this user', 404);
  const updatedApproval = updatedApprovals![0];

  if (decisionNormalized === 'rejected') {
    await writeApprovalAuditLogs({
      approvalIds: [approval.id as string],
      action: 'rejected',
      userId: actorUserId,
      departmentScope,
    });

    const { data: cascadePending, error: cascadeSelErr } = await supabaseAdmin
      .from('approvals')
      .select('id')
      .eq('request_id', pr.id)
      .eq('company_id', companyId)
      .eq('status', 'pending');
    if (cascadeSelErr) throw cascadeSelErr;
    const cascadeIds = (cascadePending ?? []).map((r) => r.id as string);

    const { error: prRejErr } = await supabaseAdmin
      .from('purchase_requests')
      .update({ status: 'rejected', updated_by: actorUserId })
      .eq('id', pr.id)
      .eq('company_id', companyId);
    if (prRejErr) throw prRejErr;

    await supabaseAdmin
      .from('approvals')
      .update({
        status: 'rejected',
        comments: 'Auto-rejected due to earlier rejection',
        updated_by: actorUserId,
      })
      .eq('request_id', pr.id)
      .eq('company_id', companyId)
      .eq('status', 'pending');

    if (cascadeIds.length > 0) {
      await writeApprovalAuditLogs({
        approvalIds: cascadeIds,
        action: 'rejected',
        userId: actorUserId,
        reason: 'cascade_after_stage_rejection',
        departmentScope,
      });
    }

    await recordTrackedAction({
      audit: {
        action: 'pr_rejected',
        userId: actorUserId,
        entity: 'purchase_request',
        entityType: 'purchase_request',
        entityId: pr.id as string,
        changes: { status: { after: 'rejected' }, stage: approval.role },
        departmentScope,
      },
      notify: [
        {
          userId: pr.created_by as string,
          type: 'pr_rejected',
          message: `Purchase Request ${pr.id} was rejected at the ${approval.role} stage.`,
          emailSubject: appEmailSubject('PR Rejected'),
        },
      ],
    });

    return { prId: pr.id, status: 'rejected' as const, approval: updatedApproval };
  }

  const fullyApproved = await rolesRequiredAreFullyApproved({
    requestId: pr.id as string,
    roles: requiredRoles,
    companyId,
  });
  if (!fullyApproved) {
    const nextRole = requiredRoles[currentIndex + 1];
    if (!nextRole) throw new AppError('Next role not found', 500);

    const { data: nextApproval, error: nextErr } = await supabaseAdmin
      .from('approvals')
      .select('id, approver_id, role')
      .eq('request_id', pr.id)
      .eq('company_id', companyId)
      .eq('role', nextRole)
      .single();
    if (nextErr || !nextApproval) throw nextErr ?? new AppError('Next approval stage missing', 500);

    await recordTrackedAction({
      audit: {
        action: 'approval_stage_approved',
        userId: actorUserId,
        entity: 'purchase_request',
        entityType: 'purchase_request',
        entityId: pr.id as string,
        changes: { stage: approval.role, approvalStatus: { after: 'approved' } },
        departmentScope,
      },
      touch: { table: 'purchase_requests', id: pr.id as string, companyId },
      notify: [
        {
          userId: nextApproval.approver_id as string,
          type: 'pr_approval_pending',
          message: `Purchase Request ${pr.id} is ready for your ${humanizeStageLabel(nextRole as ApprovalStageRole)}.`,
          emailSubject: appEmailSubject('PR Approval Pending'),
        },
      ],
    });

    await writeApprovalAuditLogs({
      approvalIds: [approval.id as string],
      action: 'approved',
      userId: actorUserId,
      departmentScope,
    });

    return { prId: pr.id, status: 'pending' as const, approval: updatedApproval };
  }

  let rpcResult: Record<string, unknown> = {};
  try {
    rpcResult = await finalizePrBudgetAfterApprovalRpc(pr.id as string, actorUserId);
  } catch (e) {
    await supabaseAdmin
      .from('approvals')
      .update({ status: 'pending', updated_by: actorUserId })
      .eq('id', approval.id)
      .eq('company_id', companyId);
    throw e;
  }

  await writeApprovalAuditLogs({
    approvalIds: [approval.id as string],
    action: 'approved',
    userId: actorUserId,
    departmentScope,
  });

  await writeAuditLog({
    action: 'budget_deducted_after_pr_approval',
    userId: actorUserId,
    entity: 'purchase_request',
    entityType: 'purchase_request',
    entityId: pr.id as string,
    reason: auditPayloadPreview(rpcResult),
    changes: { finalize: rpcResult },
    departmentScope,
  });

  await writeAuditLog({
    action: 'pr_approved',
    userId: actorUserId,
    entity: 'purchase_request',
    entityType: 'purchase_request',
    entityId: pr.id as string,
    changes: { status: { after: 'approved' } },
    departmentScope,
  });

  await touchEntityRow('purchase_requests', pr.id as string, actorUserId, companyId);
  await deliverTrackedNotifications([
    {
      userId: pr.created_by as string,
      type: 'pr_approved',
      message: `Purchase Request ${pr.id} was fully approved.`,
      emailSubject: appEmailSubject('PR Approved'),
    },
  ]);

  return { prId: pr.id, status: 'approved' as const, approval: updatedApproval };
}

export async function adminOverridePurchaseRequest(params: {
  requestId: string;
  decision: ApprovalDecision;
  reason: string;
  actorUserId: string;
  companyId: string;
}) {
  const { requestId, decision, reason, actorUserId, companyId } = params;
  const decisionNormalized = decision === 'approved' ? 'approved' : 'rejected';

  const { data: pr, error: prErr } = await supabaseAdmin
    .from('purchase_requests')
    .select('id, status, created_by, amount, project_id, po_line_id, budget_deducted')
    .eq('id', requestId)
    .eq('company_id', companyId)
    .single();
  if (prErr || !pr) throw prErr ?? new AppError('Purchase request not found', 404);

  const departmentScope = await departmentScopeForProjectId(pr.project_id as string, companyId);

  if (decisionNormalized === 'rejected') {
    const { data: pendingRejectIds, error: pendRejErr } = await supabaseAdmin
      .from('approvals')
      .select('id')
      .eq('request_id', pr.id)
      .eq('company_id', companyId)
      .eq('status', 'pending');
    if (pendRejErr) throw pendRejErr;
    const rejIds = (pendingRejectIds ?? []).map((r) => r.id as string);

    const { error: prRejErr } = await supabaseAdmin
      .from('purchase_requests')
      .update({ status: 'rejected', updated_by: actorUserId })
      .eq('id', pr.id)
      .eq('company_id', companyId);
    if (prRejErr) throw prRejErr;

    if (rejIds.length > 0) {
      const { error: approvalsCloseErr } = await supabaseAdmin
        .from('approvals')
        .update({
          status: 'rejected',
          comments: `Admin override rejected. Reason: ${reason}`,
          updated_by: actorUserId,
          is_admin_override: true,
        })
        .eq('company_id', companyId)
        .in('id', rejIds);
      if (approvalsCloseErr) throw approvalsCloseErr;
      await writeApprovalAuditLogs({
        approvalIds: rejIds,
        action: 'rejected',
        userId: actorUserId,
        reason: 'admin_override',
        departmentScope,
      });
    }

    await deliverTrackedNotifications([
      {
        userId: pr.created_by as string,
        type: 'pr_rejected',
        message: `Purchase Request ${pr.id} was rejected by an administrator (override).`,
        emailSubject: appEmailSubject('PR Rejected'),
      },
    ]);
  } else {
    if (pr.status === 'approved' && pr.budget_deducted) {
      const { data: updatedPr, error: updatedPrErr } = await supabaseAdmin
        .from('purchase_requests')
        .select('id, status, created_by')
        .eq('id', pr.id)
        .eq('company_id', companyId)
        .single();
      if (updatedPrErr || !updatedPr) throw updatedPrErr ?? new AppError('Updated purchase request not found', 500);
      await writeAuditLog({
        action: 'admin_override',
        userId: actorUserId,
        entity: 'purchase_request',
        entityType: 'purchase_request',
        entityId: pr.id,
        reason: `${reason} (no-op: already approved and budget applied)`,
        departmentScope,
      });
      return { prId: updatedPr.id, status: updatedPr.status, reason };
    }

    const { data: pendingApproveIds, error: pendApprErr } = await supabaseAdmin
      .from('approvals')
      .select('id')
      .eq('request_id', pr.id)
      .eq('company_id', companyId)
      .eq('status', 'pending');
    if (pendApprErr) throw pendApprErr;
    const approveIds = (pendingApproveIds ?? []).map((r) => r.id as string);

    const overrideComment = `Admin override approved. Reason: ${reason}`;
    if (approveIds.length > 0) {
      const { error: approvalsSkipErr } = await supabaseAdmin
        .from('approvals')
        .update({
          status: 'approved',
          comments: overrideComment,
          updated_by: actorUserId,
          is_admin_override: true,
        })
        .eq('company_id', companyId)
        .in('id', approveIds);
      if (approvalsSkipErr) throw approvalsSkipErr;
    }

    let rpcResult: Record<string, unknown> = {};
    try {
      rpcResult = await finalizePrBudgetAfterApprovalRpc(pr.id, actorUserId);
    } catch (e) {
      if (approveIds.length > 0) {
        await supabaseAdmin
          .from('approvals')
          .update({ status: 'pending', is_admin_override: false, updated_by: actorUserId })
          .eq('company_id', companyId)
          .in('id', approveIds);
      }
      throw e;
    }

    if (approveIds.length > 0) {
      await writeApprovalAuditLogs({
        approvalIds: approveIds,
        action: 'approved',
        userId: actorUserId,
        reason: 'admin_override',
        departmentScope,
      });
    }

    await writeAuditLog({
      action: 'budget_deducted_after_pr_approval',
      userId: actorUserId,
      entity: 'purchase_request',
      entityType: 'purchase_request',
      entityId: pr.id,
      reason: auditPayloadPreview({ ...rpcResult, via: 'admin_override' }),
      changes: { via: 'admin_override', finalize: rpcResult },
      departmentScope,
    });

    await deliverTrackedNotifications([
      {
        userId: pr.created_by as string,
        type: 'pr_approved',
        message: `Purchase Request ${pr.id} was fully approved (administrator override).`,
        emailSubject: appEmailSubject('PR Approved'),
      },
    ]);
  }

  const { data: updatedPr, error: updatedPrErr } = await supabaseAdmin
    .from('purchase_requests')
    .select('id, status, created_by')
    .eq('id', pr.id)
    .eq('company_id', companyId)
    .single();
  if (updatedPrErr || !updatedPr) throw updatedPrErr ?? new AppError('Updated purchase request not found', 500);

  await writeAuditLog({
    action: 'admin_override',
    userId: actorUserId,
    entity: 'purchase_request',
    entityType: 'purchase_request',
    entityId: pr.id,
    reason,
    departmentScope,
  });

  return {
    prId: updatedPr.id,
    status: updatedPr.status,
    reason,
  };
}
