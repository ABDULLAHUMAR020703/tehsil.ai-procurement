import { supabaseAdmin } from '../../config/supabase';
import { normalizeItemCode } from '../../utils/itemCode';

const TTL_MS = 60_000;
const cache = new Map<string, { exp: number; data: unknown }>();

function cacheGet<T>(key: string): T | undefined {
  const e = cache.get(key);
  if (!e || e.exp < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return e.data as T;
}

function cacheSet(key: string, data: unknown) {
  cache.set(key, { exp: Date.now() + TTL_MS, data });
}

export const REMAINING_AMOUNT_TOOLTIP =
  'Remaining = PO Amount − Invoiced − Acceptance Approved − Pending to apply (per PO line).';

export type PoLineSnapshot = {
  id: string;
  po: string | null;
  po_line_sn: string | null;
  item_code: string | null;
  description: string | null;
  unit_price: number;
  remaining_amount: number;
  po_amount: number;
};

const LINE_SELECT = 'id, po, po_line_sn, item_code, description, unit_price, remaining_amount, po_amount';

export type PoAnchor = { id: string; po: string | null; po_line_sn: string | null; item_code: string | null };

export async function fetchPoLineById(id: string, companyId: string): Promise<PoLineSnapshot | null> {
  const key = `id:${companyId}:${id}`;
  const hit = cacheGet<PoLineSnapshot | null>(key);
  if (hit !== undefined) return hit;
  const { data, error } = await supabaseAdmin
    .from('purchase_orders')
    .select(LINE_SELECT)
    .eq('id', id)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) throw error;
  const row = (data as PoLineSnapshot | null) ?? null;
  cacheSet(key, row);
  return row;
}

export async function sumPendingAmountOnPoLine(params: {
  poLineId: string;
  excludePurchaseRequestId?: string;
  companyId: string;
}): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('purchase_requests')
    .select('id, amount')
    .eq('company_id', params.companyId)
    .eq('po_line_id', params.poLineId)
    .in('status', ['pending', 'pending_exception']);
  if (error) throw error;
  let sum = 0;
  for (const r of data ?? []) {
    const id = (r as { id: string }).id;
    if (params.excludePurchaseRequestId && id === params.excludePurchaseRequestId) continue;
    sum += Number((r as { amount: number }).amount);
  }
  return sum;
}

/** Sum of pending PR amounts per PO line id (batch). */
export async function sumPendingAmountsByPoLineIds(
  poLineIds: string[],
  companyId: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (poLineIds.length === 0) return map;
  const unique = [...new Set(poLineIds)];
  const { data, error } = await supabaseAdmin
    .from('purchase_requests')
    .select('po_line_id, amount')
    .eq('company_id', companyId)
    .in('po_line_id', unique)
    .in('status', ['pending', 'pending_exception']);
  if (error) throw error;
  for (const r of data ?? []) {
    const id = (r as { po_line_id: string }).po_line_id;
    const amt = Number((r as { amount: number }).amount);
    map.set(id, (map.get(id) ?? 0) + amt);
  }
  return map;
}

export function poLineMatchesProjectAnchor(
  row: { id: string; po: string | null },
  anchor: PoAnchor,
  projectPoId: string,
): boolean {
  if (row.id === anchor.id) return true;
  const aPo = anchor.po?.trim() || null;
  const rPo = row.po?.trim() || null;
  if (aPo && rPo) return aPo === rPo;
  return row.id === projectPoId;
}

export async function resolvePoLineForProject(params: {
  anchor: PoAnchor;
  itemCodeNorm: string | null;
  poLineSnRaw: string | null | undefined;
  companyId: string;
}): Promise<PoLineSnapshot | null> {
  const { companyId } = params;
  const sn = params.poLineSnRaw?.trim() || null;
  if (sn) {
    const key = `sn:${companyId}:${sn}`;
    let row = cacheGet<PoLineSnapshot | null>(key);
    if (row === undefined) {
      const { data, error } = await supabaseAdmin
        .from('purchase_orders')
        .select(LINE_SELECT)
        .eq('company_id', companyId)
        .eq('po_line_sn', sn)
        .maybeSingle();
      if (error) throw error;
      row = (data as PoLineSnapshot | null) ?? null;
      cacheSet(key, row);
    }
    if (!row) return null;
    const aPo = params.anchor.po?.trim() || null;
    const rPo = row.po?.trim() || null;
    if (aPo && rPo && aPo !== rPo) return null;
    if (!aPo && !rPo && row.id !== params.anchor.id) return null;
    return row;
  }

  const inc = params.itemCodeNorm;
  if (!inc) return null;

  const poText = params.anchor.po?.trim() || null;
  if (poText) {
    const key = `po:${companyId}:${poText}:item:${inc}`;
    let row = cacheGet<PoLineSnapshot | null>(key);
    if (row === undefined) {
      const { data: rows, error } = await supabaseAdmin
        .from('purchase_orders')
        .select(LINE_SELECT)
        .eq('company_id', companyId)
        .eq('po', poText);
      if (error) throw error;
      const found =
        (rows ?? []).find((r: { item_code?: string | null }) => normalizeItemCode(r.item_code) === inc) ?? null;
      row = found as PoLineSnapshot | null;
      cacheSet(key, row);
    }
    return row;
  }

  if (normalizeItemCode(params.anchor.item_code) === inc) {
    return fetchPoLineById(params.anchor.id, companyId);
  }
  return null;
}

