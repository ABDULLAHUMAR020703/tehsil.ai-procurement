import { supabaseAdmin } from '../../config/supabase';
import type { UserRole } from '../auth/types';
import { bypassesDepartmentScope } from '../auth/types';
import { matchDepartmentCodeFromPoField } from '../departments/service';
import { fetchActivePurchaseOrderLines } from '../po/fetchPoLines';
import { budgetPairFromRow, purchaseOrderGroupKey } from '../po/groupByPo';

export type DashboardDrillSection = 'projects' | 'approvals' | 'exceptions' | 'po';

export type DeptProjectRow = { id: string; name: string; status: string };
export type DeptApprovalRow = {
  id: string;
  request_id: string;
  role: string;
  status: string;
  pr_description: string;
};
export type DeptExceptionRow = {
  id: string;
  type: string;
  status: string;
  reference_id: string;
  severity: 'high' | 'medium';
};
export type DeptPoRow = {
  id: string;
  label: string;
  vendor: string | null;
  total_value: number;
  remaining_value: number;
  line_count: number;
};

export type DashboardDepartmentBucket = {
  name: string;
  code: string;
  projects: DeptProjectRow[];
  pendingApprovals: DeptApprovalRow[];
  exceptions: DeptExceptionRow[];
  poRecords: DeptPoRow[];
};

function exceptionSeverity(type: string): 'high' | 'medium' {
  return type === 'over_budget' ? 'high' : 'medium';
}

