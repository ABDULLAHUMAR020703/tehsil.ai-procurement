import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { loadEmployeeVisibleProjectIds } from '../projects/projectAccess';
import { searchPoLinesForProject } from './searchLines';
import { groupPurchaseOrdersByPo, type PurchaseOrderDbRow } from './groupByPo';
import { parsePoUploadFile, calcRemainingAmount, type ParsedLineItemRow } from './service';
import { appEmailSubject } from '../../config/appMeta';
import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';
import { recordTrackedAction } from '../auditLogs/trackedAction';
import { getAdminUserIds } from '../notifications/service';
import { attachLastUpdatedFields } from '../auditLogs/lastUpdated';
import { getLastTransactionForPO } from './lastTransaction';
import { bypassesDepartmentScope, isDeptManagerRole, type UserRole } from '../auth/types';
import { requirePermission } from '../../middleware/permissions';

export const poRouter = Router();

poRouter.use(requireAuth);
poRouter.use(requirePermission('view_pos'));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function normalizeVendor(vendor: string) {
  return vendor.trim().toLowerCase();
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function lineItemToPayload(
  row: ParsedLineItemRow,
  existing: Record<string, unknown> | null,
  actorUserId: string,
  options: { enforceUploaderDepartment: string | null },
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
    po: row.po,
    po_line_sn: row.po_line_sn,
    item_code: row.item_code,
    description: row.description,
    unit_price: row.unit_price,
    po_amount,
    po_invoiced,
    po_acceptance_approved,
    pending_to_apply,
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
    vendor: customerStr || '—',
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

async function handleLineItemUpload(params: {
  rows: ParsedLineItemRow[];
  actorUserId: string;
  actorRole: UserRole;
  actorDepartment: string | null;
}): Promise<{
  totalRows: number;
  inserted: number;
  updated: number;
  failed: number;
  firstEntityId: string | null;
}> {
  const { rows, actorUserId, actorRole, actorDepartment } = params;
  const enforceDept = isDeptManagerRole(actorRole) ? actorDepartment : null;

  let inserted = 0;
  let updated = 0;
  let failed = 0;
  let firstEntityId: string | null = null;

  for (const row of rows) {
    try {
      const { data: existing, error: findErr } = await supabaseAdmin
        .from('purchase_orders')
        .select('*')
        .eq('po_line_sn', row.po_line_sn)
        .maybeSingle();
      if (findErr) throw findErr;

      const payload = lineItemToPayload(row, existing, actorUserId, {
        enforceUploaderDepartment: enforceDept,
      });

      if (existing?.id) {
        const { data: upd, error: updErr } = await supabaseAdmin
          .from('purchase_orders')
          .update(payload)
          .eq('id', existing.id as string)
          .select('id')
          .single();
        if (updErr) throw updErr;
        updated += 1;
        if (upd?.id && !firstEntityId) firstEntityId = upd.id as string;
      } else {
        const { data: ins, error: insErr } = await supabaseAdmin
          .from('purchase_orders')
          .insert(payload)
          .select('id')
          .single();
        if (insErr) throw insErr;
        inserted += 1;
        if (ins?.id && !firstEntityId) firstEntityId = ins.id as string;
      }
    } catch {
      failed += 1;
    }
  }

  if (inserted === 0 && updated === 0 && failed === rows.length) {
    throw new AppError('All PO rows failed to save. Check data types and constraints.', 400);
  }

  return { totalRows: rows.length, inserted, updated, failed, firstEntityId };
}

poRouter.post('/upload', requireRole('admin', 'pm', 'dept_head'), upload.single('file'), async (req, res, next) => {
  try {
    const actorUserId = req.auth!.userId;
    const actorRole = req.auth!.role;
    const actorDepartment = req.auth!.department ?? null;
    if (!req.file) throw new AppError('Missing `file` upload field', 400);

    const parsed = parsePoUploadFile({
      fileBuffer: req.file.buffer,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
    });

    if (parsed.mode === 'line_items') {
      if (isDeptManagerRole(actorRole) && !actorDepartment) {
        throw new AppError('Profile must include a department for PO upload', 400);
      }

      const result = await handleLineItemUpload({
        rows: parsed.rows,
        actorUserId,
        actorRole,
        actorDepartment,
      });

      const { data: actor } = await supabaseAdmin
        .from('users')
        .select('name, email')
        .eq('id', actorUserId)
        .maybeSingle();

      const actorLabel = String(actor?.name ?? actor?.email ?? actorUserId);

      const deptScope = isDeptManagerRole(actorRole) ? actorDepartment : null;
      const adminIds = await getAdminUserIds();
      const uploadSummary = `PO data upload (${result.inserted} inserted, ${result.updated} updated, ${result.failed} failed). Uploaded by ${actorLabel}.`;
      const notifyEntries = adminIds.map((id) => ({
        userId: id,
        type: isDeptManagerRole(actorRole) ? 'pm_po_upload' : 'po_upload',
        message: uploadSummary,
        emailSubject: appEmailSubject('PO data uploaded'),
      }));

      if (result.firstEntityId) {
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
          },
          touch: { table: 'purchase_orders', id: result.firstEntityId },
          notify: notifyEntries,
        });
      }

      return res.json({
        ok: true,
        mode: 'line_items',
        totalRows: result.totalRows,
        inserted: result.inserted,
        updated: result.updated,
        failed: result.failed,
      });
    }

    if (!bypassesDepartmentScope(actorRole)) {
      throw new AppError('Only admins may use legacy vendor/total_value CSV layout.', 403);
    }

    const rows = parsed.rows;
    if (rows.length === 0) throw new AppError('No valid PO rows found', 400);

    const aggregatedByVendor = new Map<string, { vendorDisplay: string; po_number: string; total_value: number; rowCount: number }>();
    for (const r of rows) {
      const key = normalizeVendor(r.vendor);
      const prev = aggregatedByVendor.get(key);
      if (prev) {
        prev.total_value += Number(r.total_value);
        prev.po_number = r.po_number;
        prev.rowCount += 1;
      } else {
        aggregatedByVendor.set(key, {
          vendorDisplay: r.vendor.trim(),
          po_number: r.po_number,
          total_value: Number(r.total_value),
          rowCount: 1,
        });
      }
    }

    const duplicateRowsMerged = rows.length - aggregatedByVendor.size;

    const { data: existingRows, error: existingErr } = await supabaseAdmin
      .from('purchase_orders')
      .select('id, vendor, po_number, total_value, remaining_value');
    if (existingErr) throw existingErr;

    const existingByVendor = new Map<string, { id: string; vendor: string; total_value: number; remaining_value: number }>();
    for (const row of existingRows ?? []) {
      const key = normalizeVendor(String(row.vendor ?? ''));
      if (!key) continue;
      if (!existingByVendor.has(key)) {
        existingByVendor.set(key, {
          id: row.id,
          vendor: row.vendor,
          total_value: Number(row.total_value),
          remaining_value: Number(row.remaining_value),
        });
      }
    }

    let added = 0;
    let updated = 0;
    const touchedIds: string[] = [];
    const duplicateVendorsHandled: string[] = [];

    for (const [vendorKey, item] of aggregatedByVendor.entries()) {
      const existing = existingByVendor.get(vendorKey);
      if (existing) {
        const { data: upd, error: updErr } = await supabaseAdmin
          .from('purchase_orders')
          .update({
            total_value: Number(existing.total_value) + Number(item.total_value),
            remaining_value: Number(existing.remaining_value) + Number(item.total_value),
            po_number: item.po_number,
            vendor: item.vendorDisplay,
            uploaded_by: actorUserId,
            updated_by: actorUserId,
          })
          .eq('id', existing.id)
          .select('id')
          .single();
        if (updErr) throw updErr;
        updated += 1;
        if (upd?.id) touchedIds.push(upd.id);
        duplicateVendorsHandled.push(item.vendorDisplay);
      } else {
        const { data: ins, error: insErr } = await supabaseAdmin
          .from('purchase_orders')
          .insert({
            po_number: item.po_number,
            vendor: item.vendorDisplay,
            total_value: item.total_value,
            remaining_value: item.total_value,
            uploaded_by: actorUserId,
            updated_by: actorUserId,
          })
          .select('id')
          .single();
        if (insErr) throw insErr;
        added += 1;
        if (ins?.id) touchedIds.push(ins.id);
      }
    }

    if (touchedIds.length === 0) throw new AppError('PO upload produced no changes', 500);

    const adminIds = await getAdminUserIds();
    const legacyMsg = `Legacy PO upload (${added} added, ${updated} updated).`;
    await recordTrackedAction({
      audit: {
        action: updated > 0 ? 'updated' : 'created',
        userId: actorUserId,
        entity: 'purchase_order',
        entityType: 'purchase_order',
        entityId: touchedIds[0],
        changes: { inserted: added, updated, mode: 'legacy_vendor' },
        departmentScope: null,
      },
      touch: { table: 'purchase_orders', id: touchedIds[0] },
      notify: adminIds.map((id) => ({
        userId: id,
        type: 'po_upload_legacy',
        message: legacyMsg,
        emailSubject: appEmailSubject('PO upload'),
      })),
    });

    res.json({
      ok: true,
      mode: 'legacy_vendor',
      totalRows: rows.length,
      inserted: added,
      updated,
      failed: 0,
      skipped: duplicateRowsMerged,
      duplicatesHandled: duplicateVendorsHandled,
    });
  } catch (err) {
    next(err);
  }
});

