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
import {
  isMissingColumnError,
  postgrestErrorMessage,
  throwSupabaseError,
} from '../../utils/supabaseError';

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
  'source_row',
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
const INSERT_CHUNK_MIN = 10;
const UPDATE_CONCURRENCY = 15;
/** PostgREST / gateway body limits — keep bulk inserts under ~512KB. */
const MAX_INSERT_BATCH_BYTES = 512 * 1024;

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function roundMoney(value: number, scale: number): number {
  const factor = 10 ** scale;
  return Math.round(value * factor) / factor;
}

/** DB columns `total_value` / `remaining_value` are numeric(20,2) with check >= 0. */
function nonNegativeMoney(value: number, scale: 2 | 4 = 2): number {
  if (!Number.isFinite(value)) return 0;
  const max = scale === 2 ? 999999999999999999.99 : 9999999999999999.9999;
  return roundMoney(Math.min(max, Math.max(0, value)), scale);
}

function compactSourceRow(source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === null || value === undefined || value === '') continue;
    if (typeof value === 'string' && value.length > 2000) {
      out[key] = `${value.slice(0, 2000)}…`;
      continue;
    }
    out[key] = value;
  }
  return out;
}

function estimateInsertBatchBytes(rows: Record<string, unknown>[]): number {
  try {
    return Buffer.byteLength(JSON.stringify(rows), 'utf8');
  } catch {
    return rows.length * 4096;
  }
}

function insertChunkSize(rows: Record<string, unknown>[]): number {
  if (rows.length === 0) return INSERT_CHUNK;
  const sample = rows.slice(0, Math.min(rows.length, INSERT_CHUNK));
  const bytesPerRow = Math.max(256, Math.ceil(estimateInsertBatchBytes(sample) / sample.length));
  return Math.max(INSERT_CHUNK_MIN, Math.min(INSERT_CHUNK, Math.floor(MAX_INSERT_BATCH_BYTES / bytesPerRow)));
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

  const sourceRemaining =
    row.extras.remaining_amount !== undefined ? num(row.extras.remaining_amount, NaN) : NaN;
  const remaining_amount = nonNegativeMoney(
    Number.isFinite(sourceRemaining)
      ? sourceRemaining
      : calcRemainingAmount({
          po_amount,
          po_invoiced,
          po_acceptance_approved,
          pending_to_apply,
        }),
    4,
  );

  const customerStr =
    row.extras.customer !== undefined ? String(row.extras.customer).trim() : String(ex.customer ?? '').trim();

  const rest = { ...row.extras };
  delete rest.po_invoiced;
  delete rest.po_acceptance_approved;
  delete rest.pending_to_apply;
  delete rest.remaining_amount;

  const department =
    options.enforceUploaderDepartment ??
    (rest.department !== undefined ? String(rest.department) : (ex.department as string | undefined)) ??
    null;

  const base: Record<string, unknown> = {
    ...rest,
    company_id: options.companyId,
    po: row.po,
    po_line_sn: row.po_line_sn,
    item_code: row.item_code || null,
    description: row.description || null,
    unit_price: row.unit_price,
    po_amount,
    po_invoiced,
    po_acceptance_approved,
    pending_to_apply,
    status: row.is_cancelled ? 'cancelled' : 'active',
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
    total_value: nonNegativeMoney(po_amount ?? 0, 2),
    remaining_value: nonNegativeMoney(remaining_amount, 2),
    uploaded_by: actorUserId,
    updated_by: actorUserId,
    department,
    source_row: {
      ...compactSourceRow(row.source_row),
      _dash_fields: row.dash_fields,
      _explicit_cancelled: row.is_cancelled,
    },
  };

  for (const k of Object.keys(base)) {
    if (base[k] === undefined) delete base[k];
  }

  return base;
}

function supabaseErrMessage(err: unknown): string {
  return postgrestErrorMessage(err);
}

function stripPayloadColumns(payload: Record<string, unknown>, columns: string[]): Record<string, unknown> {
  const out = { ...payload };
  for (const col of columns) delete out[col];
  return out;
}

function insertPayloadVariants(payload: Record<string, unknown>): Record<string, unknown>[] {
  const base = pickPoRowPayload(payload);
  return [
    base,
    stripPayloadColumns(base, ['source_row']),
    stripPayloadColumns(base, ['source_row', 'status']),
  ];
}

async function insertOnePoRow(payload: Record<string, unknown>): Promise<{ id: string } | null> {
  const candidates = insertPayloadVariants(payload);

  let lastErr: unknown;
  for (const row of candidates) {
    const { data, error } = await supabaseAdmin.from('purchase_orders').insert(row).select('id').single();
    if (!error) return data?.id ? { id: data.id as string } : null;
    lastErr = error;
    if (!isMissingColumnError(error)) break;
  }
  throw lastErr;
}