export type PrPoLineSummary = {
  item_code: string | null;
  pr_description: string;
  line_description: string | null;
  unit_price: number | null;
  requested_quantity: number | null;
  requested_amount: number;
  remaining_amount: number;
  remaining_after_approval: number;
  exceeds_po_limit: boolean;
  po_line_sn: string | null;
  remaining_tooltip: string;
};

export async function buildPrPoLineSummary(
  pr: {
    id: string;
    company_id?: string | null;
    description: string;
    amount: number | string;
    item_code: string | null;
    po_line_id: string | null;
    requested_quantity: number | string | null;
    status: string;
  },
  anchor: PoAnchor | null,
): Promise<PrPoLineSummary | null> {
  if (!anchor) return null;
  const cid = pr.company_id;
  if (!cid) {
    throw new Error('buildPrPoLineSummary requires pr.company_id');
  }
  let line: PoLineSnapshot | null = null;
  if (pr.po_line_id) {
    line = await fetchPoLineById(pr.po_line_id, cid);
  } else {
    line = await resolvePoLineForProject({
      anchor,
      itemCodeNorm: pr.item_code,
      poLineSnRaw: null,
      companyId: cid,
    });
  }
  if (!line) return null;
  const pendingOthers = await sumPendingAmountOnPoLine({
    poLineId: line.id,
    excludePurchaseRequestId: pr.id,
    companyId: cid,
  });
  const lineRem = Number(line.remaining_amount);
  const amount = Number(pr.amount);
  const adjustedRemaining = lineRem - pendingOthers;
  const afterApproval = adjustedRemaining - amount;
  const unitPrice = Number(line.unit_price);
  const reqQtyRaw = pr.requested_quantity != null ? Number(pr.requested_quantity) : NaN;
  const requestedQty =
    Number.isFinite(reqQtyRaw) && reqQtyRaw > 0
      ? reqQtyRaw
      : Number.isFinite(unitPrice) && unitPrice > 0
        ? Math.round((amount / unitPrice) * 10000) / 10000
        : null;

  return {
    item_code: pr.item_code ?? line.item_code ?? null,
    pr_description: pr.description,
    line_description: line.description ?? null,
    unit_price: Number.isFinite(unitPrice) ? unitPrice : null,
    requested_quantity: requestedQty,
    requested_amount: amount,
    remaining_amount: adjustedRemaining,
    remaining_after_approval: afterApproval,
    exceeds_po_limit: afterApproval < 0,
    po_line_sn: line.po_line_sn ?? null,
    remaining_tooltip: REMAINING_AMOUNT_TOOLTIP,
  };
}

export async function loadAnchorsForProjectIds(
  projectIds: string[],
  companyId: string,
): Promise<Map<string, PoAnchor | null>> {
  const unique = [...new Set(projectIds)].filter(Boolean);
  const map = new Map<string, PoAnchor | null>();
  if (unique.length === 0) return map;
  const { data: projects, error } = await supabaseAdmin
    .from('projects')
    .select('id, po_id')
    .eq('company_id', companyId)
    .in('id', unique);
  if (error) throw error;
  const poIds = [...new Set((projects ?? []).map((p) => p.po_id as string | null).filter(Boolean))] as string[];
  if (poIds.length === 0) {
    for (const p of projects ?? []) map.set(p.id as string, null);
    return map;
  }
  const { data: pos, error: poErr } = await supabaseAdmin
    .from('purchase_orders')
    .select('id, po, po_line_sn, item_code')
    .eq('company_id', companyId)
    .in('id', poIds);
  if (poErr) throw poErr;
  const poById = new Map((pos ?? []).map((r) => [r.id as string, r as PoAnchor]));
  for (const p of projects ?? []) {
    const pid = p.po_id as string | null;
    map.set(p.id as string, pid ? poById.get(pid) ?? null : null);
  }
  return map;
}

export async function enrichPurchaseRequestsWithPoLine(
  prs: Array<{
    id: string;
    company_id?: string | null;
    project_id: string;
    description: string;
    amount: number | string;
    item_code: string | null;
    po_line_id: string | null;
    requested_quantity: number | string | null;
    status: string;
  }>,
  companyId: string,
): Promise<Map<string, PrPoLineSummary | null>> {
  const out = new Map<string, PrPoLineSummary | null>();
  const anchors = await loadAnchorsForProjectIds(
    prs.map((p) => p.project_id),
    companyId,
  );
  await Promise.all(
    prs.map(async (pr) => {
      const anchor = anchors.get(pr.project_id) ?? null;
      const summary = await buildPrPoLineSummary(pr, anchor);
      out.set(pr.id, summary);
    }),
  );
  return out;
}
