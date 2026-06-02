import type { Request } from 'express';
import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';
import { appEmailSubject } from '../../config/appMeta';
import { recordTrackedAction } from '../auditLogs/trackedAction';
import { getAdminUserIds } from '../notifications/service';
import { isDeptManagerRole, type UserRole } from '../auth/types';
import { calcRemainingAmount, type ParsedLineItemRow } from './service';
import { OPTIONAL_HEADER_TO_COLUMN } from './lineItemMap';
import { logPoUpload } from './uploadLog';
import { postgrestErrorMessage, throwSupabaseError } from '../../utils/supabaseError';

/** Columns we may send to `purchase_orders` (avoids PGRST204 when prod DB lags migrations). */
const PO_INSERT_COLUMNS = new Set<string>([
  'company_id',
  'po',
  'po_line_sn',
  'item_code',
  'description',
  'unit_price',
  'po_amount',
  'po_invoiced',
  'po_acceptance_approved',
  'pending_to_apply',
  'po_acceptance_pending',
  'acceptance_rejected_amount',
  'wnd',
  'remaining_amount',
  'po_number',
  'vendor',
  'total_value',
  'remaining_value',
  'uploaded_by',
  'updated_by',
  'department',
  'status',
  ...Object.values(OPTIONAL_HEADER_TO_COLUMN),
]);

function pickPoRowPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (PO_INSERT_COLUMNS.has(key)) out[key] = value;
  }
  return out;
}

const INSERT_CHUNK = 100;
const UPDATE_CONCURRENCY = 15;

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function lineItemToPayload(
  row: ParsedLineItemRow,
  existing: Record<string, unknown> | null,
  actorUserId: string,
  options: { enforceUploaderDepartment: string | null; companyId: string },
) {
  const ex = existing ?? {};
  const po_amount = row.po_amount;
  const po_invoiced = row.extras.po_invoiced !== undefined ? num(row.extras.po_invoiced, 0) : num(ex.po_invoiced, 0);
  const po_acceptance_approved =
    row.extras.po_acceptance_approved !== undefined
      ? num(row.extras.po_acceptance_approved, 0)
      : num(ex.po_acceptance_approved, 0);
  const pending_to_apply =
    row.extras.pending_to_apply !== undefined ? num(row.extras.pending_to_apply, 0) : num(ex.pending_to_apply, 0);

  const remaining_amount = calcRemainingAmount({
    po_amount,
    po_invoiced,
    po_acceptance_approved,
    pending_to_apply,
  });

  const customerStr =
    row.extras.customer !== undefined ? String(row.extras.customer).trim() : String(ex.customer ?? '').trim();

  const rest = { ...row.extras };
  delete rest.po_invoiced;
  delete rest.po_acceptance_approved;
  delete rest.pending_to_apply;

  const department =
    options.enforceUploaderDepartment ??
    (rest.department !== undefined ? String(rest.department) : (ex.department as string | undefined)) ??
    null;

  const base: Record<string, unknown> = {
    ...rest,
    company_id: options.companyId,
    po: row.po,
    po_line_sn: row.po_line_sn,
    item_code: row.item_code,
    description: row.description,
    unit_price: row.unit_price,
    po_amount,
    po_invoiced,
    po_acceptance_approved,
    pending_to_apply,
    status: 'active',
    po_acceptance_pending:
      row.extras.po_acceptance_pending !== undefined
        ? num(row.extras.po_acceptance_pending, 0)
        : num(ex.po_acceptance_pending, 0),
    acceptance_rejected_amount:
      row.extras.acceptance_rejected_amount !== undefined
        ? num(row.extras.acceptance_rejected_amount, 0)
        : num(ex.acceptance_rejected_amount, 0),
    wnd: row.extras.wnd !== undefined ? num(row.extras.wnd, 0) : num(ex.wnd, 0),
    remaining_amount,
    po_number: row.po,
    vendor: customerStr || 'Unknown',
    total_value: po_amount,
    remaining_value: remaining_amount,
    uploaded_by: actorUserId,
    updated_by: actorUserId,
    department,
  };

  for (const k of Object.keys(base)) {
    if (base[k] === undefined) delete base[k];
  }

  return base;
}

function supabaseErrMessage(err: unknown): string {
  return postgrestErrorMessage(err);
}

async function insertOnePoRow(
  payload: Record<string, unknown>,
  companyId: string,
): Promise<{ id: string } | null> {
  const row = pickPoRowPayload(payload);
  const { data, error } = await supabaseAdmin.from('purchase_orders').insert(row).select('id').single();
  if (error) throw error;
  return data?.id ? { id: data.id as string } : null;
}

async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
}

