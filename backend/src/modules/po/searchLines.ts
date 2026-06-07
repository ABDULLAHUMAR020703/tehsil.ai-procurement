import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';
import type { UserRole } from '../auth/types';
import { assertActorMayViewProject, fetchProjectForAccess } from '../projects/projectAccess';
import { sumPendingAmountsByPoLineIds } from '../purchaseRequests/poLineContext';
import type { TenantAuth } from '../../tenant/tenantScope';

export type PoSearchLineDto = {
  po_line_sn: string;
  item_code: string | null;
  description: string | null;
  unit_price: number;
  remaining_amount: number;
  effective_remaining: number;
  po: string | null;
  line_no: string | null;
};

export async function searchPoLinesForProject(params: {
  projectId: string;
  q: string;
  limit: number;
  actorRole: UserRole;
  actorDepartment: string | null;
  actorUserId: string;
  auth: TenantAuth;
}): Promise<{ lines: PoSearchLineDto[] }> {
  const { projectId, q, limit, actorRole, actorDepartment, actorUserId, auth } = params;

  const projectAccess = await fetchProjectForAccess(projectId, auth);
  await assertActorMayViewProject({
    project: projectAccess,
    actorUserId,
    actorRole,
    actorDepartment,
  });

  const companyId = projectAccess.company_id;
  const poId = projectAccess.po_id as string | null;
  if (!poId) {
    return { lines: [] };
  }

  const { data: anchor, error: aErr } = await supabaseAdmin
    .from('purchase_orders')
    .select('id, po')
    .eq('id', poId)
    .eq('company_id', companyId)
    .single();
  if (aErr || !anchor) throw aErr ?? new AppError('Project PO not found', 404);

  const poText = (anchor.po as string | null)?.trim() || null;

  let query = supabaseAdmin
    .from('purchase_orders')
    .select('id, po_line_sn, item_code, description, unit_price, remaining_amount, po, line_no')
    .eq('company_id', companyId)
    .eq('status', 'active')
    .not('po_line_sn', 'is', null);

  if (poText) {
    query = query.eq('po', poText);
  } else {
    query = query.eq('id', poId);
  }

  const { data: rows, error } = await query.limit(500);
  if (error) throw error;

  const list = (rows ?? []).filter((r) => r.po_line_sn);

  const term = q.trim().toLowerCase();
  const filtered = !term
    ? list
    : list.filter((r) => {
        const ic = String(r.item_code ?? '').toLowerCase();
        const desc = String(r.description ?? '').toLowerCase();
        const poNum = String(r.po ?? '').toLowerCase();
        return ic.includes(term) || desc.includes(term) || poNum.includes(term);
      });

  filtered.sort((a, b) => String(a.item_code ?? '').localeCompare(String(b.item_code ?? '')));
  const slice = filtered.slice(0, Math.min(Math.max(limit, 1), 50));

  const ids = slice.map((r) => r.id as string);
  const pendingMap = await sumPendingAmountsByPoLineIds(ids, companyId);

  const lines: PoSearchLineDto[] = slice.map((r) => {
    const rem = Number(r.remaining_amount);
    const pending = pendingMap.get(r.id as string) ?? 0;
    return {
      po_line_sn: r.po_line_sn as string,
      item_code: (r.item_code as string | null) ?? null,
      description: (r.description as string | null) ?? null,
      unit_price: Number(r.unit_price),
      remaining_amount: rem,
      effective_remaining: rem - pending,
      po: (r.po as string | null) ?? null,
      line_no: (r.line_no as string | null) ?? null,
    };
  });

  return { lines };
}
