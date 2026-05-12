'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { AppLayout } from '../../components/AppLayout';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { PageContainer } from '../../components/ui/PageContainer';
import { PageHeader } from '../../components/ui/PageHeader';
import { useAuth } from '../../features/auth/AuthProvider';
import { authedFetchWithSupabase, NoSessionError } from '../../lib/api';

type PurchaseOrderGroup = {
  po: string;
  issue_date: string | null;
  customer: string | null;
  vendor: string | null;
  total_amount: number;
  remaining_amount: number;
  total_value: number;
  remaining_value: number;
  anchor_po_line_id: string;
  created_at: string;
  /** From CSV "Project Name" column (line-item upload). */
  project_name?: string | null;
  /** From CSV Department column(s), first non-empty in PO group. */
  department?: string | null;
  items: Array<{
    id: string;
    item_code: string | null;
    description: string | null;
    line_no: string | null;
    po_line_sn: string | null;
    unit_price: number | null;
    po_amount: number;
    remaining_amount: number;
    department: string | null;
  }>;
};

type DeptRow = { code: string; display_name: string };

function resolvedPoDepartmentFromGroup(group: PurchaseOrderGroup): string | null {
  const top = group.department?.trim();
  if (top) return top;
  for (const it of group.items) {
    const raw = it.department?.trim();
    if (raw) return raw;
  }
  return null;
}

/** Map CSV / PO text (e.g. "BSS") to a configured department code (e.g. bss_wireless → "BSS & Wireless"). */
function matchDepartmentCode(raw: string, departments: DeptRow[]): string | null {
  const t = raw.trim();
  if (!t) return null;
  const tn = t.toLowerCase();

  const byCode = departments.find((d) => d.code === t || d.code.toLowerCase() === tn);
  if (byCode) return byCode.code;

  const byDisplayExact = departments.find((d) => d.display_name.trim().toLowerCase() === tn);
  if (byDisplayExact) return byDisplayExact.code;

  const tokenize = (s: string) =>
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 0);

  for (const d of departments) {
    const words = tokenize(d.display_name);
    if (words.some((w) => w === tn)) return d.code;
  }

  for (const d of departments) {
    const segments = d.code.toLowerCase().split(/[_/-]+/).filter(Boolean);
    if (segments.some((seg) => seg === tn)) return d.code;
  }

  if (tn.length >= 3) {
    for (const d of departments) {
      const display = d.display_name.toLowerCase().trim();
      if (display.startsWith(tn)) return d.code;
    }
  }

  return null;
}

function isDeptManagerRole(role: string | undefined): boolean {
  return role === 'pm' || role === 'dept_head';
}

const ROLES_WITH_PO_LIST = new Set<string>(['admin', 'pm', 'dept_head', 'employee']);

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string | null;
  job_title?: string | null;
};

