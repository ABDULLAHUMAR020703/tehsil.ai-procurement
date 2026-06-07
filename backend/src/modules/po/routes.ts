import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { loadEmployeeVisibleProjectIds } from '../projects/projectAccess';
import { searchPoLinesForProject } from './searchLines';
import { groupPurchaseOrdersByPo, type PurchaseOrderDbRow } from './groupByPo';
import { parsePoUploadFile } from './service';
import { handleLineItemUpload, runPoUploadSideEffects } from './uploadHandler';
import { logPoUpload } from './uploadLog';
import { appEmailSubject } from '../../config/appMeta';
import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';
import { recordTrackedAction } from '../auditLogs/trackedAction';
import { getAdminUserIds } from '../notifications/service';
import { attachLastUpdatedFields } from '../auditLogs/lastUpdated';
import { getLastTransactionForPO } from './lastTransaction';
import { getBatchLastTransactionForPOs } from './batchLastTransaction';
import { fetchActivePurchaseOrderLines } from './fetchPoLines';
import { bypassesDepartmentScope, isDeptManagerRole, type UserRole } from '../auth/types';
import { requirePermission } from '../../middleware/permissions';
import { companyScopeForRequest } from '../../tenant/requestCompanyId';

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

poRouter.post('/upload', requireRole('admin', 'platform_admin', 'pm', 'dept_head'), (req, res, next) => {
  upload.single('file')(req, res, (multerErr) => {
    if (multerErr) return next(multerErr);
    void handlePoUpload(req, res, next);
  });
});

async function handlePoUpload(
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
) {
  try {
    const actorUserId = req.auth!.userId;
    const actorRole = req.auth!.role;
    const actorDepartment = req.auth!.department ?? null;
    const cid = companyScopeForRequest(req);

    logPoUpload(req, 'request_start', {
      companyId: cid,
      userId: actorUserId,
      role: actorRole,
      headers: {
        contentType: req.headers['content-type'],
        contentLength: req.headers['content-length'],
        origin: req.headers.origin,
        userAgent: req.headers['user-agent'],
      },
      hasFile: Boolean(req.file),
      fileBytes: req.file?.size,
      fileName: req.file?.originalname,
      mimeType: req.file?.mimetype,
    });

    if (!req.file) throw new AppError('Missing `file` upload field', 400);

    let parsed;
    try {
      parsed = parsePoUploadFile({
        fileBuffer: req.file.buffer,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
      });
      logPoUpload(req, 'parse_ok', { mode: parsed.mode, rowCount: parsed.rows.length });
    } catch (parseErr) {
      logPoUpload(req, 'parse_failed', {
        error: parseErr instanceof Error ? parseErr.message : String(parseErr),
        stack: parseErr instanceof Error ? parseErr.stack : undefined,
      });
      throw parseErr;
    }

    if (parsed.mode === 'line_items') {
      if (isDeptManagerRole(actorRole) && !actorDepartment) {
        throw new AppError('Profile must include a department for PO upload', 400);
      }

      const result = await handleLineItemUpload({
        rows: parsed.rows,
        actorUserId,
        actorRole,
        actorDepartment,
        companyId: cid,
        req,
      });

      const { warnings } = await runPoUploadSideEffects({
        req,
        companyId: cid,
        actorUserId,
        actorRole,
        actorDepartment,
        result,
      });

      return res.json({
        ok: true,
        mode: 'line_items',
        totalRows: result.totalRows,
        inserted: result.inserted,
        updated: result.updated,
        failed: result.failed,
        activeInserted: result.activeInserted,
        activeUpdated: result.activeUpdated,
        explicitCancelled: result.explicitCancelled,
        dashRows: result.dashRows,
        cancelled: result.cancelled,
        missingCancelled: result.cancelledPos.length,
        totalActivePos: result.totalActivePos,
        totalCancelledPos: result.totalCancelledPos,
        cancelledPos: result.cancelledPos.length > 0 ? result.cancelledPos : undefined,
        cancelledAt: result.cancelledPos.length > 0 ? result.cancelledAt : undefined,
        failures: result.failures,
        warnings: warnings.length > 0 ? warnings : undefined,
      });
    }

    if (!bypassesDepartmentScope(actorRole)) {
      throw new AppError('Only admins may use legacy vendor/total_value CSV layout.', 403);
    }

    const rows = parsed.rows;
    if (rows.length === 0) throw new AppError('No valid PO rows found', 400);

    const aggregatedByVendor = new Map<
      string,
      {
        vendorDisplay: string;
        po_number: string;
        total_value: number;
        rowCount: number;
        is_cancelled: boolean;
        dash_fields: string[];
        source_rows: Record<string, unknown>[];
      }
    >();
    for (const r of rows) {
      const key = normalizeVendor(r.vendor);
      const prev = aggregatedByVendor.get(key);
      if (prev) {
        prev.total_value += Number(r.total_value ?? 0);
        prev.po_number = r.po_number;
        prev.rowCount += 1;
        prev.is_cancelled = prev.is_cancelled || r.is_cancelled;
        prev.dash_fields.push(...r.dash_fields);
        prev.source_rows.push(r.source_row);
      } else {
        aggregatedByVendor.set(key, {
          vendorDisplay: r.vendor.trim(),
          po_number: r.po_number,
          total_value: Number(r.total_value ?? 0),
          rowCount: 1,
          is_cancelled: r.is_cancelled,
          dash_fields: [...r.dash_fields],
          source_rows: [r.source_row],
        });
      }
    }

    const duplicateRowsMerged = rows.length - aggregatedByVendor.size;

    const { data: existingRows, error: existingErr } = await supabaseAdmin
      .from('purchase_orders')
      .select('id, vendor, po_number, total_value, remaining_value')
      .eq('company_id', cid);
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
            total_value: Math.max(0, Number(existing.total_value) + Number(item.total_value)),
            remaining_value: Math.max(0, Number(existing.remaining_value) + Number(item.total_value)),
            po_number: item.po_number,
            vendor: item.vendorDisplay,
            status: item.is_cancelled ? 'cancelled' : 'active',
            source_row: { rows: item.source_rows, _dash_fields: item.dash_fields, _explicit_cancelled: item.is_cancelled },
            uploaded_by: actorUserId,
            updated_by: actorUserId,
          })
          .eq('company_id', cid)
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
            total_value: Math.max(0, item.total_value),
            remaining_value: Math.max(0, item.total_value),
            status: item.is_cancelled ? 'cancelled' : 'active',
            source_row: { rows: item.source_rows, _dash_fields: item.dash_fields, _explicit_cancelled: item.is_cancelled },
            uploaded_by: actorUserId,
            updated_by: actorUserId,
            company_id: cid,
          })
          .select('id')
          .single();
        if (insErr) throw insErr;
        added += 1;
        if (ins?.id) touchedIds.push(ins.id);
      }
    }

    if (touchedIds.length === 0) throw new AppError('PO upload produced no changes', 500);

    const legacyWarnings: string[] = [];
    try {
      const adminIds = await getAdminUserIds(cid);
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
          companyId: cid,
        },
        touch: { table: 'purchase_orders', id: touchedIds[0], companyId: cid },
        notify: adminIds.map((id) => ({
          userId: id,
          type: 'po_upload_legacy',
          message: legacyMsg,
          emailSubject: appEmailSubject('PO upload'),
        })),
      });
    } catch (sideErr) {
      const msg = sideErr instanceof Error ? sideErr.message : String(sideErr);
      legacyWarnings.push(`PO rows saved, but audit/notification step failed: ${msg}`);
      logPoUpload(req, 'side_effects_failed', { error: msg, mode: 'legacy_vendor' });
    }

    res.json({
      ok: true,
      mode: 'legacy_vendor',
      totalRows: rows.length,
      inserted: added,
      updated,
      failed: 0,
      skipped: duplicateRowsMerged,
      duplicatesHandled: duplicateVendorsHandled,
      warnings: legacyWarnings.length > 0 ? legacyWarnings : undefined,
    });
  } catch (err) {
    next(err);
  }
}