poRouter.get('/search', requireRole('admin', 'pm', 'dept_head', 'employee'), async (req, res, next) => {
  try {
    const projectId = z.string().uuid().parse(req.query.project_id);
    const qRaw = req.query.q;
    const q = typeof qRaw === 'string' ? qRaw : Array.isArray(qRaw) ? String(qRaw[0] ?? '') : '';
    const limitParsed = z.coerce.number().int().min(1).max(50).safeParse(req.query.limit);
    const limit = limitParsed.success ? limitParsed.data : 20;
    const { lines } = await searchPoLinesForProject({
      projectId,
      q,
      limit,
      actorRole: req.auth!.role,
      actorDepartment: req.auth!.department ?? null,
      actorUserId: req.auth!.userId,
    });
    res.json({ lines });
  } catch (err) {
    next(err);
  }
});

poRouter.get('/', requireRole('admin', 'pm', 'dept_head', 'employee'), async (req, res) => {
  const actorRole = req.auth!.role;
  const actorUserId = req.auth!.userId;
  const actorDepartment = req.auth!.department ?? null;

  let q = supabaseAdmin
    .from('purchase_orders')
    .select(
      'id, po_number, vendor, total_value, remaining_value, uploaded_by, created_at, updated_at, updated_by, po, po_line_sn, item_code, description, unit_price, line_no, department, project_name, po_amount, remaining_amount, issue_date, customer',
    )
    .order('created_at', { ascending: false })
    .limit(500);

  if (!bypassesDepartmentScope(actorRole)) {
    let fromProjects: string[] = [];
    if (actorDepartment) {
      if (actorRole === 'employee') {
        const visible = await loadEmployeeVisibleProjectIds({
          userId: actorUserId,
          department: actorDepartment,
        });
        if (visible.length > 0) {
          const { data: projs, error: pErr } = await supabaseAdmin
            .from('projects')
            .select('po_id')
            .in('id', visible)
            .not('po_id', 'is', null);
          if (pErr) throw pErr;
          fromProjects = [...new Set((projs ?? []).map((p) => p.po_id as string).filter(Boolean))];
        }
      } else {
        const { data: projs, error: pErr } = await supabaseAdmin
          .from('projects')
          .select('po_id')
          .eq('department_id', actorDepartment)
          .not('po_id', 'is', null);
        if (pErr) throw pErr;
        fromProjects = [...new Set((projs ?? []).map((p) => p.po_id as string).filter(Boolean))];
      }
    }
    const orParts = [`uploaded_by.eq.${actorUserId}`];
    if (actorDepartment) orParts.push(`department.eq.${actorDepartment}`);
    if (fromProjects.length) orParts.push(`id.in.(${fromProjects.join(',')})`);
    q = q.or(orParts.join(','));
  }

  const { data, error } = await q;
  if (error) throw error;
  const rows = data ?? [];
  const enrichedRows = await attachLastUpdatedFields('purchase_order', rows);
  const purchaseOrders = groupPurchaseOrdersByPo(enrichedRows as unknown as PurchaseOrderDbRow[]);
  const rowMap = new Map(enrichedRows.map((r) => [r.id, r]));

  const withGroupLastUpdated = purchaseOrders.map((g) => {
    let bestAt = '';
    let bestBy: (typeof enrichedRows)[0]['last_updated_by'] = null;
    for (const it of g.items) {
      const row = rowMap.get(it.id);
      if (!row) continue;
      const at = row.last_updated_at ?? '';
      if (at && at > bestAt) {
        bestAt = at;
        bestBy = row.last_updated_by ?? null;
      }
    }
    const fallbackAt = g.updated_at;
    return {
      ...g,
      last_updated_at: bestAt || fallbackAt || null,
      last_updated_by: bestAt ? bestBy : null,
    };
  });

  const withLastTx = await Promise.all(
    withGroupLastUpdated.map(async (g) => {
      const bundle = await getLastTransactionForPO(g.anchor_po_line_id);
      return {
        ...g,
        po_last_transaction: {
          po_id: bundle.po_id,
          po_number: bundle.po_number ?? g.po,
          last_transaction: bundle.last_transaction,
        },
      };
    }),
  );

  withLastTx.sort((a, b) => {
    const ta = a.po_last_transaction.last_transaction?.timestamp ?? '';
    const tb = b.po_last_transaction.last_transaction?.timestamp ?? '';
    if (tb !== ta) return tb.localeCompare(ta);
    return String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? ''));
  });

  res.json({ purchaseOrders: withLastTx });
});