async function insertPoChunk(chunk: Record<string, unknown>[]): Promise<{ id: string }[]> {
  const tryInsert = async (rows: Record<string, unknown>[]) => {
    const { data, error } = await supabaseAdmin.from('purchase_orders').insert(rows).select('id');
    if (error) throw error;
    return (data ?? []) as { id: string }[];
  };

  for (const stripCols of [[], ['source_row'], ['source_row', 'status']] as const) {
    const rows =
      stripCols.length === 0
        ? chunk
        : chunk.map((row) => stripPayloadColumns(row, [...stripCols]));
    try {
      return await tryInsert(rows);
    } catch (chunkErr) {
      if (!isMissingColumnError(chunkErr) || stripCols.length === 2) throw chunkErr;
    }
  }
  return [];
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
  activeInserted: number;
  activeUpdated: number;
  explicitCancelled: number;
  dashRows: number;
  totalActivePos: number;
  totalCancelledPos: number;
  cancelled: number;
  cancelledPos: string[];
  cancelledAt: string;
  firstEntityId: string | null;
  failures: string[];
}> {
  const { rows, actorUserId, actorRole, actorDepartment, companyId, req } = params;
  const enforceDept = isDeptManagerRole(actorRole) ? actorDepartment : null;
  const explicitCancelledPoSet = new Set(rows.filter((r) => r.is_cancelled).map((r) => r.po).filter(Boolean));
  const explicitCancelled = explicitCancelledPoSet.size;
  const dashRows = rows.filter((r) => r.dash_fields.length > 0).length;

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
    const effectiveRow =
      explicitCancelledPoSet.has(row.po) && !row.is_cancelled
        ? { ...row, is_cancelled: true }
        : row;
    const payload = lineItemToPayload(effectiveRow, existing, actorUserId, {
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
  let activeInserted = 0;
  let activeUpdated = 0;
  let failed = 0;
  let firstEntityId: string | null = null;
  const failures: string[] = [];

  if (req) logPoUpload(req, 'db_insert_start', { insertCount: toInsert.length, updateCount: toUpdate.length });

  const chunkSize = insertChunkSize(toInsert);
  for (let offset = 0; offset < toInsert.length; offset += chunkSize) {
    const chunk = toInsert.slice(offset, offset + chunkSize);
    try {
      const insRows = await insertPoChunk(chunk);
      inserted += insRows.length;
      activeInserted += chunk.filter((row) => row.status !== 'cancelled').length;
      const first = insRows[0]?.id;
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
          const ins = await insertOnePoRow(rowPayload);
          if (ins?.id) {
            inserted += 1;
            if (rowPayload.status !== 'cancelled') activeInserted += 1;
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
    const runUpdate = async (payload: Record<string, unknown>) => {
      const { data: upd, error: updErr } = await supabaseAdmin
        .from('purchase_orders')
        .update(payload)
        .eq('company_id', companyId)
        .eq('id', item.id)
        .select('id')
        .single();
      if (updErr) throw updErr;
      return upd;
    };

    try {
      let upd: { id?: unknown } | null;
      try {
        upd = await runUpdate(item.payload);
      } catch (err) {
        if (!isMissingColumnError(err)) throw err;
        let payload = { ...item.payload };
        if ('source_row' in payload) {
          delete payload.source_row;
          try {
            upd = await runUpdate(payload);
          } catch (err2) {
            if (!isMissingColumnError(err2) || !('status' in payload)) throw err2;
            delete payload.status;
            upd = await runUpdate(payload);
          }
        } else if ('status' in payload) {
          delete payload.status;
          upd = await runUpdate(payload);
        } else {
          throw err;
        }
      }
      updated += 1;
      if (item.payload.status !== 'cancelled') activeUpdated += 1;
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
    const sample = failures[0] ?? 'unknown database error';
    throw new AppError(`All PO rows failed to save. Check data types and constraints. Example: ${sample}`, 400, {
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

  const countQuery = supabaseAdmin
    .from('purchase_orders')
    .select('id, po, po_number, status', { count: 'exact' })
    .eq('company_id', companyId);
  const { data: allStatusRows } = await countQuery;
  const poKey = (r: { id: unknown; po?: unknown; po_number?: unknown }) =>
    String(r.po ?? r.po_number ?? r.id).trim() || String(r.id);
  const totalActivePos = new Set((allStatusRows ?? []).filter((r) => r.status !== 'cancelled').map(poKey)).size;
  const totalCancelledPos = new Set((allStatusRows ?? []).filter((r) => r.status === 'cancelled').map(poKey)).size;

  return {
    totalRows: rows.length,
    inserted,
    updated,
    failed,
    activeInserted,
    activeUpdated,
    explicitCancelled,
    dashRows,
    totalActivePos,
    totalCancelledPos,
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