poRouter.get('/search', requireRole('admin', 'platform_admin', 'pm', 'dept_head', 'employee'), async (req, res, next) => {
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
      auth: {
        userId: req.auth!.userId,
        role: req.auth!.role,
        companyId: companyScopeForRequest(req),
      },
    });
    res.json({ lines });
  } catch (err) {
    next(err);
  }
});

poRouter.get('/', requireRole('admin', 'platform_admin', 'pm', 'dept_head', 'employee'), async (req, res, next) => {
  try {
    const actorRole = req.auth!.role;
  const actorUserId = req.auth!.userId;
  const actorDepartment = req.auth!.department ?? null;
  const cid = companyScopeForRequest(req);

  let scopeOr: string | undefined;
  if (!bypassesDepartmentScope(actorRole)) {
    let fromProjects: string[] = [];
    if (actorDepartment) {
      if (actorRole === 'employee') {
        const visible = await loadEmployeeVisibleProjectIds({
          userId: actorUserId,
          department: actorDepartment,
          companyId: cid,
        });
        if (visible.length > 0) {
          const { data: projs, error: pErr } = await supabaseAdmin
            .from('projects')
            .select('po_id')
            .eq('company_id', cid)
            .in('id', visible)
            .not('po_id', 'is', null);
          if (pErr) throw pErr;
          fromProjects = [...new Set((projs ?? []).map((p) => p.po_id as string).filter(Boolean))];
        }
      } else {
        const { data: projs, error: pErr } = await supabaseAdmin
          .from('projects')
          .select('po_id')
          .eq('company_id', cid)
          .eq('department_id', actorDepartment)
          .not('po_id', 'is', null);
        if (pErr) throw pErr;
        fromProjects = [...new Set((projs ?? []).map((p) => p.po_id as string).filter(Boolean))];
      }
    }
    const orParts = [`uploaded_by.eq.${actorUserId}`];
    if (actorDepartment) orParts.push(`department.eq.${actorDepartment}`);
    if (fromProjects.length) {
      const safeUUIDs = fromProjects.filter(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id));
      if (safeUUIDs.length) orParts.push(`id.in.(${safeUUIDs.join(',')})`);
    }
    scopeOr = orParts.join(',');
  }

  const rows = await fetchActivePurchaseOrderLines(cid, { scope: scopeOr ? { or: scopeOr } : undefined });
  const enrichedRows = await attachLastUpdatedFields('purchase_order', rows, cid);
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

  const anchorIds = withGroupLastUpdated.map(g => g.anchor_po_line_id);
  const bundleMap = await getBatchLastTransactionForPOs(anchorIds, cid);
  
  const withLastTx = withGroupLastUpdated.map(g => {
    const bundle = bundleMap.get(g.anchor_po_line_id);
    return {
      ...g,
      po_last_transaction: bundle ?? {
        po_id: g.anchor_po_line_id,
        po_number: g.po,
        last_transaction: null,
      },
    };
  });

  withLastTx.sort((a, b) => {
    const ta = a.po_last_transaction.last_transaction?.timestamp ?? '';
    const tb = b.po_last_transaction.last_transaction?.timestamp ?? '';
    if (tb !== ta) return tb.localeCompare(ta);
    return String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? ''));
  });

    res.json({ purchaseOrders: withLastTx });
  } catch (err) {
    next(err);
  }
});
