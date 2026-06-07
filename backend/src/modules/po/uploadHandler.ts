import { randomUUID } from 'crypto';
import type { Request } from 'express';
import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';
import { appEmailSubject } from '../../config/appMeta';
import { recordTrackedAction } from '../auditLogs/trackedAction';
import { getAdminUserIds } from '../notifications/service';
import { isDeptManagerRole, type UserRole } from '../auth/types';
import { calcRemainingAmount, type ParsedLineItemRow } from './service';
import { OPTIONAL_HEADER_TO_COLUMN } from './lineItemMap';
import { expandPoLineLookupKeys, rowMatchesPoLineKey } from './poLineIdentity';
import { logPoUpload } from './uploadLog';
import {
  isMissingColumnError,
  isPostgrestError,
  postgrestErrorMessage,
  throwSupabaseError,
} from '../../utils/supabaseError';

const MISSING_FROM_UPLOAD_REASON = 'Missing from latest procurement upload';
const EXPLICIT_CANCEL_REASON = 'PO Cancelled in upload file';

/** Columns we may send to `purchase_orders` (avoids PGRST204 when prod DB lags migrations). */
const PO_INSERT_COLUMNS = new Set<string>([
  'company_id',
  'po',
  'po_line_sn',
  'line_no',
  'sn',
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
  'is_active',
  'cancelled_at',
  'cancellation_reason',
  'upload_batch_id',
  'uploaded_at',
  'last_seen_upload_id',
  'last_seen_at',
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

const UPSERT_CONCURRENCY = 20;
const CANCEL_CHUNK = 200;
const LOOKUP_CHUNK = 200;

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function roundMoney(value: number, scale: number): number {
  const factor = 10 ** scale;
  return Math.round(value * factor) / factor;
}

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

function isDuplicateKeyError(err: unknown): boolean {
  return isPostgrestError(err) && err.code === '23505';
}

export function lineItemToPayload(
  row: ParsedLineItemRow,
  existing: Record<string, unknown> | null,
  actorUserId: string,
  options: {
    enforceUploaderDepartment: string | null;
    companyId: string;
    uploadBatchId: string;
    uploadedAt: string;
  },
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

  const isCancelled = row.is_cancelled;
  const now = options.uploadedAt;

  const base: Record<string, unknown> = {
    ...rest,
    company_id: options.companyId,
    po: row.po,
    po_line_sn: row.po_line_key,
    line_no: row.line_no || null,
    sn: row.sn || null,
    item_code: row.item_code || null,
    description: row.description || null,
    unit_price: row.unit_price,
    po_amount,
    po_invoiced,
    po_acceptance_approved,
    pending_to_apply,
    status: isCancelled ? 'cancelled' : 'active',
    is_active: !isCancelled,
    cancelled_at: isCancelled ? now : null,
    cancellation_reason: isCancelled ? EXPLICIT_CANCEL_REASON : null,
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
    upload_batch_id: options.uploadBatchId,
    uploaded_at: existing?.uploaded_at ?? now,
    last_seen_upload_id: options.uploadBatchId,
    last_seen_at: now,
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

const OPTIONAL_STRIP_LADDER: readonly (readonly string[])[] = [
  [],
  ['source_row'],
  ['source_row', 'status'],
  ['source_row', 'status', 'is_active', 'cancelled_at', 'cancellation_reason'],
  [
    'source_row',
    'status',
    'is_active',
    'cancelled_at',
    'cancellation_reason',
    'upload_batch_id',
    'uploaded_at',
    'last_seen_upload_id',
    'last_seen_at',
    'sn',
  ],
];

function payloadVariants(payload: Record<string, unknown>): Record<string, unknown>[] {
  const base = pickPoRowPayload(payload);
  return OPTIONAL_STRIP_LADDER.map((cols) =>
    cols.length === 0 ? base : stripPayloadColumns(base, [...cols]),
  );
}

async function upsertOnePoRow(payload: Record<string, unknown>): Promise<string | null> {
  let lastErr: unknown;
  for (const row of payloadVariants(payload)) {
    const { data, error } = await supabaseAdmin
      .from('purchase_orders')
      .upsert(row, { onConflict: 'company_id,po_line_sn' })
      .select('id')
      .single();
    if (!error) return (data?.id as string | undefined) ?? null;
    lastErr = error;
    if (!isMissingColumnError(error)) break;
  }
  throw lastErr;
}

async function updatePoRowById(
  companyId: string,
  id: string,
  payload: Record<string, unknown>,
): Promise<void> {
  let lastErr: unknown;
  for (const row of payloadVariants(payload)) {
    const { error } = await supabaseAdmin
      .from('purchase_orders')
      .update(row)
      .eq('company_id', companyId)
      .eq('id', id);
    if (!error) return;
    lastErr = error;
    if (!isMissingColumnError(error)) break;
  }
  throw lastErr;
}

async function fetchExistingByLineKeys(
  companyId: string,
  canonicalKeys: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  const lookupKeys = [...new Set(canonicalKeys.flatMap((k) => expandPoLineLookupKeys(k)))];
  const fetchedRows: Record<string, unknown>[] = [];

  for (let i = 0; i < lookupKeys.length; i += LOOKUP_CHUNK) {
    const chunk = lookupKeys.slice(i, i + LOOKUP_CHUNK);
    const { data, error } = await supabaseAdmin
      .from('purchase_orders')
      .select('*')
      .eq('company_id', companyId)
      .in('po_line_sn', chunk);
    if (error) throwSupabaseError(error);
    fetchedRows.push(...((data ?? []) as Record<string, unknown>[]));
  }

  for (const key of canonicalKeys) {
    const match = fetchedRows.find((row) => rowMatchesPoLineKey(row, key));
    if (match) map.set(key, match);
  }

  return map;
}

async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length || 1) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
}

export type LineItemUploadResult = {
  uploadBatchId: string;
  totalRows: number;
  totalRowsInFile: number;
  uniqueRowsProcessed: number;
  duplicateRowsSkipped: number;
  inserted: number;
  updated: number;
  reactivated: number;
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
};

export async function handleLineItemUpload(params: {
  rows: ParsedLineItemRow[];
  actorUserId: string;
  actorRole: UserRole;
  actorDepartment: string | null;
  companyId: string;
  uploadBatchId?: string;
  totalRowsInFile?: number;
  duplicateRowsSkipped?: number;
  req?: Request;
}): Promise<LineItemUploadResult> {
  const { rows, actorUserId, actorRole, actorDepartment, companyId, req } = params;
  const enforceDept = isDeptManagerRole(actorRole) ? actorDepartment : null;
  const uploadBatchId = params.uploadBatchId ?? randomUUID();
  const uploadedAt = new Date().toISOString();
  const totalRowsInFile = params.totalRowsInFile ?? rows.length;
  const duplicateRowsSkipped = params.duplicateRowsSkipped ?? 0;

  const explicitCancelledPoSet = new Set(rows.filter((r) => r.is_cancelled).map((r) => r.po).filter(Boolean));
  const explicitCancelled = explicitCancelledPoSet.size;
  const dashRows = rows.filter((r) => r.dash_fields.length > 0).length;

  if (req) {
    logPoUpload(req, 'po_upload_started', {
      rowCount: rows.length,
      totalRowsInFile,
      duplicateRowsSkipped,
      uploadBatchId,
      companyId,
    });
  }

  const lineKeys = rows.map((r) => r.po_line_key);
  const existingByKey = await fetchExistingByLineKeys(companyId, lineKeys);

  let inserted = 0;
  let updated = 0;
  let reactivated = 0;
  let failed = 0;
  let activeInserted = 0;
  let activeUpdated = 0;
  let firstEntityId: string | null = null;
  const failures: string[] = [];

  type UpsertJob = {
    row: ParsedLineItemRow;
    index: number;
    payload: Record<string, unknown>;
    existing: Record<string, unknown> | null;
  };

  const jobs: UpsertJob[] = rows.map((row, index) => {
    const effectiveRow =
      explicitCancelledPoSet.has(row.po) && !row.is_cancelled ? { ...row, is_cancelled: true } : row;
    const existing = existingByKey.get(row.po_line_key) ?? null;
    const payload = pickPoRowPayload(
      lineItemToPayload(effectiveRow, existing, actorUserId, {
        enforceUploaderDepartment: enforceDept,
        companyId,
        uploadBatchId,
        uploadedAt,
      }),
    );
    return { row: effectiveRow, index, payload, existing };
  });

  type UpsertOutcome =
    | { kind: 'inserted'; isActive: boolean; entityId?: string }
    | { kind: 'updated'; isActive: boolean; entityId?: string }
    | { kind: 'reactivated'; entityId?: string }
    | { kind: 'failed'; message: string };

  const outcomes: UpsertOutcome[] = [];

  if (req) {
    logPoUpload(req, 'po_upsert_start', { count: jobs.length, uploadBatchId });
  }

  await runPool(jobs, UPSERT_CONCURRENCY, async (job) => {
    const label = job.row.po_line_key;
    const wasCancelled =
      job.existing?.status === 'cancelled' || job.existing?.is_active === false;
    const isActive = job.payload.status === 'active';

    try {
      if (job.existing?.id) {
        const retryPayload = {
          ...job.payload,
          uploaded_at: job.existing.uploaded_at ?? job.payload.uploaded_at,
        };
        await updatePoRowById(companyId, job.existing.id as string, retryPayload);
        if (wasCancelled && isActive) {
          outcomes.push({ kind: 'reactivated', entityId: job.existing.id as string });
          if (req) logPoUpload(req, 'po_reactivated', { key: label, uploadBatchId });
        } else {
          outcomes.push({ kind: 'updated', isActive, entityId: job.existing.id as string });
          if (req) logPoUpload(req, 'po_updated', { key: label, uploadBatchId });
        }
        return;
      }

      const newId = await upsertOnePoRow(job.payload);
      outcomes.push({ kind: 'inserted', isActive, entityId: newId ?? undefined });
      if (req) logPoUpload(req, 'po_inserted', { key: label, uploadBatchId });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        if (req) logPoUpload(req, 'duplicate_detected', { key: label, uploadBatchId });
        try {
          const { data: found, error: findErr } = await supabaseAdmin
            .from('purchase_orders')
            .select('id, status, is_active, uploaded_at, po_line_sn, po, line_no, sn')
            .eq('company_id', companyId)
            .in('po_line_sn', expandPoLineLookupKeys(job.row.po_line_key));
          if (findErr) throw findErr;
          const match = (found ?? []).find((row) => rowMatchesPoLineKey(row, job.row.po_line_key));
          if (match?.id) {
            const retryPayload = {
              ...job.payload,
              uploaded_at: match.uploaded_at ?? job.payload.uploaded_at,
            };
            await updatePoRowById(companyId, match.id as string, retryPayload);
            const retryWasCancelled = match.status === 'cancelled' || match.is_active === false;
            if (retryWasCancelled && job.payload.status === 'active') {
              outcomes.push({ kind: 'reactivated', entityId: match.id as string });
              if (req) logPoUpload(req, 'po_reactivated', { key: label, uploadBatchId });
            } else {
              outcomes.push({
                kind: 'updated',
                isActive: job.payload.status === 'active',
                entityId: match.id as string,
              });
              if (req) logPoUpload(req, 'po_updated', { key: label, uploadBatchId });
            }
            return;
          }
        } catch (retryErr) {
          outcomes.push({ kind: 'failed', message: `row ${job.index + 2} (${label}): ${supabaseErrMessage(retryErr)}` });
          return;
        }
      }
      outcomes.push({ kind: 'failed', message: `row ${job.index + 2} (${label}): ${supabaseErrMessage(err)}` });
    }
  });

  for (const outcome of outcomes) {
    if (outcome.kind === 'inserted') {
      inserted += 1;
      if (outcome.isActive) activeInserted += 1;
      if (outcome.entityId && !firstEntityId) firstEntityId = outcome.entityId;
    } else if (outcome.kind === 'updated') {
      updated += 1;
      if (outcome.isActive) activeUpdated += 1;
    } else if (outcome.kind === 'reactivated') {
      updated += 1;
      reactivated += 1;
      activeUpdated += 1;
      if (outcome.entityId && !firstEntityId) firstEntityId = outcome.entityId;
    } else if (outcome.kind === 'failed') {
      failed += 1;
      failures.push(outcome.message);
    }
    if (outcome.kind === 'updated' && outcome.entityId && !firstEntityId) {
      firstEntityId = outcome.entityId;
    }
  }

  if (req) {
    logPoUpload(req, 'po_upsert_complete', {
      inserted,
      updated,
      reactivated,
      failed,
      uploadBatchId,
    });
  }

  if (inserted === 0 && updated === 0 && failed === rows.length && rows.length > 0) {
    const sample = failures[0] ?? 'unknown database error';
    throw new AppError(`All PO rows failed to save. Check data types and constraints. Example: ${sample}`, 400, {
      failures: failures.slice(0, 10),
    });
  }

  const activeKeysInFile = new Set(
    rows.filter((r) => !r.is_cancelled && !explicitCancelledPoSet.has(r.po)).map((r) => r.po_line_key),
  );

  let cancelled = 0;
  const cancelledPos: string[] = [];
  const cancelledAt = uploadedAt;

  try {
    let cancelQuery = supabaseAdmin
      .from('purchase_orders')
      .select('id, po_line_sn, po, status')
      .eq('company_id', companyId)
      .not('status', 'eq', 'cancelled');
    if (enforceDept) cancelQuery = cancelQuery.eq('department', enforceDept);

    const { data: activeDbRows, error: fetchErr } = await cancelQuery;
    if (!fetchErr && activeDbRows) {
      const toCancel = (activeDbRows as { id: string; po_line_sn: string | null; po: string | null }[]).filter(
        (r) => {
          const key = r.po_line_sn ?? '';
          return key && !activeKeysInFile.has(key);
        },
      );

      for (let i = 0; i < toCancel.length; i += CANCEL_CHUNK) {
        const chunk = toCancel.slice(i, i + CANCEL_CHUNK);
        const ids = chunk.map((r) => r.id);
        const cancelPayloadVariants = [
          {
            status: 'cancelled',
            is_active: false,
            cancelled_at: cancelledAt,
            cancellation_reason: MISSING_FROM_UPLOAD_REASON,
            updated_by: actorUserId,
          },
          {
            status: 'cancelled',
            updated_by: actorUserId,
          },
        ];

        let cancelOk = false;
        for (const cancelPayload of cancelPayloadVariants) {
          const { data: cancelledRows, error: cancelErr } = await supabaseAdmin
            .from('purchase_orders')
            .update(cancelPayload)
            .eq('company_id', companyId)
            .in('id', ids)
            .select('id, po');
          if (!cancelErr) {
            cancelled += cancelledRows?.length ?? 0;
            for (const row of cancelledRows ?? []) {
              const poNum = String(row.po ?? '').trim();
              if (poNum && !cancelledPos.includes(poNum)) cancelledPos.push(poNum);
            }
            for (const row of chunk) {
              if (req) {
                logPoUpload(req, 'po_marked_cancelled', {
                  key: row.po_line_sn,
                  reason: MISSING_FROM_UPLOAD_REASON,
                  uploadBatchId,
                });
              }
            }
            cancelOk = true;
            break;
          }
          if (!isMissingColumnError(cancelErr)) {
            if (req) logPoUpload(req, 'cancel_chunk_error', { error: cancelErr.message });
            break;
          }
        }
        if (!cancelOk && req) {
          logPoUpload(req, 'cancel_chunk_error', { chunkSize: chunk.length });
        }
      }
    }
    if (req) logPoUpload(req, 'cancel_complete', { cancelled, cancelledPos, uploadBatchId });
  } catch (cancelErr) {
    if (req) {
      logPoUpload(req, 'cancel_failed', {
        error: cancelErr instanceof Error ? cancelErr.message : String(cancelErr),
      });
    }
  }

  const { data: allStatusRows } = await supabaseAdmin
    .from('purchase_orders')
    .select('id, po, po_number, status')
    .eq('company_id', companyId);
  const poKey = (r: { id: unknown; po?: unknown; po_number?: unknown }) =>
    String(r.po ?? r.po_number ?? r.id).trim() || String(r.id);
  const totalActivePos = new Set((allStatusRows ?? []).filter((r) => r.status !== 'cancelled').map(poKey)).size;
  const totalCancelledPos = new Set((allStatusRows ?? []).filter((r) => r.status === 'cancelled').map(poKey)).size;

  if (req) {
    logPoUpload(req, 'po_upload_completed', {
      uploadBatchId,
      inserted,
      updated,
      reactivated,
      cancelled,
      failed,
      duplicateRowsSkipped,
    });
  }

  if (duplicateRowsSkipped > 0 && req) {
    logPoUpload(req, 'duplicate_skipped', { count: duplicateRowsSkipped, uploadBatchId });
  }

  return {
    uploadBatchId,
    totalRows: rows.length,
    totalRowsInFile,
    uniqueRowsProcessed: rows.length,
    duplicateRowsSkipped,
    inserted,
    updated,
    reactivated,
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
