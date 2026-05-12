import { supabaseAdmin } from '../../config/supabase';
import type { UserRole } from '../auth/types';
import { bypassesDepartmentScope } from '../auth/types';

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
    const { data: links, error: linkErr } = await supabaseAdmin
      .from('projects')
      .select('department_id, po_id')
      .eq('company_id', companyId)
      .not('po_id', 'is', null)
      .in('department_id', allowedCodes);
    if (linkErr) throw linkErr;

    const deptToPoIds = new Map<string, Set<string>>();
    for (const l of links ?? []) {
      const d = l.department_id as string;
      const pid = l.po_id as string;
      if (!byCode.has(d)) continue;
      if (!deptToPoIds.has(d)) deptToPoIds.set(d, new Set());
      deptToPoIds.get(d)!.add(pid);
    }

    const allPoIds = [...new Set([...deptToPoIds.values()].flatMap((s) => [...s]))];
    if (allPoIds.length === 0) {
      return { section, departments: [...byCode.values()] };
    }

    const { data: poRows, error: poErr } = await supabaseAdmin
      .from('purchase_orders')
      .select('id, po_number, vendor, total_value, remaining_value')
      .eq('company_id', companyId)
      .in('id', allPoIds);
    if (poErr) throw poErr;

    const poMap = new Map((poRows ?? []).map((r) => [r.id as string, r]));

    const projectLinksPerDeptPo = new Map<string, number>();
    for (const l of links ?? []) {
      const d = l.department_id as string;
      const pid = l.po_id as string;
      const k = `${d}::${pid}`;
      projectLinksPerDeptPo.set(k, (projectLinksPerDeptPo.get(k) ?? 0) + 1);
    }

    for (const [dept, ids] of deptToPoIds) {
      const b = byCode.get(dept);
      if (!b) continue;
      for (const poId of ids) {
        const row = poMap.get(poId);
        if (!row) continue;
        const linkKey = `${dept}::${poId}`;
        b.poRecords.push({
          id: poId,
          label: String(row.po_number ?? '').trim() || poId.slice(0, 8),
          vendor: (row.vendor as string | null) ?? null,
          total_value: Number(row.total_value ?? 0),
          remaining_value: Number(row.remaining_value ?? 0),
          line_count: projectLinksPerDeptPo.get(linkKey) ?? 1,
        });
      }
      b.poRecords.sort((a, c) => a.label.localeCompare(c.label));
    }
  }

  return {
    section,
    departments: allowedCodes.map((code) => byCode.get(code)!).filter(Boolean),
  };
}
