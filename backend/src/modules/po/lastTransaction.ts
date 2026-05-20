import { supabaseAdmin } from '../../config/supabase';
import type { PurchaseOrderDbRow } from './groupByPo';

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function groupRemainingSum(rows: Pick<PurchaseOrderDbRow, 'po_amount' | 'remaining_amount' | 'total_value' | 'remaining_value'>[]): number {
  let sum = 0;
  for (const r of rows) {
    const pa = num(r.po_amount, NaN);
    const ra = num(r.remaining_amount, NaN);
    const tv = num(r.total_value, 0);
    const rv = num(r.remaining_value, 0);
    const rem = Number.isFinite(ra) ? ra : rv;
    sum += rem;
  }
  return sum;
}

async function resolvePoGroupRows(anchorId: string, scopeCompanyId?: string): Promise<PurchaseOrderDbRow[]> {
  let q = supabaseAdmin.from('purchase_orders').select('*').eq('id', anchorId);
  if (scopeCompanyId) q = q.eq('company_id', scopeCompanyId);
  const { data: anchor, error: aErr } = await q.maybeSingle();
  if (aErr || !anchor) return [];

  const row = anchor as PurchaseOrderDbRow;
  const companyId = row.company_id;
  if (!companyId) return [row];

  const poKey = String(row.po ?? '').trim();
  if (poKey) {
    const { data: sibs, error } = await supabaseAdmin
      .from('purchase_orders')
      .select('*')
      .eq('po', poKey)
      .eq('company_id', companyId);
    if (error) throw error;
    return (sibs ?? []) as PurchaseOrderDbRow[];
  }
  const pn = String(row.po_number ?? '').trim();
  if (pn) {
    const { data: sibs, error } = await supabaseAdmin
      .from('purchase_orders')
      .select('*')
      .eq('po_number', pn)
      .eq('company_id', companyId);
    if (error) throw error;
    return (sibs ?? []) as PurchaseOrderDbRow[];
  }
  return [row];
}

type UserLite = { id: string; name: string | null; email: string | null; role: string | null };

async function loadUsers(ids: string[], companyId: string): Promise<Map<string, UserLite>> {
  const u = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, UserLite>();
  if (u.length === 0) return map;
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, name, email, role')
    .eq('company_id', companyId)
    .in('id', u);
  if (error) throw error;
  for (const r of data ?? []) {
    map.set(r.id as string, {
      id: r.id as string,
      name: (r.name as string | null) ?? null,
      email: (r.email as string | null) ?? null,
      role: (r.role as string | null) ?? null,
    });
  }
  return map;
}

function stageLabel(role: string | null): string | null {
  if (!role) return null;
  if (role === 'team_lead') return 'team_lead';
  if (role === 'pm') return 'pm';
  if (role === 'admin') return 'admin';
  return role;
}

function displayUser(u: UserLite | undefined): { user_id: string; user_name: string; role: string } {
  if (!u) {
    return { user_id: '', user_name: 'System', role: '—' };
  }
  const name = u.name?.trim() || u.email?.trim() || 'System';
  return { user_id: u.id, user_name: name, role: u.role ?? '—' };
}

export type LastTransactionFinancials = {
  previous_budget: number;
  transaction_amount: number;
  current_budget: number;
};

export type LastTransactionPayload = {
  type: string;
  description: string;
  performed_by: { user_id: string; user_name: string; role: string };
  timestamp: string;
  financials: LastTransactionFinancials;
  reference: {
    pr_id: string | null;
    approval_stage: string | null;
    exception_type: string | null;
  };
};

export type PoLastTransactionBundle = {
  po_id: string;
  po_number: string | null;
  last_transaction: LastTransactionPayload | null;
};

type Candidate = {
  ts: string;
  sortKey: number;
  build: () => Omit<LastTransactionPayload, never>;
};

