import { appEmailSubject } from '../../config/appMeta';
import { env } from '../../config/env';
import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';
import { startApprovalsForPurchaseRequest } from '../approvals/engine';
import { recordTrackedAction } from '../auditLogs/trackedAction';
import {
  bypassesDepartmentScope,
  isDeptManagerRole,
  type UserRole,
} from '../auth/types';
import { normalizeItemCode } from '../../utils/itemCode';
import {
  poLineMatchesProjectAnchor,
  resolvePoLineForProject,
  sumPendingAmountOnPoLine,
  type PoAnchor,
} from './poLineContext';
import { assertActorMaySubmitPurchaseRequestForProject, fetchProjectForAccess } from '../projects/projectAccess';

export { normalizeItemCode } from '../../utils/itemCode';

export async function countPreviousPrsForSameItem(userId: string, itemCodeNorm: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('purchase_requests')
    .select('*', { count: 'exact', head: true })
    .eq('created_by', userId)
    .eq('item_code', itemCodeNorm);
  if (error) throw error;
  return count ?? 0;
}

export async function createPurchaseRequest(params: {
  projectId: string;
  description: string;
  amount: number;
  itemCode?: string | null;
  poLineSn?: string | null;
  requestedQuantity?: number | null;
  documentFile?: { buffer: Buffer; originalName: string; mimeType: string } | null;
  createdBy: string;
  actorRole: UserRole;
  actorDepartment?: string | null;
}) {
  const {
    projectId,
    description,
    amount,
    itemCode,
    poLineSn,
    requestedQuantity,
    documentFile,
    createdBy,
    actorRole,
    actorDepartment,
  } = params;

  if (!description.trim()) throw new AppError('Description is required', 400);
  if (description.trim().length < 10) throw new AppError('Description must be at least 10 characters', 400);

  const { data: project, error: prjErr } = await supabaseAdmin
    .from('projects')
    .select('id, po_id, budget, status, created_by, department_id, team_lead_id, pm_id')
    .eq('id', projectId)
    .single();
  if (prjErr || !project) throw prjErr ?? new AppError('Project not found', 404);
  const pmRowId = project.pm_id as string | null;
  if (!pmRowId) throw new AppError('Project is missing an assigned PM — run migrations or contact admin', 400);

  // PRs always have project_id. Spend is deducted on final approval from: po_line_id row, project.po_id PO header, or project.budget (no PO).
  if (
    !project.po_id &&
    (!Number.isFinite(Number(project.budget)) || Number(project.budget) <= 0)
  ) {
    throw new AppError(
      'Project has no linked purchase order and no usable budget — cannot create a purchase request',
      400,
    );
  }

  let anchorPo: PoAnchor | null = null;
  if (project.po_id) {
    const { data: a, error: aErr } = await supabaseAdmin
      .from('purchase_orders')
      .select('id, po, po_line_sn, item_code')
      .eq('id', project.po_id)
      .single();
    if (!aErr && a) anchorPo = a as PoAnchor;
  }

  await assertActorMaySubmitPurchaseRequestForProject({
    project: {
      id: project.id as string,
      department_id: project.department_id as string,
      team_lead_id: (project.team_lead_id as string | null) ?? null,
      pm_id: pmRowId,
      created_by: project.created_by as string,
      status: project.status as string,
    },
    actorUserId: createdBy,
    actorRole,
    actorDepartment: actorDepartment ?? null,
  });

  if (project.status !== 'active') {
    throw new AppError(`Project is not active (status=${project.status}). Submit is blocked until exceptions are approved.`, 409);
  }

  const itemCodeNorm = normalizeItemCode(itemCode);
  let reqAmount = Number(amount);

  let matchedPoLineId: string | null = null;
  let storedItemCodeNorm: string | null = itemCodeNorm;

  const rqParsed =
    requestedQuantity != null && Number.isFinite(Number(requestedQuantity)) && Number(requestedQuantity) > 0
      ? Number(requestedQuantity)
      : null;
  let rqForDb: number | null = rqParsed;

  const snTrim = poLineSn?.trim() || null;
  if (snTrim) {
    if (!project.po_id || !anchorPo) {
      throw new AppError('PO line selection is only valid for projects with a linked purchase order', 400);
    }
    const { data: lineRow, error: lrErr } = await supabaseAdmin
      .from('purchase_orders')
      .select('id, po, remaining_amount, item_code, unit_price')
      .eq('po_line_sn', snTrim)
      .maybeSingle();
    if (lrErr) throw lrErr;
    if (!lineRow) {
      throw new AppError('Unknown PO line', 400);
    }
    if (
      !poLineMatchesProjectAnchor(
        { id: lineRow.id as string, po: lineRow.po as string | null },
        anchorPo,
        project.po_id as string,
      )
    ) {
      throw new AppError('PO line does not belong to this project', 400);
    }
    matchedPoLineId = lineRow.id as string;
    storedItemCodeNorm = normalizeItemCode(lineRow.item_code as string | null);

    const unitPrice = Number(lineRow.unit_price);
    if (unitPrice > 0) {
      if (rqParsed == null) {
        throw new AppError('requested_quantity is required for the selected PO line', 400);
      }
      reqAmount = Math.round(rqParsed * unitPrice * 100) / 100;
      rqForDb = rqParsed;
    } else {
      if (rqParsed != null) {
        throw new AppError('This PO line has no unit price; omit quantity and provide amount only', 400);
      }
      rqForDb = null;
      if (!Number.isFinite(reqAmount) || reqAmount <= 0) {
        throw new AppError('amount must be > 0', 400);
      }
    }

    const pendingOnLine = await sumPendingAmountOnPoLine({ poLineId: matchedPoLineId });
    const effectiveRemaining = Number(lineRow.remaining_amount) - pendingOnLine;
    if (reqAmount > effectiveRemaining) {
      throw new AppError('Requested amount exceeds available amount for this PO line', 400, {
        error: 'Over budget',
        message: 'Exceeds PO line limit',
        available_budget: effectiveRemaining,
        requested_amount: reqAmount,
      });
    }
  }

  if (!snTrim && anchorPo && itemCodeNorm) {
    if (!Number.isFinite(reqAmount) || reqAmount <= 0) {
      throw new AppError('amount must be > 0', 400);
    }
    const matched = await resolvePoLineForProject({
      anchor: anchorPo,
      itemCodeNorm,
      poLineSnRaw: null,
    });
    if (matched) {
      matchedPoLineId = matched.id;
      const pendingOnLine = await sumPendingAmountOnPoLine({ poLineId: matched.id });
      const effectiveRemaining = Number(matched.remaining_amount) - pendingOnLine;
      if (reqAmount > effectiveRemaining) {
        throw new AppError('Requested amount exceeds available amount for this PO line', 400, {
          error: 'Over budget',
          message: 'Exceeds PO line limit',
          available_budget: effectiveRemaining,
          requested_amount: reqAmount,
        });
      }
    }
  }

  // Financial validation before upload (project / header PO when no line match)
  if (!matchedPoLineId) {
    if (!Number.isFinite(reqAmount) || reqAmount <= 0) {
      throw new AppError('amount must be > 0', 400);
    }
    let remainingValue = Number(project.budget);
    if (project.po_id) {
      const { data: po, error: poErr } = await supabaseAdmin
        .from('purchase_orders')
        .select('remaining_value')
        .eq('id', project.po_id)
        .single();
      if (poErr || !po) throw poErr ?? new AppError('PO not found', 404);
      remainingValue = Number(po.remaining_value);
    }

    if (reqAmount > remainingValue) {
      throw new AppError('Requested amount exceeds available budget', 400, {
        error: 'Over budget',
        message: 'Requested amount exceeds available budget',
        available_budget: remainingValue,
        requested_amount: reqAmount,
      });
    }
  }

  if (!Number.isFinite(reqAmount) || reqAmount <= 0) {
    throw new AppError('amount must be > 0', 400);
  }

  let documentUrl: string | null = null;
  if (documentFile?.buffer) {
    const bucket = env.SUPABASE_STORAGE_BUCKET_DOCUMENTS;
    const safeExt = documentFile.originalName.includes('.')
      ? documentFile.originalName.slice(documentFile.originalName.lastIndexOf('.'))
      : '';
    const path = `pr-documents/${projectId}/${Date.now()}-${createdBy}${safeExt}`.replace(/\\/g, '/');

    const { error: upErr } = await supabaseAdmin.storage.from(bucket).upload(path, documentFile.buffer, {
      contentType: documentFile.mimeType,
      upsert: true,
    });
    if (upErr) throw upErr;
    documentUrl = `${env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
  }

  let duplicate_count = 1;
  if (storedItemCodeNorm) {
    const previous = await countPreviousPrsForSameItem(createdBy, storedItemCodeNorm);
    duplicate_count = previous + 1;
  }

  const prPayload = {
    project_id: project.id,
    description: description.trim(),
    amount: reqAmount,
    document_url: documentUrl,
    item_code: storedItemCodeNorm,
    duplicate_count,
    po_line_id: matchedPoLineId,
    requested_quantity: rqForDb,
    created_by: createdBy,
  };

  // Within remaining: create PR and start approval workflow
  const { data: pr, error: prInsErr } = await supabaseAdmin
    .from('purchase_requests')
    .insert({ ...prPayload, status: 'pending', updated_by: createdBy })
    .select('id, status, amount, project_id, created_by')
    .single();
  if (prInsErr || !pr) throw prInsErr ?? new AppError('Failed to create purchase request', 500);

  await recordTrackedAction({
    audit: {
      action: 'purchase_request_created',
      userId: createdBy,
      entity: 'purchase_request',
      entityType: 'purchase_request',
      entityId: pr.id as string,
      changes: { amount: reqAmount, project_id: project.id, po_line_id: matchedPoLineId },
      departmentScope: project.department_id as string,
    },
    touch: { table: 'purchase_requests', id: pr.id as string },
    notify: [
      {
        userId: createdBy,
        type: 'pr_created',
        message: `Your Purchase Request ${pr.id} was submitted and is now pending approvals.`,
        emailSubject: appEmailSubject('PR Created'),
      },
      {
        userId: pmRowId,
        type: 'pr_submitted_for_project',
        message: `A new purchase request (${String(pr.id).slice(0, 8)}…) was submitted on your project.`,
        emailSubject: appEmailSubject('New purchase request'),
      },
    ],
  });

  await startApprovalsForPurchaseRequest(pr.id, createdBy);

  return { pr };
}

export async function deletePurchaseRequest(params: {
  requestId: string;
  actorUserId: string;
  actorRole: UserRole;
  actorDepartment: string | null;
}) {
  const { requestId, actorUserId, actorRole, actorDepartment } = params;

  if (actorRole === 'employee') {
    throw new AppError('Forbidden', 403);
  }

  const { data: pr, error: prErr } = await supabaseAdmin
    .from('purchase_requests')
    .select('id, project_id, status, budget_deducted, created_by')
    .eq('id', requestId)
    .maybeSingle();
  if (prErr) throw prErr;
  if (!pr) throw new AppError('Purchase request not found', 404);

  if (pr.status === 'approved' || pr.budget_deducted === true) {
    throw new AppError('Cannot delete an approved purchase request that affected budget', 409);
  }

  const project = await fetchProjectForAccess(pr.project_id as string);

  if (!bypassesDepartmentScope(actorRole)) {
    if (!isDeptManagerRole(actorRole)) {
      throw new AppError('Forbidden', 403);
    }
    if (!actorDepartment || actorDepartment !== project.department_id) {
      throw new AppError('You can only delete purchase requests for projects in your department', 403);
    }
  }

  const { error: delErr } = await supabaseAdmin.from('purchase_requests').delete().eq('id', requestId);
  if (delErr) throw delErr;

  await recordTrackedAction({
    audit: {
      action: 'purchase_request_deleted',
      userId: actorUserId,
      entity: 'purchase_request',
      entityType: 'purchase_request',
      entityId: requestId,
      changes: { project_id: pr.project_id, status: pr.status },
      departmentScope: project.department_id,
    },
  });

  return { ok: true as const };
}