export async function fetchDashboardDepartmentsBreakdown(params: {
  section: DashboardDrillSection;
  actorRole: UserRole;
  actorDepartment: string | null;
  companyId: string;
}): Promise<{ section: DashboardDrillSection; departments: DashboardDepartmentBucket[] }> {
  const { section, actorRole, actorDepartment, companyId } = params;

  const { data: deptRows, error: deptErr } = await supabaseAdmin
    .from('departments')
    .select('code, display_name')
    .eq('company_id', companyId)
    .order('display_name');
  if (deptErr) throw deptErr;

  const allDepts = (deptRows ?? []) as { code: string; display_name: string }[];
  const allowedCodes: string[] = bypassesDepartmentScope(actorRole)
    ? allDepts.map((d) => d.code)
    : actorDepartment
      ? [actorDepartment]
      : [];

  if (allowedCodes.length === 0) {
    return { section, departments: [] };
  }

  const displayName = (code: string) => allDepts.find((d) => d.code === code)?.display_name ?? code;

  const emptyBucket = (code: string): DashboardDepartmentBucket => ({
    name: displayName(code),
    code,
    projects: [],
    pendingApprovals: [],
    exceptions: [],
    poRecords: [],
  });

  const byCode = new Map<string, DashboardDepartmentBucket>();
  for (const code of allowedCodes) {
    byCode.set(code, emptyBucket(code));
  }

  if (section === 'projects') {
    const { data: projects, error } = await supabaseAdmin
      .from('projects')
      .select('id, name, status, department_id')
      .eq('company_id', companyId)
      .in('department_id', allowedCodes);
    if (error) throw error;
    for (const p of projects ?? []) {
      const code = p.department_id as string;
      const b = byCode.get(code);
      if (!b) continue;
      b.projects.push({
        id: p.id as string,
        name: String(p.name ?? ''),
        status: String(p.status ?? ''),
      });
    }
  }

  if (section === 'approvals') {
    const { data: rows, error } = await supabaseAdmin
      .from('approvals')
      .select(
        'id, request_id, role, status, purchase_requests ( description, projects ( department_id ) )',
      )
      .eq('company_id', companyId)
      .eq('status', 'pending');
    if (error) throw error;
    for (const r of rows ?? []) {
      const pr = r.purchase_requests as
        | { description?: string | null; projects?: { department_id?: string | null } | null }
        | null
        | undefined;
      const dept = pr?.projects?.department_id ?? null;
      if (!dept || !byCode.has(dept)) continue;
      byCode.get(dept)!.pendingApprovals.push({
        id: r.id as string,
        request_id: r.request_id as string,
        role: String(r.role ?? ''),
        status: String(r.status ?? ''),
        pr_description: String(pr?.description ?? ''),
      });
    }
  }

  if (section === 'exceptions') {
    const { data: exRows, error: exErr } = await supabaseAdmin
      .from('exceptions')
      .select('id, type, status, reference_id')
      .eq('company_id', companyId)
      .eq('status', 'pending');
    if (exErr) throw exErr;
    const list = exRows ?? [];
    const noPoIds = list.filter((e) => e.type === 'no_po').map((e) => e.reference_id as string);
    const obIds = list.filter((e) => e.type === 'over_budget').map((e) => e.reference_id as string);

    const projectDept = new Map<string, string>();
    if (noPoIds.length) {
      const { data: projs, error: pErr } = await supabaseAdmin
        .from('projects')
        .select('id, department_id')
        .eq('company_id', companyId)
        .in('id', noPoIds);
      if (pErr) throw pErr;
      for (const p of projs ?? []) {
        projectDept.set(p.id as string, p.department_id as string);
      }
    }
    if (obIds.length) {
      const { data: prs, error: prErr } = await supabaseAdmin
        .from('purchase_requests')
        .select('id, project_id, projects ( department_id )')
        .eq('company_id', companyId)
        .in('id', obIds);
      if (prErr) throw prErr;
      for (const pr of prs ?? []) {
        const proj = pr.projects as { department_id?: string } | null | undefined;
        const d = proj?.department_id;
        if (d) projectDept.set(pr.id as string, d);
      }
    }

    for (const e of list) {
      const ref = e.reference_id as string;
      let dept: string | null = null;
      if (e.type === 'no_po') dept = projectDept.get(ref) ?? null;
      else if (e.type === 'over_budget') dept = projectDept.get(ref) ?? null;
      if (!dept || !byCode.has(dept)) continue;
      byCode.get(dept)!.exceptions.push({
        id: e.id as string,
        type: String(e.type ?? ''),
        status: String(e.status ?? ''),
        reference_id: ref,
        severity: exceptionSeverity(String(e.type ?? '')),
      });
    }
  }

  if (section === 'po') {
    const deptCatalog = allDepts.filter((d) => allowedCodes.includes(d.code));
    const poLines = await fetchActivePurchaseOrderLines(companyId);

    type PoAgg = {
      id: string;
      label: string;
      vendor: string | null;
      total_value: number;
      remaining_value: number;
      line_count: number;
    };
    const deptPoGroups = new Map<string, Map<string, PoAgg>>();

    for (const line of poLines) {
      const deptCode = matchDepartmentCodeFromPoField(line.department, deptCatalog);
      if (!deptCode || !byCode.has(deptCode)) continue;

      const groupKey = purchaseOrderGroupKey(line);
      const label =
        String(line.po ?? line.po_number ?? '').trim() ||
        `Legacy row - ${String(line.id).slice(0, 8)}`;
      const { amount, remaining } = budgetPairFromRow(line);

      if (!deptPoGroups.has(deptCode)) deptPoGroups.set(deptCode, new Map());
      const groups = deptPoGroups.get(deptCode)!;
      const existing = groups.get(groupKey);
      if (existing) {
        existing.total_value += amount;
        existing.remaining_value += remaining;
        existing.line_count += 1;
        if (!existing.vendor && line.vendor) existing.vendor = String(line.vendor);
      } else {
        groups.set(groupKey, {
          id: line.id,
          label,
          vendor: line.vendor != null ? String(line.vendor) : null,
          total_value: amount,
          remaining_value: remaining,
          line_count: 1,
        });
      }
    }

    for (const [deptCode, groups] of deptPoGroups) {
      const bucket = byCode.get(deptCode);
      if (!bucket) continue;
      bucket.poRecords = [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
    }
  }

  return {
    section,
    departments: allowedCodes.map((code) => byCode.get(code)!).filter(Boolean),
  };
}