/**
 * Latest activity for a PO group (all line rows sharing `po` or `po_number` with anchor), scoped to
 * PRs on linked projects or PRs targeting a line in the group. Uses PR/approval/exception rows and
 * audit_logs for budget finalization and exception decisions.
 */
export async function getLastTransactionForPO(anchorPoLineId: string, scopeCompanyId?: string): Promise<PoLastTransactionBundle> {
  const groupRows = await resolvePoGroupRows(anchorPoLineId, scopeCompanyId);
  const lineIds = groupRows.map((r) => r.id);
  const currentGroupRemaining = groupRemainingSum(groupRows);

  const anchor = groupRows[0];
  const po_number = (anchor?.po_number as string | null) ?? (String(anchor?.po ?? '').trim() || null);
  const companyId = anchor?.company_id as string | undefined;
  if (!companyId) {
    return { po_id: anchorPoLineId, po_number, last_transaction: null };
  }

  if (lineIds.length === 0) {
    return { po_id: anchorPoLineId, po_number, last_transaction: null };
  }

  const { data: projects, error: pErr } = await supabaseAdmin
    .from('projects')
    .select('id')
    .in('po_id', lineIds)
    .eq('company_id', companyId);
  if (pErr) throw pErr;
  const projectIds = [...new Set((projects ?? []).map((p) => p.id as string))];

  const { data: prByProject, error: pr1Err } =
    projectIds.length > 0
      ? await supabaseAdmin
          .from('purchase_requests')
          .select('id, created_at, created_by, amount, status, project_id, po_line_id')
          .eq('company_id', companyId)
          .in('project_id', projectIds)
      : { data: [] as Record<string, unknown>[], error: null };
  if (pr1Err) throw pr1Err;

  const { data: prByLine, error: pr2Err } = await supabaseAdmin
    .from('purchase_requests')
    .select('id, created_at, created_by, amount, status, project_id, po_line_id')
    .eq('company_id', companyId)
    .in('po_line_id', lineIds);
  if (pr2Err) throw pr2Err;

  const prMap = new Map<string, Record<string, unknown>>();
  for (const r of [...(prByProject ?? []), ...(prByLine ?? [])]) {
    prMap.set(r.id as string, r);
  }
  const prs = [...prMap.values()];
  const prIds = prs.map((p) => p.id as string);

  const { data: approvals, error: apErr } =
    prIds.length > 0
      ? await supabaseAdmin
          .from('approvals')
          .select('id, request_id, approver_id, role, status, updated_at, updated_by, created_at')
          .eq('company_id', companyId)
          .in('request_id', prIds)
      : { data: [] as Record<string, unknown>[], error: null };
  if (apErr) throw apErr;

  const refUnion = [...new Set([...projectIds, ...prIds])];
  const { data: exceptions, error: exErr } =
    refUnion.length > 0
      ? await supabaseAdmin
          .from('exceptions')
          .select('id, type, reference_id, status, approved_by, created_at')
          .eq('company_id', companyId)
          .in('reference_id', refUnion)
      : { data: [] as Record<string, unknown>[], error: null };
  if (exErr) throw exErr;

  const exIds = (exceptions ?? []).map((e) => e.id as string);

  const auditSelect = 'id, action, user_id, entity_type, entity_id, timestamp, changes';
  const auditRows: Record<string, unknown>[] = [];

  if (prIds.length > 0) {
    const { data: prAudits, error: prAudErr } = await supabaseAdmin
      .from('audit_logs')
      .select(auditSelect)
      .eq('company_id', companyId)
      .eq('entity_type', 'purchase_request')
      .in('entity_id', prIds)
      .eq('action', 'budget_deducted_after_pr_approval');
    if (prAudErr) throw prAudErr;
    auditRows.push(...((prAudits ?? []) as Record<string, unknown>[]));
  }

  if (exIds.length > 0) {
    const { data: exAudits, error: exAudErr } = await supabaseAdmin
      .from('audit_logs')
      .select(auditSelect)
      .eq('company_id', companyId)
      .in('entity_id', exIds)
      .or('entity_type.eq.exception,entity.eq.exception');
    if (exAudErr) throw exAudErr;
    auditRows.push(...((exAudits ?? []) as Record<string, unknown>[]));
  }

  function prTouchesPoGroup(pr: Record<string, unknown> | undefined): boolean {
    if (!pr) return false;
    const pl = pr.po_line_id as string | null;
    if (pl && lineIds.includes(pl)) return true;
    const pj = pr.project_id as string;
    return projectIds.includes(pj);
  }

  const userIdSet = new Set<string>();
  for (const pr of prs) userIdSet.add(pr.created_by as string);
  for (const a of approvals ?? []) {
    if (a.updated_by) userIdSet.add(a.updated_by as string);
    userIdSet.add(a.approver_id as string);
  }
  for (const e of exceptions ?? []) {
    if (e.approved_by) userIdSet.add(e.approved_by as string);
  }
  for (const log of auditRows) {
    if (log.user_id) userIdSet.add(log.user_id as string);
  }

  const users = await loadUsers([...userIdSet], companyId);

  const candidates: Candidate[] = [];

  for (const pr of prs) {
    const prId = pr.id as string;
    const createdAt = String(pr.created_at);
    const uid = pr.created_by as string;
    const amount = num(pr.amount, 0);
    candidates.push({
      ts: createdAt,
      sortKey: new Date(createdAt).getTime(),
      build: () => ({
        type: 'PR Submitted',
        description: `Purchase request ${prId.slice(0, 8)}… submitted (${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} requested).`,
        performed_by: displayUser(users.get(uid)),
        timestamp: createdAt,
        financials: {
          previous_budget: currentGroupRemaining,
          transaction_amount: amount,
          current_budget: currentGroupRemaining,
        },
        reference: { pr_id: prId, approval_stage: null, exception_type: null },
      }),
    });
  }

  for (const a of approvals ?? []) {
    const prId = a.request_id as string;
    if (!prTouchesPoGroup(prMap.get(prId))) continue;
    const st = a.status as string;
    if (st === 'pending') continue;
    const ts = String(a.updated_at ?? a.created_at);
    const role = stageLabel(a.role as string);
    const decider = (a.updated_by as string | null) ?? (a.approver_id as string);
    const isAppr = st === 'approved';
    candidates.push({
      ts,
      sortKey: new Date(ts).getTime(),
      build: () => ({
        type: isAppr ? 'Approved' : 'Rejected',
        description: isAppr
          ? `PR ${prId.slice(0, 8)}… approved at ${role ?? 'stage'}.`
          : `PR ${prId.slice(0, 8)}… rejected at ${role ?? 'stage'}.`,
        performed_by: displayUser(users.get(decider)),
        timestamp: ts,
        financials: {
          previous_budget: currentGroupRemaining,
          transaction_amount: 0,
          current_budget: currentGroupRemaining,
        },
        reference: { pr_id: prId, approval_stage: role, exception_type: null },
      }),
    });
  }

  for (const ex of exceptions ?? []) {
    const ref = ex.reference_id as string;
    const exType = ex.type as string;
    if (exType === 'no_po' && !projectIds.includes(ref)) continue;
    if (exType === 'over_budget' && !prIds.includes(ref)) continue;

    const st = ex.status as string;
    if (st === 'pending') continue;
    const exId = ex.id as string;
    const logs = auditRows.filter(
      (l) =>
        l.entity_id === exId &&
        (String(l.entity_type) === 'exception' || String(l.entity) === 'exception'),
    );
    logs.sort((x, y) => String(y.timestamp).localeCompare(String(x.timestamp)));
    const log = logs[0];
    const ts = log ? String(log.timestamp) : String(ex.created_at);
    const actorId = (log?.user_id as string) ?? (ex.approved_by as string) ?? '';
    const isAppr = st === 'approved';
    const typeLabel =
      exType === 'no_po'
        ? isAppr
          ? 'Exception Approved'
          : 'Exception Rejected'
        : exType === 'over_budget'
          ? isAppr
            ? 'Over-Budget Exception Approved'
            : 'Over-Budget Exception Rejected'
          : 'Exception Updated';

    let description = `${typeLabel} (${exType}).`;
    let refPr: string | null = null;
    if (exType === 'no_po') {
      description = isAppr
        ? `No-PO exception approved for project ${String(ex.reference_id).slice(0, 8)}… — PRs may proceed.`
        : `No-PO exception rejected for project ${String(ex.reference_id).slice(0, 8)}….`;
    } else if (exType === 'over_budget') {
      refPr = ex.reference_id as string;
      description = isAppr
        ? `Over-budget exception approved for PR ${refPr.slice(0, 8)}… — workflow resumed.`
        : `Over-budget exception rejected for PR ${refPr.slice(0, 8)}….`;
    }

    candidates.push({
      ts,
      sortKey: new Date(ts).getTime(),
      build: () => ({
        type: typeLabel,
        description,
        performed_by: displayUser(actorId ? users.get(actorId) : undefined),
        timestamp: ts,
        financials: {
          previous_budget: currentGroupRemaining,
          transaction_amount: 0,
          current_budget: currentGroupRemaining,
        },
        reference: {
          pr_id: refPr,
          approval_stage: null,
          exception_type: exType,
        },
      }),
    });
  }

  for (const log of auditRows) {
    const action = String(log.action);
    if (action !== 'budget_deducted_after_pr_approval') continue;
    const prId = log.entity_id as string;
    const prRow = prMap.get(prId);
    if (!prTouchesPoGroup(prRow)) continue;

    const ts = String(log.timestamp);
    const uid = (log.user_id as string) ?? '';
    const changes = log.changes as Record<string, unknown> | null;
    const finalize = (changes?.finalize as Record<string, unknown>) ?? changes ?? {};
    const amount = num(finalize.amount, 0);
    const deductionType = String(finalize.deduction_type ?? '');

    const poLineId = finalize.po_line_id as string | undefined;
    const purchaseOrderId = finalize.purchase_order_id as string | undefined;
    const hitsPoBalance =
      deductionType === 'po_line' || deductionType === 'project_po'
        ? Boolean(
            (poLineId && lineIds.includes(poLineId)) || (purchaseOrderId && lineIds.includes(purchaseOrderId)),
          )
        : false;

    if (deductionType === 'project_budget') {
      /* Spend came from project budget, not this PO */
      continue;
    }
    if (!hitsPoBalance) continue;

    const transaction_amount = amount;
    const current_budget = currentGroupRemaining;
    const previous_budget = transaction_amount > 0 ? current_budget + transaction_amount : current_budget;

    candidates.push({
      ts,
      sortKey: new Date(ts).getTime(),
      build: () => ({
        type: 'PR Approved (Budget Applied)',
        description: `PR ${prId.slice(0, 8)}… fully approved — ${transaction_amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} deducted from this PO.`,
        performed_by: displayUser(uid ? users.get(uid) : undefined),
        timestamp: ts,
        financials: {
          previous_budget,
          transaction_amount,
          current_budget,
        },
        reference: { pr_id: prId, approval_stage: null, exception_type: null },
      }),
    });
  }

  if (candidates.length === 0) {
    return { po_id: anchorPoLineId, po_number, last_transaction: null };
  }

  candidates.sort((a, b) => {
    if (b.sortKey !== a.sortKey) return b.sortKey - a.sortKey;
    return b.ts.localeCompare(a.ts);
  });

  const winner = candidates[0]!.build();

  return {
    po_id: anchorPoLineId,
    po_number,
    last_transaction: winner,
  };
}