export async function handleLineItemUpload(params: {
  rows: ParsedLineItemRow[];
  actorUserId: string;
  actorRole: UserRole;
  actorDepartment: string | null;
  companyId: string;
  req?: Request;
}): Promise<{
  totalRows: number;
  inserted: number;
  updated: number;
  failed: number;
  cancelled: number;
  cancelledPos: string[];
  cancelledAt: string;
  firstEntityId: string | null;
  failures: string[];
}> {
  const { rows, actorUserId, actorRole, actorDepartment, companyId, req } = params;
  const enforceDept = isDeptManagerRole(actorRole) ? actorDepartment : null;

  if (req) logPoUpload(req, 'db_prepare', { rowCount: rows.length, companyId });

  const lineSns = [...new Set(rows.map((r) => r.po_line_sn).filter(Boolean))];
  const existingBySn = new Map<string, Record<string, unknown>>();

  if (lineSns.length > 0) {
    const LOOKUP_CHUNK = 200;
    for (let i = 0; i < lineSns.length; i += LOOKUP_CHUNK) {
      const chunk = lineSns.slice(i, i + LOOKUP_CHUNK);
      const { data: existingRows, error: findErr } = await supabaseAdmin
        .from('purchase_orders')
        .select('*')
        .eq('company_id', companyId)
        .in('po_line_sn', chunk);
      if (findErr) throwSupabaseError(findErr);
      for (const row of existingRows ?? []) {
        const sn = row.po_line_sn as string | undefined;
        if (sn) existingBySn.set(sn, row as Record<string, unknown>);
      }
    }
  }

  const toInsert: Record<string, unknown>[] = [];
  const toUpdate: { id: string; payload: Record<string, unknown>; rowIndex: number; label: string }[] = [];

  for (const [index, row] of rows.entries()) {
    const existing = existingBySn.get(row.po_line_sn) ?? null;
    const payload = lineItemToPayload(row, existing, actorUserId, {
      enforceUploaderDepartment: enforceDept,
      companyId,
    });
    if (existing?.id) {
      toUpdate.push({
        id: existing.id as string,
        payload: pickPoRowPayload(payload),
        rowIndex: index,
        label: row.po_line_sn || row.po || 'unknown',
      });
    } else {
      toInsert.push(pickPoRowPayload(payload));
    }
  }

  let inserted = 0;
  let updated = 0;
  let failed = 0;
  let firstEntityId: string | null = null;
  const failures: string[] = [];

  if (req) logPoUpload(req, 'db_insert_start', { insertCount: toInsert.length, updateCount: toUpdate.length });

  for (let offset = 0; offset < toInsert.length; offset += INSERT_CHUNK) {
    const chunk = toInsert.slice(offset, offset + INSERT_CHUNK);
    try {
      const { data: insRows, error: insErr } = await supabaseAdmin
        .from('purchase_orders')
        .insert(chunk)
        .select('id');
      if (insErr) throw insErr;
      inserted += insRows?.length ?? chunk.length;
      const first = insRows?.[0]?.id as string | undefined;
      if (first && !firstEntityId) firstEntityId = first;
    } catch (chunkErr) {
      if (req) {
        logPoUpload(req, 'db_insert_chunk_fallback', {
        offset,
        chunkSize: chunk.length,
        error: supabaseErrMessage(chunkErr),
        });
      }
      for (let j = 0; j < chunk.length; j++) {
        const rowPayload = chunk[j]!;
        const label = (rowPayload.po_line_sn as string) ?? 'unknown';
        try {
          const ins = await insertOnePoRow(rowPayload, companyId);
          if (ins?.id) {
            inserted += 1;
            if (!firstEntityId) firstEntityId = ins.id;
          }
        } catch (rowErr) {
          failed += 1;
          failures.push(`row ${offset + j + 2} (${label}): ${supabaseErrMessage(rowErr)}`);
        }
      }
    }
  }

  await runPool(toUpdate, UPDATE_CONCURRENCY, async (item) => {
    try {
      const { data: upd, error: updErr } = await supabaseAdmin
        .from('purchase_orders')
        .update(item.payload)
        .eq('company_id', companyId)
        .eq('id', item.id)
        .select('id')
        .single();
      if (updErr) throw updErr;
      updated += 1;
      if (upd?.id && !firstEntityId) firstEntityId = upd.id as string;
    } catch (err) {
      failed += 1;
      failures.push(`row ${item.rowIndex + 2} (${item.label}): ${supabaseErrMessage(err)}`);
    }
  });

  if (req) {
    logPoUpload(req, 'db_complete', { inserted, updated, failed, firstEntityId });
  }

  if (inserted === 0 && updated === 0 && failed === rows.length) {
    throw new AppError('All PO rows failed to save. Check data types and constraints.', 400, {
      failures: failures.slice(0, 10),
    });
  }

  // Mark POs absent from this upload as cancelled.
  // Scope: if uploader is a dept manager, only cancel within their department.
  let cancelled = 0;
  let cancelledPos: string[] = [];
  const cancelledAt = new Date().toISOString();
  try {
    const uploadedPos = new Set(rows.map((r) => r.po).filter(Boolean));
    let cancelQuery = supabaseAdmin
      .from('purchase_orders')
      .select('po')
      .eq('company_id', companyId)
      .neq('status', 'cancelled');
    if (enforceDept) cancelQuery = cancelQuery.eq('department', enforceDept);
    const { data: existingPoRows, error: fetchErr } = await cancelQuery;
    if (!fetchErr && existingPoRows) {
      const missingPos = [...new Set((existingPoRows as { po: string | null }[]).map((r) => r.po).filter((p): p is string => !!p && !uploadedPos.has(p)))];
      if (missingPos.length > 0) {
        const CANCEL_CHUNK = 200;
        for (let i = 0; i < missingPos.length; i += CANCEL_CHUNK) {
          const chunk = missingPos.slice(i, i + CANCEL_CHUNK);
          let q = supabaseAdmin
            .from('purchase_orders')
            .update({ status: 'cancelled', updated_by: actorUserId })
            .eq('company_id', companyId)
            .in('po', chunk)
            .select('id');
          if (enforceDept) q = q.eq('department', enforceDept);
          const { data: cancelledRows, error: cancelErr } = await q;
          if (!cancelErr) {
            cancelled += cancelledRows?.length ?? 0;
            cancelledPos = cancelledPos.concat(chunk);
          } else if (req) {
            logPoUpload(req, 'cancel_chunk_error', { error: cancelErr.message });
          }
        }
      }
    }
    if (req) logPoUpload(req, 'cancel_complete', { cancelled, cancelledPos });
  } catch (cancelErr) {
    if (req) logPoUpload(req, 'cancel_failed', { error: cancelErr instanceof Error ? cancelErr.message : String(cancelErr) });
  }

  return {
    totalRows: rows.length,
    inserted,
    updated,
    failed,
    cancelled,
    cancelledPos,
    cancelledAt,
    firstEntityId,
    failures: failures.slice(0, 10),
  };
}