export default function ProjectsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accessToken, profile, supabase } = useAuth();
  const token = accessToken ?? '';

  const {
    data: poData,
    isLoading: poLoading,
    error: poError,
  } = useQuery({
    queryKey: ['po', 'list'],
    enabled: !!token && !!supabase && ROLES_WITH_PO_LIST.has(profile?.role ?? ''),
    queryFn: async () => {
      try {
        return await authedFetchWithSupabase<{ purchaseOrders: PurchaseOrderGroup[] }>(supabase, '/api/po');
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });

  const { data: departmentsData } = useQuery({
    queryKey: ['departments'],
    enabled: !!token && !!supabase && (profile?.role === 'admin' || isDeptManagerRole(profile?.role)),
    queryFn: async () => {
      try {
        return await authedFetchWithSupabase<{ departments: DeptRow[] }>(supabase, '/api/departments');
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });

  const [department, setDepartment] = useState<string>('technical');
  const effectiveDept = profile?.role === 'admin' ? department : (profile?.department ?? '');

  const { data: deptUsersData } = useQuery({
    queryKey: ['users', 'by-department', effectiveDept, profile?.role],
    enabled:
      !!token && !!supabase && isDeptManagerRole(profile?.role) && !!effectiveDept,
    queryFn: async () => {
      try {
        return await authedFetchWithSupabase<{ users: UserRow[] }>(supabase, '/api/users');
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });

  const { data: adminAllUsersData } = useQuery({
    queryKey: ['users', 'admin-full-list'],
    enabled: !!token && !!supabase && profile?.role === 'admin',
    queryFn: async () => {
      try {
        return await authedFetchWithSupabase<{ users: UserRow[] }>(supabase, '/api/users');
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });

  const canCreate = profile?.role === 'admin' || isDeptManagerRole(profile?.role);

  const [name, setName] = useState('');
  const [poId, setPoId] = useState<string>('');
  const [noPoMode, setNoPoMode] = useState(false);
  const [budget, setBudget] = useState<number>(0);
  const [pmId, setPmId] = useState<string>('');
  const [createTeamLeadId, setCreateTeamLeadId] = useState<string>('');
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(() => new Set());
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const allDepartmentsForSelect = departmentsData?.departments ?? [];

  const deptUsers = useMemo(() => {
    if (profile?.role === 'admin') {
      return (adminAllUsersData?.users ?? []).filter((u) => u.department === effectiveDept);
    }
    return deptUsersData?.users ?? [];
  }, [profile?.role, adminAllUsersData?.users, deptUsersData?.users, effectiveDept]);
  const pmCandidates = useMemo(() => deptUsers.filter((u) => u.role === 'pm'), [deptUsers]);
  const teamLeadCandidates = useMemo(
    () => deptUsers.filter((u) => u.role !== 'admin'),
    [deptUsers],
  );
  const employeePool = useMemo(() => {
    if (profile?.role === 'admin') {
      return (adminAllUsersData?.users ?? []).filter((u) => u.role === 'employee');
    }
    return deptUsers.filter((u) => u.role === 'employee');
  }, [profile?.role, adminAllUsersData?.users, deptUsers]);
  const filteredEmployees = useMemo(() => {
    const q = employeeSearch.trim().toLowerCase();
    if (!q) return employeePool;
    return employeePool.filter(
      (u) =>
        (u.name ?? '').toLowerCase().includes(q) ||
        (u.email ?? '').toLowerCase().includes(q) ||
        (u.job_title ?? '').toLowerCase().includes(q),
    );
  }, [employeePool, employeeSearch]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!pmId || !createTeamLeadId) {
        throw new Error('Project Manager and Team Lead are required');
      }
      const payload: Record<string, unknown> = {
        name,
        pm_id: pmId,
        team_lead_id: createTeamLeadId,
        assigned_employee_ids: [...selectedEmployeeIds],
      };
      payload.department_id = profile?.role === 'admin' ? department : (profile?.department ?? '');
      if (noPoMode) {
        payload.po_id = null;
        payload.budget = Number(budget);
      } else {
        payload.po_id = poId ? poId : null;
      }
      try {
        return await authedFetchWithSupabase<unknown>(supabase, '/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
    onSuccess: () => {
      setError(null);
      setName('');
      setPoId('');
      setNoPoMode(false);
      setBudget(0);
      setPmId('');
      setCreateTeamLeadId('');
      setSelectedEmployeeIds(new Set());
      setEmployeeSearch('');
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Create failed'),
  });

  const poOptions = useMemo(() => poData?.purchaseOrders ?? [], [poData]);

  const selectedPoGroup = useMemo(
    () => poOptions.find((g) => g.anchor_po_line_id === poId) ?? null,
    [poOptions, poId],
  );

  useEffect(() => {
    if (noPoMode) return;

    if (!poId) {
      setName('');
      return;
    }

    if (!selectedPoGroup) return;

    const nameFromUpload =
      (selectedPoGroup.project_name && selectedPoGroup.project_name.trim()) || selectedPoGroup.po;
    setName(nameFromUpload);

    if (profile?.role !== 'admin' || allDepartmentsForSelect.length === 0) return;

    const rawDept = resolvedPoDepartmentFromGroup(selectedPoGroup);
    const code = rawDept ? matchDepartmentCode(rawDept, allDepartmentsForSelect) : null;
    if (!code) return;

    let deptChanged = false;
    setDepartment((prev) => {
      if (prev === code) return prev;
      deptChanged = true;
      return code;
    });
    if (deptChanged) {
      setPmId('');
      setCreateTeamLeadId('');
      setSelectedEmployeeIds(new Set());
    }
  }, [noPoMode, poId, selectedPoGroup, profile?.role, allDepartmentsForSelect]);

  const toggleEmployee = (id: string, checked: boolean) => {
    setSelectedEmployeeIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedEmployeeIds((prev) => {
      const next = new Set(prev);
      for (const u of filteredEmployees) next.add(u.id);
      return next;
    });
  };

  const clearEmployeeSelection = () => setSelectedEmployeeIds(new Set());

  const departmentBadgeClass =
    'inline-flex items-center rounded-full border border-orange-300/60 dark:border-orange-600/50 bg-orange-100/90 dark:bg-orange-950/45 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-orange-900 dark:text-orange-200';

  return (
    <AppLayout>
      <PageContainer className="space-y-6">
        <PageHeader
          title="Projects"
          subtitle="Create a project here. View all projects, PDFs, and date filters on Reports."
        />

        <Card className="p-6">
          <h2 className="text-lg font-medium">Create Project</h2>
          {!canCreate ? (
            <div className="text-sm text-muted-foreground mt-3">Your role does not have permission to create projects.</div>
          ) : (
            <form
              className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!pmId || !createTeamLeadId) {
                  setError('Project Manager and Team Lead are required.');
                  return;
                }
                setError(null);
                mutation.mutate();
              }}
            >
              <div className="md:col-span-2 flex items-center gap-3">
                <input
                  id="no-po"
                  type="checkbox"
                  checked={noPoMode}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setNoPoMode(checked);
                    if (checked) setPoId('');
                  }}
                  className="h-4 w-4 rounded border border-stone-400 dark:border-stone-500 bg-[var(--surface)] dark:bg-stone-900 accent-orange-600"
                />
                <label htmlFor="no-po" className="text-sm text-muted-foreground">
                  Create without PO (raises `no_po` exception)
                </label>
              </div>

              {!noPoMode ? (
                <div className="md:col-span-2 space-y-2">
                  <label className="block text-sm font-medium">Select PO</label>
                  <select
                    className="w-full rounded-lg border border-stone-200 dark:border-stone-600 bg-[var(--surface)] dark:bg-stone-900 px-3 py-2 text-sm text-stone-900 dark:text-stone-100 outline-none focus:ring-2 focus:ring-orange-500/25 dark:focus:ring-orange-400/25 focus:border-orange-400 dark:focus:border-orange-500 shadow-sm"
                    value={poId}
                    onChange={(e) => setPoId(e.target.value)}
                    disabled={poLoading}
                  >
                    <option value="">-- Choose PO --</option>
                    {poOptions.map((g) => (
                      <option key={g.anchor_po_line_id} value={g.anchor_po_line_id}>
                        {g.po} ({g.vendor ?? '—'})
                        {g.items.length > 1 ? ` · ${g.items.length} line items` : ''}
                      </option>
                    ))}
                  </select>
                  {selectedPoGroup && selectedPoGroup.items.length > 0 ? (
                    <div className="rounded-lg border border-stone-200/90 dark:border-stone-600/70 bg-stone-100/80 dark:bg-stone-800/50 p-3 text-xs space-y-2">
                      <div className="font-medium text-foreground">Lines on this PO</div>
                      <ul className="space-y-1 text-muted-foreground list-disc list-inside">
                        {selectedPoGroup.items.map((it) => (
                          <li key={it.id}>
                            <span className="text-foreground">{it.item_code ?? it.po_line_sn ?? '—'}</span>
                            {it.description ? ` — ${it.description}` : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <div className="text-xs text-muted-foreground">
                    Budget is the sum of all lines for this PO (remaining value). Project name and department (admin) fill from the PO when you select one.
                  </div>
                  {poError ? <div className="text-sm text-rose-600 dark:text-rose-400">{String(poError)}</div> : null}
                </div>
              ) : (
                <div className="md:col-span-2 space-y-2">
                  <label className="block text-sm font-medium">Budget (required)</label>
                  <Input
                    type="number"
                    value={budget}
                    onChange={(e) => setBudget(Number(e.target.value))}
                    min={0.01}
                    step="0.01"
                    required
                  />
                </div>
              )}

              {profile?.role === 'admin' ? (
                <div className="md:col-span-2 space-y-2">
                  <label className="block text-sm font-medium">Department</label>
                  <select
                    className="w-full rounded-lg border border-stone-200 dark:border-stone-600 bg-[var(--surface)] dark:bg-stone-900 px-3 py-2 text-sm text-stone-900 dark:text-stone-100 outline-none focus:ring-2 focus:ring-orange-500/25 dark:focus:ring-orange-400/25 focus:border-orange-400 dark:focus:border-orange-500 shadow-sm"
                    value={department}
                    onChange={(e) => {
                      setDepartment(e.target.value);
                      setPmId('');
                      setCreateTeamLeadId('');
                      setSelectedEmployeeIds(new Set());
                    }}
                  >
                    {allDepartmentsForSelect.map((d) => (
                      <option key={d.code} value={d.code}>
                        {d.display_name}
                      </option>
                    ))}
                  </select>
                  <div className="text-xs text-muted-foreground">
                    Choose manually, or when you pick a PO it fills from the CSV Department column when it matches a department
                    (e.g. BSS matches BSS & Wireless).
                  </div>
                </div>
              ) : isDeptManagerRole(profile?.role) ? (
                <div className="md:col-span-2 space-y-2">
                  <label className="block text-sm font-medium">Department</label>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={departmentBadgeClass}>
                      {allDepartmentsForSelect.find((d) => d.code === profile?.department)?.display_name ??
                        profile?.department ??
                        '—'}
                    </span>
                    <span className="text-xs text-muted-foreground">Projects are created for this department only.</span>
                  </div>
                </div>
              ) : (
                <div className="md:col-span-2 text-xs text-muted-foreground">
                  New projects are created in your department: <span className="text-foreground">{profile?.department}</span>
                </div>
              )}

              <div className="md:col-span-2 space-y-2">
                <label className="block text-sm font-medium">Project Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} required />
              </div>

              <div className="md:col-span-2 space-y-2">
                <label className="block text-sm font-medium">Project Manager</label>
                <select
                  className="w-full rounded-lg border border-stone-200 dark:border-stone-600 bg-[var(--surface)] dark:bg-stone-900 px-3 py-2 text-sm text-stone-900 dark:text-stone-100 outline-none focus:ring-2 focus:ring-orange-500/25 dark:focus:ring-orange-400/25 focus:border-orange-400 dark:focus:border-orange-500 shadow-sm"
                  value={pmId}
                  onChange={(e) => setPmId(e.target.value)}
                  required
                  disabled={!effectiveDept}
                >
                  <option value="">Select PM ({effectiveDept || '…'})</option>
                  {pmCandidates.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name ?? u.email} — PM
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2 space-y-2">
                <label className="block text-sm font-medium">Team Lead</label>
                <select
                  className="w-full rounded-lg border border-stone-200 dark:border-stone-600 bg-[var(--surface)] dark:bg-stone-900 px-3 py-2 text-sm text-stone-900 dark:text-stone-100 outline-none focus:ring-2 focus:ring-orange-500/25 dark:focus:ring-orange-400/25 focus:border-orange-400 dark:focus:border-orange-500 shadow-sm"
                  value={createTeamLeadId}
                  onChange={(e) => setCreateTeamLeadId(e.target.value)}
                  required
                  disabled={!effectiveDept}
                >
                  <option value="">Select team lead</option>
                  {teamLeadCandidates.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name ?? u.email} ({u.role})
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2 space-y-2 rounded-lg border border-stone-200/90 dark:border-stone-600/70 bg-orange-50/40 dark:bg-stone-800/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="block text-sm font-medium">Assigned employees</label>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" className="text-xs py-1 px-2" onClick={selectAllFiltered}>
                      Select all (filtered)
                    </Button>
                    <Button type="button" variant="secondary" className="text-xs py-1 px-2" onClick={clearEmployeeSelection}>
                      Clear
                    </Button>
                  </div>
                </div>
                <Input
                  placeholder="Search by name, email, or job title…"
                  value={employeeSearch}
                  onChange={(e) => setEmployeeSearch(e.target.value)}
                  className="text-sm"
                />
                <div className="text-xs text-muted-foreground">
                  Only <span className="text-foreground">employee</span> users in this department. PM cannot be duplicated as a member row.
                </div>
                <div className="max-h-[200px] overflow-y-auto rounded border border-stone-200/90 dark:border-stone-600/70 divide-y divide-stone-100 dark:divide-stone-700 bg-[var(--surface)] dark:bg-stone-900/60">
                  {filteredEmployees.length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground">No employees match.</div>
                  ) : (
                    filteredEmployees.map((u) => (
                      <label
                        key={u.id}
                        className="flex items-start gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-orange-50/60 dark:hover:bg-stone-800/80"
                      >
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 rounded border border-stone-400 dark:border-stone-500 bg-[var(--surface)] dark:bg-stone-900 accent-orange-600"
                          checked={selectedEmployeeIds.has(u.id)}
                          onChange={(e) => toggleEmployee(u.id, e.target.checked)}
                        />
                        <span>
                          <span className="text-foreground">{u.name ?? u.email}</span>
                          <span className="text-muted-foreground text-xs ml-2">{u.email}</span>
                          {u.job_title ? (
                            <span className="ml-2 text-[11px] uppercase tracking-wide text-amber-700">{u.job_title}</span>
                          ) : null}
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              {error ? <div className="md:col-span-2 text-sm text-rose-600 dark:text-rose-400">{error}</div> : null}

              <Button className="md:col-span-2" disabled={mutation.isPending} type="submit">
                {mutation.isPending ? 'Creating...' : 'Create Project'}
              </Button>
            </form>
          )}
        </Card>
      </PageContainer>
    </AppLayout>
  );
}