/** Audit + notifications must not fail a successful PO data import (common prod schema/env drift). */
export async function runPoUploadSideEffects(params: {
  req: Request;
  companyId: string;
  actorUserId: string;
  actorRole: UserRole;
  actorDepartment: string | null;
  result: {
    inserted: number;
    updated: number;
    failed: number;
    firstEntityId: string | null;
  };
}): Promise<{ warnings: string[] }> {
  const warnings: string[] = [];
  const { req, companyId, actorUserId, actorRole, actorDepartment, result } = params;

  if (!result.firstEntityId) return { warnings };

  try {
    const { data: actor } = await supabaseAdmin
      .from('users')
      .select('name, email')
      .eq('id', actorUserId)
      .eq('company_id', companyId)
      .maybeSingle();

    const actorLabel = String(actor?.name ?? actor?.email ?? actorUserId);
    const deptScope = isDeptManagerRole(actorRole) ? actorDepartment : null;
    const adminIds = await getAdminUserIds(companyId);
    const uploadSummary = `PO data upload (${result.inserted} inserted, ${result.updated} updated, ${result.failed} failed). Uploaded by ${actorLabel}.`;
    const notifyEntries = adminIds.map((id) => ({
      userId: id,
      type: isDeptManagerRole(actorRole) ? 'pm_po_upload' : 'po_upload',
      message: uploadSummary,
      emailSubject: appEmailSubject('PO data uploaded'),
    }));

    const action = result.updated > 0 ? 'updated' : result.inserted > 0 ? 'created' : 'updated';
    await recordTrackedAction({
      audit: {
        action,
        userId: actorUserId,
        entity: 'purchase_order',
        entityType: 'purchase_order',
        entityId: result.firstEntityId,
        changes: { inserted: result.inserted, updated: result.updated, failed: result.failed },
        departmentScope: deptScope,
        companyId,
      },
      touch: { table: 'purchase_orders', id: result.firstEntityId, companyId },
      notify: notifyEntries,
    });
    logPoUpload(req, 'side_effects_ok', { entityId: result.firstEntityId });
  } catch (err) {
    const msg = supabaseErrMessage(err);
    warnings.push(`PO rows saved, but audit/notification step failed: ${msg}`);
    logPoUpload(req, 'side_effects_failed', { error: msg });
  }

  return { warnings };
}
